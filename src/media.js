// Everything to do with images: validating uploads, fetching favicons safely, cleaning up.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { MEDIA_DIR } from './db.js';

export const MIME = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif'
};

// ---- file type detection (we never trust the browser's content-type) -----
const BAD_SVG = /<script|<foreignObject|\son\w+\s*=|javascript:|<iframe|<embed|<object|<!ENTITY|<!DOCTYPE[^>]*\[|<link|<meta|<use[^>]+href\s*=\s*["']?https?:/i;
export function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  const h4 = buf.toString('latin1', 0, 4);
  if (h4 === 'GIF8') return 'gif';
  if (h4 === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico';
  if (buf.length > 12 && buf.toString('latin1', 4, 12) === 'ftypavif') return 'avif';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 2048)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return BAD_SVG.test(buf.toString('utf8')) ? null : 'svg';
  }
  return null;
}

// Files are named after their content hash, so they can be cached forever.
export function saveMedia(buf, prefix = 'up') {
  const ext = sniff(buf);
  if (!ext) return null;
  const name = `${prefix}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
  const f = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
  else fs.utimesSync(f, new Date(), new Date());
  return name;
}

// Delete files nothing refers to any more (with a 1 hour grace period for fresh uploads).
export function cleanupMedia(inUse) {
  try {
    for (const name of fs.readdirSync(MEDIA_DIR)) {
      if (inUse.has(name)) continue;
      const f = path.join(MEDIA_DIR, name);
      if (Date.now() - fs.statSync(f).mtimeMs > 3600e3) fs.unlinkSync(f);
    }
  } catch { /* ignore */ }
}

// ---- SSRF-safe HTTP GET ---------------------------------------------------
// The favicon fetcher makes requests to URLs the admin typed in. These checks make sure
// it can never be used to poke at your home network or the server itself.
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const s = ip.toLowerCase();
  return !/^[23]/.test(s) || s.startsWith('2002:'); // only allow global unicast IPv6
}
const lookup = (host, opts, cb) => dns.lookup(host, { all: true }, (err, addrs) => {
  if (err) return cb(err);
  const ok = addrs.filter((a) => !isPrivate(a.address));
  if (!ok.length) return cb(new Error('blocked address'));
  if (opts && opts.all) return cb(null, ok);
  cb(null, ok[0].address, ok[0].family);
});

export function safeGet(rawUrl, { maxBytes = 1e6, timeout = 5000, redirects = 4 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (href, left) => {
      let u;
      try { u = new URL(href); } catch { return reject(new Error('bad url')); }
      if (!/^https?:$/.test(u.protocol)) return reject(new Error('bad protocol'));
      const port = u.port || (u.protocol === 'https:' ? '443' : '80');
      if (port !== '80' && port !== '443') return reject(new Error('bad port'));
      const host = u.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(host) && isPrivate(host)) return reject(new Error('blocked address'));
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, {
        method: 'GET', timeout, lookup,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkpageBot/1.0)', Accept: 'text/html,image/*;q=0.9,*/*;q=0.5' }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (left <= 0) return reject(new Error('too many redirects'));
          return go(new URL(res.headers.location, u).href, left - 1);
        }
        const chunks = []; let n = 0;
        res.on('data', (c) => { n += c.length; if (n > maxBytes) req.destroy(new Error('too big')); else chunks.push(c); });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), finalUrl: u.href }));
        res.on('error', reject);
      });
      const t = setTimeout(() => req.destroy(new Error('deadline')), 8000);
      req.on('close', () => clearTimeout(t));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    };
    go(rawUrl, redirects);
  });
}

// ---- favicon discovery ------------------------------------------------------
function parseIcons(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = {};
    for (const x of m[0].matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) a[x[1].toLowerCase()] = x[2] ?? x[3] ?? x[4];
    if (!a.href || !/\bicon\b/i.test(a.rel || '') || /mask-icon/i.test(a.rel)) continue;
    let href;
    try { href = new URL(a.href.replace(/&amp;/g, '&'), base).href; } catch { continue; }
    const size = parseInt((a.sizes || '').split('x')[0], 10) || 0;
    const score = (/apple-touch/i.test(a.rel) ? 1000 : 0) + (/svg/.test(a.type || '') || /\.svg(\?|$)/i.test(href) ? 300 : 0) + Math.min(size, 512);
    out.push({ href, score });
  }
  return out.sort((x, y) => y.score - x.score).map((x) => x.href);
}

export async function fetchFavicon(pageUrl) {
  let u;
  try { u = new URL(pageUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const cands = [];
  try {
    const r = await safeGet(u.origin + '/', { maxBytes: 400_000 });
    if (r.status === 200 && /html/i.test(r.headers['content-type'] || '')) cands.push(...parseIcons(r.body.toString('utf8'), r.finalUrl));
  } catch { /* fall through to /favicon.ico */ }
  cands.push(u.origin + '/favicon.ico');
  for (const c of [...new Set(cands)].slice(0, 5)) {
    try {
      const r = await safeGet(c, { maxBytes: 1_000_000 });
      if (r.status === 200) { const name = saveMedia(r.body, 'fav'); if (name) return name; }
    } catch { /* try next */ }
  }
  return null;
}

// Remember results so saving doesn't re-fetch the same site again and again.
const memo = new Map();
export function favCached(origin) {
  const m = memo.get(origin);
  if (m && (m.file ? fs.existsSync(path.join(MEDIA_DIR, m.file)) : Date.now() - m.at < 600e3)) return m.p;
  const p = fetchFavicon(origin).then((file) => { memo.set(origin, { file, at: Date.now(), p }); return file; }).catch(() => null);
  memo.set(origin, { file: null, at: Date.now(), p });
  return p;
}

// Fill in any "auto" icons that are missing (runs when you press Save).
export async function ensureIcons(blocks) {
  const jobs = [];
  const visit = (o) => {
    if (!o.icon || o.icon.mode !== 'auto' || !/^https?:/i.test(o.url || '')) return;
    let origin;
    try { origin = new URL(o.url).origin; } catch { return; }
    if (o.icon.for === origin && o.icon.file) return;
    jobs.push(favCached(origin).then((f) => { o.icon.file = f || ''; o.icon.for = origin; }));
  };
  for (const b of blocks) { if (b.type === 'link') visit(b); (b.items || []).forEach(visit); }
  if (jobs.length) await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 9000))]);
}
