// Word-style toolbar + contextual bars (table / image / link / code block) + selection bubble.
import { h, icon, popupMenu, popover, closeMenu } from '../ui/h.js';
import { CALLOUTS } from './extensions.js';

export const TEXT_COLORS = ['#1d1d1f', '#636366', '#aeaeb2', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e1b1b', '#1b4d8e', '#1b8e4b'];
export const HIGHLIGHTS = ['#fff59d', '#ffd6a5', '#ffadad', '#ffc6ff', '#bdb2ff', '#a0c4ff', '#9bf6ff', '#caffbf', '#e5e5ea', '#ffe0b2', '#d7ccc8', '#f8bbd0'];
export const FONTS = [
  ['ค่าเริ่มต้น', ''], ['SF Pro (ระบบ)', '-apple-system, BlinkMacSystemFont, sans-serif'], ['Helvetica Neue', '"Helvetica Neue", Helvetica, sans-serif'],
  ['Avenir Next', '"Avenir Next", sans-serif'], ['Futura', 'Futura, sans-serif'], ['Optima', 'Optima, sans-serif'], ['Georgia', 'Georgia, serif'],
  ['Times New Roman', '"Times New Roman", serif'], ['Palatino', 'Palatino, serif'], ['Baskerville', 'Baskerville, serif'],
  ['Thonburi', 'Thonburi, sans-serif'], ['Sukhumvit Set', '"Sukhumvit Set", sans-serif'], ['Ayuthaya', 'Ayuthaya, serif'], ['Krungthep', 'Krungthep, sans-serif'],
  ['Silom', 'Silom, sans-serif'], ['Sathu', 'Sathu, serif'], ['Noteworthy', 'Noteworthy, cursive'], ['Marker Felt', '"Marker Felt", cursive'],
  ['Menlo (โค้ด)', 'Menlo, monospace'], ['Courier New', '"Courier New", monospace'],
];
export const SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 60, 72];
const LINE_HEIGHTS = ['1', '1.15', '1.4', '1.6', '1.8', '2', '2.5'];
const LANGS = ['plaintext', 'javascript', 'typescript', 'python', 'json', 'bash', 'sql', 'html', 'xml', 'css', 'go', 'java', 'kotlin', 'swift', 'rust', 'php', 'ruby', 'c', 'cpp', 'csharp', 'yaml', 'markdown', 'diff', 'dockerfile'];

const BLOCK_STYLES = [
  { label: 'ข้อความปกติ', test: (e) => e.isActive('paragraph'), run: (c) => c.setParagraph(), cls: '' },
  { label: 'หัวข้อ 1', test: (e) => e.isActive('heading', { level: 1 }), run: (c) => c.setHeading({ level: 1 }), cls: 'pv-h1' },
  { label: 'หัวข้อ 2', test: (e) => e.isActive('heading', { level: 2 }), run: (c) => c.setHeading({ level: 2 }), cls: 'pv-h2' },
  { label: 'หัวข้อ 3', test: (e) => e.isActive('heading', { level: 3 }), run: (c) => c.setHeading({ level: 3 }), cls: 'pv-h3' },
  { label: 'หัวข้อ 4', test: (e) => e.isActive('heading', { level: 4 }), run: (c) => c.setHeading({ level: 4 }), cls: 'pv-h4' },
  { label: 'คำพูด', test: (e) => e.isActive('blockquote'), run: (c) => c.toggleBlockquote(), cls: 'pv-quote' },
  { label: 'โค้ด', test: (e) => e.isActive('codeBlock'), run: (c) => c.toggleCodeBlock(), cls: 'pv-code' },
];

export function colorGrid(colors, current, onPick, opts = {}) {
  const custom = h('input', { type: 'color', class: 'color-input', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#ff3b30' });
  custom.addEventListener('change', () => { closeMenu(); onPick(custom.value); });
  return h('div', { class: 'color-pop' },
    h('button', { class: 'btn small ghost full', onclick: () => { closeMenu(); onPick(null); } }, opts.noneLabel || 'อัตโนมัติ / ไม่มีสี'),
    h('div', { class: 'color-grid' }, colors.map((c) => h('button', {
      class: 'swatch' + ((current || '').toLowerCase() === c ? ' on' : ''), style: { background: c }, title: c,
      onclick: () => { closeMenu(); onPick(c); },
    }))),
    h('label', { class: 'color-custom' }, custom, 'เลือกสีเอง…'));
}

export function buildToolbar(editor, ctx) {
  const updaters = [];
  const chain = () => editor.chain().focus();

  const btn = (ic, title, run, active, opts = {}) => {
    const b = h('button', { class: 'tb-btn' + (opts.cls ? ' ' + opts.cls : ''), title, onmousedown: (e) => e.preventDefault(), onclick: (e) => run(e, b) }, icon(ic));
    if (active) updaters.push(() => b.classList.toggle('on', !!active()));
    if (opts.enabled) updaters.push(() => { b.disabled = !opts.enabled(); });
    return b;
  };
  const drop = (labelFn, title, onOpen, cls = '') => {
    const lbl = h('span', { class: 'tb-drop-label' });
    const b = h('button', { class: 'tb-btn tb-drop ' + cls, title, onmousedown: (e) => e.preventDefault(), onclick: () => onOpen(b) }, lbl, icon('chevronDown', 'tb-caret'));
    updaters.push(() => { const v = labelFn(); if (v instanceof Node) lbl.replaceChildren(v); else lbl.textContent = v; });
    return b;
  };
  const sep = () => h('span', { class: 'tb-sep' });

  // ---- block style
  const styleDrop = drop(() => (BLOCK_STYLES.find((s) => s.test(editor))?.label || 'ข้อความปกติ'), 'รูปแบบย่อหน้า',
    (b) => popupMenu(BLOCK_STYLES.map((s) => ({ label: s.label, checked: s.test(editor), onClick: () => s.run(chain()).run(), style: undefined, cls: s.cls }))
      .map((it, i) => ({ ...it, el: styleItem(BLOCK_STYLES[i], it) })), b, { class: 'style-menu' }), 'w-style');
  function styleItem(s, it) {
    const row = h('button', { class: 'menu-item' + (it.checked ? ' checked' : '') }, h('span', { class: 'menu-label ' + s.cls }, s.label));
    row.addEventListener('click', () => { closeMenu(); s.run(chain()).run(); });
    return row;
  }

  // ---- font family
  const curFont = () => editor.getAttributes('textStyle').fontFamily || '';
  const fontDrop = drop(() => (FONTS.find(([, v]) => v && v === curFont())?.[0] || (curFont() ? curFont().split(',')[0].replace(/"/g, '') : 'ฟอนต์')), 'ฟอนต์',
    (b) => popupMenu(FONTS.map(([name, v]) => ({
      label: name, checked: v === curFont(), style: v ? { fontFamily: v } : undefined,
      onClick: () => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run()),
    })), b, { class: 'font-menu' }), 'w-font');

  // ---- font size
  const curSize = () => parseInt(editor.getAttributes('textStyle').fontSize, 10) || null;
  const sizeInput = h('input', { class: 'tb-size', title: 'ขนาดตัวอักษร', placeholder: '16' });
  sizeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const v = parseInt(sizeInput.value, 10); if (v >= 6 && v <= 200) chain().setFontSize(v + 'px').run(); else editor.commands.focus(); }
    if (e.key === 'Escape') editor.commands.focus();
  });
  sizeInput.addEventListener('focus', () => {
    sizeInput.select();
    popupMenu(SIZES.map((s) => ({ label: String(s), checked: curSize() === s, onClick: () => chain().setFontSize(s + 'px').run() })), sizeInput, { class: 'size-menu' });
  });
  updaters.push(() => { if (document.activeElement !== sizeInput) sizeInput.value = curSize() || ''; });
  const step = (d) => {
    const cur = curSize() || ctx.baseSize();
    const next = d > 0 ? SIZES.find((s) => s > cur) || cur + 8 : [...SIZES].reverse().find((s) => s < cur) || Math.max(6, cur - 2);
    chain().setFontSize(next + 'px').run();
  };

  // ---- colours
  const colorBar = (getter, fallback) => {
    const bar = h('span', { class: 'tb-colorbar' });
    updaters.push(() => { bar.style.background = getter() || fallback; });
    return bar;
  };
  const textColorBtn = h('button', { class: 'tb-btn tb-color', title: 'สีตัวอักษร', onmousedown: (e) => e.preventDefault() }, icon('color'), colorBar(() => editor.getAttributes('textStyle').color, 'transparent'));
  textColorBtn.addEventListener('click', () => popover(colorGrid(TEXT_COLORS, editor.getAttributes('textStyle').color,
    (c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())), textColorBtn));
  const hlBtn = h('button', { class: 'tb-btn tb-color', title: 'ไฮไลต์', onmousedown: (e) => e.preventDefault() }, icon('highlight'), colorBar(() => editor.getAttributes('highlight').color, 'transparent'));
  hlBtn.addEventListener('click', () => popover(colorGrid(HIGHLIGHTS, editor.getAttributes('highlight').color,
    (c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run()), { noneLabel: 'ไม่ไฮไลต์' }), hlBtn));

  // ---- align
  const ALIGNS = [['left', 'alignLeft', 'ชิดซ้าย'], ['center', 'alignCenter', 'กึ่งกลาง'], ['right', 'alignRight', 'ชิดขวา'], ['justify', 'alignJustify', 'เต็มบรรทัด']];
  const curAlign = () => ALIGNS.find(([a]) => editor.isActive({ textAlign: a })) || ALIGNS[0];
  const alignDrop = drop(() => icon(curAlign()[1]), 'จัดแนว',
    (b) => popupMenu(ALIGNS.map(([a, ic, label]) => ({ label, icon: ic, checked: curAlign()[0] === a, kbd: { left: '⌘⇧L', center: '⌘⇧E', right: '⌘⇧R', justify: '⌘⇧J' }[a],
      onClick: () => chain().setTextAlign(a).run() })), b));

  const lhDrop = drop(() => icon('lineHeight'), 'ระยะห่างบรรทัด',
    (b) => popupMenu([{ header: 'ระยะห่างบรรทัด' }, { label: 'ค่าเริ่มต้น', onClick: () => chain().setLineHeight(null).run() },
      ...LINE_HEIGHTS.map((v) => ({ label: v, checked: editor.getAttributes('paragraph').lineHeight === v || editor.getAttributes('heading').lineHeight === v,
        onClick: () => chain().setLineHeight(v).run() }))], b));

  // ---- table grid picker
  const tableBtn = btn('table', 'แทรกตาราง', (_e, b) => {
    const N = 10;
    const label = h('div', { class: 'grid-label' }, 'แทรกตาราง');
    const cells = [];
    const grid = h('div', { class: 'grid-pick' });
    for (let r = 1; r <= N; r++) for (let c = 1; c <= N; c++) {
      const cell = h('span', { class: 'gp-cell' });
      cell.addEventListener('mouseenter', () => { cells.forEach((x) => x.el.classList.toggle('on', x.r <= r && x.c <= c)); label.textContent = `${c} × ${r}`; });
      cell.addEventListener('click', () => { closeMenu(); chain().insertTable({ rows: r, cols: c, withHeaderRow: true }).run(); });
      cells.push({ el: cell, r, c }); grid.append(cell);
    }
    popover([label, grid], b);
  });

  const calloutDrop = drop(() => icon('callout'), 'กล่องข้อความ (Callout)',
    (b) => popupMenu([...Object.entries(CALLOUTS).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: () => chain().setCallout(k).run() })),
      editor.isActive('callout') ? '-' : null, editor.isActive('callout') ? { label: 'เอากล่องออก', icon: 'x', onClick: () => chain().lift('callout').run() } : null], b));

  const moreDrop = drop(() => icon('more'), 'เพิ่มเติม', (b) => popupMenu([
    { label: 'ตัวห้อย', icon: 'sub', kbd: '⌘,', checked: editor.isActive('subscript'), onClick: () => chain().toggleSubscript().run() },
    { label: 'ตัวยก', icon: 'sup', kbd: '⌘.', checked: editor.isActive('superscript'), onClick: () => chain().toggleSuperscript().run() },
    { label: 'โค้ดในบรรทัด', icon: 'code', kbd: '⌘E', checked: editor.isActive('code'), onClick: () => chain().toggleCode().run() },
    '-',
    { label: 'คำพูด', icon: 'quote', kbd: '⌘⇧B', onClick: () => chain().toggleBlockquote().run() },
    { label: 'บล็อกโค้ด', icon: 'codeblock', kbd: '⌘⌥C', onClick: () => chain().toggleCodeBlock().run() },
    { label: 'เส้นคั่น', icon: 'hr', onClick: () => chain().setHorizontalRule().run() },
    { label: 'แทรกวันที่', icon: 'sparkle', onClick: () => chain().insertContent(new Date().toLocaleDateString('th-TH', { dateStyle: 'long' })).run() },
    '-',
    { label: 'ล้างรูปแบบ', icon: 'clear', kbd: '⌘\\', onClick: () => chain().unsetAllMarks().clearNodes().run() },
  ], b));

  const el = h('div', { class: 'toolbar' },
    btn('undo', 'เลิกทำ (⌘Z)', () => chain().undo().run(), null, { enabled: () => editor.can().undo() }),
    btn('redo', 'ทำซ้ำ (⌘⇧Z)', () => chain().redo().run(), null, { enabled: () => editor.can().redo() }),
    sep(), styleDrop, fontDrop,
    h('span', { class: 'tb-size-group' },
      h('button', { class: 'tb-btn tb-mini', title: 'เล็กลง', onmousedown: (e) => e.preventDefault(), onclick: () => step(-1) }, icon('minus')),
      sizeInput,
      h('button', { class: 'tb-btn tb-mini', title: 'ใหญ่ขึ้น', onmousedown: (e) => e.preventDefault(), onclick: () => step(1) }, icon('plus'))),
    sep(),
    btn('bold', 'ตัวหนา (⌘B)', () => chain().toggleBold().run(), () => editor.isActive('bold')),
    btn('italic', 'ตัวเอียง (⌘I)', () => chain().toggleItalic().run(), () => editor.isActive('italic')),
    btn('underline', 'ขีดเส้นใต้ (⌘U)', () => chain().toggleUnderline().run(), () => editor.isActive('underline')),
    btn('strike', 'ขีดฆ่า (⌘⇧X)', () => chain().toggleStrike().run(), () => editor.isActive('strike')),
    textColorBtn, hlBtn,
    sep(), alignDrop, lhDrop,
    sep(),
    btn('list', 'รายการจุด (⌘⇧8)', () => chain().toggleBulletList().run(), () => editor.isActive('bulletList')),
    btn('olist', 'รายการตัวเลข (⌘⇧7)', () => chain().toggleOrderedList().run(), () => editor.isActive('orderedList')),
    btn('task', 'Checklist (⌘⇧9)', () => chain().toggleTaskList().run(), () => editor.isActive('taskList')),
    btn('outdent', 'ลดเยื้อง (⇧Tab)', () => (editor.isActive('listItem') ? chain().liftListItem('listItem').run() : editor.isActive('taskItem') ? chain().liftListItem('taskItem').run() : chain().outdent().run())),
    btn('indent', 'เพิ่มเยื้อง (Tab)', () => (editor.isActive('listItem') ? chain().sinkListItem('listItem').run() : editor.isActive('taskItem') ? chain().sinkListItem('taskItem').run() : chain().indent().run())),
    sep(),
    btn('link', 'ลิงก์ (⌘K)', () => ctx.editLink(), () => editor.isActive('link')),
    btn('image', 'แทรกรูป', () => ctx.insertImage()),
    tableBtn, calloutDrop,
    btn('codeblock', 'บล็อกโค้ด', () => chain().toggleCodeBlock().run(), () => editor.isActive('codeBlock')),
    moreDrop,
  );

  // ---------------- contextual bar ----------------
  const ctxBar = h('div', { class: 'ctxbar' });
  let ctxMode = '';
  const cbtn = (ic, label, run, opts = {}) => h('button', { class: 'cb-btn' + (opts.danger ? ' danger' : '') + (opts.on ? ' on' : ''), title: label, onmousedown: (e) => e.preventDefault(), onclick: (e) => run(e) },
    icon(ic), opts.text ? h('span', {}, opts.text) : null);
  const ctxLabel = (t) => h('span', { class: 'cb-label' }, t);

  function renderCtx() {
    const sel = editor.state.selection;
    const isImage = sel.node && sel.node.type.name === 'image';
    const mode = isImage ? 'image' : editor.isActive('table') ? 'table' : editor.isActive('codeBlock') ? 'code' : editor.isActive('link') ? 'link' : '';
    const key = mode + (mode === 'image' ? sel.node.attrs.align + sel.node.attrs.width : '') + (mode === 'link' ? editor.getAttributes('link').href : '') + (mode === 'code' ? editor.getAttributes('codeBlock').language : '');
    if (key === ctxMode) return;
    ctxMode = key;
    ctxBar.replaceChildren();
    ctxBar.classList.toggle('show', !!mode);
    if (mode === 'table') {
      ctxBar.append(ctxLabel('ตาราง'),
        cbtn('rowAbove', 'แทรกแถวด้านบน', () => chain().addRowBefore().run()),
        cbtn('rowBelow', 'แทรกแถวด้านล่าง', () => chain().addRowAfter().run()),
        cbtn('colLeft', 'แทรกคอลัมน์ซ้าย', () => chain().addColumnBefore().run()),
        cbtn('colRight', 'แทรกคอลัมน์ขวา', () => chain().addColumnAfter().run()),
        h('span', { class: 'tb-sep' }),
        cbtn('delRow', 'ลบแถว', () => chain().deleteRow().run()),
        cbtn('delCol', 'ลบคอลัมน์', () => chain().deleteColumn().run()),
        h('span', { class: 'tb-sep' }),
        cbtn('merge', 'รวมเซลล์', () => chain().mergeCells().run()),
        cbtn('split', 'แยกเซลล์', () => chain().splitCell().run()),
        cbtn('headerRow', 'สลับแถวหัวตาราง', () => chain().toggleHeaderRow().run()),
        cbtn('palette', 'สีพื้นเซลล์', (e) => popover(colorGrid(HIGHLIGHTS, editor.getAttributes('tableCell').backgroundColor,
          (c) => chain().setCellAttribute('backgroundColor', c).run(), { noneLabel: 'ไม่มีสีพื้น' }), e.currentTarget)),
        h('span', { class: 'cb-flex' }),
        cbtn('trash', 'ลบตาราง', () => chain().deleteTable().run(), { danger: true, text: 'ลบตาราง' }));
    } else if (mode === 'image') {
      const a = sel.node.attrs;
      const setW = (pct) => {
        const full = editor.view.dom.clientWidth - 8;
        chain().updateAttributes('image', { width: pct ? Math.round(full * pct) : null }).run();
      };
      ctxBar.append(ctxLabel('รูปภาพ'),
        cbtn('alignLeft', 'ลอยซ้าย (ข้อความล้อมรูป)', () => chain().updateAttributes('image', { align: 'left' }).run(), { on: a.align === 'left' }),
        cbtn('alignCenter', 'กึ่งกลาง', () => chain().updateAttributes('image', { align: 'center' }).run(), { on: a.align === 'center' }),
        cbtn('alignRight', 'ลอยขวา (ข้อความล้อมรูป)', () => chain().updateAttributes('image', { align: 'right' }).run(), { on: a.align === 'right' }),
        h('span', { class: 'tb-sep' }),
        ...[[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']].map(([p, t]) => h('button', { class: 'cb-btn cb-text', onmousedown: (e) => e.preventDefault(), onclick: () => setW(p) }, t)),
        h('button', { class: 'cb-btn cb-text', onmousedown: (e) => e.preventDefault(), onclick: () => setW(0) }, 'ขนาดจริง'),
        h('span', { class: 'cb-hint' }, a.width ? `${a.width}px · ลากมุมเพื่อย่อ/ขยาย` : 'ลากมุมเพื่อย่อ/ขยาย'),
        h('span', { class: 'cb-flex' }),
        cbtn('edit', 'คำบรรยายใต้ภาพ', () => ctx.editCaption(), { text: 'คำบรรยาย' }),
        cbtn('trash', 'ลบรูป', () => chain().deleteSelection().run(), { danger: true }));
    } else if (mode === 'code') {
      const lang = editor.getAttributes('codeBlock').language || 'plaintext';
      const select = h('select', { class: 'cb-select' }, LANGS.map((l) => h('option', { value: l, selected: l === lang }, l)));
      select.addEventListener('change', () => chain().updateAttributes('codeBlock', { language: select.value }).run());
      ctxBar.append(ctxLabel('บล็อกโค้ด'), select, h('span', { class: 'cb-flex' }),
        cbtn('copy', 'คัดลอกโค้ด', () => { const { $from } = editor.state.selection; navigator.clipboard.writeText($from.parent.textContent); ctx.toast('คัดลอกโค้ดแล้ว'); }, { text: 'คัดลอก' }));
    } else if (mode === 'link') {
      const href = editor.getAttributes('link').href || '';
      ctxBar.append(ctxLabel('ลิงก์'), h('span', { class: 'cb-url' }, href),
        cbtn('open', 'เปิดลิงก์', () => window.nv.open.external(href)),
        cbtn('edit', 'แก้ลิงก์', () => ctx.editLink()),
        cbtn('unlink', 'เอาลิงก์ออก', () => chain().extendMarkRange('link').unsetLink().run()));
    }
  }

  let raf = 0;
  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { updaters.forEach((u) => u()); renderCtx(); });
  };
  editor.on('transaction', update);
  editor.on('focus', update);
  update();
  return { el, ctxBar, update };
}

// ---------------- floating bubble on text selection ----------------
export function buildBubble(editor, ctx) {
  const chain = () => editor.chain().focus();
  const b = (ic, title, run, active) => {
    const x = h('button', { class: 'bb-btn', title, onmousedown: (e) => e.preventDefault(), onclick: (e) => run(e) }, icon(ic));
    x._active = active;
    return x;
  };
  const items = [
    b('bold', 'ตัวหนา', () => chain().toggleBold().run(), () => editor.isActive('bold')),
    b('italic', 'ตัวเอียง', () => chain().toggleItalic().run(), () => editor.isActive('italic')),
    b('underline', 'ขีดเส้นใต้', () => chain().toggleUnderline().run(), () => editor.isActive('underline')),
    b('strike', 'ขีดฆ่า', () => chain().toggleStrike().run(), () => editor.isActive('strike')),
    b('code', 'โค้ด', () => chain().toggleCode().run(), () => editor.isActive('code')),
    b('color', 'สีตัวอักษร', (e) => popover(colorGrid(TEXT_COLORS, editor.getAttributes('textStyle').color,
      (c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())), e.currentTarget)),
    b('highlight', 'ไฮไลต์', (e) => popover(colorGrid(HIGHLIGHTS, editor.getAttributes('highlight').color,
      (c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run()), { noneLabel: 'ไม่ไฮไลต์' }), e.currentTarget)),
    b('link', 'ลิงก์', () => ctx.editLink(), () => editor.isActive('link')),
    b('clear', 'ล้างรูปแบบ', () => chain().unsetAllMarks().run()),
  ];
  // one-click highlight swatches
  const quick = HIGHLIGHTS.slice(0, 4).map((c) => h('button', { class: 'bb-swatch', style: { background: c }, title: 'ไฮไลต์',
    onmousedown: (e) => e.preventDefault(), onclick: () => chain().setHighlight({ color: c }).run() }));
  const el = h('div', { class: 'bubble' }, items, h('span', { class: 'bb-sep' }), quick);
  editor.on('transaction', () => items.forEach((x) => x._active && x.classList.toggle('on', !!x._active())));
  return el;
}
