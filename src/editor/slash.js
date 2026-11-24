// "/" command menu — type "/" then filter, ↑↓ to choose, Enter to insert.
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { h, icon, place } from '../ui/h.js';
import { CALLOUTS } from './extensions.js';

export function slashItems(ctx) {
  const b = (title, ic, keys, run, group) => ({ title, icon: ic, keys, run, group });
  return [
    b('ข้อความปกติ', 'type', 'text paragraph p ข้อความ', (e) => e.chain().focus().setParagraph().run(), 'พื้นฐาน'),
    b('หัวข้อใหญ่', 'heading', 'h1 heading1 title หัวข้อ', (e) => e.chain().focus().setHeading({ level: 1 }).run(), 'พื้นฐาน'),
    b('หัวข้อกลาง', 'heading', 'h2 heading2 หัวข้อ', (e) => e.chain().focus().setHeading({ level: 2 }).run(), 'พื้นฐาน'),
    b('หัวข้อเล็ก', 'heading', 'h3 heading3 หัวข้อ', (e) => e.chain().focus().setHeading({ level: 3 }).run(), 'พื้นฐาน'),
    b('รายการจุด', 'list', 'bullet ul list รายการ', (e) => e.chain().focus().toggleBulletList().run(), 'รายการ'),
    b('รายการตัวเลข', 'olist', 'number ol ordered รายการ ลำดับ', (e) => e.chain().focus().toggleOrderedList().run(), 'รายการ'),
    b('Checklist / To-do', 'task', 'todo task check เช็ค งาน', (e) => e.chain().focus().toggleTaskList().run(), 'รายการ'),
    b('ตาราง 3×3', 'table', 'table ตาราง grid', (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), 'แทรก'),
    b('รูปภาพ', 'image', 'image picture photo รูป ภาพ', () => ctx.insertImage(), 'แทรก'),
    b('ลิงก์', 'link', 'link url ลิงก์', () => ctx.editLink(), 'แทรก'),
    b('เส้นคั่น', 'hr', 'divider hr line เส้น', (e) => e.chain().focus().setHorizontalRule().run(), 'แทรก'),
    b('วันที่วันนี้', 'sparkle', 'date today วันที่', (e) => e.chain().focus().insertContent(new Date().toLocaleDateString('th-TH', { dateStyle: 'long' }) + ' ').run(), 'แทรก'),
    b('คำพูด / Quote', 'quote', 'quote blockquote คำพูด อ้างอิง', (e) => e.chain().focus().toggleBlockquote().run(), 'บล็อก'),
    b('บล็อกโค้ด', 'codeblock', 'code pre โค้ด', (e) => e.chain().focus().toggleCodeBlock().run(), 'บล็อก'),
    ...Object.entries(CALLOUTS).map(([k, v]) =>
      b(`กล่อง${v.label}`, null, `callout panel box ${k} กล่อง ${v.label}`, (e) => e.chain().focus().setCallout(k).run(), 'บล็อก')).map((x, i) => ({ ...x, emoji: Object.values(CALLOUTS)[i].icon })),
  ];
}

export function SlashCommand(ctx) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('slash'),
        char: '/',
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).run(); props.run(editor); },
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          const all = slashItems(ctx);
          if (!q) return all;
          // rank: keyword that starts with the query (earlier keyword = stronger), then plain substring
          const score = (it) => {
            const words = (it.keys + ' ' + it.title).toLowerCase().split(/\s+/);
            const i = words.findIndex((w) => w.startsWith(q));
            return i >= 0 ? i : (it.title + ' ' + it.keys).toLowerCase().includes(q) ? 50 : -1;
          };
          return all.map((it) => [score(it), it]).filter(([sc]) => sc >= 0).sort((a, b) => a[0] - b[0]).map(([, it]) => it);
        },
        render: () => {
          let el, items = [], index = 0, command;
          const draw = () => {
            if (!el) return;
            el.replaceChildren();
            if (!items.length) { el.append(h('div', { class: 'menu-header' }, 'ไม่พบคำสั่ง')); return; }
            let group = null;
            items.forEach((it, i) => {
              if (it.group !== group) { group = it.group; el.append(h('div', { class: 'menu-header' }, group)); }
              const row = h('button', { class: 'menu-item slash-item' + (i === index ? ' active' : '') },
                h('span', { class: 'slash-ic' }, it.emoji ? it.emoji : icon(it.icon)), h('span', { class: 'menu-label' }, it.title));
              row.addEventListener('mousedown', (e) => { e.preventDefault(); command(it); });
              row.addEventListener('mouseenter', () => { index = i; el.querySelectorAll('.slash-item').forEach((x, j) => x.classList.toggle('active', j === i)); });
              el.append(row);
            });
            el.querySelector('.slash-item.active')?.scrollIntoView({ block: 'nearest' });
          };
          const position = (props) => { if (!el) return; const r = props.clientRect?.(); if (r) place(el, { x: r.left, y: r.bottom + 6 }); };
          return {
            onStart: (props) => {
              el = h('div', { class: 'menu slash-menu' });
              document.body.append(el);
              items = props.items; command = props.command; index = 0;
              draw(); position(props);
            },
            onUpdate: (props) => { items = props.items; command = props.command; index = 0; draw(); position(props); },
            onKeyDown: ({ event }) => {
              if (!el || !items.length) return false;
              if (event.key === 'ArrowDown') { index = (index + 1) % items.length; draw(); return true; }
              if (event.key === 'ArrowUp') { index = (index - 1 + items.length) % items.length; draw(); return true; }
              if (event.key === 'Enter' || event.key === 'Tab') { command(items[index]); return true; }
              if (event.key === 'Escape') { el?.remove(); el = null; return true; }
              return false;
            },
            onExit: () => { el?.remove(); el = null; },
          };
        },
      })];
    },
  });
}
