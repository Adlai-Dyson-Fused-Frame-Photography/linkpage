// Turns {config, blocks} into the final HTML page. No client-side framework needed,
// so the public page is tiny, fast and works without JavaScript.
import fs from 'node:fs';
import { ICONS } from './icons-data.js';

const CSS = fs.readFileSync(new URL('../public/site.css', import.meta.url), 'utf8');

export const FONTS = {
  system: 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  rounded: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,Nunito,system-ui,sans-serif',
  serif: 'ui-serif,Georgia,Cambria,"Times New Roman",serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  easy: '"Atkinson Hyperlegible",Verdana,Tahoma,sans-serif'
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.link}</svg>`;

function icon(i, title) {
  if (i.mode === 'lib') return svg(i.lib);
  if ((i.mode === 'auto' || i.mode === 'upload') && i.file) return `<img src="/media/${esc(i.file)}" alt="" width="32" height="32" loading="lazy" decoding="async">`;
  return `<b class="mono">${esc(Array.from((title || '?').trim())[0]?.toUpperCase() || '?')}</b>`;
}

const external = (u) => /^https?:/i.test(u);
const target = (u, newTab = true) => (external(u) && newTab ? ' target="_blank" rel="noopener noreferrer"' : '');
const vars = (i, color) => ` style="--i:${i}${color ? `;--a:${color}` : ''}"`;

function visible(b, now) {
  if (b.hidden) return false;
  if (b.type === 'link') {
    if (b.from && new Date(b.from) > now) return false;
    if (b.until && new Date(b.until) <= now) return false;
  }
  return true;
}

function block(b, i) {
  switch (b.type) {
    case 'link':
      return `<a class="card glass s${b.size}" href="${esc(b.url)}" data-id="${b.id}"${target(b.url, b.newTab)}${vars(i, b.color)}>` +
        `<span class="ico">${icon(b.icon, b.title)}</span><span class="arr">${svg(b.size > 1 ? 'arrow' : 'external', 'rot')}</span>` +
        `<span class="txt"><strong class="t">${esc(b.title)}</strong>${b.desc ? `<span class="d">${esc(b.desc)}</span>` : ''}</span></a>`;
    case 'social':
      return `<div class="card glass social s${b.size}"${vars(i)}><div class="txt"><strong class="t">${esc(b.title)}</strong>${b.desc ? `<span class="d">${esc(b.desc)}</span>` : ''}</div><div class="icons">` +
        b.items.map((it) => `<a class="soc" href="${esc(it.url)}" title="${esc(it.title)}" aria-label="${esc(it.title)}" data-id="${it.id}"${target(it.url)}${vars(0, it.color)}>${icon(it.icon, it.title)}</a>`).join('') +
        '</div></div>';
    case 'group':
      return `<details class="card glass group s${b.size}"${b.open ? ' open' : ''}${vars(i)}><summary><span class="ico">${icon(b.icon, b.title)}</span>` +
        `<span class="txt"><strong class="t">${esc(b.title)}</strong>${b.desc ? `<span class="d">${esc(b.desc)}</span>` : ''}</span><span class="chev">${svg('chevron')}</span></summary><div class="sub">` +
        b.items.map((it) => `<a class="row" href="${esc(it.url)}" data-id="${it.id}"${target(it.url)}${vars(0, it.color)}><span class="ico">${icon(it.icon, it.title)}</span><span class="t">${esc(it.title)}</span></a>`).join('') +
        '</div></details>';
    case 'text':
      return `<div class="note s3"${vars(i)}>${esc(b.text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
    case 'divider':
      return '<hr class="s3">';
    default:
      return '';
  }
}

export function faviconSvg(config) {
  const l = esc(Array.from((config.profile.name || '?').trim())[0]?.toUpperCase() || '?');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${config.theme.bg}"/><text x="32" y="45" font-size="36" font-weight="700" text-anchor="middle" fill="${config.theme.primary}" font-family="system-ui,sans-serif">${l}</text></svg>`;
}

export function renderPage({ config: c, blocks }, { base = '', preview = false } = {}) {
  const t = c.theme, s = c.site, p = c.profile;
  const now = new Date();
  const origin = s.url || base;
  const title = esc(s.title || p.name || 'Links');
  const themeVars = `--bg:${t.bg};--text:${t.text};--primary:${t.primary};--secondary:${t.secondary};--radius:${t.radius}px;--blur:${t.blur}px;--glass:${t.glass}%;--font:${FONTS[t.font] || FONTS.system}`;
  const ogImg = s.ogImage ? `${origin}/media/${s.ogImage}` : p.avatar ? `${origin}/media/${p.avatar}` : '';

  const avatar = p.avatar
    ? `<img src="/media/${esc(p.avatar)}" alt="${esc(p.name)}" width="136" height="136" fetchpriority="high">`
    : `<b class="mono">${esc(Array.from((p.name || '?').trim())[0]?.toUpperCase() || '?')}</b>`;

  const body = blocks.filter((b) => visible(b, now)).map((b, i) => block(b, i + 1)).join('');
  const footerText = esc(c.footer.text).replace(/\{year\}/g, String(now.getFullYear()));

  return `<!doctype html>
<html lang="${esc(s.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${esc(s.description)}">
<meta name="theme-color" content="${t.bg}">
${s.robots && !preview ? '' : '<meta name="robots" content="noindex,nofollow">'}
${s.url ? `<link rel="canonical" href="${esc(s.url)}/">` : ''}
<link rel="icon" href="/favicon">
<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${esc(s.description)}">
${s.url ? `<meta property="og:url" content="${esc(s.url)}/">` : ''}
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<style>:root{${themeVars}}${CSS}${t.customCss.replace(/<\/style/gi, '<\\/style')}</style>
${preview ? '' : s.headHtml}
</head>
<body class="${t.layout}${t.animate ? ' anim' : ''}${t.glow ? ' glow' : ''}${t.float ? ' float' : ''}">
${c.banner.enabled && c.banner.text ? `<a class="banner" href="${esc(c.banner.url || '#')}"${target(c.banner.url)}>${esc(c.banner.text)} ${svg('arrow')}</a>` : ''}
<main>
<header class="profile" style="--i:0"><div class="avatar ${p.avatarShape}">${avatar}</div><h1>${esc(p.name)}</h1>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}</header>
<div class="grid">${body}</div>
<footer><p>${footerText}</p>${c.footer.links.length ? `<nav>${c.footer.links.map((l) => `<a href="${esc(l.url)}"${target(l.url)}>${esc(l.label)}</a>`).join('')}</nav>` : ''}
${c.footer.showGithub && c.footer.githubUrl ? `<a class="gh" href="${esc(c.footer.githubUrl)}" target="_blank" rel="noopener noreferrer">${svg('github')}<span>Open-source project</span></a>` : ''}</footer>
</main>
${preview
    ? '<script>document.addEventListener("click",function(e){if(e.target.closest("a"))e.preventDefault()})</script>'
    : s.trackClicks ? '<script>!function(){function t(e){var a=e.target.closest&&e.target.closest("a[data-id]");a&&navigator.sendBeacon&&navigator.sendBeacon("/api/c/"+a.getAttribute("data-id"))}document.addEventListener("click",t,{passive:true});document.addEventListener("auxclick",t,{passive:true})}()</script>' : ''}
</body>
</html>`;
}
