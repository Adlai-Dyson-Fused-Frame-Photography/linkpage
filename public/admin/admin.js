'use strict';
/* Linkpage admin: a tiny dependency-free single page app. */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag); let val;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') val = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(9)) { if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  if (val !== undefined) e.value = val;
  return e;
}

let S = null;                 // { config, blocks, icons, ... }
let tab = 'links', openId = null, dirty = false, saving = false, dragFrom = null;
const TYPE = { link: 'Link', social: 'Social icons', group: 'Group', text: 'Text', divider: 'Divider' };
const PRESETS = [
  ['Aurora', { bg: '#020617', text: '#f1f5f9', primary: '#94fdf8', secondary: '#3b82f6' }],
  ['Sunset', { bg: '#1a0b12', text: '#fff1f2', primary: '#fb923c', secondary: '#ec4899' }],
  ['Forest', { bg: '#05140d', text: '#ecfdf5', primary: '#4ade80', secondary: '#14b8a6' }],
  ['Violet', { bg: '#0f0a1f', text: '#f5f3ff', primary: '#c4b5fd', secondary: '#8b5cf6' }],
  ['Paper (light)', { bg: '#f1f5f9', text: '#0f172a', primary: '#0284c7', secondary: '#6366f1' }],
  ['Mono', { bg: '#000000', text: '#ffffff', primary: '#ffffff', secondary: '#a3a3a3' }]
];
const FONT_LABELS = { system: 'Modern (system)', rounded: 'Rounded', serif: 'Serif', mono: 'Monospace', easy: 'Easy to read (Verdana style)' };

// ---------- helpers ----------
const newId = () => Math.random().toString(36).slice(2, 10);
const normUrl = (v) => { v = (v || '').trim(); if (!v) return ''; return /^(https?:\/\/|(mailto|tel|sms|whatsapp|tg|signal|facetime|skype):|\/|#)/i.test(v) ? v : 'https://' + v; };
const newIcon = () => ({ mode: 'auto', lib: 'link', file: '', for: '' });
const newItem = () => ({ id: newId(), title: '', url: 'https://', color: '', icon: newIcon() });

function toast(msg, err) {
  const t = el('div', { class: 't' + (err ? ' err' : '') }, msg);
  $('#toast').append(t); setTimeout(() => t.remove(), err ? 6000 : 2500);
}
async function api(path, opts = {}) {
  const r = await fetch('/admin/api/' + path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: opts.json ? { 'Content-Type': 'application/json' } : opts.headers,
    body: opts.json ? JSON.stringify(opts.json) : opts.body
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function upload(file, kind) {
  const r = await fetch('/admin/api/upload?kind=' + kind, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Upload failed');
  return j;
}
function svgEl(name) {
  const s = el('span', { class: 'svg' });
  s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (S.icons[name] || S.icons.link) + '</svg>';
  return s;
}

// ---------- dirty state + preview ----------
function setStatus() {
  const s = $('#status'); s.textContent = saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved';
  s.classList.toggle('dirty', dirty && !saving); $('#save').disabled = !dirty || saving;
}
function touch() { dirty = true; setStatus(); schedulePreview(); }
let pvTimer, pvSeq = 0;
function schedulePreview(ms = 350) {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(async () => {
    const seq = ++pvSeq;
    try {
      const html = await api('preview', { method: 'POST', json: { config: S.config, blocks: S.blocks } });
      if (seq !== pvSeq) return;
      const fr = $('#pv'); let y = 0;
      try { y = fr.contentWindow.scrollY; } catch { /* ignore */ }
      fr.onload = () => { try { fr.contentWindow.scrollTo(0, y); } catch { /* ignore */ } };
      fr.srcdoc = html;
    } catch { /* preview is best effort */ }
  }, ms);
}
async function save() {
  if (saving || !dirty) return;
  saving = true; setStatus();
  try {
    const s = await api('state', { method: 'PUT', json: { config: S.config, blocks: S.blocks } });
    S.config = s.config; S.blocks = s.blocks; dirty = false;
    saving = false; renderPanel(); schedulePreview(0); toast('Saved ✓');
  } catch (e) { saving = false; toast(e.message, true); }
  setStatus();
}

// ---------- form field builders ----------
const field = (label, ctrl, hint) => el('label', { class: 'f' }, el('span', { class: 'fl' }, label), ctrl, hint ? el('small', {}, hint) : null);
function input(obj, key, o = {}) {
  const i = el(o.textarea ? 'textarea' : 'input', {
    type: o.textarea ? null : (o.type || 'text'), placeholder: o.ph || '', maxlength: o.max, rows: o.rows, value: obj[key] ?? '',
    oninput: (e) => { obj[key] = e.target.value; if (o.onchange) o.onchange(e); touch(); }
  });
  return i;
}
const check = (obj, key, label, def = false) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: obj[key] ?? def, onchange: (e) => { obj[key] = e.target.checked; touch(); } }), el('span', {}, label));
const select = (obj, key, opts, onchange) => el('select', { value: String(obj[key]), onchange: (e) => { obj[key] = e.target.value; if (onchange) onchange(); touch(); } }, opts.map(([v, l]) => el('option', { value: v }, l)));
function range(obj, key, min, max, unit = '') {
  const out = el('output', {}, obj[key] + unit);
  return el('div', { class: 'rng' }, el('input', { type: 'range', min, max, value: obj[key], oninput: (e) => { obj[key] = +e.target.value; out.textContent = obj[key] + unit; touch(); } }), out);
}
function colorField(label, obj, key) {
  return el('div', { class: 'f' }, el('span', { class: 'fl' }, label), el('input', { type: 'color', value: obj[key], oninput: (e) => { obj[key] = e.target.value; touch(); } }));
}
function accentField(obj) {
  const c = el('input', { type: 'color', value: obj.color || '#94fdf8', oninput: (e) => { obj.color = e.target.value; note.textContent = ''; touch(); } });
  const note = el('small', {}, obj.color ? '' : 'Using the theme colour');
  return el('div', { class: 'f' }, el('span', { class: 'fl' }, 'Accent colour (hover glow & icon)'),
    el('div', { class: 'crow' }, c, el('button', { type: 'button', class: 'btn sm', onclick: () => { obj.color = ''; note.textContent = 'Using the theme colour'; touch(); } }, 'Use theme colour'), note));
}
function imageField(obj, key, kind, label, hint) {
  const box = el('div', { class: 'f' });
  const draw = () => {
    box.replaceChildren(el('span', { class: 'fl' }, label),
      el('div', { class: 'imgf' },
        obj[key] ? el('img', { src: '/media/' + obj[key], alt: '' }) : null,
        el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { obj[key] = (await upload(f, kind)).file; touch(); draw(); } catch (er) { toast(er.message, true); } } }),
        obj[key] ? el('button', { type: 'button', class: 'btn sm danger', onclick: () => { obj[key] = ''; touch(); draw(); } }, 'Remove') : null),
      hint ? el('small', {}, hint) : null);
  };
  draw(); return box;
}

// ---------- icons ----------
function fillThumb(t, o) {
  t.replaceChildren(); const ic = o.icon;
  if (!ic) { t.append(svgEl(o.type === 'social' ? 'hash' : o.type === 'text' ? 'message' : 'link')); return; }
  if (ic.mode === 'lib') t.append(svgEl(ic.lib));
  else if ((ic.mode === 'auto' || ic.mode === 'upload') && ic.file) t.append(el('img', { src: '/media/' + ic.file, alt: '' }));
  else t.append((o.title || '?').trim().charAt(0).toUpperCase() || '?');
}
const thumb = (o) => { const t = el('span', { class: 'th', 'data-th': o.id }); fillThumb(t, o); return t; };
const refreshThumbs = (o) => document.querySelectorAll('[data-th="' + o.id + '"]').forEach((t) => fillThumb(t, o));

async function autoFetch(o, force) {
  if (!o.icon || o.icon.mode !== 'auto') return;
  const url = normUrl(o.url); let origin;
  try { origin = new URL(url).origin; } catch { return; }
  if (!/^https?:/i.test(url) || (!force && o.icon.for === origin && o.icon.file)) return;
  try {
    const r = await api('icon/fetch', { method: 'POST', json: { url } });
    o.icon.file = r.file || ''; o.icon.for = origin; touch(); refreshThumbs(o);
    if (force) toast(r.file ? 'Icon found ✓' : 'No icon found – the first letter is used instead', !r.file);
  } catch (e) { toast(e.message, true); }
}
function urlInput(o) {
  const i = input(o, 'url', { ph: 'https://example.com' });
  i.addEventListener('blur', () => { const n = normUrl(o.url); if (n !== o.url) { o.url = n; i.value = n; touch(); } autoFetch(o); });
  return i;
}
function iconEditor(o) {
  const box = el('div', { class: 'iconed' });
  const draw = () => {
    box.replaceChildren(); const ic = o.icon;
    box.append(el('div', { class: 'irow' }, thumb(o),
      select(ic, 'mode', [['auto', 'Auto – icon from the website'], ['lib', 'Pick a built-in icon'], ['upload', 'Upload my own icon'], ['none', 'No icon (first letter)']], () => { if (ic.mode === 'auto') autoFetch(o, true); refreshThumbs(o); draw(); })));
    if (ic.mode === 'auto') box.append(el('div', { class: 'irow' }, el('button', { type: 'button', class: 'btn sm', onclick: () => autoFetch(o, true) }, 'Fetch icon again'), el('small', {}, 'Saved on your server – visitors never contact the other site.')));
    if (ic.mode === 'lib') { const g = el('div', { class: 'igrid' }); for (const n of Object.keys(S.icons)) g.append(el('button', { type: 'button', class: 'ib' + (ic.lib === n ? ' on' : ''), title: n, onclick: () => { ic.lib = n; touch(); refreshThumbs(o); draw(); } }, svgEl(n))); box.append(g); }
    if (ic.mode === 'upload') box.append(el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { ic.file = (await upload(f, 'icon')).file; touch(); refreshThumbs(o); } catch (er) { toast(er.message, true); } } }), el('small', {}, 'Square PNG, SVG, WebP, JPG or ICO, up to 1 MB.'));
  };
  draw(); return box;
}

// ---------- links tab ----------
function move(arr, from, to) { if (to < 0 || to >= arr.length) return; const [x] = arr.splice(from, 1); arr.splice(to, 0, x); }
const blockTitle = (b) => b.title || (b.type === 'text' ? (b.text || '').slice(0, 40) : '') || TYPE[b.type];

function addBlock(type) {
  const base = { id: newId(), type, size: 1, hidden: false };
  const b = type === 'link' ? { ...base, title: 'New link', desc: '', url: 'https://', color: '', icon: newIcon(), newTab: true, from: '', until: '' }
    : type === 'social' ? { ...base, size: 3, title: 'Follow me', desc: '', items: [newItem()] }
    : type === 'group' ? { ...base, size: 3, title: 'More links', desc: '', open: false, icon: { mode: 'lib', lib: 'hash', file: '', for: '' }, items: [newItem()] }
    : type === 'text' ? { ...base, size: 3, text: 'Some text…' } : { ...base, size: 3 };
  S.blocks.push(b); openId = b.id; touch(); renderPanel();
  setTimeout(() => document.querySelector('[data-id="' + b.id + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
}

function renderLinks() {
  const wrap = el('div');
  if (S.config.theme.layout === 'list') wrap.append(el('p', { class: 'muted' }, 'Tip: tile sizes only matter in the Bento layout. You are using the List layout.'));
  wrap.append(el('div', { class: 'addbar' }, Object.entries(TYPE).map(([t, l]) => el('button', { type: 'button', class: 'btn', onclick: () => addBlock(t) }, '+ ' + l))));
  const list = el('div');
  S.blocks.forEach((b, i) => list.append(blockRow(b, i)));
  if (!S.blocks.length) list.append(el('p', { class: 'empty' }, 'Nothing here yet. Add your first link with the buttons above.'));
  wrap.append(list); return wrap;
}

function blockRow(b, i) {
  const open = openId === b.id;
  const row = el('div', { class: 'brow' + (open ? ' open' : '') + (b.hidden ? ' off' : ''), 'data-id': b.id });
  const btn = (txt, title, fn, cls = '') => el('button', { type: 'button', class: 'btn sm ' + cls, title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } }, txt);
  const head = el('div', { class: 'bhead', draggable: 'true', onclick: () => { openId = open ? null : b.id; renderPanel(); } },
    el('span', { class: 'grip', title: 'Drag to reorder' }, '⠿'), thumb(b),
    el('div', { class: 'bt' }, el('strong', {}, blockTitle(b)), el('small', {}, TYPE[b.type] + (b.type !== 'divider' && b.type !== 'text' && S.config.theme.layout === 'bento' ? ' · ' + ['', 'small', 'wide', 'full width'][b.size] : '') + (b.hidden ? ' · hidden' : ''))),
    el('div', { class: 'bbtn' },
      btn('↑', 'Move up', () => { move(S.blocks, i, i - 1); touch(); renderPanel(); }),
      btn('↓', 'Move down', () => { move(S.blocks, i, i + 1); touch(); renderPanel(); }),
      btn(open ? 'Close' : 'Edit', 'Edit', () => { openId = open ? null : b.id; renderPanel(); }),
      btn('Delete', 'Delete', () => { if (confirm('Delete “' + blockTitle(b) + '”?')) { S.blocks.splice(i, 1); touch(); renderPanel(); } }, 'danger')));
  head.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); row.classList.add('drag'); });
  head.addEventListener('dragend', () => { row.classList.remove('drag'); dragFrom = null; });
  row.addEventListener('dragover', (e) => { if (dragFrom == null) return; e.preventDefault(); row.classList.add('over'); });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', (e) => { e.preventDefault(); if (dragFrom == null) return; move(S.blocks, dragFrom, i); dragFrom = null; touch(); renderPanel(); });
  row.append(head);
  if (open) row.append(blockEditor(b));
  return row;
}

const sizeSelect = (b) => field('Tile size (Bento layout)', select(b, 'size', [[1, 'Small – 1 tile'], [2, 'Wide – 2 tiles'], [3, 'Full width']], () => { b.size = +b.size; }), 'On phones everything is one column automatically.');
function liveTitle(b) { const s = document.querySelector('[data-id="' + b.id + '"] .bt strong'); if (s) s.textContent = blockTitle(b); }

function blockEditor(b) {
  const f = el('div', { class: 'bedit' });
  if (b.type === 'link') {
    f.append(field('Title', input(b, 'title', { max: 80, onchange: () => { liveTitle(b); refreshThumbs(b); } })),
      field('Description (optional)', input(b, 'desc', { max: 160 })),
      field('Link address', urlInput(b), 'Use mailto:you@example.com for email or tel:+441234567890 for phone.'),
      sizeSelect(b), accentField(b), el('span', { class: 'fl' }, 'Icon'), iconEditor(b),
      check(b, 'newTab', 'Open in a new tab', true),
      el('div', { class: 'two' }, field('Show from (optional)', input(b, 'from', { type: 'datetime-local' })), field('Hide after (optional)', input(b, 'until', { type: 'datetime-local' }))),
      el('small', {}, 'Scheduled times use the server’s timezone (set TZ in your compose file).'));
  } else if (b.type === 'social') {
    f.append(field('Heading', input(b, 'title', { max: 80, onchange: () => liveTitle(b) })), field('Small text (optional)', input(b, 'desc', { max: 160 })), sizeSelect(b), el('span', { class: 'fl' }, 'Icons'), itemsEditor(b, true));
  } else if (b.type === 'group') {
    f.append(field('Title', input(b, 'title', { max: 80, onchange: () => { liveTitle(b); refreshThumbs(b); } })), field('Small text (optional)', input(b, 'desc', { max: 160 })), sizeSelect(b),
      el('span', { class: 'fl' }, 'Group icon'), iconEditor(b), check(b, 'open', 'Start expanded'), el('span', { class: 'fl' }, 'Links inside'), itemsEditor(b, false));
  } else if (b.type === 'text') {
    f.append(field('Text', input(b, 'text', { textarea: true, rows: 4, max: 1500, onchange: () => liveTitle(b) }), 'Leave a blank line to start a new paragraph.'));
  } else f.append(el('p', { class: 'muted' }, 'A thin line to separate sections.'));
  f.append(check(b, 'hidden', 'Hide this block (keeps it saved but not shown)'));
  return f;
}

function itemsEditor(b, social) {
  const box = el('div', { class: 'items' });
  const draw = () => {
    box.replaceChildren();
    b.items.forEach((it, i) => {
      const small = (txt, title, fn, cls = '') => el('button', { type: 'button', class: 'btn sm ' + cls, title, 'aria-label': title, onclick: fn }, txt);
      box.append(el('div', { class: 'item' },
        el('div', { class: 'ihead' }, thumb(it), el('strong', {}, it.title || it.url || 'New'),
          small('↑', 'Move up', () => { move(b.items, i, i - 1); touch(); draw(); }), small('↓', 'Move down', () => { move(b.items, i, i + 1); touch(); draw(); }),
          small('Remove', 'Remove', () => { b.items.splice(i, 1); touch(); draw(); }, 'danger')),
        field(social ? 'Name (shown on hover)' : 'Title', input(it, 'title', { max: 80, onchange: () => refreshThumbs(it) })),
        field('Link address', urlInput(it)),
        accentField(it), iconEditor(it)));
    });
    box.append(el('button', { type: 'button', class: 'btn', onclick: () => { b.items.push(newItem()); touch(); draw(); } }, social ? '+ Add social icon' : '+ Add link'));
  };
  draw(); return box;
}

// ---------- profile tab ----------
function renderProfile() {
  const c = S.config, w = el('div');
  w.append(el('h2', {}, 'Profile'),
    field('Your name', input(c.profile, 'name', { max: 80 })), field('Short bio (optional)', input(c.profile, 'bio', { max: 200 })),
    imageField(c.profile, 'avatar', 'avatar', 'Profile picture', 'Square images work best. PNG, JPG, WebP, GIF or SVG, up to 5 MB.'),
    field('Picture shape', select(c.profile, 'avatarShape', [['circle', 'Circle'], ['rounded', 'Rounded square'], ['square', 'Square']])),
    el('h2', {}, 'Top banner'), check(c.banner, 'enabled', 'Show a banner across the top'),
    field('Banner text', input(c.banner, 'text', { max: 200 })), field('Banner link', input(c.banner, 'url', { ph: 'https://example.com' })),
    el('h2', {}, 'Footer'),
    field('Footer text', input(c.footer, 'text', { max: 200 }), 'Use {year} to show the current year automatically.'),
    el('span', { class: 'fl' }, 'Footer links'), footerLinks(),
    check(c.footer, 'showGithub', 'Show the “Open-source project” link'), field('Project link', input(c.footer, 'githubUrl', { ph: 'https://github.com/…' })));
  return w;
}
function footerLinks() {
  const box = el('div'), links = S.config.footer.links;
  const draw = () => {
    box.replaceChildren();
    links.forEach((l, i) => box.append(el('div', { class: 'item' }, el('div', { class: 'two' }, field('Label', input(l, 'label', { max: 60 })), field('Address', input(l, 'url', { ph: 'https://…' }))),
      el('button', { type: 'button', class: 'btn sm danger', onclick: () => { links.splice(i, 1); touch(); draw(); } }, 'Remove'))));
    if (links.length < 10) box.append(el('button', { type: 'button', class: 'btn', onclick: () => { links.push({ label: 'New link', url: 'https://' }); touch(); draw(); } }, '+ Add footer link'));
  };
  draw(); return box;
}

// ---------- design tab ----------
function renderDesign() {
  const t = S.config.theme, w = el('div');
  const layoutChoice = (v, name, desc) => el('button', { type: 'button', class: 'choice' + (t.layout === v ? ' on' : ''), onclick: () => { t.layout = v; touch(); renderPanel(); } },
    el('div', { class: 'mini ' + v }, [1, 2, 3, 4].map(() => el('i'))), el('strong', {}, name), el('small', {}, desc));
  w.append(el('h2', {}, 'Layout'),
    el('div', { class: 'choices' }, layoutChoice('bento', 'Bento grid', 'Tiles of different sizes'), layoutChoice('list', 'Simple list', 'One neat column')),
    el('h2', {}, 'Colour presets'),
    el('div', { class: 'presets' }, PRESETS.map(([n, v]) => el('button', { type: 'button', class: 'preset', onclick: () => { Object.assign(t, v); touch(); renderPanel(); } }, el('span', { class: 'sw', style: 'background:' + v.primary }), el('span', { class: 'sw', style: 'background:' + v.secondary }), n))),
    el('h2', {}, 'Colours'),
    el('div', { class: 'colors' }, colorField('Background', t, 'bg'), colorField('Text', t, 'text'), colorField('Main accent', t, 'primary'), colorField('Second accent', t, 'secondary')),
    el('h2', {}, 'Glass & shapes'),
    field('Corner roundness', range(t, 'radius', 0, 40, 'px')), field('Glass blur', range(t, 'blur', 0, 40, 'px')), field('Glass brightness', range(t, 'glass', 2, 30, '%')),
    el('h2', {}, 'Effects'), check(t, 'glow', 'Soft glowing background'), check(t, 'float', 'Floating profile picture'), check(t, 'animate', 'Entrance animations'),
    el('h2', {}, 'Font'), field('Font style', select(t, 'font', S.fonts.map((k) => [k, FONT_LABELS[k] || k])), 'Fonts come from your visitor’s device, so the page loads instantly.'),
    el('h2', {}, 'Advanced'), field('Custom CSS (optional)', input(t, 'customCss', { textarea: true, rows: 6, max: 20000, ph: '.card { letter-spacing: .01em }' })));
  return w;
}

// ---------- SEO tab ----------
function renderSeo() {
  const s = S.config.site, w = el('div');
  w.append(el('h2', {}, 'Search & sharing'),
    field('Page title', input(s, 'title', { max: 120 }), 'Shown in the browser tab and in Google.'),
    field('Description', input(s, 'description', { textarea: true, rows: 3, max: 300 }), 'One or two sentences. Shown in search results and when your link is shared.'),
    field('Public address of this page', input(s, 'url', { ph: 'https://links.example.com' }), 'Used for the canonical link and share images. Recommended.'),
    imageField(s, 'ogImage', 'og', 'Share image', 'Shown when your link is shared (1200×630 is ideal). If empty, your profile picture is used.'),
    imageField(s, 'favicon', 'favicon', 'Favicon (browser tab icon)', 'Leave empty for an automatic icon made from your first letter and colours.'),
    field('Language code', input(s, 'lang', { max: 10, ph: 'en' })),
    check(s, 'robots', 'Allow search engines to list this page'),
    el('h2', {}, 'Analytics & extras'),
    check(s, 'trackClicks', 'Count link clicks (private, no cookies, no personal data)'),
    field('Extra code for the <head> (optional)', input(s, 'headHtml', { textarea: true, rows: 5, max: 10000, ph: '<script defer src="https://analytics.example.com/script.js" data-website-id="…"></script>' }), 'Paste a tracking script here. Only add code you trust.'));
  return w;
}

// ---------- stats tab ----------
function renderStats() {
  const w = el('div', {}, el('h2', {}, 'Link clicks'), el('p', { class: 'muted' }, 'Loading…'));
  api('stats').then(({ rows }) => {
    w.replaceChildren(el('h2', {}, 'Link clicks'), el('p', { class: 'muted' }, 'Counted when someone clicks a link. No cookies, no IP addresses stored.'),
      el('table', {}, el('tr', {}, el('th', {}, 'Link'), el('th', { class: 'n' }, '7 days'), el('th', { class: 'n' }, '30 days'), el('th', { class: 'n' }, 'All time')),
        rows.map((r) => el('tr', {}, el('td', {}, r.title), el('td', { class: 'n' }, r.d7), el('td', { class: 'n' }, r.d30), el('td', { class: 'n' }, r.total)))));
  }).catch((e) => w.append(el('p', {}, e.message)));
  return w;
}

// ---------- account tab ----------
function renderAccount() {
  const w = el('div'), pw = { current: '', next: '', again: '' };
  const pwi = (label, key, ac) => field(label, el('input', { type: 'password', autocomplete: ac, oninput: (e) => { pw[key] = e.target.value; } }));
  w.append(el('h2', {}, 'Signed in as ' + S.user), S.cf ? el('p', { class: 'muted' }, 'You are signed in through Cloudflare Access.') : null,
    el('h2', {}, 'Change password'), pwi('Current password', 'current', 'current-password'), pwi('New password (10+ characters)', 'next', 'new-password'), pwi('Repeat new password', 'again', 'new-password'),
    el('button', { type: 'button', class: 'btn', onclick: async () => {
      if (pw.next !== pw.again) return toast('The new passwords do not match.', true);
      try { await api('password', { method: 'POST', json: { current: pw.current, next: pw.next } }); toast('Password changed ✓'); renderPanel(); } catch (e) { toast(e.message, true); }
    } }, 'Change password'),
    el('h2', {}, 'Backup & restore'),
    el('p', { class: 'muted' }, 'A backup contains all your links, settings and uploaded icons/images (not your password).'),
    el('div', { class: 'crow' }, el('a', { class: 'btn', href: '/admin/api/export', download: '' }, 'Download backup'),
      el('label', { class: 'btn' }, 'Restore from backup…', el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (!confirm('This replaces everything on your page with the backup. Continue?')) return;
        try { const s = await api('import', { method: 'POST', json: JSON.parse(await f.text()) }); S.config = s.config; S.blocks = s.blocks; dirty = false; renderPanel(); schedulePreview(0); setStatus(); toast('Backup restored ✓'); } catch (er) { toast(er.message, true); }
      } }))),
    el('h2', {}, 'Session'),
    el('button', { type: 'button', class: 'btn danger', onclick: async () => { try { await api('logout', { method: 'POST' }); } catch { /* ignore */ } location.href = '/login'; } }, 'Sign out'));
  return w;
}

// ---------- shell ----------
const TABS = { links: ['Links', renderLinks], profile: ['Profile', renderProfile], design: ['Design', renderDesign], seo: ['SEO & site', renderSeo], stats: ['Stats', renderStats], account: ['Account', renderAccount] };
function renderPanel() {
  const t = $('#tabs'); t.replaceChildren();
  for (const [k, [label]] of Object.entries(TABS)) t.append(el('button', { type: 'button', class: k === tab ? 'on' : '', onclick: () => { tab = k; renderPanel(); } }, label));
  const p = $('#panel'), y = p.scrollTop;
  p.replaceChildren(TABS[tab][1]()); p.scrollTop = y;
}

async function boot() {
  S = await api('state'); renderPanel(); setStatus(); schedulePreview(0);
  $('#save').onclick = save;
  $('#btn-pv').onclick = () => { document.body.classList.toggle('showpv'); $('#btn-pv').textContent = document.body.classList.contains('showpv') ? 'Edit' : 'Preview'; };
  $('#devices').onclick = (e) => { const d = e.target.dataset.d; if (!d) return; $('#pvwrap').className = d; document.querySelectorAll('#devices button').forEach((b) => b.classList.toggle('on', b === e.target)); };
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
  addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}
boot().catch((e) => { $('#panel').textContent = 'Could not load: ' + e.message; });
