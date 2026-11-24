import { h, icon, add, clear, toast, popupMenu, popover, closeMenu, confirm, modal, emojiPicker, uid, fmtDate } from '../ui/h.js';
import { strength, generate, totp } from './tools.js';

export const TEMPLATES = {
  login: { label: 'ล็อกอิน / เว็บไซต์', icon: '🌐', fields: [['ชื่อผู้ใช้ / อีเมล', 'text'], ['รหัสผ่าน', 'password'], ['เว็บไซต์', 'url']] },
  card: { label: 'บัตรเครดิต / เดบิต', icon: '💳', fields: [['ชื่อบนบัตร', 'text'], ['เลขบัตร', 'password'], ['หมดอายุ', 'text'], ['CVV', 'pin'], ['PIN', 'pin']] },
  bank: { label: 'บัญชีธนาคาร', icon: '🏦', fields: [['ธนาคาร', 'text'], ['เลขบัญชี', 'text'], ['ชื่อบัญชี', 'text'], ['PIN แอป', 'pin'], ['รหัสผ่าน', 'password']] },
  wifi: { label: 'Wi-Fi', icon: '📶', fields: [['ชื่อเครือข่าย (SSID)', 'text'], ['รหัสผ่าน', 'password']] },
  identity: { label: 'บัตร / เอกสาร', icon: '🪪', fields: [['ชื่อ-นามสกุล', 'text'], ['เลขที่', 'text'], ['วันหมดอายุ', 'text']] },
  note: { label: 'บันทึกลับ', icon: '🔐', fields: [] },
  other: { label: 'อื่น ๆ', icon: '🔑', fields: [['ข้อมูล', 'text']] },
};
const KINDS = [['text', 'ข้อความ'], ['password', 'รหัสผ่าน'], ['pin', 'PIN / ตัวเลขลับ'], ['email', 'อีเมล'], ['url', 'เว็บไซต์'], ['phone', 'เบอร์โทร'], ['totp', '2FA (TOTP)'], ['multiline', 'ข้อความยาว']];
const CATEGORY_SUGGEST = ['อีเมล', 'โซเชียล', 'ธนาคาร', 'งาน', 'ช้อปปิ้ง', 'บ้าน', 'เกม', 'รัฐบาล', 'สุขภาพ', 'เดินทาง', 'อื่น ๆ'];
const isSecretKind = (k) => k === 'password' || k === 'pin' || k === 'totp';

export function createVault(app) {
  const V = { status: null, items: [], filter: 'all', selectedId: null, editing: null, query: '', revealed: new Set(), sort: 'title' };
  let totpTimer = null;
  const settings = () => app.settings;

  async function refreshStatus() { V.status = await window.nv.vault.status(); return V.status; }
  async function loadItems() { V.items = V.status?.unlocked ? await window.nv.vault.items() : []; }

  function onLocked() {
    V.items = []; V.editing = null; V.revealed.clear(); V.selectedId = null;
    if (V.status) V.status.unlocked = false;
    clearInterval(totpTimer);
  }

  // ---------------- analysis ----------------
  function passwords(it) { return it.fields.filter((f) => f.kind === 'password' && f.value); }
  function weakIds() { return new Set(V.items.filter((it) => passwords(it).some((f) => strength(f.value).score <= 1)).map((it) => it.id)); }
  function dupIds() {
    const map = new Map();
    for (const it of V.items) for (const f of passwords(it)) { if (!map.has(f.value)) map.set(f.value, new Set()); map.get(f.value).add(it.id); }
    const out = new Set();
    for (const set of map.values()) if (set.size > 1) set.forEach((id) => out.add(id));
    return out;
  }

  function filtered() {
    let list = V.items;
    const f = V.filter;
    if (f === 'fav') list = list.filter((x) => x.favorite);
    else if (f === 'weak') { const s = weakIds(); list = list.filter((x) => s.has(x.id)); }
    else if (f === 'dup') { const s = dupIds(); list = list.filter((x) => s.has(x.id)); }
    else if (f.startsWith('type:')) list = list.filter((x) => x.type === f.slice(5));
    else if (f.startsWith('cat:')) list = list.filter((x) => (x.category || 'ไม่มีหมวด') === f.slice(4));
    const q = V.query.trim().toLowerCase();
    if (q) list = list.filter((x) => [x.title, x.category, x.notes, ...x.fields.filter((fl) => !isSecretKind(fl.kind)).map((fl) => fl.value + ' ' + fl.label)]
      .join(' ').toLowerCase().includes(q));
    const sorted = [...list];
    if (V.sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'th'));
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }

  // ---------------- sidebar ----------------
  function sidebarItems() {
    if (!V.status?.unlocked) return [];
    const types = Object.entries(TEMPLATES).map(([k, t]) => ({ id: 'type:' + k, label: t.label, emoji: t.icon, count: V.items.filter((x) => x.type === k).length })).filter((x) => x.count);
    const cats = [...new Set(V.items.map((x) => x.category || 'ไม่มีหมวด'))].sort((a, b) => a.localeCompare(b, 'th'))
      .map((c) => ({ id: 'cat:' + c, label: c, icon: 'tag', count: V.items.filter((x) => (x.category || 'ไม่มีหมวด') === c).length }));
    return {
      main: [{ id: 'all', label: 'ทั้งหมด', icon: 'vault', count: V.items.length }, { id: 'fav', label: 'รายการโปรด', icon: 'star', count: V.items.filter((x) => x.favorite).length }],
      types, cats,
      health: [{ id: 'weak', label: 'รหัสอ่อน', icon: 'shieldAlert', count: weakIds().size, warn: true }, { id: 'dup', label: 'รหัสซ้ำ', icon: 'copy', count: dupIds().size, warn: true }],
    };
  }

  // ---------------- list pane ----------------
  function itemSubtitle(it) {
    const f = it.fields.find((x) => !isSecretKind(x.kind) && x.value && x.kind !== 'multiline');
    return f ? f.value : it.category || TEMPLATES[it.type]?.label || '';
  }

  function renderList(pane) {
    clear(pane);
    const titleMap = { all: 'รหัสผ่านทั้งหมด', fav: 'รายการโปรด', weak: 'รหัสอ่อน', dup: 'รหัสซ้ำ' };
    const title = titleMap[V.filter] || (V.filter.startsWith('type:') ? TEMPLATES[V.filter.slice(5)]?.label : V.filter.slice(4));
    const list = filtered();
    const search = h('input', { class: 'search', placeholder: 'ค้นหารหัสผ่าน', value: V.query, type: 'search' });
    search.addEventListener('input', () => { V.query = search.value; renderRows(); });
    search.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } });
    const rows = h('div', { class: 'rows' });
    const countEl = h('span', { class: 'list-count' });
    pane.append(
      h('div', { class: 'list-head drag' },
        h('div', { class: 'list-title' }, h('span', {}, title), countEl),
        h('div', { class: 'list-actions no-drag' },
          h('button', { class: 'icon-btn', title: 'เรียง', onclick: (e) => popupMenu([
            { label: 'ตามชื่อ', checked: V.sort === 'title', onClick: () => { V.sort = 'title'; renderRows(); } },
            { label: 'แก้ไขล่าสุด', checked: V.sort === 'updated', onClick: () => { V.sort = 'updated'; renderRows(); } }], e.currentTarget) }, icon('sort')),
          h('button', { class: 'icon-btn', title: 'เพิ่มรายการ (⌘⌥N)', onclick: (e) => newItemMenu(e.currentTarget) }, icon('plus')))),
      h('div', { class: 'search-wrap' }, icon('search', 'search-ic'), search),
      rows);
    function renderRows() {
      const items = filtered();
      countEl.textContent = items.length;
      clear(rows);
      if (!items.length) rows.append(h('div', { class: 'empty-list' }, V.query ? 'ไม่พบรายการ' : 'ยังไม่มีรายการ'));
      const dups = dupIds(), weak = weakIds();
      for (const it of items) {
        const row = h('div', { class: 'row vault-row' + (it.id === V.selectedId ? ' active' : ''), tabindex: '-1' },
          h('div', { class: 'row-icon' }, it.icon || TEMPLATES[it.type]?.icon || '🔑'),
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, it.title, it.favorite ? icon('starFill', 'row-star') : null),
            h('div', { class: 'row-sub' }, itemSubtitle(it))),
          weak.has(it.id) ? h('span', { class: 'pill warn', title: 'รหัสผ่านอ่อน' }, 'อ่อน') : dups.has(it.id) ? h('span', { class: 'pill warn', title: 'ใช้รหัสซ้ำกับรายการอื่น' }, 'ซ้ำ') : null);
        row.addEventListener('click', () => select(it.id));
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); itemMenu(it, e); });
        rows.append(row);
      }
    }
    renderRows();
    V.renderRows = renderRows;
    V.searchEl = search;
  }

  function move(d) {
    const items = filtered();
    if (!items.length) return;
    const i = items.findIndex((x) => x.id === V.selectedId);
    select(items[Math.max(0, Math.min(items.length - 1, i + d))].id);
  }

  function select(id) {
    if (V.editing && !confirmDiscard()) return;
    V.selectedId = id; V.editing = null; V.revealed.clear();
    V.renderRows?.();
    app.renderMain();
  }
  function confirmDiscard() { return window.confirm('ทิ้งการแก้ไขที่ยังไม่บันทึก?'); }

  function itemMenu(it, at) {
    popupMenu([
      { label: it.favorite ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด', icon: 'star', onClick: () => save({ ...it, favorite: !it.favorite }) },
      { label: 'แก้ไข', icon: 'edit', onClick: () => { V.selectedId = it.id; startEdit(it); } },
      { label: 'ทำสำเนา', icon: 'duplicate', onClick: () => save({ ...structuredClone(it), id: undefined, title: it.title + ' (สำเนา)' }, true) },
      '-',
      { label: 'ลบ', icon: 'trash', danger: true, onClick: () => remove(it) },
    ], at);
  }

  function newItemMenu(anchor) {
    popupMenu([{ header: 'เพิ่มรายการใหม่' }, ...Object.entries(TEMPLATES).map(([k, t]) => ({ label: t.label, icon: t.icon, onClick: () => newItem(k) }))], anchor);
  }

  function newItem(type = 'login') {
    const t = TEMPLATES[type];
    const cat = V.filter.startsWith('cat:') && V.filter !== 'cat:ไม่มีหมวด' ? V.filter.slice(4) : '';
    V.selectedId = null;
    startEdit({ id: null, type, title: '', category: cat, icon: '', favorite: V.filter === 'fav', notes: '',
      fields: t.fields.map(([label, kind]) => ({ id: uid('f'), label, kind, value: '' })) });
  }

  // ---------------- main pane ----------------
  function renderMain(pane) {
    clearInterval(totpTimer);
    clear(pane);
    const st = V.status;
    if (!st) return;
    if (!st.exists) return pane.append(setupScreen());
    if (!st.unlocked) return pane.append(lockScreen());
    if (V.editing) return pane.append(editView());
    const it = V.items.find((x) => x.id === V.selectedId);
    if (!it) {
      return pane.append(h('div', { class: 'placeholder drag' },
        h('div', { class: 'ph-icon' }, icon('vault')),
        h('h2', {}, 'ตู้เซฟรหัสผ่าน'),
        h('p', { class: 'muted' }, `${V.items.length} รายการ · เข้ารหัส AES-256 เก็บในเครื่องนี้เท่านั้น`),
        h('div', { class: 'ph-actions no-drag' },
          h('button', { class: 'btn primary', onclick: (e) => newItemMenu(e.currentTarget) }, icon('plus'), 'เพิ่มรายการ'),
          h('button', { class: 'btn', onclick: (e) => openGenerator(e.currentTarget) }, icon('key'), 'สร้างรหัสผ่าน'))));
    }
    pane.append(detailView(it));
  }

  function setupScreen() {
    const pw = h('input', { class: 'input big', type: 'password', placeholder: 'รหัสผ่านหลัก (อย่างน้อย 8 ตัว)', autocomplete: 'new-password' });
    const pw2 = h('input', { class: 'input big', type: 'password', placeholder: 'ยืนยันรหัสผ่านหลัก', autocomplete: 'new-password' });
    const meter = h('div', { class: 'meter' }, h('span'));
    const meterLabel = h('span', { class: 'meter-label muted' });
    const samples = h('input', { type: 'checkbox', checked: true });
    const err = h('div', { class: 'form-err' });
    pw.addEventListener('input', () => { const s = strength(pw.value); meter.dataset.score = pw.value ? s.score : ''; meterLabel.textContent = pw.value ? s.label : ''; });
    const go = async () => {
      err.textContent = '';
      if (pw.value.length < 8) return (err.textContent = 'รหัสผ่านหลักต้องยาวอย่างน้อย 8 ตัวอักษร');
      if (pw.value !== pw2.value) return (err.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      btn.disabled = true; btn.textContent = 'กำลังสร้าง…';
      try {
        V.status = await window.nv.vault.create(pw.value, samples.checked);
        await loadItems(); app.renderAll();
        toast('สร้างตู้เซฟแล้ว 🔐');
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'สร้างตู้เซฟ'; }
    };
    const btn = h('button', { class: 'btn primary big', onclick: go }, 'สร้างตู้เซฟ');
    pw2.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    setTimeout(() => pw.focus(), 50);
    return h('div', { class: 'lock-screen drag' },
      h('div', { class: 'lock-card no-drag' },
        h('div', { class: 'lock-icon' }, icon('shield')),
        h('h2', {}, 'ตั้งรหัสผ่านหลัก'),
        h('p', { class: 'muted' }, 'ใช้เปิดตู้เซฟรหัสผ่านและโน้ตที่ล็อกไว้ ข้อมูลเข้ารหัส AES-256-GCM และเก็บในเครื่องนี้เท่านั้น'),
        pw, h('div', { class: 'meter-row' }, meter, meterLabel), pw2,
        h('label', { class: 'check' }, samples, 'ใส่ข้อมูลตัวอย่าง (ปลอม) ให้ดูก่อน'),
        h('div', { class: 'warn-box' }, icon('alert'), h('span', {}, 'ถ้าลืมรหัสผ่านหลัก จะกู้ข้อมูลในตู้เซฟไม่ได้เลย จดเก็บไว้ในที่ปลอดภัย')),
        err, btn));
  }

  function lockScreen() {
    const pw = h('input', { class: 'input big', type: 'password', placeholder: 'รหัสผ่านหลัก', autocomplete: 'current-password' });
    const err = h('div', { class: 'form-err' });
    const card = h('div', { class: 'lock-card no-drag' });
    const go = async () => {
      if (!pw.value) return;
      btn.disabled = true;
      const r = await window.nv.vault.unlock(pw.value);
      btn.disabled = false;
      if (r.ok) { await afterUnlock(); return; }
      pw.select();
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      err.textContent = r.wait ? `ใส่ผิดหลายครั้ง รอ ${r.wait} วินาที` : 'รหัสผ่านไม่ถูกต้อง';
    };
    const btn = h('button', { class: 'btn primary big', onclick: go }, icon('unlock'), 'ปลดล็อก');
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    const touch = V.status.touchIdEnabled && V.status.touchIdAvailable
      ? h('button', { class: 'btn big', onclick: () => tryTouchId() }, icon('fingerprint'), 'Touch ID') : null;
    card.append(h('div', { class: 'lock-icon' }, icon('lock')), h('h2', {}, 'ตู้เซฟล็อกอยู่'),
      h('p', { class: 'muted' }, 'ใส่รหัสผ่านหลักเพื่อดูรหัสผ่าน'), pw, err, h('div', { class: 'lock-actions' }, btn, touch));
    setTimeout(() => pw.focus(), 50);
    return h('div', { class: 'lock-screen drag' }, card);
  }

  async function tryTouchId() {
    const r = await window.nv.vault.unlockTouchId();
    if (r.ok) await afterUnlock();
    else if (!r.cancelled) toast('Touch ID ใช้ไม่ได้ ใส่รหัสผ่านแทน', 'error');
  }

  async function afterUnlock() {
    await refreshStatus(); await loadItems();
    app.onVaultUnlocked?.();
    app.renderAll();
  }

  // ---------------- detail ----------------
  function copy(value, label, secret) {
    const secs = secret ? (settings().clipboardClear ?? 30) : 0;
    window.nv.clip.copy(value, secs);
    toast(`คัดลอก${label ? ' ' + label : ''}แล้ว` + (secs ? ` · ล้างใน ${secs} วิ` : ''));
  }

  function detailView(it) {
    const t = TEMPLATES[it.type] || TEMPLATES.other;
    const dups = dupIds();
    const fields = h('div', { class: 'fields' });
    const totpEls = [];
    for (const f of it.fields) {
      if (!f.value && f.kind !== 'totp') continue;
      fields.append(fieldRow(f, totpEls));
    }
    if (totpEls.length) {
      const tick = async () => { for (const x of totpEls) await x(); };
      tick(); totpTimer = setInterval(tick, 1000);
    }
    return h('div', { class: 'vault-detail' },
      h('div', { class: 'detail-head drag' },
        h('div', { class: 'detail-actions no-drag' },
          h('button', { class: 'icon-btn' + (it.favorite ? ' on-star' : ''), title: 'รายการโปรด', onclick: () => save({ ...it, favorite: !it.favorite }) }, icon(it.favorite ? 'starFill' : 'star')),
          h('button', { class: 'btn small', onclick: () => startEdit(it) }, icon('edit'), 'แก้ไข'),
          h('button', { class: 'icon-btn', title: 'เพิ่มเติม', onclick: (e) => itemMenu(it, e.currentTarget) }, icon('more')))),
      h('div', { class: 'detail-scroll' },
        h('div', { class: 'detail-card' },
          h('div', { class: 'detail-hero' },
            h('div', { class: 'hero-icon' }, it.icon || t.icon),
            h('div', {},
              h('h1', { class: 'detail-title' }, it.title),
              h('div', { class: 'detail-meta' }, h('span', { class: 'pill' }, t.label), it.category ? h('span', { class: 'pill soft' }, it.category) : null))),
          dups.has(it.id) ? h('div', { class: 'warn-box' }, icon('alert'), h('span', {}, 'รหัสผ่านนี้ถูกใช้ซ้ำกับรายการอื่น ควรเปลี่ยนให้ไม่ซ้ำกัน')) : null,
          fields,
          it.notes ? h('div', { class: 'field-block' }, h('div', { class: 'field-label' }, 'บันทึก'), h('div', { class: 'field-notes' }, it.notes)) : null,
          h('div', { class: 'detail-foot muted' }, `แก้ไขล่าสุด ${new Date(it.updatedAt).toLocaleString('th-TH')} · สร้างเมื่อ ${new Date(it.createdAt).toLocaleDateString('th-TH')}`))));
  }

  function fieldRow(f, totpEls) {
    const key = f.id;
    const revealed = V.revealed.has(key);
    const actions = h('div', { class: 'field-actions' });
    let valueEl;
    if (f.kind === 'totp') {
      const code = h('span', { class: 'totp-code' }, '––– –––');
      const ring = h('span', { class: 'totp-ring' });
      valueEl = h('div', { class: 'field-value mono totp' }, code, ring);
      let current = '';
      totpEls.push(async () => {
        try {
          const r = await totp(f.value);
          if (!r) { code.textContent = 'secret ไม่ถูกต้อง'; return; }
          current = r.code;
          code.textContent = r.code.slice(0, 3) + ' ' + r.code.slice(3);
          ring.style.setProperty('--p', (r.remaining / r.period) * 360 + 'deg');
          ring.textContent = r.remaining;
          ring.classList.toggle('low', r.remaining <= 5);
        } catch { code.textContent = 'secret ไม่ถูกต้อง'; }
      });
      valueEl.addEventListener('click', () => current && copy(current, 'รหัส 2FA', true));
      actions.append(h('button', { class: 'icon-btn', title: 'คัดลอก', onclick: () => current && copy(current, 'รหัส 2FA', true) }, icon('copy')));
    } else if (isSecretKind(f.kind)) {
      valueEl = h('div', { class: 'field-value mono' + (revealed ? '' : ' masked') }, revealed ? f.value : '•'.repeat(Math.min(14, Math.max(8, f.value.length))));
      valueEl.addEventListener('click', () => copy(f.value, f.label, true));
      add(actions,
        f.kind === 'password' ? strengthBadge(f.value) : null,
        h('button', { class: 'icon-btn', title: revealed ? 'ซ่อน' : 'แสดง', onclick: () => { revealed ? V.revealed.delete(key) : V.revealed.add(key); app.renderMain(); } }, icon(revealed ? 'eyeOff' : 'eye')),
        h('button', { class: 'icon-btn', title: 'แสดงตัวใหญ่', onclick: () => largeType(f) }, icon('zoomIn')),
        h('button', { class: 'icon-btn', title: 'คัดลอก', onclick: () => copy(f.value, f.label, true) }, icon('copy')));
    } else {
      valueEl = h('div', { class: 'field-value' + (f.kind === 'multiline' ? ' multiline' : '') }, f.value);
      if (f.kind === 'url') {
        valueEl.classList.add('link');
        actions.append(h('button', { class: 'icon-btn', title: 'เปิดเว็บไซต์', onclick: () => window.nv.open.external(/^https?:/.test(f.value) ? f.value : 'https://' + f.value) }, icon('open')));
      }
      valueEl.addEventListener('click', () => copy(f.value, f.label, false));
      actions.append(h('button', { class: 'icon-btn', title: 'คัดลอก', onclick: () => copy(f.value, f.label, false) }, icon('copy')));
    }
    return h('div', { class: 'field-block' }, h('div', { class: 'field-label' }, f.label || 'ไม่มีชื่อ'), h('div', { class: 'field-line' }, valueEl, actions));
  }

  function strengthBadge(v) {
    const s = strength(v);
    return h('span', { class: 'strength s' + s.score, title: `${s.bits} bits` }, s.label);
  }

  function largeType(f) {
    const chars = [...f.value].map((c, i) => h('span', { class: 'lt-char' + (/\d/.test(c) ? ' digit' : /[^a-zA-Z0-9]/.test(c) ? ' sym' : '') }, c, h('small', {}, i + 1)));
    modal(f.label, h('div', { class: 'large-type' }, chars), [{ label: 'ปิด', primary: true }], { class: 'wide' });
  }

  // ---------------- edit ----------------
  function startEdit(it) {
    V.editing = structuredClone(it);
    if (!V.editing.fields.length && it.type !== 'note') V.editing.fields.push({ id: uid('f'), label: '', kind: 'text', value: '' });
    app.renderMain();
  }

  function editView() {
    const d = V.editing;
    const isNew = !d.id;
    const title = h('input', { class: 'input title-input', placeholder: 'ชื่อรายการ เช่น Gmail, ธนาคาร…', value: d.title });
    title.addEventListener('input', () => { d.title = title.value; });
    const iconBtn = h('button', { class: 'hero-icon btn-icon', title: 'เปลี่ยนไอคอน' }, d.icon || TEMPLATES[d.type]?.icon || '🔑');
    iconBtn.addEventListener('click', () => emojiPicker(iconBtn, (e) => { d.icon = e; iconBtn.textContent = e || TEMPLATES[d.type]?.icon; }));
    const typeSel = h('select', { class: 'input' }, Object.entries(TEMPLATES).map(([k, t]) => h('option', { value: k, selected: k === d.type }, t.icon + ' ' + t.label)));
    typeSel.addEventListener('change', () => { d.type = typeSel.value; if (!d.icon) iconBtn.textContent = TEMPLATES[d.type].icon; });
    const cats = [...new Set([...V.items.map((x) => x.category).filter(Boolean), ...CATEGORY_SUGGEST])];
    const catList = h('datalist', { id: 'cat-list' }, cats.map((c) => h('option', { value: c })));
    const cat = h('input', { class: 'input', placeholder: 'หมวดหมู่', value: d.category, list: 'cat-list' });
    cat.addEventListener('input', () => { d.category = cat.value; });

    const fieldsEl = h('div', { class: 'edit-fields' });
    const drawFields = () => {
      clear(fieldsEl);
      d.fields.forEach((f, i) => {
        const label = h('input', { class: 'input small', placeholder: 'ชื่อช่อง', value: f.label });
        label.addEventListener('input', () => { f.label = label.value; });
        const secret = isSecretKind(f.kind);
        const val = f.kind === 'multiline'
          ? h('textarea', { class: 'input', rows: 3, placeholder: 'ค่า' })
          : h('input', { class: 'input mono', placeholder: f.kind === 'totp' ? 'Secret (base32) หรือ otpauth://' : 'ค่า', type: secret && !f._show ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false' });
        val.value = f.value;
        const meter = f.kind === 'password' ? h('span', { class: 'strength' }) : null;
        const updMeter = () => { if (meter) { const s = strength(val.value); meter.className = 'strength s' + s.score; meter.textContent = val.value ? s.label : ''; } };
        val.addEventListener('input', () => { f.value = val.value; updMeter(); });
        updMeter();
        const kind = h('select', { class: 'input small kind' }, KINDS.map(([k, l]) => h('option', { value: k, selected: k === f.kind }, l)));
        kind.addEventListener('change', () => { f.kind = kind.value; drawFields(); });
        fieldsEl.append(h('div', { class: 'edit-field' },
          h('div', { class: 'ef-top' }, label, kind,
            h('button', { class: 'icon-btn', title: 'เลื่อนขึ้น', disabled: i === 0, onclick: () => { [d.fields[i - 1], d.fields[i]] = [d.fields[i], d.fields[i - 1]]; drawFields(); } }, icon('arrowUp')),
            h('button', { class: 'icon-btn', title: 'เลื่อนลง', disabled: i === d.fields.length - 1, onclick: () => { [d.fields[i + 1], d.fields[i]] = [d.fields[i], d.fields[i + 1]]; drawFields(); } }, icon('arrowDown')),
            h('button', { class: 'icon-btn danger', title: 'ลบช่อง', onclick: () => { d.fields.splice(i, 1); drawFields(); } }, icon('trash'))),
          h('div', { class: 'ef-val' }, val, meter,
            secret && f.kind !== 'multiline' ? h('button', { class: 'icon-btn', title: 'แสดง/ซ่อน', onclick: () => { f._show = !f._show; drawFields(); } }, icon(f._show ? 'eyeOff' : 'eye')) : null,
            f.kind === 'password' || f.kind === 'pin' ? h('button', { class: 'icon-btn accent', title: 'สร้างรหัสผ่าน', onclick: (e) => openGenerator(e.currentTarget, (pw) => { f.value = pw; f._show = true; drawFields(); }, f.kind === 'pin' ? { mode: 'pin', length: 6 } : null) }, icon('sparkle')) : null)));
      });
    };
    drawFields();
    const notes = h('textarea', { class: 'input', rows: 5, placeholder: 'บันทึกเพิ่มเติม (เข้ารหัสด้วย)' });
    notes.value = d.notes || '';
    notes.addEventListener('input', () => { d.notes = notes.value; });

    const doSave = async () => {
      if (!d.title.trim()) { title.focus(); toast('ใส่ชื่อรายการก่อน', 'error'); return; }
      const clean = { ...d, fields: d.fields.filter((f) => f.label || f.value).map(({ _show, ...f }) => f) };
      const saved = await save(clean, true);
      if (saved) { V.editing = null; V.selectedId = saved.id; app.renderAll(); }
    };
    const cancel = () => { V.editing = null; app.renderMain(); };
    setTimeout(() => (isNew ? title.focus() : null), 30);
    const root = h('div', { class: 'vault-detail editing' },
      h('div', { class: 'detail-head drag' },
        h('div', { class: 'detail-actions no-drag' },
          h('button', { class: 'btn small', onclick: cancel }, 'ยกเลิก'),
          h('button', { class: 'btn small primary', onclick: doSave }, icon('check'), 'บันทึก'))),
      h('div', { class: 'detail-scroll' },
        h('div', { class: 'detail-card' },
          h('div', { class: 'detail-hero' }, iconBtn, title),
          h('div', { class: 'edit-grid' }, h('label', {}, 'ชนิด', typeSel), h('label', {}, 'หมวดหมู่', cat, catList)),
          h('div', { class: 'section-label' }, 'ข้อมูล'),
          fieldsEl,
          h('button', { class: 'btn small ghost', onclick: () => { d.fields.push({ id: uid('f'), label: '', kind: 'text', value: '' }); drawFields(); fieldsEl.lastChild?.querySelector('input')?.focus(); } }, icon('plus'), 'เพิ่มช่อง'),
          h('div', { class: 'section-label' }, 'บันทึก'), notes)));
    root.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); doSave(); }
      if (e.key === 'Escape' && !document.querySelector('.menu')) cancel();
    });
    return root;
  }

  async function save(item, quiet = false) {
    try {
      const saved = await window.nv.vault.saveItem(item);
      const i = V.items.findIndex((x) => x.id === saved.id);
      if (i >= 0) V.items[i] = saved; else V.items.unshift(saved);
      if (!quiet) app.renderAll(); else app.renderSidebar();
      toast('บันทึกแล้ว');
      return saved;
    } catch (e) { toast(e.message, 'error'); return null; }
  }

  async function remove(it) {
    if (!(await confirm('ลบรายการนี้?', `“${it.title}” จะถูกลบถาวร (ยังกู้ได้จากไฟล์สำรองอัตโนมัติในโฟลเดอร์ backups)`, 'ลบ', true))) return;
    await window.nv.vault.deleteItem(it.id);
    V.items = V.items.filter((x) => x.id !== it.id);
    if (V.selectedId === it.id) V.selectedId = null;
    app.renderAll();
    toast('ลบแล้ว');
  }

  // ---------------- generator ----------------
  function openGenerator(anchor, onUse, preset) {
    const o = { length: 20, upper: true, lower: true, digits: true, symbols: true, ambiguous: false, mode: 'random', words: 4, sep: '-', ...(settings().generator || {}), ...(preset || {}) };
    const out = h('div', { class: 'gen-out mono' });
    const meter = h('span', { class: 'strength' });
    const regen = () => {
      const pw = generate(o);
      out.replaceChildren(...[...pw].map((c) => h('span', { class: /\d/.test(c) ? 'digit' : /[^a-zA-Z0-9-]/.test(c) ? 'sym' : '' }, c)));
      out.dataset.value = pw;
      const s = strength(pw); meter.className = 'strength s' + s.score; meter.textContent = `${s.label} · ${s.bits} bits`;
      if (!preset) window.nv.settings.set({ generator: { ...o } }).then((s2) => { app.settings = s2; });
    };
    const lenLabel = h('span', { class: 'gen-len' });
    const slider = h('input', { type: 'range', min: 4, max: 64, value: o.mode === 'words' ? o.words : o.length });
    const updLen = () => { lenLabel.textContent = o.mode === 'words' ? `${o.words} คำ` : `${o.length} ตัว`; };
    slider.addEventListener('input', () => { if (o.mode === 'words') o.words = +slider.value; else o.length = +slider.value; updLen(); regen(); });
    const toggle = (k, label) => {
      const c = h('input', { type: 'checkbox', checked: o[k] });
      c.addEventListener('change', () => { o[k] = c.checked; regen(); });
      return h('label', { class: 'check' }, c, label);
    };
    const opts = h('div', { class: 'gen-opts' });
    const drawOpts = () => {
      clear(opts);
      slider.min = o.mode === 'words' ? 3 : 4; slider.max = o.mode === 'words' ? 10 : 64; slider.value = o.mode === 'words' ? o.words : o.length;
      if (o.mode === 'random') opts.append(toggle('upper', 'A-Z'), toggle('lower', 'a-z'), toggle('digits', '0-9'), toggle('symbols', '!@#'), toggle('ambiguous', 'ไม่ใช้ตัวที่สับสน (0 O l 1)'));
      if (o.mode === 'words') opts.append(toggle('upper', 'มีตัวใหญ่'), toggle('digits', 'มีตัวเลข'));
      updLen();
    };
    const modes = h('div', { class: 'seg small' }, [['random', 'สุ่ม'], ['words', 'คำ'], ['pin', 'PIN']].map(([m, l]) => {
      const b = h('button', { class: o.mode === m ? 'on' : '' }, l);
      b.addEventListener('click', () => { o.mode = m; if (m === 'pin' && o.length > 12) o.length = 6; if (m === 'random' && o.length < 8) o.length = 20; modes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); drawOpts(); regen(); });
      return b;
    }));
    drawOpts(); regen();
    popover(h('div', { class: 'generator' },
      h('div', { class: 'gen-head' }, h('b', {}, 'สร้างรหัสผ่าน'), modes),
      out,
      h('div', { class: 'gen-row' }, meter, h('button', { class: 'icon-btn', title: 'สุ่มใหม่', onclick: regen }, icon('refresh'))),
      h('div', { class: 'gen-row' }, slider, lenLabel),
      opts,
      h('div', { class: 'gen-actions' },
        h('button', { class: 'btn small', onclick: () => copy(out.dataset.value, 'รหัสผ่าน', true) }, icon('copy'), 'คัดลอก'),
        onUse ? h('button', { class: 'btn small primary', onclick: () => { closeMenu(); onUse(out.dataset.value); } }, icon('check'), 'ใช้รหัสนี้') : null)),
    anchor || { x: innerWidth / 2 - 170, y: 120 }, { class: 'gen-pop' });
  }

  // ---------------- import ----------------
  async function importJson() {
    const text = await window.nv.file.openJson();
    if (!text) return;
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(list)) throw new Error('ไม่พบ items ในไฟล์');
      if (!(await confirm('นำเข้ารหัสผ่าน', `พบ ${list.length} รายการ นำเข้าเพิ่มในตู้เซฟ?`, 'นำเข้า'))) return;
      const n = await window.nv.vault.import(list);
      await loadItems(); app.renderAll();
      toast(`นำเข้า ${n} รายการแล้ว`);
    } catch (e) { toast('นำเข้าไม่ได้: ' + e.message, 'error'); }
  }

  return { V, refreshStatus, loadItems, onLocked, sidebarItems, renderList, renderMain, newItem, newItemMenu, openGenerator, importJson, tryTouchId, move,
    isUnlocked: () => !!V.status?.unlocked, focusSearch: () => V.searchEl?.focus() };
}
