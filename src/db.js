// All storage lives in one SQLite file (Node's built-in node:sqlite) inside DATA_DIR.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { normConfig } from './model.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'linkpage.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blocks(id TEXT PRIMARY KEY, pos INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clicks(block_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(block_id, day));
`);

const q = (sql) => db.prepare(sql);

// ---- page content -------------------------------------------------------
export const hasConfig = () => !!q("SELECT 1 FROM kv WHERE k='config'").get();
export const blockCount = () => q('SELECT COUNT(*) c FROM blocks').get().c;

export function getConfig() {
  const r = q("SELECT v FROM kv WHERE k='config'").get();
  return normConfig(r ? JSON.parse(r.v) : {});
}
export function getBlocks() {
  return q('SELECT id,type,data FROM blocks ORDER BY pos').all().map((r) => ({ id: r.id, type: r.type, ...JSON.parse(r.data) }));
}
export function saveState({ config, blocks }) {
  db.exec('BEGIN');
  try {
    q("INSERT INTO kv(k,v) VALUES('config',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(config));
    q('DELETE FROM blocks').run();
    const ins = q('INSERT INTO blocks(id,pos,type,data) VALUES(?,?,?,?)');
    blocks.forEach((b, i) => { const { id, type, ...rest } = b; ins.run(id, i, type, JSON.stringify(rest)); });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---- users & sessions ---------------------------------------------------
export const userCount = () => q('SELECT COUNT(*) c FROM users').get().c;
export const firstUser = () => q('SELECT id,username FROM users ORDER BY id LIMIT 1').get();
export const getUserByName = (n) => q('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(n);
export const getUserById = (id) => q('SELECT * FROM users WHERE id=?').get(id);
export const createUser = (username, hash) => q('INSERT INTO users(username,hash,created) VALUES(?,?,?)').run(username, hash, Date.now()).lastInsertRowid;
export const setPassword = (id, hash) => q('UPDATE users SET hash=? WHERE id=?').run(hash, id);
export const createSession = (token, uid, expires) => q('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(token, uid, expires);
export const getSession = (token) => q('SELECT * FROM sessions WHERE token=?').get(token);
export const deleteSession = (token) => q('DELETE FROM sessions WHERE token=?').run(token);
export const deleteSessionsFor = (uid, except = '') => q('DELETE FROM sessions WHERE user_id=? AND token<>?').run(uid, except);
export const purgeSessions = () => q('DELETE FROM sessions WHERE expires<?').run(Date.now());

// ---- click stats --------------------------------------------------------
const day = (offset = 0) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
export const addClick = (id) => q('INSERT INTO clicks(block_id,day,n) VALUES(?,?,1) ON CONFLICT(block_id,day) DO UPDATE SET n=n+1').run(id, day());
export const getStats = () =>
  q(`SELECT block_id id, SUM(n) total,
       SUM(CASE WHEN day>=? THEN n ELSE 0 END) d30,
       SUM(CASE WHEN day>=? THEN n ELSE 0 END) d7
     FROM clicks GROUP BY block_id`).all(day(29), day(6));

export const close = () => db.close();
