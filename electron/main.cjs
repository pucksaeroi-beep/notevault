'use strict';
const {
  app, BrowserWindow, ipcMain, protocol, net, dialog, shell, clipboard, Menu,
  systemPreferences, safeStorage, powerMonitor, nativeTheme, session,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vault = require('./vault.cjs');
const { Library } = require('./library.cjs');
const mock = require('./mock.cjs');

app.setName('NoteVault');
// Test hooks: a throwaway data dir + a scripted run (see scripts/shot.mjs). Ignored in normal use.
if (process.env.NV_USER_DATA) app.setPath('userData', process.env.NV_USER_DATA);
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '..', 'dist');
const CONFIG = path.join(app.getPath('userData'), 'config.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'nv', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ---------------- config ----------------
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { config = {}; }
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
}
const libraryRoot = () => config.libraryPath || path.join(app.getPath('userData'), 'Library');

let lib = null;
function openLibrary() {
  lib = new Library(libraryRoot());
  if (lib.isEmpty() && !config.seeded?.[lib.root]) {
    for (const n of mock.sampleNotes()) lib.saveNote({ ...n, text: htmlToText(n.html), trashedAt: null, locked: false });
    if (!lib.getFolders().length) lib.saveFolders(mock.sampleFolders());
    config.seeded = { ...(config.seeded || {}), [lib.root]: true };
    saveConfig();
  }
}
function htmlToText(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// ---------------- vault session (DEK lives only in main-process memory) ----------------
let dek = null;
let doc = null; // { items: [] }
let failed = 0;
let lockedUntil = 0;

function lockVault(reason = 'manual') {
  if (dek) dek.fill(0);
  dek = null; doc = null;
  win?.webContents.send('vault:locked', reason);
}
function requireUnlocked() { if (!dek) throw new Error('ตู้เซฟล็อกอยู่'); }
function touchIdAvailable() {
  try { return process.platform === 'darwin' && systemPreferences.canPromptTouchID() && safeStorage.isEncryptionAvailable(); }
  catch { return false; }
}
function vaultStatus() {
  return { exists: vault.exists(lib.root), unlocked: !!dek, touchIdAvailable: touchIdAvailable(),
    touchIdEnabled: !!config.touchId?.[lib.root], lockedUntil };
}

// ---------------- window ----------------
let win = null;
function createWindow() {
  const b = config.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1320, height: b.height || 840, x: b.x, y: b.y, minWidth: 860, minHeight: 520,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    // (test runs use an opaque window: screenshots of a vibrancy window come out washed out)
    ...(process.env.NV_SCRIPT ? { backgroundColor: nativeTheme.shouldUseDarkColors ? '#262628' : '#f2f2f4' } : { vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (!win.isMinimized() && !win.isFullScreen()) { config.bounds = win.getBounds(); saveConfig(); } };
  win.on('resized', remember); win.on('moved', remember);
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const ok = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('nv://app/');
    if (!ok) { e.preventDefault(); if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('context-menu', (_e, p) => {
    // Spelling suggestions only; the app draws its own menus for everything else.
    if (!p.misspelledWord) return;
    const items = p.dictionarySuggestions.slice(0, 6).map((s) => ({ label: s, click: () => win.webContents.replaceMisspelling(s) }));
    items.push({ type: 'separator' }, { label: 'เพิ่มในพจนานุกรม', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    Menu.buildFromTemplate(items).popup();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('nv://app/index.html');
  if (process.env.NV_SCRIPT) win.webContents.once('did-finish-load', () => runScript(process.env.NV_SCRIPT));
}

async function runScript(file) {
  const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('[renderer]', msg); });
  await wait(1200);
  for (const st of steps) {
    try {
      if (st.eval) { const r = await win.webContents.executeJavaScript(st.eval, true); if (r !== undefined) console.log('[eval]', JSON.stringify(r)); }
      if (st.key) win.webContents.sendInputEvent({ type: 'keyDown', keyCode: st.key, modifiers: st.mods || [] });
      if (st.type) for (const ch of st.type) win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await wait(st.wait ?? 400);
      if (st.shot) fs.writeFileSync(st.shot, (await win.webContents.capturePage()).toPNG());
    } catch (e) { console.log('[step error]', e.message); }
  }
  app.exit(0);
}

function send(cmd, arg) { win?.webContents.send('menu', cmd, arg); }
function buildMenu() {
  const t = [
    { label: 'NoteVault', submenu: [
      { role: 'about', label: 'เกี่ยวกับ NoteVault' }, { type: 'separator' },
      { label: 'ตั้งค่า…', accelerator: 'Cmd+,', click: () => send('settings') }, { type: 'separator' },
      { role: 'hide', label: 'ซ่อน NoteVault' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { role: 'quit', label: 'ออกจาก NoteVault' }] },
    { label: 'ไฟล์', submenu: [
      { label: 'โน้ตใหม่', accelerator: 'Cmd+N', click: () => send('new-note') },
      { label: 'โฟลเดอร์ใหม่', accelerator: 'Cmd+Shift+N', click: () => send('new-folder') },
      { label: 'รายการรหัสผ่านใหม่', accelerator: 'Cmd+Alt+N', click: () => send('new-item') },
      { type: 'separator' },
      { label: 'นำเข้าไฟล์ (Markdown / HTML / TXT)…', accelerator: 'Cmd+O', click: () => send('import-file') },
      { label: 'ส่งออกเป็น Markdown…', accelerator: 'Cmd+Shift+E', click: () => send('export', 'md') },
      { label: 'ส่งออกเป็น HTML…', click: () => send('export', 'html') },
      { label: 'ส่งออกเป็น PDF…', accelerator: 'Cmd+P', click: () => send('export', 'pdf') },
      { type: 'separator' },
      { label: 'สำรองข้อมูลทั้งหมด…', click: () => send('backup') },
      { type: 'separator' }, { role: 'close', label: 'ปิดหน้าต่าง' }] },
    { label: 'แก้ไข', submenu: [
      { role: 'undo', label: 'เลิกทำ' }, { role: 'redo', label: 'ทำซ้ำ' }, { type: 'separator' },
      { role: 'cut', label: 'ตัด' }, { role: 'copy', label: 'คัดลอก' }, { role: 'paste', label: 'วาง' },
      { role: 'pasteAndMatchStyle', label: 'วางแบบข้อความล้วน' }, { role: 'selectAll', label: 'เลือกทั้งหมด' },
      { type: 'separator' },
      { label: 'ค้นหาในโน้ต', accelerator: 'Cmd+F', click: () => send('find') },
      { label: 'ค้นหา/แทนที่', accelerator: 'Cmd+Alt+F', click: () => send('replace') },
      { label: 'ค้นหาทุกโน้ต', accelerator: 'Cmd+Shift+F', click: () => send('search') },
      { type: 'separator' }, { role: 'startSpeaking', label: 'อ่านออกเสียง' }, { role: 'stopSpeaking', label: 'หยุดอ่าน' }] },
    { label: 'มุมมอง', submenu: [
      { label: 'โน้ต', accelerator: 'Cmd+1', click: () => send('view', 'notes') },
      { label: 'รหัสผ่าน', accelerator: 'Cmd+2', click: () => send('view', 'vault') },
      { type: 'separator' },
      { label: 'ซ่อน/แสดงแถบข้าง', accelerator: 'Cmd+\\', click: () => send('toggle-sidebar') },
      { label: 'โหมดโฟกัส', accelerator: 'Cmd+Shift+\\', click: () => send('focus-mode') },
      { label: 'Markdown ดิบ', accelerator: 'Cmd+Shift+M', click: () => send('markdown-source') },
      { type: 'separator' },
      { label: 'ขยายเนื้อหา', accelerator: 'Cmd+=', click: () => send('zoom', 1) },
      { label: 'ย่อเนื้อหา', accelerator: 'Cmd+-', click: () => send('zoom', -1) },
      { label: 'ขนาดจริง', accelerator: 'Cmd+0', click: () => send('zoom', 0) },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'เต็มจอ' },
      ...(app.isPackaged ? [] : [{ role: 'reload' }, { role: 'toggleDevTools' }])] },
    { label: 'ตู้เซฟ', submenu: [
      { label: 'ล็อกตู้เซฟ', accelerator: 'Cmd+L', click: () => lockVault('manual') },
      { label: 'สร้างรหัสผ่าน…', accelerator: 'Cmd+G', click: () => send('generator') }] },
    { role: 'windowMenu', label: 'หน้าต่าง' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

// ---------------- IPC ----------------
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    if (e.senderFrame && win && e.sender !== win.webContents) throw new Error('forbidden');
    return fn(...args);
  });
}

function registerIpc() {
  // Library
  handle('lib:info', () => ({ root: lib.root, defaultRoot: path.join(app.getPath('userData'), 'Library') }));
  handle('lib:listNotes', () => lib.listNotes());
  handle('lib:getNote', (id) => {
    const n = lib.getNote(id);
    if (!n || !n.locked) return n;
    if (!dek) return { ...n, enc: undefined, html: '', lockedOut: true };
    try { const body = vault.openJson(dek, n.enc); return { ...n, enc: undefined, html: body.html, text: body.text }; }
    catch { return { ...n, enc: undefined, html: '', lockedOut: true }; }
  });
  handle('lib:saveNote', (note) => {
    if (note.locked) {
      requireUnlocked();
      const { html, text, ...meta } = note;
      return lib.saveNote({ ...meta, text: '', enc: vault.sealJson(dek, { html, text }) });
    }
    return lib.saveNote(note);
  });
  handle('lib:deleteNote', (id) => lib.deleteNote(id));
  handle('lib:getFolders', () => lib.getFolders());
  handle('lib:saveFolders', (list) => lib.saveFolders(list));
  handle('lib:saveAsset', (bytes, ext) => lib.saveAsset(Buffer.from(bytes), ext));
  handle('lib:pickImage', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'รูปภาพ', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => lib.saveAsset(fs.readFileSync(p), path.extname(p).slice(1)));
  });
  handle('lib:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'],
      message: 'เลือกโฟลเดอร์เก็บข้อมูล (เช่นใน iCloud Drive เพื่อใช้หลายเครื่อง)' });
    if (r.canceled) return null;
    lockVault('library-changed');
    config.libraryPath = r.filePaths[0]; saveConfig(); openLibrary();
    return lib.root;
  });
  handle('lib:resetFolder', () => { lockVault('library-changed'); delete config.libraryPath; saveConfig(); openLibrary(); return lib.root; });
  handle('lib:reveal', () => shell.openPath(lib.root));
  handle('lib:backup', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], message: 'เลือกที่เก็บไฟล์สำรอง' });
    if (r.canceled) return null;
    const dest = lib.backupTo(r.filePaths[0]);
    shell.showItemInFolder(dest);
    return dest;
  });
  handle('lib:seedSamples', () => {
    for (const n of mock.sampleNotes()) {
      lib.saveNote({ ...n, id: n.id + '-' + Date.now().toString(36), text: htmlToText(n.html), trashedAt: null, locked: false, pinned: false });
    }
    return true;
  });

  // Files
  handle('file:saveText', async ({ name, content, ext }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, content, 'utf8');
    return r.filePath;
  });
  handle('file:savePdf', async ({ name }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled) return null;
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(r.filePath, pdf);
    shell.openPath(r.filePath);
    return r.filePath;
  });
  handle('file:openText', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'เอกสาร', extensions: ['md', 'markdown', 'txt', 'html', 'htm'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => ({ name: path.basename(p, path.extname(p)), ext: path.extname(p).slice(1).toLowerCase(), content: fs.readFileSync(p, 'utf8') }));
  });
  handle('file:openJson', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return null;
    return fs.readFileSync(r.filePaths[0], 'utf8');
  });

  // Vault
  handle('vault:status', () => vaultStatus());
  handle('vault:create', async (password, withSamples) => {
    if (vault.exists(lib.root)) throw new Error('มีตู้เซฟอยู่แล้ว');
    const items = withSamples ? mock.sampleVaultItems().map(vault.sanitizeItem) : [];
    dek = await vault.create(lib.root, password, items);
    doc = { items };
    return vaultStatus();
  });
  handle('vault:unlock', async (password) => {
    if (Date.now() < lockedUntil) return { ok: false, wait: Math.ceil((lockedUntil - Date.now()) / 1000) };
    const k = await vault.unlock(lib.root, password);
    if (!k) {
      failed++;
      if (failed >= 5) lockedUntil = Date.now() + Math.min(300, 15 * 2 ** (failed - 5)) * 1000;
      return { ok: false, failed };
    }
    failed = 0; lockedUntil = 0; dek = k; doc = vault.load(lib.root, dek);
    return { ok: true };
  });
  handle('vault:unlockTouchId', async () => {
    const blob = config.touchId?.[lib.root];
    if (!blob || !touchIdAvailable()) return { ok: false };
    try { await systemPreferences.promptTouchID('ปลดล็อกตู้เซฟ NoteVault'); } catch { return { ok: false, cancelled: true }; }
    try {
      const k = Buffer.from(safeStorage.decryptString(Buffer.from(blob, 'base64')), 'base64');
      if (!vault.verify(lib.root, k)) return { ok: false };
      dek = k; doc = vault.load(lib.root, dek); failed = 0;
      return { ok: true };
    } catch { return { ok: false }; }
  });
  handle('vault:setTouchId', (on) => {
    requireUnlocked();
    config.touchId = config.touchId || {};
    if (on && touchIdAvailable()) config.touchId[lib.root] = safeStorage.encryptString(dek.toString('base64')).toString('base64');
    else delete config.touchId[lib.root];
    saveConfig();
    return vaultStatus();
  });
  handle('vault:lock', () => lockVault('manual'));
  handle('vault:items', () => { requireUnlocked(); return doc.items; });
  handle('vault:saveItem', (raw) => {
    requireUnlocked();
    const item = vault.sanitizeItem(raw);
    const i = doc.items.findIndex((x) => x.id === item.id);
    if (i >= 0) { item.createdAt = doc.items[i].createdAt; doc.items[i] = item; } else doc.items.unshift(item);
    vault.save(lib.root, dek, doc);
    return item;
  });
  handle('vault:deleteItem', (id) => {
    requireUnlocked();
    doc.items = doc.items.filter((x) => x.id !== id);
    vault.save(lib.root, dek, doc);
    return true;
  });
  handle('vault:import', (list) => {
    requireUnlocked();
    const items = (Array.isArray(list) ? list : []).map((x) => vault.sanitizeItem({ ...x, id: undefined }));
    doc.items = [...items, ...doc.items];
    vault.save(lib.root, dek, doc);
    return items.length;
  });
  handle('vault:export', async () => {
    requireUnlocked();
    const r = await dialog.showSaveDialog(win, { defaultPath: 'vault-encrypted.json', message: 'ไฟล์นี้ยังเข้ารหัสอยู่ เปิดได้ด้วยรหัสผ่านหลักเท่านั้น' });
    if (r.canceled) return null;
    fs.copyFileSync(path.join(lib.root, 'vault.json'), r.filePath);
    return r.filePath;
  });
  handle('vault:changePassword', async (oldPw, newPw) => vault.changePassword(lib.root, oldPw, newPw));

  // Clipboard: copy a secret and wipe it after N seconds if it is still there.
  let clipTimer = null;
  handle('clip:copy', (text, seconds) => {
    clipboard.writeText(String(text));
    clearTimeout(clipTimer);
    if (seconds > 0) clipTimer = setTimeout(() => { if (clipboard.readText() === String(text)) clipboard.clear(); }, seconds * 1000);
    return true;
  });

  // Settings (UI prefs only)
  handle('settings:get', () => config.settings || {});
  handle('settings:set', (s) => { config.settings = { ...(config.settings || {}), ...s }; saveConfig(); return config.settings;
  });
  handle('theme:set', (mode) => { nativeTheme.themeSource = ['light', 'dark'].includes(mode) ? mode : 'system'; return true; });
  handle('open:external', (url) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); });
}

// ---------------- app lifecycle ----------------
app.whenReady().then(() => {
  protocol.handle('nv', (req) => {
    const u = new URL(req.url);
    if (u.host === 'asset') {
      const p = lib.assetPath(decodeURIComponent(u.pathname.slice(1)));
      return p ? net.fetch(pathToFileURL(p).toString()) : new Response('not found', { status: 404 });
    }
    if (u.host === 'app') {
      const rel = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
      const p = path.join(DIST, rel || 'index.html');
      if (!p.startsWith(DIST)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(p).toString());
    }
    return new Response('not found', { status: 404 });
  });

  if (!DEV_URL) {
    session.defaultSession.webRequest.onHeadersReceived((d, cb) => {
      cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [
        "default-src 'self' nv:; script-src 'self' nv:; style-src 'self' nv: 'unsafe-inline'; img-src 'self' nv: data: blob: https: http:; font-src 'self' nv: data:; connect-src 'self' nv:; object-src 'none'; base-uri 'none'"] } });
    });
  }
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));

  nativeTheme.themeSource = config.settings?.theme || 'system';
  openLibrary();
  registerIpc();
  buildMenu();
  createWindow();

  powerMonitor.on('lock-screen', () => lockVault('screen-locked'));
  powerMonitor.on('suspend', () => lockVault('sleep'));
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { lockVault('closed'); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => lockVault('quit'));
