// Cleans and validates everything coming from the admin panel (or an import).
// Nothing reaches the database or the public page without passing through here.
import crypto from 'node:crypto';
import { ICONS } from './icons-data.js';
import { DEFAULT_CONFIG as D } from './defaults.js';

export const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,90}$/i;
export const FONT_KEYS = ['system', 'rounded', 'serif', 'mono', 'easy'];

export const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
export const num = (v, min, max, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
export const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
export const color = (v, d = '') => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
export const file = (v) => (typeof v === 'string' && FILE_RE.test(v) ? v : '');
const newId = () => crypto.randomBytes(6).toString('base64url').replace(/[^a-z0-9]/gi, 'x').toLowerCase();

// Only safe link types are allowed. Anything else (javascript:, data:, ...) is neutralised.
const SAFE_URL = /^(https?:\/\/|(mailto|tel|sms|whatsapp|tg|signal|facetime|skype):|\/(?!\/)|#)/i;
export function url(v) {
  v = str(v, 2000).trim();
  if (!v) return '';
  if (SAFE_URL.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[a-z0-9.-]+:\d+/i.test(v)) return ''; // unknown scheme -> drop
  return 'https://' + v.replace(/^\/+/, '');
}
function siteUrl(v) {
  try { const u = new URL(str(v, 300).trim()); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}

const normIcon = (i) => {
  i = i && typeof i === 'object' ? i : {};
  return {
    mode: ['auto', 'lib', 'upload', 'none'].includes(i.mode) ? i.mode : 'auto',
    lib: ICONS[i.lib] ? i.lib : 'link',
    file: file(i.file),
    for: str(i.for, 300)
  };
};

const normItem = (it, used) => {
  it = it && typeof it === 'object' ? it : {};
  let id = /^[a-z0-9_-]{3,40}$/i.test(it.id || '') ? it.id : newId();
  while (used.has(id)) id = newId();
  used.add(id);
  return { id, title: str(it.title, 80), url: url(it.url), color: color(it.color), icon: normIcon(it.icon) };
};

function normBlock(b, used) {
  b = b && typeof b === 'object' ? b : {};
  let id = /^[a-z0-9_-]{3,40}$/i.test(b.id || '') ? b.id : newId();
  while (used.has(id)) id = newId();
  used.add(id);
  const base = { id, type: b.type, hidden: bool(b.hidden), size: Math.round(num(b.size, 1, 3, 1)) };
  const items = () => (Array.isArray(b.items) ? b.items.slice(0, 100) : []).map((x) => normItem(x, used));
  switch (b.type) {
    case 'link':
      return { ...base, title: str(b.title, 80), desc: str(b.desc, 160), url: url(b.url), color: color(b.color), icon: normIcon(b.icon),
        newTab: bool(b.newTab, true), from: str(b.from, 25), until: str(b.until, 25) };
    case 'social':
      return { ...base, title: str(b.title, 80), desc: str(b.desc, 160), items: items() };
    case 'group':
      return { ...base, title: str(b.title, 80), desc: str(b.desc, 160), icon: normIcon(b.icon), open: bool(b.open), items: items() };
    case 'text':
      return { ...base, size: 3, text: str(b.text, 1500) };
    case 'divider':
      return { ...base, size: 3 };
    default:
      return null;
  }
}

export function normConfig(c) {
  c = c && typeof c === 'object' ? c : {};
  const s = c.site || {}, p = c.profile || {}, t = c.theme || {}, b = c.banner || {}, f = c.footer || {};
  return {
    site: {
      title: str(s.title ?? D.site.title, 120), description: str(s.description ?? D.site.description, 300),
      lang: str(s.lang || 'en', 10).replace(/[^a-zA-Z-]/g, '') || 'en', url: siteUrl(s.url),
      robots: bool(s.robots, true), ogImage: file(s.ogImage), favicon: file(s.favicon),
      headHtml: str(s.headHtml, 10000), trackClicks: bool(s.trackClicks, true)
    },
    profile: {
      name: str(p.name ?? D.profile.name, 80), bio: str(p.bio ?? D.profile.bio, 200), avatar: file(p.avatar),
      avatarShape: ['circle', 'rounded', 'square'].includes(p.avatarShape) ? p.avatarShape : 'circle'
    },
    theme: {
      layout: t.layout === 'list' ? 'list' : 'bento',
      bg: color(t.bg, D.theme.bg), text: color(t.text, D.theme.text),
      primary: color(t.primary, D.theme.primary), secondary: color(t.secondary, D.theme.secondary),
      radius: Math.round(num(t.radius, 0, 40, D.theme.radius)), blur: Math.round(num(t.blur, 0, 40, D.theme.blur)),
      glass: Math.round(num(t.glass, 2, 30, D.theme.glass)),
      glow: bool(t.glow, true), float: bool(t.float, true), animate: bool(t.animate, true),
      font: FONT_KEYS.includes(t.font) ? t.font : 'system', customCss: str(t.customCss, 20000)
    },
    banner: { enabled: bool(b.enabled, false), text: str(b.text, 200), url: url(b.url) },
    footer: {
      text: str(f.text ?? D.footer.text, 200),
      links: (Array.isArray(f.links) ? f.links : []).slice(0, 10).map((l) => ({ label: str(l?.label, 60), url: url(l?.url) })).filter((l) => l.label),
      showGithub: bool(f.showGithub, true), githubUrl: url(f.githubUrl)
    }
  };
}

export function normState(input) {
  input = input && typeof input === 'object' ? input : {};
  const used = new Set();
  const blocks = (Array.isArray(input.blocks) ? input.blocks : []).slice(0, 200).map((b) => normBlock(b, used)).filter(Boolean);
  return { config: normConfig(input.config), blocks };
}

// Every uploaded/cached file that is still in use (everything else gets cleaned up).
export function collectFiles(config, blocks) {
  const s = new Set([config.profile.avatar, config.site.ogImage, config.site.favicon]);
  for (const b of blocks) {
    if (b.icon) s.add(b.icon.file);
    for (const it of b.items || []) s.add(it.icon.file);
  }
  s.delete('');
  return s;
}

// Every clickable thing: used for click stats.
export function clickTargets(blocks) {
  const m = new Map();
  for (const b of blocks) {
    if (b.type === 'link') m.set(b.id, b.title || b.url);
    for (const it of b.items || []) m.set(it.id, `${it.title || it.url}${b.type === 'group' ? ' (in ' + (b.title || 'group') + ')' : ''}`);
  }
  return m;
}
