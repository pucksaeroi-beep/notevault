import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Image from '@tiptap/extension-image';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { popupMenu } from '../ui/h.js';

// ---------------- font size (on textStyle mark) ----------------
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize || null,
          renderHTML: (a) => (a.fontSize ? { style: `font-size: ${a.fontSize}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// ---------------- paragraph formatting: line height + indent ----------------
const BLOCKS = ['paragraph', 'heading'];
export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [{
      types: BLOCKS,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => el.style.lineHeight || null,
          renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
        },
        indent: {
          default: 0,
          parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
          renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `margin-left: ${a.indent * 2}em` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const setAttr = (key, fn) => () => ({ state, tr, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (BLOCKS.includes(node.type.name)) {
          const value = fn(node.attrs[key]);
          if (value !== node.attrs[key]) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, [key]: value }); changed = true; }
          return false;
        }
        return true;
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return {
      setLineHeight: (lh) => setAttr('lineHeight', () => lh)(),
      indent: () => setAttr('indent', (v) => Math.min(8, (v || 0) + 1))(),
      outdent: () => setAttr('indent', (v) => Math.max(0, (v || 0) - 1))(),
    };
  },
  addKeyboardShortcuts() {
    const ed = this.editor;
    return {
      Tab: () => {
        if (ed.isActive('table')) return false; // table moves to the next cell
        if (ed.isActive('codeBlock')) return ed.commands.insertContent('  ');
        if (ed.isActive('taskItem')) return ed.commands.sinkListItem('taskItem') || true;
        if (ed.isActive('listItem')) return ed.commands.sinkListItem('listItem') || true;
        return ed.commands.indent() || true;
      },
      'Shift-Tab': () => {
        if (ed.isActive('table')) return false;
        if (ed.isActive('taskItem')) return ed.commands.liftListItem('taskItem') || true;
        if (ed.isActive('listItem')) return ed.commands.liftListItem('listItem') || true;
        return ed.commands.outdent() || true;
      },
      'Mod-]': () => ed.commands.indent(),
      'Mod-[': () => ed.commands.outdent(),
    };
  },
});

// ---------------- Confluence-style callout panels ----------------
export const CALLOUTS = {
  info: { icon: 'ℹ️', label: 'ข้อมูล' },
  success: { icon: '✅', label: 'สำเร็จ' },
  warning: { icon: '⚠️', label: 'ระวัง' },
  danger: { icon: '⛔️', label: 'อันตราย' },
  note: { icon: '📝', label: 'โน้ต' },
  idea: { icon: '💡', label: 'ไอเดีย' },
};

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { type: { default: 'info', parseHTML: (el) => el.getAttribute('data-callout') || 'info', renderHTML: (a) => ({ 'data-callout': a.type }) } };
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0]; },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'callout';
      dom.dataset.callout = node.attrs.type;
      const iconEl = document.createElement('button');
      iconEl.className = 'callout-icon';
      iconEl.contentEditable = 'false';
      iconEl.title = 'เปลี่ยนชนิดกล่อง';
      iconEl.textContent = CALLOUTS[node.attrs.type]?.icon || 'ℹ️';
      iconEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!editor.isEditable) return;
        popupMenu([
          ...Object.entries(CALLOUTS).map(([k, v]) => ({
            label: v.label, icon: v.icon, checked: current.attrs.type === k,
            onClick: () => editor.chain().command(({ tr }) => { tr.setNodeMarkup(getPos(), undefined, { ...current.attrs, type: k }); return true; }).run(),
          })),
          '-',
          { label: 'เอากล่องออก', icon: 'x', onClick: () => {
            const pos = getPos();
            editor.chain().focus().setTextSelection(pos + 2).lift('callout').run();
          } },
        ], iconEl);
      });
      const content = document.createElement('div');
      content.className = 'callout-content';
      dom.append(iconEl, content);
      return {
        dom, contentDOM: content,
        update(n) {
          if (n.type.name !== 'callout') return false;
          current = n;
          dom.dataset.callout = n.attrs.type;
          iconEl.textContent = CALLOUTS[n.attrs.type]?.icon || 'ℹ️';
          return true;
        },
        stopEvent: (e) => iconEl.contains(e.target),
        ignoreMutation: (m) => iconEl.contains(m.target),
      };
    };
  },
  addCommands() {
    return {
      setCallout: (type = 'info') => ({ commands }) => commands.wrapIn(this.name, { type }),
      toggleCallout: (type = 'info') => ({ commands, editor }) => (editor.isActive('callout') ? commands.lift('callout') : commands.wrapIn('callout', { type })),
    };
  },
});

// ---------------- images: resize by dragging, align left / center / right ----------------
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => parseInt(el.getAttribute('width') || el.style.width, 10) || null,
        renderHTML: (a) => (a.width ? { width: a.width } : {}),
      },
      align: {
        default: 'center',
        parseHTML: (el) => el.getAttribute('data-align') || 'center',
        renderHTML: (a) => ({ 'data-align': a.align }),
      },
      caption: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-caption') || '',
        renderHTML: (a) => (a.caption ? { 'data-caption': a.caption } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const wrap = document.createElement('div');
      wrap.className = 'img-wrap';
      const frame = document.createElement('span');
      frame.className = 'img-frame';
      const img = document.createElement('img');
      img.draggable = false;
      const cap = document.createElement('div');
      cap.className = 'img-caption';
      const handles = ['nw', 'ne', 'sw', 'se'].map((c) => {
        const d = document.createElement('span');
        d.className = 'img-handle ' + c;
        d.dataset.corner = c;
        return d;
      });
      const badge = document.createElement('span');
      badge.className = 'img-size-badge';
      frame.append(img, ...handles, badge);
      wrap.append(frame, cap);

      const apply = (n) => {
        img.src = n.attrs.src;
        img.alt = n.attrs.alt || '';
        img.title = n.attrs.title || '';
        img.style.width = n.attrs.width ? n.attrs.width + 'px' : '';
        wrap.dataset.align = n.attrs.align || 'center';
        cap.textContent = n.attrs.caption || '';
        cap.style.display = n.attrs.caption ? '' : 'none';
      };
      apply(node);

      const onDown = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!editor.isEditable) return;
        const corner = e.target.dataset.corner;
        const dir = corner.includes('w') ? -1 : 1;
        const startX = e.clientX;
        const startW = img.getBoundingClientRect().width / (parseFloat(getComputedStyle(editor.view.dom).zoom) || 1);
        const maxW = editor.view.dom.clientWidth;
        frame.classList.add('resizing');
        const move = (ev) => {
          const zoom = parseFloat(getComputedStyle(editor.view.dom).zoom) || 1;
          const w = Math.round(Math.max(40, Math.min(maxW, startW + dir * (ev.clientX - startX) / zoom * (current.attrs.align === 'center' ? 2 : 1))));
          img.style.width = w + 'px';
          badge.textContent = `${w}px`;
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          frame.classList.remove('resizing');
          const w = parseInt(img.style.width, 10);
          if (typeof getPos === 'function') {
            editor.chain().command(({ tr }) => { tr.setNodeMarkup(getPos(), undefined, { ...current.attrs, width: w }); return true; })
              .setNodeSelection(getPos()).run();
          }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      };
      handles.forEach((d) => d.addEventListener('mousedown', onDown));

      return {
        dom: wrap,
        update(n) { if (n.type.name !== current.type.name) return false; current = n; apply(n); return true; },
        selectNode() { wrap.classList.add('selected'); },
        deselectNode() { wrap.classList.remove('selected'); },
        stopEvent: (e) => e.target.classList?.contains('img-handle'),
        ignoreMutation: () => true,
      };
    };
  },
});

// ---------------- table cell background colour ----------------
const bg = {
  backgroundColor: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-background') || el.style.backgroundColor || null,
    renderHTML: (a) => (a.backgroundColor ? { 'data-background': a.backgroundColor, style: `background-color: ${a.backgroundColor}` } : {}),
  },
};
export const ColorCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...bg }; } });
export const ColorHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...bg }; } });

// ---------------- find & replace (decorations) ----------------
export const searchKey = new PluginKey('nv-search');

function findMatches(doc, query, cs) {
  const out = [];
  if (!query) return out;
  const needle = cs ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) { for (let k = 0; k < child.text.length; k++) map.push(pos + 1 + offset + k); text += child.text; }
      else { text += '￼'; map.push(pos + 1 + offset); }
    });
    const hay = cs ? text : text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i >= 0 && out.length < 5000) {
      out.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
      i = hay.indexOf(needle, i + needle.length);
    }
    return false;
  });
  return out;
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => ({ query: '', cs: false, index: 0, results: [] }),
        apply(tr, prev) {
          const meta = tr.getMeta(searchKey);
          let s = meta ? { ...prev, ...meta } : prev;
          if ((meta && ('query' in meta || 'cs' in meta)) || (tr.docChanged && s.query)) {
            const results = findMatches(tr.doc, s.query, s.cs);
            s = { ...s, results, index: Math.min(s.index, Math.max(0, results.length - 1)) };
          }
          return s;
        },
      },
      props: {
        decorations(state) {
          const s = searchKey.getState(state);
          if (!s.query || !s.results.length) return null;
          return DecorationSet.create(state.doc, s.results.map((r, i) =>
            Decoration.inline(r.from, r.to, { class: i === s.index ? 'search-hit current' : 'search-hit' })));
        },
      },
    })];
  },
  addCommands() {
    const go = (tr, s, index) => {
      const r = s.results[index];
      tr.setMeta(searchKey, { index });
      if (r) tr.setSelection(TextSelection.create(tr.doc, r.from, r.to)).scrollIntoView();
    };
    return {
      setSearch: (query, cs = false) => ({ tr, state, dispatch }) => {
        if (!dispatch) return true;
        tr.setMeta(searchKey, { query, cs, index: 0 });
        dispatch(tr);
        // jump to the first hit after the state recomputes
        return true;
      },
      findStep: (dir = 1) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        const n = s.results.length;
        if (!n) return false;
        if (dispatch) go(tr, s, (s.index + dir + n) % n);
        return true;
      },
      replaceCurrent: (rep) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        const r = s.results[s.index];
        if (!r) return false;
        if (dispatch) tr.insertText(rep, r.from, r.to);
        return true;
      },
      replaceAll: (rep) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s.results.length) return false;
        if (dispatch) for (const r of [...s.results].reverse()) tr.insertText(rep, r.from, r.to);
        return true;
      },
    };
  },
});

// ---------------- always keep an empty paragraph at the end ----------------
// Without it, a note ending in an image/table/callout has nowhere to put the cursor,
// and typing "at the end" would replace the selected block.
export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('trailingParagraph'),
      appendTransaction: (_trs, _old, state) => {
        const last = state.doc.lastChild;
        if (last && last.type.name === 'paragraph') return null;
        return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create()).setMeta('addToHistory', false);
      },
    })];
  },
});
