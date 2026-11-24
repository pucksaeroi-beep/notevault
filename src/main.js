import './styles/app.css';
import './styles/editor.css';
import { h, icon, $, add, clear, uid, debounce, fmtDate, toast, popupMenu, confirm, prompt, modal, emojiPicker, closeMenu } from './ui/h.js';
import { NoteEditor } from './editor/editor.js';
import { htmlToMarkdown, markdownToHtml } from './editor/markdown.js';
import { createVault } from './vault/vault.js';
import * as md from './editor/markdown.js';
window.__md = md;
import { FONTS } from './editor/toolbar.js';

const nv = window.nv;
const DEFAULTS = {
  theme: 'system', accent: '#0a84ff', fontFamily: '', fontSize: 16, lineHeight: 1.65, width: 'medium', zoom: 100, spellcheck: true,
  autoLockMin: 10, clipboardClear: 30, sidebarW: 230, listW: 300, sidebarHidden: false, sort: 'updated', listDensity: 'comfy',
};
const ACCENTS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#ac8e68', '#8e8e93'];
const FOLDER_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a', '#8e8e93'];

const app = window.__app = {
  view: 'notes', settings: { ...DEFAULTS }, notes: [], folders: [], filter: 'all', query: '', currentId: null, current: null,
  dirty: false, saving: false, focusMode: false,
};

// ---------------- layout ----------------
const root = h('div', { class: 'app', id: 'app' });
const sidebar = h('aside', { class: 'sidebar' });
const listPane = h('section', { class: 'list-pane' });
const mainPane = h('main', { class: 'main-pane' });
const notesMain = h('div', { class: 'notes-main' });
const vaultMain = h('div', { class: 'vault-main' });
mainPane.append(notesMain, vaultMain);
const resizer1 = h('div', { class: 'resizer', dataset: { which: 'sidebarW' } });
const resizer2 = h('div', { class: 'resizer', dataset: { which: 'listW' } });
root.append(sidebar, resizer1, listPane, resizer2, mainPane);
document.body.append(root);

for (const r of [resizer1, resizer2]) {
  r.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const key = r.dataset.which;
    const start = e.clientX, startW = app.settings[key];
    document.body.classList.add('resizing');
    const move = (ev) => {
      const w = Math.max(key === 'sidebarW' ? 180 : 220, Math.min(key === 'sidebarW' ? 360 : 520, startW + ev.clientX - start));
      app.settings[key] = w; applyLayout();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); saveSettings({ [key]: app.settings[key] }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
}

function applyLayout() {
  const s = app.settings;
  root.style.setProperty('--sb-w', (s.sidebarHidden || app.focusMode ? 0 : s.sidebarW) + 'px');
  root.style.setProperty('--list-w', (app.focusMode || (app.view === 'vault' && !vault.isUnlocked()) ? 0 : s.listW) + 'px');
  root.classList.toggle('sb-hidden', !!s.sidebarHidden || app.focusMode);
  root.classList.toggle('focus-mode', app.focusMode);
  root.classList.toggle('list-hidden', app.focusMode || (app.view === 'vault' && !vault.isUnlocked()));
  root.dataset.view = app.view;
}

function applySettings() {
  const s = app.settings, d = document.documentElement.style;
  d.setProperty('--accent', s.accent);
  d.setProperty('--editor-font', s.fontFamily || 'var(--ui-font)');
  d.setProperty('--editor-size', s.fontSize + 'px');
  d.setProperty('--editor-lh', s.lineHeight);
  d.setProperty('--editor-zoom', s.zoom / 100);
  d.setProperty('--page-w', { narrow: '640px', medium: '780px', wide: '980px', full: '100%' }[s.width] || '780px');
  document.documentElement.dataset.density = s.listDensity;
  nv.theme.set(s.theme);
  editor?.editor.view.dom.setAttribute('spellcheck', String(s.spellcheck !== false));
  applyLayout();
}

async function saveSettings(patch) {
  Object.assign(app.settings, patch);
  await nv.settings.set(patch);
  applySettings();
}

// ---------------- vault ----------------
const vault = createVault({
  get settings() { return app.settings; }, set settings(v) { Object.assign(app.settings, v); },
  renderAll: () => renderAll(), renderMain: () => renderMain(), renderSidebar: () => renderSidebar(),
  onVaultUnlocked: async () => { if (app.current?.locked) await openNote(app.current.id, true); },
});

// ---------------- notes data ----------------
const inTrash = (n) => !!n.trashedAt;
function folderById(id) { return app.folders.find((f) => f.id === id); }
function allTags() {
  const m = new Map();
  for (const n of app.notes) if (!inTrash(n)) for (const t of n.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'));
}
function noteTitle(n) { return n.title?.trim() || (n.locked ? 'โน้ตล็อก' : (n.text || '').trim().split('\n')[0].slice(0, 80)) || 'ไม่มีชื่อ'; }

function filteredNotes() {
  const q = app.query.trim().toLowerCase();
  let list = app.notes;
  if (q) list = list.filter((n) => !inTrash(n) && (noteTitle(n) + ' ' + (n.text || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q));
  else {
    const f = app.filter;
    if (f === 'trash') list = list.filter(inTrash);
    else {
      list = list.filter((n) => !inTrash(n));
      if (f === 'pinned') list = list.filter((n) => n.pinned);
      else if (f === 'locked') list = list.filter((n) => n.locked);
      else if (f.startsWith('folder:')) list = list.filter((n) => n.folderId === f.slice(7));
      else if (f.startsWith('tag:')) list = list.filter((n) => (n.tags || []).includes(f.slice(4)));
    }
  }
  const s = app.settings.sort;
  const cmp = s === 'title' ? (a, b) => noteTitle(a).localeCompare(noteTitle(b), 'th') : s === 'created' ? (a, b) => b.createdAt - a.createdAt : (a, b) => b.updatedAt - a.updatedAt;
  return [...list].sort((a, b) => (app.filter !== 'trash' && !q && (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || cmp(a, b));
}

async function loadNotes() {
  [app.notes, app.folders] = await Promise.all([nv.lib.listNotes(), nv.lib.getFolders()]);
}

// ---------------- editor ----------------
let editor;
const ui = {};
function buildNoteView() {
  editor = window.__editor = new NoteEditor({ onChange: () => markDirty(), getSettings: () => app.settings });

  ui.iconBtn = h('button', { class: 'note-icon', title: 'ไอคอนโน้ต' });
  ui.iconBtn.addEventListener('click', () => emojiPicker(ui.iconBtn, (e) => { if (!app.current) return; app.current.icon = e; drawNoteHead(); markDirty(); }));
  ui.title = h('textarea', { class: 'note-title', rows: 1, placeholder: 'ชื่อโน้ต', spellcheck: 'false' });
  const autosize = () => { ui.title.style.height = 'auto'; ui.title.style.height = ui.title.scrollHeight + 'px'; };
  ui.title.addEventListener('input', () => { if (!app.current) return; app.current.title = ui.title.value.replace(/\n/g, ' '); autosize(); markDirty(); });
  ui.title.addEventListener('keydown', (e) => { if (e.key === 'Enter' || (e.key === 'ArrowDown' && ui.title.selectionStart === ui.title.value.length)) { e.preventDefault(); editor.focus('start'); } });
  ui.autosize = autosize;
  ui.meta = h('div', { class: 'note-meta' });
  ui.banner = h('div', { class: 'note-banner' });
  ui.lockOverlay = h('div', { class: 'lock-overlay' });

  ui.page = h('div', { class: 'note-page' },
    h('div', { class: 'note-head' }, ui.iconBtn, ui.title, ui.meta),
    editor.contentEl, editor.sourceEl);
  editor.sourceEl.style.display = 'none';
  ui.scroll = h('div', { class: 'note-scroll' }, ui.page);
  ui.scroll.addEventListener('mousedown', (e) => {
    // clicking the empty area under the content focuses the end of the note
    if (e.target === ui.scroll || e.target === ui.page) { e.preventDefault(); editor.focus('end'); }
  });

  ui.saved = h('span', { class: 'st-saved' });
  ui.stats = h('span', { class: 'st-stats' });
  ui.zoomLabel = h('button', { class: 'st-btn', title: 'รีเซ็ตขนาด', onclick: () => setZoom(0) });
  ui.mdBtn = h('button', { class: 'icon-btn', title: 'Markdown ดิบ (⌘⇧M)', onclick: () => toggleSource() }, icon('markdown'));
  const status = h('div', { class: 'statusbar' },
    ui.saved, h('span', { class: 'st-flex' }), ui.stats,
    h('span', { class: 'st-group' },
      h('button', { class: 'st-btn', title: 'ย่อ (⌘-)', onclick: () => setZoom(-1) }, icon('zoomOut')), ui.zoomLabel,
      h('button', { class: 'st-btn', title: 'ขยาย (⌘=)', onclick: () => setZoom(1) }, icon('zoomIn'))),
    h('button', { class: 'st-btn', title: 'ความกว้างหน้า', onclick: (e) => popupMenu(['narrow', 'medium', 'wide', 'full'].map((w) => ({
      label: { narrow: 'แคบ (อ่านง่าย)', medium: 'กลาง', wide: 'กว้าง', full: 'เต็มจอ' }[w], checked: app.settings.width === w, onClick: () => saveSettings({ width: w }) })), e.currentTarget) }, icon('width')));

  const topRight = h('div', { class: 'note-top-actions no-drag' },
    h('button', { class: 'icon-btn', title: 'ค้นหาในโน้ต (⌘F)', onclick: () => editor.openFind() }, icon('search')),
    ui.mdBtn,
    h('button', { class: 'icon-btn', title: 'โหมดโฟกัส (⌘⇧\\)', onclick: () => toggleFocus() }, icon('focus')),
    h('button', { class: 'icon-btn', title: 'เพิ่มเติม', onclick: (e) => app.current && noteMenu(app.current, e.currentTarget) }, icon('more')));

  ui.topbar = h('div', { class: 'note-topbar drag' }, h('div', { class: 'tb-scroll no-drag' }, editor.toolbar.el), topRight);
  ui.view = h('div', { class: 'note-view' }, ui.topbar, editor.toolbar.ctxBar, editor.findBar, ui.banner, ui.scroll, ui.lockOverlay, status, editor.bubbleEl);
  ui.empty = h('div', { class: 'placeholder drag' },
    h('div', { class: 'ph-icon' }, icon('notes')), h('h2', {}, 'ยังไม่ได้เลือกโน้ต'),
    h('p', { class: 'muted' }, 'เลือกโน้ตทางซ้าย หรือสร้างโน้ตใหม่'),
    h('div', { class: 'ph-actions no-drag' }, h('button', { class: 'btn primary', onclick: () => newNote() }, icon('plus'), 'โน้ตใหม่ (⌘N)')));
  notesMain.append(ui.view, ui.empty);

  editor.editor.on('update', () => updateStats());
  editor.editor.on('selectionUpdate', () => {});
}

function drawNoteHead() {
  const n = app.current;
  if (!n) return;
  ui.iconBtn.textContent = n.icon || '';
  ui.iconBtn.classList.toggle('empty', !n.icon);
  if (!n.icon) ui.iconBtn.append(icon('emoji'));
  clear(ui.meta);
  const f = folderById(n.folderId);
  const folderBtn = h('button', { class: 'meta-chip', title: 'ย้ายโฟลเดอร์' }, f ? (f.icon || '📁') + ' ' + f.name : '📁 ไม่มีโฟลเดอร์');
  folderBtn.addEventListener('click', () => popupMenu([{ header: 'ย้ายไปโฟลเดอร์' },
    { label: 'ไม่มีโฟลเดอร์', checked: !n.folderId, onClick: () => moveNote(n, null) },
    ...app.folders.map((x) => ({ label: x.name, icon: x.icon || '📁', checked: x.id === n.folderId, onClick: () => moveNote(n, x.id) }))], folderBtn));
  ui.meta.append(folderBtn);
  for (const t of n.tags || []) {
    ui.meta.append(h('span', { class: 'meta-chip tag' }, '#' + t,
      h('button', { class: 'chip-x', title: 'เอาแท็กออก', onclick: () => { n.tags = n.tags.filter((x) => x !== t); drawNoteHead(); markDirty(); renderSidebar(); } }, icon('x'))));
  }
  const addTag = h('button', { class: 'meta-chip add' }, icon('tag'), 'แท็ก');
  addTag.addEventListener('click', async () => {
    const v = await prompt('เพิ่มแท็ก', '', { placeholder: 'เช่น งาน, สำคัญ (คั่นด้วย ,)' });
    if (!v) return;
    const tags = v.split(/[,#]/).map((x) => x.trim()).filter(Boolean);
    n.tags = [...new Set([...(n.tags || []), ...tags])];
    drawNoteHead(); markDirty(); renderSidebar();
  });
  ui.meta.append(addTag);
  if (n.locked) ui.meta.append(h('span', { class: 'meta-chip locked' }, icon('lock'), 'ล็อกด้วยรหัสผ่านหลัก'));
  ui.meta.append(h('span', { class: 'meta-date' }, 'แก้ไข ' + new Date(n.updatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })));
}

function updateStats() {
  const s = editor.stats();
  ui.stats.textContent = `${s.words.toLocaleString()} คำ · ${s.chars.toLocaleString()} ตัวอักษร`;
}
function setZoom(d) {
  const steps = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250];
  let z = app.settings.zoom;
  if (d === 0) z = 100;
  else { const i = steps.findIndex((s) => s >= z); z = steps[Math.max(0, Math.min(steps.length - 1, (steps[i] === z ? i : d > 0 ? i - 1 : i) + d))]; }
  saveSettings({ zoom: z });
  ui.zoomLabel.textContent = z + '%';
}
function toggleSource() {
  if (!app.current || app.current.lockedOut) return;
  const on = editor.toggleSource();
  ui.mdBtn.classList.toggle('on', on);
  root.classList.toggle('source-mode', on);
  if (on) toast('โหมด Markdown — สี/ขนาดตัวอักษรจะไม่แสดงในโหมดนี้');
}
function toggleFocus() { app.focusMode = !app.focusMode; applyLayout(); }

// ---------------- open / save ----------------
const saveSoon = debounce(() => saveCurrent(), 500);
function markDirty() {
  if (!app.current || app.loadingNote) return;
  app.dirty = true;
  ui.saved.textContent = 'กำลังแก้ไข…';
  saveSoon();
}

async function saveCurrent() {
  const n = app.current;
  if (!n || !app.dirty || n.lockedOut || inTrash(n)) return;
  app.dirty = false;
  const full = { ...n, html: editor.getHTML(), text: editor.getText(), updatedAt: Date.now() };
  delete full.lockedOut;
  try {
    const meta = await nv.lib.saveNote(full);
    if (n.locked) meta.text = full.text; // keep searchable while unlocked in this session
    Object.assign(n, { updatedAt: full.updatedAt });
    const i = app.notes.findIndex((x) => x.id === n.id);
    if (i >= 0) app.notes[i] = { ...app.notes[i], ...meta, text: full.text };
    ui.saved.textContent = 'บันทึกแล้ว';
    renderList(true);
  } catch (e) {
    app.dirty = true;
    ui.saved.textContent = 'บันทึกไม่สำเร็จ';
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

function isBlankNote(n) {
  if (n.title?.trim() || n.icon || (n.tags || []).length || inTrash(n)) return false;
  const html = editor.getHTML();
  return !editor.getText().trim() && !/<(img|table|hr|pre)/.test(html);
}

async function openNote(id, force = false) {
  if (!force && app.currentId === id) return;
  saveSoon.cancel();
  const prev = app.current;
  if (prev && !prev.locked && !prev.lockedOut && isBlankNote(prev)) {
    // like Apple Notes: an empty note you leave behind is discarded
    await nv.lib.deleteNote(prev.id);
    app.notes = app.notes.filter((x) => x.id !== prev.id);
    app.dirty = false;
    renderSidebar();
  } else await saveCurrent();
  closeMenu();
  app.currentId = id;
  if (!id) { app.current = null; renderMain(); renderList(true); return; }
  const n = await nv.lib.getNote(id);
  if (!n) { app.currentId = null; app.current = null; renderMain(); return; }
  const { html, enc, ...meta } = n;
  app.current = meta;
  app.loadingNote = true;
  editor.setContent(html);
  app.loadingNote = false;
  app.dirty = false;
  ui.title.value = meta.title || '';
  requestAnimationFrame(ui.autosize);
  ui.saved.textContent = '';
  ui.scroll.scrollTop = 0;
  root.classList.remove('source-mode'); ui.mdBtn.classList.remove('on');
  editor.closeFind && editor.findBar.classList.remove('show');
  renderMain();
  renderList(true);
  updateStats();
}

async function newNote(opts = {}) {
  await saveCurrent();
  const f = app.filter;
  const n = {
    id: uid('n'), title: opts.title || '', icon: '', html: opts.html || '<p></p>', text: '',
    folderId: f.startsWith('folder:') ? f.slice(7) : null, tags: f.startsWith('tag:') ? [f.slice(4)] : [],
    pinned: f === 'pinned', locked: false, trashedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (f === 'trash' || f === 'locked') app.filter = 'all';
  const meta = await nv.lib.saveNote(n);
  app.notes.unshift({ ...meta, text: n.text });
  app.query = '';
  if (app.view !== 'notes') setView('notes');
  await openNote(n.id);
  renderSidebar();
  if (opts.title) editor.focus('end'); else ui.title.focus();
  return n;
}

async function patchNote(n, patch) {
  if (n.id === app.currentId) { await saveCurrent(); Object.assign(app.current, patch); }
  const full = await nv.lib.getNote(n.id);
  if (full.locked && !vault.isUnlocked()) {
    // metadata-only change on a locked note: keep the encrypted body as is
    const { lockedOut, ...rest } = full;
    toast('ปลดล็อกตู้เซฟก่อนแก้โน้ตที่ล็อกไว้', 'error');
    return rest;
  }
  const updated = { ...full, ...patch, updatedAt: patch.updatedAt ?? full.updatedAt };
  delete updated.lockedOut;
  const meta = await nv.lib.saveNote(updated);
  const i = app.notes.findIndex((x) => x.id === n.id);
  if (i >= 0) app.notes[i] = { ...app.notes[i], ...meta, text: full.text ?? app.notes[i].text };
  if (n.id === app.currentId) drawNoteHead();
  renderSidebar(); renderList(true);
  return meta;
}

const moveNote = (n, folderId) => patchNote(n, { folderId });

async function trashNote(n) {
  await patchNote(n, { trashedAt: Date.now(), pinned: false });
  if (n.id === app.currentId) { app.currentId = null; app.current = null; renderMain(); }
  toast('ย้ายไปถังขยะแล้ว');
}
async function restoreNote(n) { await patchNote(n, { trashedAt: null }); if (n.id === app.currentId) await openNote(n.id, true); toast('กู้คืนแล้ว'); }
async function destroyNote(n) {
  if (!(await confirm('ลบถาวร?', `“${noteTitle(n)}” จะหายไปและกู้คืนไม่ได้`, 'ลบถาวร', true))) return;
  await nv.lib.deleteNote(n.id);
  app.notes = app.notes.filter((x) => x.id !== n.id);
  if (n.id === app.currentId) { app.currentId = null; app.current = null; }
  renderAll();
}
async function emptyTrash() {
  const list = app.notes.filter(inTrash);
  if (!list.length || !(await confirm('ล้างถังขยะ?', `ลบถาวร ${list.length} โน้ต`, 'ล้างถังขยะ', true))) return;
  for (const n of list) await nv.lib.deleteNote(n.id);
  app.notes = app.notes.filter((x) => !inTrash(x));
  if (app.current && inTrash(app.current)) { app.currentId = null; app.current = null; }
  renderAll();
}
async function duplicateNote(n) {
  const full = await nv.lib.getNote(n.id);
  if (full.lockedOut) return toast('ปลดล็อกตู้เซฟก่อน', 'error');
  const copy = { ...full, id: uid('n'), title: noteTitle(n) + ' (สำเนา)', pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
  delete copy.lockedOut;
  const meta = await nv.lib.saveNote(copy);
  app.notes.unshift({ ...meta, text: full.text });
  await openNote(copy.id);
  renderSidebar();
}
async function toggleLock(n) {
  const st = await vault.refreshStatus();
  if (!st.exists) {
    if (await confirm('ยังไม่มีรหัสผ่านหลัก', 'ต้องสร้างตู้เซฟ (ตั้งรหัสผ่านหลัก) ก่อนจึงจะล็อกโน้ตได้', 'ไปสร้าง')) setView('vault');
    return;
  }
  if (!st.unlocked) { toast('ปลดล็อกตู้เซฟก่อน', 'error'); setView('vault'); return; }
  const locking = !n.locked;
  await patchNote(n, { locked: locking });
  if (n.id === app.currentId) await openNote(n.id, true);
  toast(locking ? 'ล็อกโน้ตแล้ว 🔒 เนื้อหาถูกเข้ารหัส' : 'ปลดล็อกโน้ตแล้ว');
}

function noteMenu(n, at) {
  const trash = inTrash(n);
  if (trash) return popupMenu([
    { label: 'กู้คืน', icon: 'restore', onClick: () => restoreNote(n) },
    { label: 'ลบถาวร', icon: 'trash', danger: true, onClick: () => destroyNote(n) }], at);
  popupMenu([
    { label: n.pinned ? 'เลิกปักหมุด' : 'ปักหมุด', icon: 'pin', onClick: () => patchNote(n, { pinned: !n.pinned }) },
    { label: n.locked ? 'ปลดล็อกโน้ต' : 'ล็อกโน้ต (เข้ารหัส)', icon: n.locked ? 'unlock' : 'lock', onClick: () => toggleLock(n) },
    { label: 'ย้ายไปโฟลเดอร์', icon: 'folder', onClick: () => popupMenu([
      { label: 'ไม่มีโฟลเดอร์', checked: !n.folderId, onClick: () => moveNote(n, null) },
      ...app.folders.map((x) => ({ label: x.name, icon: x.icon || '📁', checked: x.id === n.folderId, onClick: () => moveNote(n, x.id) }))], at) },
    { label: 'ทำสำเนา', icon: 'duplicate', onClick: () => duplicateNote(n) },
    '-',
    { label: 'ส่งออก Markdown', icon: 'markdown', onClick: () => exportNote('md', n) },
    { label: 'ส่งออก HTML', icon: 'code', onClick: () => exportNote('html', n) },
    { label: 'ส่งออก PDF', icon: 'print', onClick: () => exportNote('pdf', n) },
    { label: 'คัดลอกเป็น Markdown', icon: 'copy', onClick: async () => {
      const full = n.id === app.currentId ? { html: editor.getHTML() } : await nv.lib.getNote(n.id);
      await navigator.clipboard.writeText(htmlToMarkdown(full.html || '')); toast('คัดลอก Markdown แล้ว'); } },
    '-',
    { label: 'ย้ายไปถังขยะ', icon: 'trash', danger: true, onClick: () => trashNote(n) },
  ], at);
}

// ---------------- export / import ----------------
async function inlineImages(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  for (const img of doc.querySelectorAll('img[src^="nv://"]')) {
    try {
      const blob = await (await fetch(img.getAttribute('src'))).blob();
      img.setAttribute('src', await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }));
    } catch { /* keep the original src */ }
  }
  return doc.body.firstChild.innerHTML;
}
const safeName = (s) => (s || 'note').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);

async function exportNote(kind, n = app.current) {
  if (!n) return toast('เลือกโน้ตก่อน', 'error');
  if (n.id !== app.currentId) await openNote(n.id);
  if (app.current.lockedOut) return toast('ปลดล็อกโน้ตก่อน', 'error');
  await saveCurrent();
  const title = noteTitle(app.current);
  if (kind === 'pdf') { await nv.file.savePdf({ name: safeName(title) + '.pdf' }); return; }
  const html = await inlineImages(editor.getHTML());
  if (kind === 'md') {
    const p = await nv.file.saveText({ name: safeName(title) + '.md', ext: 'md', content: `# ${title}\n\n` + htmlToMarkdown(html) });
    if (p) toast('ส่งออกแล้ว');
  } else {
    const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>${css}
body{background:#fff;color:#1d1d1f;overflow:auto;height:auto}.export{max-width:820px;margin:40px auto;padding:0 24px}</style></head>
<body><div class="export"><h1>${title.replace(/</g, '&lt;')}</h1><div class="prose">${html}</div></div></body></html>`;
    const p = await nv.file.saveText({ name: safeName(title) + '.html', ext: 'html', content: doc });
    if (p) toast('ส่งออกแล้ว');
  }
}

async function importFiles() {
  const files = await nv.file.openText();
  for (const f of files) {
    let html;
    if (f.ext === 'md' || f.ext === 'markdown') html = markdownToHtml(f.content);
    else if (f.ext === 'html' || f.ext === 'htm') html = new DOMParser().parseFromString(f.content, 'text/html').body.innerHTML;
    else html = f.content.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
    let title = f.name;
    const m = html.match(/^\s*<h1[^>]*>(.*?)<\/h1>/i);
    if (m) { title = m[1].replace(/<[^>]+>/g, ''); html = html.replace(m[0], ''); }
    await newNote({ title, html });
    markDirty(); await saveSoon.flush();
  }
  if (files.length) toast(`นำเข้า ${files.length} ไฟล์แล้ว`);
}

// ---------------- folders ----------------
async function saveFolders() { app.folders = await nv.lib.saveFolders(app.folders); renderSidebar(); }
async function newFolder() {
  const name = await prompt('โฟลเดอร์ใหม่', '', { placeholder: 'ชื่อโฟลเดอร์' });
  if (!name?.trim()) return;
  const f = { id: uid('f'), name: name.trim(), icon: '', color: FOLDER_COLORS[app.folders.length % FOLDER_COLORS.length], order: app.folders.length + 1 };
  app.folders.push(f);
  await saveFolders();
  setFilter('folder:' + f.id);
}
function folderMenu(f, at) {
  popupMenu([
    { label: 'เปลี่ยนชื่อ', icon: 'edit', onClick: async () => { const v = await prompt('เปลี่ยนชื่อโฟลเดอร์', f.name); if (v?.trim()) { f.name = v.trim(); saveFolders(); } } },
    { label: 'เปลี่ยนไอคอน', icon: 'emoji', onClick: () => emojiPicker(at, (e) => { f.icon = e; saveFolders(); }) },
    { el: h('div', { class: 'menu-colors' }, FOLDER_COLORS.map((c) => h('button', { class: 'swatch' + (f.color === c ? ' on' : ''), style: { background: c }, onclick: () => { closeMenu(); f.color = c; saveFolders(); } }))) },
    { label: 'เลื่อนขึ้น', icon: 'arrowUp', onClick: () => { const i = app.folders.indexOf(f); if (i > 0) { [app.folders[i - 1], app.folders[i]] = [app.folders[i], app.folders[i - 1]]; app.folders.forEach((x, j) => (x.order = j)); saveFolders(); } } },
    { label: 'เลื่อนลง', icon: 'arrowDown', onClick: () => { const i = app.folders.indexOf(f); if (i < app.folders.length - 1) { [app.folders[i + 1], app.folders[i]] = [app.folders[i], app.folders[i + 1]]; app.folders.forEach((x, j) => (x.order = j)); saveFolders(); } } },
    '-',
    { label: 'ลบโฟลเดอร์', icon: 'trash', danger: true, onClick: async () => {
      const notes = app.notes.filter((n) => n.folderId === f.id);
      if (!(await confirm('ลบโฟลเดอร์?', notes.length ? `โน้ต ${notes.length} รายการจะย้ายออกไปอยู่ “ทั้งหมด” (ไม่ถูกลบ)` : 'โฟลเดอร์ว่าง', 'ลบ', true))) return;
      for (const n of notes) await patchNote(n, { folderId: null });
      app.folders = app.folders.filter((x) => x !== f);
      if (app.filter === 'folder:' + f.id) app.filter = 'all';
      await saveFolders(); renderList();
    } },
  ], at);
}

// ---------------- sidebar ----------------
function navItem({ id, label, icon: ic, emoji, color, count, warn, onClick, onContext, drop }) {
  const active = app.view === 'notes' ? app.filter === id && !app.query : vault.V.filter === id;
  const el = h('div', { class: 'nav-item' + (active ? ' active' : ''), tabindex: '-1' },
    emoji ? h('span', { class: 'nav-emoji' }, emoji) : icon(ic || 'folder', 'nav-ic'),
    h('span', { class: 'nav-label' }, label),
    count ? h('span', { class: 'nav-count' + (warn ? ' warn' : '') }, count) : null);
  if (color) el.style.setProperty('--folder', color);
  el.addEventListener('click', onClick);
  if (onContext) el.addEventListener('contextmenu', (e) => { e.preventDefault(); onContext(e); });
  if (drop) {
    el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('nv/note')) { e.preventDefault(); el.classList.add('drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); const id = e.dataTransfer.getData('nv/note'); const n = app.notes.find((x) => x.id === id); if (n) drop(n); });
  }
  return el;
}
const section = (title, action) => h('div', { class: 'nav-section' }, h('span', {}, title), action || null);

function renderSidebar() {
  clear(sidebar);
  const seg = h('div', { class: 'seg view-seg no-drag' },
    h('button', { class: app.view === 'notes' ? 'on' : '', onclick: () => setView('notes') }, icon('notes'), 'โน้ต'),
    h('button', { class: app.view === 'vault' ? 'on' : '', onclick: () => setView('vault') }, icon('key'), 'รหัสผ่าน'));
  const head = h('div', { class: 'sb-head drag' }, h('button', { class: 'icon-btn no-drag sb-toggle', title: 'ซ่อนแถบข้าง (⌘\\)', onclick: () => saveSettings({ sidebarHidden: true }) }, icon('sidebar')));
  const body = h('div', { class: 'sb-body' });
  add(sidebar, head, seg, body);

  if (app.view === 'notes') {
    const live = app.notes.filter((n) => !inTrash(n));
    add(body, 
      navItem({ id: 'all', label: 'โน้ตทั้งหมด', icon: 'notes', count: live.length, onClick: () => setFilter('all'), drop: (n) => moveNote(n, null) }),
      navItem({ id: 'pinned', label: 'ปักหมุด', icon: 'pin', count: live.filter((n) => n.pinned).length, onClick: () => setFilter('pinned'), drop: (n) => patchNote(n, { pinned: true }) }),
      live.some((n) => n.locked) ? navItem({ id: 'locked', label: 'ล็อกไว้', icon: 'lock', count: live.filter((n) => n.locked).length, onClick: () => setFilter('locked') }) : null,
      section('โฟลเดอร์', h('button', { class: 'icon-btn tiny', title: 'โฟลเดอร์ใหม่ (⌘⇧N)', onclick: newFolder }, icon('plus'))),
      ...[...app.folders].sort((a, b) => a.order - b.order).map((f) => navItem({
        id: 'folder:' + f.id, label: f.name, emoji: f.icon || null, icon: 'folder', color: f.color,
        count: live.filter((n) => n.folderId === f.id).length, onClick: () => setFilter('folder:' + f.id),
        onContext: (e) => folderMenu(f, e), drop: (n) => moveNote(n, f.id) })),
      !app.folders.length ? h('button', { class: 'nav-empty', onclick: newFolder }, '+ สร้างโฟลเดอร์') : null,
    );
    const tags = allTags();
    if (tags.length) add(body, section('แท็ก'), h('div', { class: 'tag-cloud' }, tags.map(([t, c]) => {
      const el = h('button', { class: 'tag-chip' + (app.filter === 'tag:' + t && !app.query ? ' active' : '') }, '#' + t, h('small', {}, c));
      el.addEventListener('click', () => setFilter('tag:' + t));
      return el;
    })));
    add(body, h('div', { class: 'sb-spacer' }),
      navItem({ id: 'trash', label: 'ถังขยะ', icon: 'trash', count: app.notes.filter(inTrash).length, onClick: () => setFilter('trash'), drop: (n) => trashNote(n) }));
  } else {
    const items = vault.sidebarItems();
    const pick = (id) => () => { vault.V.filter = id; vault.V.query = ''; renderSidebar(); renderList(); };
    if (items.main) {
      add(body, ...items.main.map((x) => navItem({ ...x, onClick: pick(x.id) })));
      if (items.types.length) add(body, section('ชนิด'), ...items.types.map((x) => navItem({ ...x, onClick: pick(x.id) })));
      if (items.cats.length) add(body, section('หมวดหมู่'), ...items.cats.map((x) => navItem({ ...x, onClick: pick(x.id) })));
      add(body, section('ตรวจสุขภาพรหัสผ่าน'), ...items.health.map((x) => navItem({ ...x, onClick: pick(x.id) })));
    } else {
      add(body, h('div', { class: 'sb-note muted' }, vault.V.status?.exists ? 'ตู้เซฟล็อกอยู่ ใส่รหัสผ่านหลักเพื่อเปิด' : 'ยังไม่มีตู้เซฟ ตั้งรหัสผ่านหลักเพื่อเริ่มใช้'));
    }
    add(body, h('div', { class: 'sb-spacer' }));
  }

  const foot = h('div', { class: 'sb-foot' },
    h('button', { class: 'icon-btn', title: 'ตั้งค่า (⌘,)', onclick: openSettings }, icon('settings')),
    h('button', { class: 'icon-btn', title: 'สร้างรหัสผ่าน (⌘G)', onclick: (e) => vault.openGenerator(e.currentTarget) }, icon('sparkle')),
    h('span', { class: 'st-flex' }),
    vault.isUnlocked()
      ? h('button', { class: 'btn small ghost', title: 'ล็อกตู้เซฟ (⌘L)', onclick: () => nv.vault.lock() }, icon('unlock'), 'ล็อก')
      : vault.V.status?.exists ? h('span', { class: 'sb-locked muted', title: 'ตู้เซฟล็อกอยู่' }, icon('lock')) : null);
  add(sidebar, foot);
}

// ---------------- list ----------------
function snippetEl(n, q) {
  if (n.locked && !n.text) return h('span', { class: 'muted' }, '🔒 เนื้อหาถูกเข้ารหัส');
  const text = (n.text || '').replace(/\s+/g, ' ').trim();
  const title = noteTitle(n);
  let body = text.startsWith(title) && !n.title ? text.slice(title.length).trim() : text;
  if (!q) return body.slice(0, 140) || 'ไม่มีข้อความเพิ่มเติม';
  const i = body.toLowerCase().indexOf(q);
  if (i < 0) return body.slice(0, 140);
  const start = Math.max(0, i - 30);
  return [start ? '…' : '', body.slice(start, i), h('mark', {}, body.slice(i, i + q.length)), body.slice(i + q.length, i + q.length + 100)];
}

function renderList(rowsOnly = false) {
  if (app.view !== 'notes') { if (!rowsOnly) vault.renderList(listPane); else vault.V.renderRows?.(); return; }
  if (rowsOnly && ui.rows) return drawRows();
  clear(listPane);
  const f = app.filter;
  const title = app.query ? 'ผลการค้นหา' : f === 'all' ? 'โน้ตทั้งหมด' : f === 'pinned' ? 'ปักหมุด' : f === 'trash' ? 'ถังขยะ' : f === 'locked' ? 'โน้ตที่ล็อก'
    : f.startsWith('folder:') ? (folderById(f.slice(7))?.name || 'โฟลเดอร์') : '#' + f.slice(4);
  const search = h('input', { class: 'search', type: 'search', placeholder: 'ค้นหาทุกโน้ต', value: app.query });
  search.addEventListener('input', () => { app.query = search.value; drawRows(); renderSidebar(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    if (e.key === 'Escape') { search.value = ''; app.query = ''; drawRows(); renderSidebar(); }
    if (e.key === 'Enter') { const first = filteredNotes()[0]; if (first) openNote(first.id).then(() => editor.focus('start')); }
  });
  ui.search = search;
  ui.count = h('span', { class: 'list-count' });
  ui.rows = h('div', { class: 'rows', tabindex: '0' });
  ui.rows.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    if (e.key === 'Enter' && app.current) { e.preventDefault(); editor.focus('start'); }
    if ((e.key === 'Backspace' || e.key === 'Delete') && app.current && e.metaKey) { e.preventDefault(); inTrash(app.current) ? destroyNote(app.current) : trashNote(app.current); }
  });
  add(listPane, 
    h('div', { class: 'list-head drag' },
      h('div', { class: 'list-title' }, app.settings.sidebarHidden ? h('button', { class: 'icon-btn no-drag', title: 'แสดงแถบข้าง', onclick: () => saveSettings({ sidebarHidden: false }) }, icon('sidebar')) : null,
        h('span', {}, title), ui.count),
      h('div', { class: 'list-actions no-drag' },
        f === 'trash' ? h('button', { class: 'btn small ghost danger', onclick: emptyTrash }, 'ล้างถังขยะ') : null,
        h('button', { class: 'icon-btn', title: 'เรียงลำดับ', onclick: (e) => popupMenu([
          { header: 'เรียงตาม' },
          ...[['updated', 'แก้ไขล่าสุด'], ['created', 'สร้างล่าสุด'], ['title', 'ชื่อ (ก-ฮ, A-Z)']].map(([k, l]) => ({ label: l, checked: app.settings.sort === k, onClick: () => { saveSettings({ sort: k }); drawRows(); } })),
          { header: 'การแสดงผล' },
          ...[['comfy', 'แสดงตัวอย่างข้อความ'], ['compact', 'กระชับ']].map(([k, l]) => ({ label: l, checked: app.settings.listDensity === k, onClick: () => saveSettings({ listDensity: k }) })),
        ], e.currentTarget) }, icon('sort')),
        h('button', { class: 'icon-btn', title: 'โน้ตใหม่ (⌘N)', onclick: () => newNote() }, icon('edit')))),
    h('div', { class: 'search-wrap' }, icon('search', 'search-ic'), search),
    ui.rows);
  drawRows();
}

function drawRows() {
  const list = filteredNotes();
  const q = app.query.trim().toLowerCase();
  ui.count.textContent = list.length;
  const scroll = ui.rows.scrollTop;
  clear(ui.rows);
  if (!list.length) {
    add(ui.rows, h('div', { class: 'empty-list' }, q ? 'ไม่พบโน้ตที่ตรงกับคำค้น' : app.filter === 'trash' ? 'ถังขยะว่าง' : 'ยังไม่มีโน้ต',
      !q && app.filter !== 'trash' ? h('button', { class: 'btn small', onclick: () => newNote() }, icon('plus'), 'โน้ตใหม่') : null));
    return;
  }
  let lastGroup = null;
  for (const n of list) {
    const group = !q && app.filter !== 'trash' && n.pinned ? 'ปักหมุด' : !q && app.filter !== 'trash' && list.some((x) => x.pinned) ? 'โน้ต' : null;
    if (group && group !== lastGroup) { add(ui.rows, h('div', { class: 'row-group' }, group)); lastGroup = group; }
    const f = folderById(n.folderId);
    const row = h('div', { class: 'row note-row' + (n.id === app.currentId ? ' active' : ''), draggable: 'true' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, n.icon ? h('span', { class: 'row-emoji' }, n.icon) : null, h('span', { class: 'row-title-text' }, noteTitle(n)),
          n.locked ? icon('lock', 'row-flag') : null, n.pinned ? icon('pin', 'row-flag') : null),
        h('div', { class: 'row-sub' }, h('span', { class: 'row-date' }, fmtDate(n.updatedAt)), h('span', { class: 'row-snippet' }, snippetEl(n, q))),
        f && app.filter !== 'folder:' + f.id ? h('div', { class: 'row-folder' }, h('span', { class: 'dot', style: { background: f.color || 'var(--muted)' } }), f.name) : null));
    row.addEventListener('click', () => openNote(n.id));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); noteMenu(n, e); });
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('nv/note', n.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    add(ui.rows, row);
  }
  ui.rows.scrollTop = scroll;
  ui.rows.querySelector('.row.active')?.scrollIntoView({ block: 'nearest' });
}

function moveSel(d) {
  const list = filteredNotes();
  if (!list.length) return;
  const i = list.findIndex((n) => n.id === app.currentId);
  const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + d))];
  openNote(next.id).then(() => ui.rows.focus());
}

// ---------------- main ----------------
function renderMain() {
  notesMain.style.display = app.view === 'notes' ? '' : 'none';
  vaultMain.style.display = app.view === 'vault' ? '' : 'none';
  if (app.view === 'vault') { vault.renderMain(vaultMain); return; }
  const n = app.current;
  ui.view.style.display = n ? '' : 'none';
  ui.empty.style.display = n ? 'none' : '';
  if (!n) return;
  drawNoteHead();
  const trash = inTrash(n);
  clear(ui.banner);
  ui.banner.style.display = trash ? '' : 'none';
  if (trash) add(ui.banner, icon('trash'), h('span', {}, 'โน้ตนี้อยู่ในถังขยะ'), h('span', { class: 'st-flex' }),
    h('button', { class: 'btn small', onclick: () => restoreNote(n) }, 'กู้คืน'),
    h('button', { class: 'btn small danger', onclick: () => destroyNote(n) }, 'ลบถาวร'));
  const editable = !trash && !n.lockedOut;
  editor.setEditable(editable);
  ui.title.readOnly = !editable;
  ui.view.classList.toggle('readonly', !editable);
  ui.zoomLabel.textContent = app.settings.zoom + '%';

  clear(ui.lockOverlay);
  ui.lockOverlay.style.display = n.lockedOut ? '' : 'none';
  if (n.lockedOut) {
    const pw = h('input', { class: 'input big', type: 'password', placeholder: 'รหัสผ่านหลัก' });
    const err = h('div', { class: 'form-err' });
    const go = async () => {
      const r = await nv.vault.unlock(pw.value);
      if (!r.ok) { err.textContent = r.wait ? `รอ ${r.wait} วินาที` : 'รหัสผ่านไม่ถูกต้อง'; pw.select(); return; }
      await vault.refreshStatus(); await vault.loadItems();
      await openNote(n.id, true); renderSidebar();
    };
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    const st = vault.V.status;
    add(ui.lockOverlay, h('div', { class: 'lock-card' },
      h('div', { class: 'lock-icon' }, icon('lock')), h('h2', {}, 'โน้ตนี้ถูกล็อก'),
      h('p', { class: 'muted' }, 'ใส่รหัสผ่านหลักเพื่อเปิดอ่าน'), pw, err,
      h('div', { class: 'lock-actions' }, h('button', { class: 'btn primary', onclick: go }, icon('unlock'), 'ปลดล็อก'),
        st?.touchIdEnabled && st?.touchIdAvailable ? h('button', { class: 'btn', onclick: async () => { await vault.tryTouchId(); } }, icon('fingerprint'), 'Touch ID') : null)));
    setTimeout(() => pw.focus(), 30);
  }
}

function renderAll() { applyLayout(); renderSidebar(); renderList(); renderMain(); }

function setView(v) {
  if (app.view === v) return;
  saveCurrent();
  app.view = v;
  closeMenu();
  if (v === 'vault') vault.refreshStatus().then(async () => { await vault.loadItems(); renderAll(); });
  else renderAll();
}
function setFilter(f) {
  if (app.view !== 'notes') { app.view = 'notes'; }
  app.filter = f; app.query = '';
  renderAll();
}

// ---------------- settings ----------------
async function openSettings() {
  const s = app.settings;
  const info = await nv.lib.info();
  const st = await vault.refreshStatus();
  const tabs = ['ทั่วไป', 'ตัวแก้ไข', 'ตู้เซฟ', 'ข้อมูล'];
  let tab = 0;
  const body = h('div', { class: 'settings' });
  const seg = h('div', { class: 'seg' }, tabs.map((t, i) => h('button', { class: i === tab ? 'on' : '', onclick: () => { tab = i; draw(); } }, t)));
  const row = (label, control, hint) => h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, label, hint ? h('small', {}, hint) : null), h('div', { class: 'set-ctl' }, control));
  const select = (key, options, onChange) => {
    const el = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l)));
    el.addEventListener('change', () => { const v = typeof s[key] === 'number' ? Number(el.value) : el.value; saveSettings({ [key]: v }); onChange?.(v); });
    return el;
  };
  const toggle = (key) => { const c = h('input', { type: 'checkbox', class: 'switch', checked: s[key] !== false }); c.addEventListener('change', () => saveSettings({ [key]: c.checked })); return c; };

  function draw() {
    seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === tab));
    clear(body);
    if (tab === 0) {
      add(body, 
        row('ธีม', select('theme', [['system', 'ตามระบบ'], ['light', 'สว่าง'], ['dark', 'มืด']])),
        row('สีหลัก', h('div', { class: 'accent-row' }, ACCENTS.map((c) => h('button', { class: 'swatch big' + (s.accent === c ? ' on' : ''), style: { background: c }, onclick: () => { saveSettings({ accent: c }); draw(); } })),
          (() => { const i = h('input', { type: 'color', class: 'color-input', value: s.accent }); i.addEventListener('change', () => { saveSettings({ accent: i.value }); draw(); }); return i; })())),
        row('รายการโน้ต', select('listDensity', [['comfy', 'แสดงตัวอย่างข้อความ'], ['compact', 'กระชับ']])),
      );
    } else if (tab === 1) {
      add(body, 
        row('ฟอนต์เริ่มต้น', select('fontFamily', FONTS.map(([n, v]) => [v, n]))),
        row('ขนาดตัวอักษร', select('fontSize', [13, 14, 15, 16, 17, 18, 20, 22].map((v) => [v, v + ' px']))),
        row('ระยะห่างบรรทัด', select('lineHeight', [1.4, 1.5, 1.65, 1.8, 2].map((v) => [v, String(v)]))),
        row('ความกว้างหน้า', select('width', [['narrow', 'แคบ'], ['medium', 'กลาง'], ['wide', 'กว้าง'], ['full', 'เต็มจอ']])),
        row('ตรวจคำสะกด', toggle('spellcheck'), 'ขีดเส้นใต้คำที่สะกดผิด (ภาษาอังกฤษ)'),
        h('div', { class: 'set-hint' }, h('b', {}, 'คีย์ลัดที่ใช้บ่อย'),
          h('div', { class: 'kbd-grid' }, [['/', 'เมนูแทรก'], ['⌘B / ⌘I / ⌘U', 'หนา / เอียง / ขีดเส้นใต้'], ['⌘⇧H', 'ไฮไลต์'], ['⌘K', 'ลิงก์'], ['⌘⇧7 / 8 / 9', 'รายการตัวเลข / จุด / checklist'],
            ['⌘⌥1…4', 'หัวข้อ 1–4'], ['⌘⇧E / L / R', 'จัดกลาง / ซ้าย / ขวา'], ['Tab / ⇧Tab', 'เยื้อง'], ['⌘F / ⌘⌥F', 'ค้นหา / แทนที่'], ['⌘⇧M', 'Markdown ดิบ'], ['⌘= / ⌘-', 'ขยาย / ย่อ'], ['⌘⇧\\', 'โหมดโฟกัส']]
            .map(([k, l]) => [h('span', { class: 'kbd' }, k), h('span', {}, l)]))));
    } else if (tab === 2) {
      add(body, 
        row('ล็อกอัตโนมัติ', select('autoLockMin', [[1, '1 นาที'], [5, '5 นาที'], [10, '10 นาที'], [30, '30 นาที'], [60, '1 ชั่วโมง'], [0, 'ไม่ล็อกเอง']]), 'เมื่อไม่ได้ใช้งาน (ล็อกเสมอเมื่อล็อกจอ/พักเครื่อง)'),
        row('ล้างคลิปบอร์ด', select('clipboardClear', [[10, '10 วินาที'], [30, '30 วินาที'], [60, '1 นาที'], [120, '2 นาที'], [0, 'ไม่ล้าง']]), 'หลังคัดลอกรหัสผ่าน'),
      );
      if (st.exists && st.unlocked) {
        const touch = h('input', { type: 'checkbox', class: 'switch', checked: st.touchIdEnabled, disabled: !st.touchIdAvailable });
        touch.addEventListener('change', async () => { const r = await nv.vault.setTouchId(touch.checked); vault.V.status = r; toast(r.touchIdEnabled ? 'เปิด Touch ID แล้ว' : 'ปิด Touch ID แล้ว'); });
        add(body, 
          row('ปลดล็อกด้วย Touch ID', touch, st.touchIdAvailable ? 'ใช้ลายนิ้วมือแทนการพิมพ์รหัส' : 'เครื่องนี้ไม่รองรับ Touch ID'),
          row('รหัสผ่านหลัก', h('button', { class: 'btn small', onclick: changeMaster }, 'เปลี่ยนรหัสผ่านหลัก')),
          row('นำเข้า JSON', h('button', { class: 'btn small', onclick: () => vault.importJson() }, icon('upload'), 'เลือกไฟล์…'), 'รูปแบบ {items:[{type,title,category,fields:[{label,value,secret}],notes}]}'),
          row('ส่งออก (ยังเข้ารหัส)', h('button', { class: 'btn small', onclick: async () => { const p = await nv.vault.export(); if (p) toast('ส่งออกแล้ว'); } }, icon('download'), 'บันทึกไฟล์…')),
        );
      } else add(body, h('p', { class: 'muted' }, st.exists ? 'ปลดล็อกตู้เซฟเพื่อดูตัวเลือกเพิ่มเติม (Touch ID, เปลี่ยนรหัส, นำเข้า)' : 'ยังไม่ได้สร้างตู้เซฟ'));
    } else {
      add(body, 
        row('โฟลเดอร์ข้อมูล', h('div', { class: 'path-box' }, h('code', {}, info.root)), 'โน้ต รูป และตู้เซฟ (เข้ารหัส) อยู่ที่นี่'),
        h('div', { class: 'set-actions' },
          h('button', { class: 'btn small', onclick: () => nv.lib.reveal() }, icon('folder'), 'เปิดใน Finder'),
          h('button', { class: 'btn small', onclick: async () => { const r = await nv.lib.chooseFolder(); if (r) { await reloadLibrary(); toast('เปลี่ยนโฟลเดอร์แล้ว'); draw2(); } } }, 'เปลี่ยนโฟลเดอร์…'),
          info.root !== info.defaultRoot ? h('button', { class: 'btn small ghost', onclick: async () => { await nv.lib.resetFolder(); await reloadLibrary(); draw2(); } }, 'ใช้ค่าเริ่มต้น') : null),
        h('p', { class: 'set-hint muted' }, '💡 ใช้หลายเครื่อง: ตั้งโฟลเดอร์ข้อมูลไว้ใน iCloud Drive / Dropbox ทั้งสองเครื่อง (ห้ามเปิดพร้อมกันสองเครื่อง)'),
        row('สำรองข้อมูล', h('button', { class: 'btn small', onclick: async () => { const p = await nv.lib.backup(); if (p) toast('สำรองแล้ว'); } }, icon('download'), 'สำรองตอนนี้…'), 'คัดลอกทั้งโฟลเดอร์ (ตู้เซฟยังเข้ารหัสอยู่)'),
        row('ข้อมูลตัวอย่าง', h('button', { class: 'btn small', onclick: async () => { await nv.lib.seedSamples(); await reloadLibrary(); toast('เพิ่มโน้ตตัวอย่างแล้ว'); } }, 'เพิ่มโน้ตตัวอย่าง')),
      );
    }
  }
  async function draw2() { Object.assign(info, await nv.lib.info()); draw(); }
  draw();
  modal('ตั้งค่า', [seg, body], [{ label: 'เสร็จ', primary: true }], { class: 'settings-modal' });
}

async function changeMaster() {
  const a = h('input', { class: 'input', type: 'password', placeholder: 'รหัสผ่านหลักเดิม' });
  const b = h('input', { class: 'input', type: 'password', placeholder: 'รหัสผ่านหลักใหม่ (อย่างน้อย 8 ตัว)' });
  const c = h('input', { class: 'input', type: 'password', placeholder: 'ยืนยันรหัสใหม่' });
  const err = h('div', { class: 'form-err' });
  await modal('เปลี่ยนรหัสผ่านหลัก', [a, b, c, err], [{ label: 'ยกเลิก' }, { label: 'เปลี่ยน', primary: true, onClick: async (close) => {
    if (b.value.length < 8) return (err.textContent = 'รหัสใหม่ต้องยาวอย่างน้อย 8 ตัว');
    if (b.value !== c.value) return (err.textContent = 'รหัสใหม่ไม่ตรงกัน');
    try {
      const ok = await nv.vault.changePassword(a.value, b.value);
      if (!ok) return (err.textContent = 'รหัสผ่านเดิมไม่ถูกต้อง');
      toast('เปลี่ยนรหัสผ่านหลักแล้ว'); close(true);
    } catch (e) { err.textContent = e.message; }
  } }]);
}

async function reloadLibrary() {
  vault.onLocked();
  await vault.refreshStatus();
  await loadNotes();
  app.currentId = null; app.current = null; app.filter = 'all';
  renderAll();
}

// ---------------- global events ----------------
nv.on('menu', (cmd, arg) => {
  switch (cmd) {
    case 'new-note': newNote(); break;
    case 'new-folder': newFolder(); break;
    case 'new-item': setView('vault'); setTimeout(() => vault.isUnlocked() ? vault.newItem('login') : toast('ปลดล็อกตู้เซฟก่อน', 'error'), 50); break;
    case 'import-file': importFiles(); break;
    case 'export': exportNote(arg); break;
    case 'backup': nv.lib.backup().then((p) => p && toast('สำรองแล้ว')); break;
    case 'settings': openSettings(); break;
    case 'find': if (app.view === 'notes' && app.current) editor.openFind(false); else (app.view === 'vault' ? vault.focusSearch() : ui.search?.focus()); break;
    case 'replace': if (app.view === 'notes' && app.current) editor.openFind(true); break;
    case 'search': if (app.view === 'vault') vault.focusSearch(); else { ui.search?.focus(); ui.search?.select(); } break;
    case 'view': setView(arg); break;
    case 'toggle-sidebar': saveSettings({ sidebarHidden: !app.settings.sidebarHidden }).then(() => renderList()); break;
    case 'focus-mode': toggleFocus(); break;
    case 'markdown-source': if (app.view === 'notes') toggleSource(); break;
    case 'zoom': setZoom(arg); break;
    case 'generator': vault.openGenerator(null); break;
    default: break;
  }
});

nv.on('vault:locked', async () => {
  vault.onLocked();
  await vault.refreshStatus();
  if (app.current?.locked) { app.dirty = false; await openNote(app.current.id, true); }
  // drop decrypted text of locked notes from memory
  app.notes = app.notes.map((n) => (n.locked ? { ...n, text: '' } : n));
  renderAll();
});

// ⌘K → link (TipTap has no default binding)
document.addEventListener('keydown', (e) => {
  if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'k' && editor?.editor.isFocused) { e.preventDefault(); editor.editLink(); }
  if (e.key === 'Escape' && app.focusMode && !document.querySelector('.modal-back,.menu')) toggleFocus();
});

// auto-lock after inactivity
let lastActive = Date.now();
for (const ev of ['mousemove', 'keydown', 'mousedown', 'wheel']) window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true });
setInterval(() => {
  const m = app.settings.autoLockMin;
  if (m > 0 && vault.isUnlocked() && Date.now() - lastActive > m * 60000) nv.vault.lock();
}, 15000);

window.addEventListener('beforeunload', () => { saveSoon.cancel(); saveCurrent(); });

// ---------------- boot ----------------
(async function boot() {
  Object.assign(app.settings, DEFAULTS, await nv.settings.get());
  buildNoteView();
  applySettings();
  await Promise.all([loadNotes(), vault.refreshStatus()]);
  renderAll();
  const first = filteredNotes()[0];
  if (first) await openNote(first.id);
  document.body.classList.add('ready');
})();
