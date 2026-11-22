// Linkpage server: public page, login/setup, and the admin API. No external dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import * as db from './db.js';
import * as auth from './auth.js';
import { normState, collectFiles, clickTargets, FILE_RE } from './model.js';
import { renderPage, faviconSvg, FONTS } from './render.js';
import { authPage } from './pages.js';
import { ICONS } from './icons-data.js';
import { DEFAULT_CONFIG, DEFAULT_BLOCKS } from './defaults.js';
import { MIME, sniff, saveMedia, cleanupMedia, fetchFavicon, ensureIcons } from './media.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;

// ---- first run: seed placeholder content -------------------------------------
if (!db.hasConfig()) {
  const seeded = normState({ config: DEFAULT_CONFIG, blocks: DEFAULT_BLOCKS });
  db.saveState(seeded);
  // Fetch favicons for the demo links in the background (merged in safely, never overwrites your edits).
  ensureIcons(seeded.blocks).then(() => {
    const all = (bs) => bs.flatMap((b) => [b, ...(b.items || [])]);
    const fresh = new Map(all(seeded.blocks).map((o) => [o.id, o]));
    const cur = db.getBlocks();
    for (const o of all(cur)) {
      const f = fresh.get(o.id);
      if (f?.icon?.file && o.icon?.mode === 'auto' && !o.icon.file) { o.icon.file = f.icon.file; o.icon.for = f.icon.for; }
    }
    db.saveState({ config: db.getConfig(), blocks: cur });
    invalidate();
  }).catch(() => {});
}
auth.initSetupCode();

// ---- small helpers ----------------------------------------------------------------
const SEC = { 'X-Content-Type-Options': 'nosniff' };
const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SEC, ...headers }); res.end(body); };
const json = (res, obj, status = 200) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
const fail = (status, message) => Object.assign(new Error(message), { status });
const redirect = (res, to) => send(res, 302, '', { Location: to, 'Cache-Control': 'no-store' });
const notFound = (res) => send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });

async function readBody(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw fail(413, 'File or request is too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(req, limit = 2e6) {
  try { return JSON.parse((await readBody(req, limit)).toString('utf8') || '{}'); } catch (e) { throw e.status ? e : fail(400, 'Bad request'); }
}

function baseUrl(req) {
  const proto = auth.TRUST_PROXY ? (req.headers['x-forwarded-proto'] || 'http').split(',')[0] : 'http';
  const host = (auth.TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  return /^[a-z0-9.\-:[\]]+$/i.test(host) && /^https?$/.test(proto) ? `${proto}://${host}` : 'http://localhost';
}

// ---- public page (rendered once, cached, pre-compressed) ----------------------------
const pageCache = new Map();
let targets = new Set();
const refreshTargets = () => { targets = new Set(clickTargets(db.getBlocks()).keys()); };
refreshTargets();

function buildPage(base) {
  const html = renderPage({ config: db.getConfig(), blocks: db.getBlocks() }, { base });
  return { at: Date.now(), etag: `"${crypto.createHash('sha1').update(html).digest('hex').slice(0, 16)}"`, raw: Buffer.from(html), br: zlib.brotliCompressSync(html, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }), gz: zlib.gzipSync(html, { level: 9 }) };
}
function home(req, res) {
  const base = baseUrl(req);
  let c = pageCache.get(base);
  if (!c || Date.now() - c.at > 30e3) { // 30s max age so scheduled links appear/disappear on time
    c = buildPage(base); pageCache.set(base, c);
    if (pageCache.size > 8) pageCache.delete(pageCache.keys().next().value);
  }
  const h = { 'Content-Type': 'text/html; charset=utf-8', ETag: c.etag, 'Cache-Control': 'public, max-age=30', Vary: 'Accept-Encoding', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
  if (req.headers['if-none-match'] === c.etag) return send(res, 304, '', h);
  const ae = req.headers['accept-encoding'] || '';
  if (/\bbr\b/.test(ae)) return send(res, 200, c.br, { ...h, 'Content-Encoding': 'br' });
  if (/\bgzip\b/.test(ae)) return send(res, 200, c.gz, { ...h, 'Content-Encoding': 'gzip' });
  send(res, 200, c.raw, h);
}
const invalidate = () => { pageCache.clear(); refreshTargets(); };

function media(res, name) {
  const type = MIME[path.extname(name).slice(1).toLowerCase()];
  if (!FILE_RE.test(name) || !type) return notFound(res);
  fs.readFile(path.join(db.MEDIA_DIR, name), (err, buf) => {
    if (err) return notFound(res);
    send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  });
}

function favicon(res) {
  const c = db.getConfig();
  const f = c.site.favicon;
  if (f && FILE_RE.test(f)) {
    try { return send(res, 200, fs.readFileSync(path.join(db.MEDIA_DIR, f)), { 'Content-Type': MIME[path.extname(f).slice(1)] || 'image/png', 'Cache-Control': 'public, max-age=3600' }); } catch { /* use generated */ }
  }
  send(res, 200, faviconSvg(c), { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
}

// ---- routing -----------------------------------------------------------------------------
async function route(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname, m = req.method;
  const get = m === 'GET' || m === 'HEAD';

  if (get) {
    if (p === '/') return home(req, res);
    if (p.startsWith('/media/')) return media(res, p.slice(7));
    if (p === '/favicon' || p === '/favicon.ico') return favicon(res);
    if (p === '/robots.txt') return send(res, 200, `User-agent: *\n${db.getConfig().site.robots ? 'Allow: /\nDisallow: /admin' : 'Disallow: /'}\n`, { 'Content-Type': 'text/plain' });
    if (p === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (p === '/setup' || p === '/login') {
      const hasUser = db.userCount() > 0;
      if (p === '/setup' && hasUser) return redirect(res, '/login');
      if (p === '/login' && !hasUser) return redirect(res, '/setup');
      return send(res, 200, authPage(p.slice(1)), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
    }
  }

  if (m === 'POST' && p.startsWith('/api/c/')) { // click counter (anonymous, no personal data)
    const id = p.slice(7);
    if (targets.has(id) && auth.rate('click:' + auth.clientIp(req), 120, 60e3)) db.addClick(id);
    return send(res, 204, '');
  }

  if (m === 'POST' && (p === '/auth/login' || p === '/auth/setup')) return authRoutes(req, res, p);
  if (p === '/admin' || p.startsWith('/admin/')) return admin(req, res, u);
  notFound(res);
}

async function authRoutes(req, res, p) {
  if (!auth.originOk(req)) throw fail(403, 'Blocked cross-site request');
  const ip = auth.clientIp(req);
  const b = await readJson(req, 10e3);
  const username = String(b.username || '').trim(), password = String(b.password || '');

  if (p === '/auth/setup') {
    if (db.userCount() > 0 || !auth.setupActive()) throw fail(403, 'Setup is already complete');
    if (!auth.rate('setup:' + ip, 10, 15 * 60e3)) throw fail(429, 'Too many attempts. Please wait 15 minutes.');
    if (!auth.checkSetupCode(b.code)) throw fail(403, 'That setup code is not right. Check your server logs.');
    if (!/^[a-zA-Z0-9._@-]{3,40}$/.test(username)) throw fail(400, 'Username: 3-40 letters, numbers, dots, dashes or underscores.');
    if (password.length < 10 || password.length > 200) throw fail(400, 'Password must be at least 10 characters.');
    const hash = await auth.hashPassword(password);
    if (db.userCount() > 0) throw fail(403, 'Setup is already complete');
    const id = db.createUser(username, hash);
    auth.clearSetupCode();
    const token = await auth.newSession(Number(id));
    return send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json', 'Set-Cookie': auth.sessionCookie(token, req) });
  }

  if (!auth.rate('login:' + ip, 8, 15 * 60e3)) throw fail(429, 'Too many attempts. Please wait 15 minutes.');
  const user = db.getUserByName(username);
  const ok = await auth.verifyPassword(password, user ? user.hash : auth.DUMMY_HASH);
  if (!user || !ok) throw fail(401, 'Wrong username or password.');
  auth.rateReset('login:' + ip);
  const token = await auth.newSession(user.id);
  send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json', 'Set-Cookie': auth.sessionCookie(token, req) });
}

const ADMIN_FILES = { '/admin': ['admin/index.html', 'text/html; charset=utf-8'], '/admin/': ['admin/index.html', 'text/html; charset=utf-8'],
  '/admin/admin.js': ['admin/admin.js', 'text/javascript; charset=utf-8'], '/admin/admin.css': ['admin/admin.css', 'text/css; charset=utf-8'] };

async function admin(req, res, u) {
  const p = u.pathname;
  const user = await auth.authenticate(req);
  if (!user) {
    if (p.startsWith('/admin/api/')) return json(res, { error: 'Please sign in again.' }, 401);
    return redirect(res, db.userCount() ? '/login' : '/setup');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !auth.originOk(req)) throw fail(403, 'Blocked cross-site request');
  const f = ADMIN_FILES[p];
  if (f) return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, f[0])), { 'Content-Type': f[1], 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  if (p.startsWith('/admin/api/')) return api(req, res, u, user, p.slice(11));
  notFound(res);
}

const UPLOAD = { icon: 1e6, favicon: 1e6, avatar: 5e6, og: 5e6 };

async function api(req, res, u, user, name) {
  const m = req.method;

  if (name === 'state' && m === 'GET') {
    return json(res, { config: db.getConfig(), blocks: db.getBlocks(), icons: ICONS, fonts: Object.keys(FONTS), user: user.username, cf: !!user.cf, cfEnabled: auth.cfEnabled });
  }
  if (name === 'state' && m === 'PUT') {
    const s = normState(await readJson(req, 4e6));
    await ensureIcons(s.blocks);
    db.saveState(s);
    invalidate();
    cleanupMedia(collectFiles(s.config, s.blocks));
    return json(res, s);
  }
  if (name === 'preview' && m === 'POST') {
    const s = normState(await readJson(req, 4e6));
    return send(res, 200, renderPage(s, { base: baseUrl(req), preview: true }), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  if (name === 'upload' && m === 'POST') {
    const kind = u.searchParams.get('kind');
    if (!UPLOAD[kind]) throw fail(400, 'Unknown upload type');
    const buf = await readBody(req, UPLOAD[kind]);
    if (!sniff(buf)) throw fail(415, 'That file is not a supported image (PNG, JPG, WebP, GIF, SVG or ICO).');
    return json(res, { file: saveMedia(buf, kind === 'icon' ? 'ic' : kind) });
  }
  if (name === 'icon/fetch' && m === 'POST') {
    if (!auth.rate('fav:' + user.id, 60, 60e3)) throw fail(429, 'Slow down a little');
    const b = await readJson(req, 5e3);
    return json(res, { file: await fetchFavicon(String(b.url || '')) });
  }
  if (name === 'stats' && m === 'GET') {
    const names = clickTargets(db.getBlocks());
    const rows = db.getStats().filter((r) => names.has(r.id)).map((r) => ({ ...r, title: names.get(r.id) }));
    for (const [id, title] of names) if (!rows.find((r) => r.id === id)) rows.push({ id, title, total: 0, d30: 0, d7: 0 });
    return json(res, { rows: rows.sort((a, b) => b.total - a.total) });
  }
  if (name === 'password' && m === 'POST') {
    const b = await readJson(req, 10e3);
    const row = db.getUserById(user.id);
    if (!auth.rate('pw:' + user.id, 8, 15 * 60e3)) throw fail(429, 'Too many attempts. Please wait.');
    if (!row || !(await auth.verifyPassword(String(b.current || ''), row.hash))) throw fail(403, 'Your current password is not right.');
    const next = String(b.next || '');
    if (next.length < 10 || next.length > 200) throw fail(400, 'New password must be at least 10 characters.');
    db.setPassword(user.id, await auth.hashPassword(next));
    db.deleteSessionsFor(user.id, auth.sessionHash(req)); // sign out everywhere else
    return json(res, { ok: true });
  }
  if (name === 'export' && m === 'GET') {
    const config = db.getConfig(), blocks = db.getBlocks(), files = {};
    for (const f of collectFiles(config, blocks)) { try { files[f] = fs.readFileSync(path.join(db.MEDIA_DIR, f)).toString('base64'); } catch { /* missing */ } }
    return send(res, 200, JSON.stringify({ app: 'linkpage', version: 1, exported: new Date().toISOString(), config, blocks, files }, null, 1),
      { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="linkpage-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
  }
  if (name === 'import' && m === 'POST') {
    const b = await readJson(req, 80e6);
    if (b.app !== 'linkpage' || !b.config || !Array.isArray(b.blocks)) throw fail(400, 'This does not look like a Linkpage backup file.');
    for (const [f, data] of Object.entries(b.files || {})) {
      if (!FILE_RE.test(f) || typeof data !== 'string') continue;
      const buf = Buffer.from(data, 'base64');
      if (sniff(buf) && f.endsWith('.' + sniff(buf))) fs.writeFileSync(path.join(db.MEDIA_DIR, f), buf);
    }
    const s = normState(b);
    db.saveState(s); invalidate();
    return json(res, s);
  }
  if (name === 'logout' && m === 'POST') {
    db.deleteSession(auth.sessionHash(req));
    return send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json', 'Set-Cookie': auth.clearCookie(req) });
  }
  notFound(res);
}

// ---- start ---------------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (res.headersSent) return res.end();
    json(res, { error: e.status ? e.message : 'Something went wrong on the server.' }, e.status || 500);
  });
});
server.keepAliveTimeout = 65e3;
server.listen(PORT, HOST, () => console.log(`Linkpage is running on http://${HOST}:${PORT}  (data: ${db.DATA_DIR})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
