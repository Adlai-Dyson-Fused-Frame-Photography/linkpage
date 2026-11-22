// Passwords, sessions, first-run setup code, rate limiting and optional Cloudflare Access.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as db from './db.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 14;

// Set TRUST_PROXY=true ONLY when you are behind Cloudflare Tunnel / a reverse proxy.
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// ---- passwords --------------------------------------------------------------
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [t, s, k] = String(stored).split('$');
  if (t !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64, SCRYPT);
  const want = Buffer.from(k, 'base64');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
export const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

// ---- sessions ---------------------------------------------------------------
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const isSecure = (req) => process.env.COOKIE_SECURE === 'true' || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
export async function newSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.createSession(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}
export const sessionCookie = (token, req) => `lp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isSecure(req) ? '; Secure' : ''}`;
export const clearCookie = (req) => `lp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
export function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return out;
}
export const sessionHash = (req) => { const t = cookies(req).lp_session; return t ? sha(t) : ''; };

// ---- Cloudflare Access (optional) ------------------------------------------
const CF = {
  team: (process.env.CF_ACCESS_TEAM || '').trim().replace(/^https?:\/\//, '').replace(/\.cloudflareaccess\.com.*$/, ''),
  aud: (process.env.CF_ACCESS_AUD || '').trim()
};
export const cfEnabled = !!(CF.team && CF.aud);
let certs = { at: 0, forced: 0, keys: [] };
async function getCerts(force) {
  if (!force && Date.now() - certs.at < 36e5 && certs.keys.length) return certs.keys;
  if (force && Date.now() - certs.forced < 60e3) return certs.keys; // don't let bad tokens hammer Cloudflare
  if (force) certs.forced = Date.now();
  const r = await fetch(`https://${CF.team}.cloudflareaccess.com/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('cannot load Cloudflare certs');
  certs = { ...certs, at: Date.now(), keys: (await r.json()).keys || [] };
  return certs.keys;
}
async function verifyCf(jwt) {
  try {
    const [h, p, s] = String(jwt).split('.');
    const head = JSON.parse(Buffer.from(h, 'base64url'));
    if (head.alg !== 'RS256') return false;
    let key = (await getCerts(false)).find((k) => k.kid === head.kid);
    if (!key) key = (await getCerts(true)).find((k) => k.kid === head.kid);
    if (!key) return false;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(s, 'base64url'));
    if (!ok) return false;
    const c = JSON.parse(Buffer.from(p, 'base64url'));
    return !!c.exp && c.exp * 1000 > Date.now() && [].concat(c.aud || []).includes(CF.aud) && c.iss === `https://${CF.team}.cloudflareaccess.com`;
  } catch { return false; }
}

// Returns the signed-in user (via session cookie, or a verified Cloudflare Access token) or null.
export async function authenticate(req) {
  const token = cookies(req).lp_session;
  if (token) {
    const s = db.getSession(sha(token));
    if (s && s.expires > Date.now()) {
      const u = db.getUserById(s.user_id);
      if (u) return { id: u.id, username: u.username };
    }
  }
  if (cfEnabled && req.headers['cf-access-jwt-assertion'] && await verifyCf(req.headers['cf-access-jwt-assertion'])) {
    const u = db.firstUser();
    if (u) return { id: u.id, username: u.username, cf: true };
  }
  return null;
}

// ---- request helpers --------------------------------------------------------
export const clientIp = (req) => TRUST_PROXY
  ? (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress)
  : req.socket.remoteAddress;

// Blocks cross-site requests that try to change things using your logged-in session.
export function originOk(req) {
  const sfs = req.headers['sec-fetch-site'];
  if (sfs) return sfs === 'same-origin' || sfs === 'none';
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const host = new URL(o).host;
    return host === req.headers.host || (TRUST_PROXY && host === req.headers['x-forwarded-host']);
  } catch { return false; }
}

// ---- rate limiting (in memory) -----------------------------------------------
const hits = new Map();
export function rate(key, max, windowMs) {
  const now = Date.now();
  let e = hits.get(key);
  if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
  return ++e.n <= max;
}
export const rateReset = (k) => hits.delete(k);
setInterval(() => { const n = Date.now(); for (const [k, e] of hits) if (e.reset < n) hits.delete(k); db.purgeSessions(); }, 60e3).unref();

// ---- first-run setup code -----------------------------------------------------
let setupCode = null;
export function initSetupCode() {
  if (db.userCount() > 0) return;
  setupCode = process.env.SETUP_CODE || crypto.randomBytes(4).toString('hex');
  const line = `  SETUP CODE:  ${setupCode}`;
  console.log(`\n╭${'─'.repeat(54)}╮\n│  FIRST RUN: open  /setup  in your browser.${' '.repeat(11)}│\n│${line}${' '.repeat(Math.max(0, 54 - line.length))}│\n╰${'─'.repeat(54)}╯\n`);
}
export const setupActive = () => setupCode !== null;
export const clearSetupCode = () => { setupCode = null; };
export function checkSetupCode(c) {
  const a = Buffer.from(String(c || '').trim()), b = Buffer.from(setupCode || '');
  return setupCode !== null && a.length === b.length && crypto.timingSafeEqual(a, b);
}
