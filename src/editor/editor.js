import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import { common, createLowlight } from 'lowlight';
import { FontSize, BlockFormat, Callout, ResizableImage, ColorCell, ColorHeader, SearchReplace, searchKey, TrailingParagraph } from './extensions.js';
import { SlashCommand } from './slash.js';
import { buildToolbar, buildBubble } from './toolbar.js';
import { htmlToMarkdown, markdownToHtml, looksLikeMarkdown } from './markdown.js';
import { h, icon, prompt, toast } from '../ui/h.js';

const lowlight = createLowlight(common);
const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif' };

export class NoteEditor {
  constructor({ onChange, getSettings }) {
    this.onChange = onChange;
    this.getSettings = getSettings;
    this.sourceMode = false;
    this.loading = false;

    const ctx = {
      insertImage: () => this.insertImage(),
      editLink: () => this.editLink(),
      editCaption: () => this.editCaption(),
      baseSize: () => this.getSettings().fontSize || 16,
      toast,
    };

    this.contentEl = h('div', { class: 'editor-content' });
    this.bubbleEl = h('div');
    this.editor = new Editor({
      element: this.contentEl,
      extensions: [
        StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3, 4] }, dropcursor: { color: 'var(--accent)', width: 3 } }),
        Underline, TextStyle, Color, FontFamily, FontSize, BlockFormat,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Subscript, Superscript,
        Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
        Table.configure({ resizable: true, cellMinWidth: 60, lastColumnResizable: true }), TableRow, ColorCell, ColorHeader,
        TaskList, TaskItem.configure({ nested: true }),
        ResizableImage.configure({ inline: false, allowBase64: true }),
        Callout,
        CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === 'heading' ? 'หัวข้อ' : 'พิมพ์ / เพื่อแทรกหัวข้อ ตาราง รูป กล่องข้อความ…'),
          includeChildren: false,
        }),
        Typography, CharacterCount, SearchReplace, TrailingParagraph,
        SlashCommand(ctx),
        BubbleMenu.configure({
          element: this.bubbleEl,
          tippyOptions: { duration: 120, placement: 'top', maxWidth: 'none', zIndex: 50 },
          shouldShow: ({ editor, state, from, to }) => {
            if (from === to || !editor.isEditable) return false;
            if (state.selection.node || editor.isActive('codeBlock')) return false;
            if (state.selection.constructor.name === 'CellSelection') return false;
            return state.doc.textBetween(from, to).trim().length > 0;
          },
        }),
      ],
      editorProps: {
        attributes: { class: 'prose', spellcheck: String(getSettings().spellcheck !== false) },
        handlePaste: (view, event) => this.handlePaste(event),
        handleDrop: (view, event, _slice, moved) => this.handleDrop(view, event, moved),
        handleClickOn: (view, pos, node, nodePos, event) => {
          // ⌘-click opens links
          const a = event.target.closest?.('a[href]');
          if (a && (event.metaKey || !view.editable)) { window.nv.open.external(a.getAttribute('href')); return true; }
          return false;
        },
      },
      onUpdate: () => {
        if (this.loading) return;
        if (this.baseline !== undefined && this.editor.getHTML() === this.baseline) return;
        this.baseline = undefined;
        this.onChange?.();
      },
    });
    this.bubbleEl.append(buildBubble(this.editor, ctx));
    this.toolbar = buildToolbar(this.editor, ctx);

    // markdown source view
    this.sourceEl = h('textarea', { class: 'md-source', spellcheck: 'false', placeholder: '# เขียน Markdown ที่นี่' });
    this.sourceEl.addEventListener('input', () => { this.sourceDirty = true; this.onChange?.(); });
    this.sourceEl.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    });

    this.findBar = this.buildFindBar();
  }

  // ---------------- content ----------------
  setContent(html) {
    this.loading = true;
    if (this.sourceMode) this.exitSource(false);
    this.editor.commands.setContent(html || '<p></p>', false);
    this.editor.commands.setSearch('');
    // reset undo history so ⌘Z can't undo into the previous note
    const { state } = this.editor.view;
    const fresh = this.editor.view.state.constructor.create({ schema: state.schema, doc: state.doc, plugins: state.plugins });
    this.editor.view.updateState(fresh);
    // Let appendTransaction plugins (table normalisation etc.) run now, not on the user's first keystroke.
    this.editor.view.dispatch(this.editor.state.tr.setMeta('addToHistory', false));
    this.baseline = this.editor.getHTML();
    this.loading = false;
    this.toolbar.update();
  }
  getHTML() {
    if (this.sourceMode && this.sourceDirty) return markdownToHtml(this.sourceEl.value);
    return this.editor.getHTML();
  }
  getText() {
    if (this.sourceMode && this.sourceDirty) return this.sourceEl.value;
    return this.editor.getText({ blockSeparator: '\n' });
  }
  stats() {
    const text = this.getText();
    return { chars: text.replace(/\s/g, '').length, words: (text.match(/[\p{L}\p{N}]+/gu) || []).length };
  }
  setEditable(on) { this.editor.setEditable(on); this.sourceEl.readOnly = !on; }
  focus(pos = 'end') { if (this.sourceMode) this.sourceEl.focus(); else this.editor.commands.focus(pos); }

  // ---------------- markdown source ----------------
  toggleSource() { if (this.sourceMode) this.exitSource(true); else this.enterSource(); return this.sourceMode; }
  enterSource() {
    this.sourceEl.value = htmlToMarkdown(this.editor.getHTML());
    this.sourceDirty = false;
    this.sourceMode = true;
    this.contentEl.style.display = 'none';
    this.sourceEl.style.display = '';
    this.sourceEl.focus();
  }
  exitSource(apply) {
    if (apply && this.sourceDirty) {
      this.loading = true;
      this.editor.commands.setContent(markdownToHtml(this.sourceEl.value), false);
      this.loading = false;
      this.onChange?.();
    }
    this.sourceMode = false;
    this.sourceDirty = false;
    this.sourceEl.style.display = 'none';
    this.contentEl.style.display = '';
  }

  // ---------------- images ----------------
  async uploadFiles(files) {
    const urls = [];
    for (const f of files) {
      const ext = IMG_EXT[f.type];
      if (!ext) continue;
      if (f.size > 40 * 1024 * 1024) { toast('รูปใหญ่เกิน 40MB', 'error'); continue; }
      urls.push(await window.nv.lib.saveAsset(new Uint8Array(await f.arrayBuffer()), ext));
    }
    return urls;
  }
  async insertImage() {
    const urls = await window.nv.lib.pickImage();
    for (const src of urls) this.editor.chain().focus().setImage({ src }).run();
  }
  handlePaste(event) {
    const dt = event.clipboardData;
    if (!dt) return false;
    const files = [...dt.files].filter((f) => IMG_EXT[f.type]);
    if (files.length) {
      event.preventDefault();
      this.uploadFiles(files).then((urls) => urls.forEach((src) => this.editor.chain().focus().setImage({ src }).run()));
      return true;
    }
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    if (!html && text && !this.editor.isActive('codeBlock') && looksLikeMarkdown(text)) {
      event.preventDefault();
      this.editor.chain().focus().insertContent(markdownToHtml(text)).run();
      toast('แปลง Markdown ให้แล้ว');
      return true;
    }
    return false;
  }
  handleDrop(view, event, moved) {
    if (moved) return false;
    const files = [...(event.dataTransfer?.files || [])].filter((f) => IMG_EXT[f.type]);
    if (!files.length) return false;
    event.preventDefault();
    const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
    this.uploadFiles(files).then((urls) => {
      let pos = at ? at.pos : view.state.selection.to;
      for (const src of urls) {
        const node = view.state.schema.nodes.image.create({ src });
        view.dispatch(view.state.tr.insert(pos, node));
        pos += node.nodeSize;
      }
    });
    return true;
  }
  async editCaption() {
    const sel = this.editor.state.selection;
    if (!sel.node || sel.node.type.name !== 'image') return;
    const v = await prompt('คำบรรยายใต้ภาพ', sel.node.attrs.caption || '');
    if (v !== undefined) this.editor.chain().focus().updateAttributes('image', { caption: v }).run();
  }

  // ---------------- links ----------------
  async editLink() {
    const prev = this.editor.getAttributes('link').href || '';
    const { from, to } = this.editor.state.selection;
    const hasText = from !== to;
    let url = await prompt(prev ? 'แก้ไขลิงก์' : 'ใส่ลิงก์', prev, { placeholder: 'https://…', message: prev ? 'ปล่อยว่างเพื่อเอาลิงก์ออก' : '' });
    if (url === undefined) return this.editor.commands.focus();
    url = url.trim();
    const c = this.editor.chain().focus().extendMarkRange('link');
    if (!url) return c.unsetLink().run();
    if (!/^[a-z]+:/i.test(url)) url = (url.includes('@') && !url.includes('/') ? 'mailto:' : 'https://') + url;
    if (!hasText && !prev) this.editor.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).insertContent(' ').run();
    else c.setLink({ href: url }).run();
  }

  // ---------------- find & replace ----------------
  buildFindBar() {
    const q = h('input', { class: 'find-input', placeholder: 'ค้นหาในโน้ต' });
    const rep = h('input', { class: 'find-input', placeholder: 'แทนที่ด้วย' });
    const count = h('span', { class: 'find-count' });
    const cs = h('button', { class: 'cb-btn cb-text', title: 'ตรงตัวพิมพ์เล็ก/ใหญ่' }, 'Aa');
    let caseOn = false;
    const run = () => this.editor.commands.setSearch(q.value, caseOn);
    const refresh = () => {
      const s = searchKey.getState(this.editor.state);
      count.textContent = !q.value ? '' : s.results.length ? `${s.index + 1}/${s.results.length}` : 'ไม่พบ';
    };
    this.editor.on('transaction', () => { if (bar.classList.contains('show')) refresh(); });
    q.addEventListener('input', () => { run(); this.editor.commands.findStep(0); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.editor.commands.findStep(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') this.closeFind();
    });
    rep.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.editor.commands.replaceCurrent(rep.value); }
      if (e.key === 'Escape') this.closeFind();
    });
    cs.addEventListener('click', () => { caseOn = !caseOn; cs.classList.toggle('on', caseOn); run(); });
    const repRow = h('div', { class: 'find-row rep' }, rep,
      h('button', { class: 'btn small', onclick: () => this.editor.commands.replaceCurrent(rep.value) }, 'แทนที่'),
      h('button', { class: 'btn small', onclick: () => { this.editor.commands.replaceAll(rep.value); toast('แทนที่ทั้งหมดแล้ว'); } }, 'แทนที่ทั้งหมด'));
    const bar = h('div', { class: 'findbar' },
      h('div', { class: 'find-row' }, icon('search', 'find-ic'), q, count, cs,
        h('button', { class: 'cb-btn', title: 'ก่อนหน้า (⇧↵)', onclick: () => this.editor.commands.findStep(-1) }, icon('arrowUp')),
        h('button', { class: 'cb-btn', title: 'ถัดไป (↵)', onclick: () => this.editor.commands.findStep(1) }, icon('arrowDown')),
        h('button', { class: 'cb-btn', title: 'แทนที่', onclick: () => bar.classList.toggle('replace') }, icon('refresh')),
        h('button', { class: 'cb-btn', title: 'ปิด (Esc)', onclick: () => this.closeFind() }, icon('x'))),
      repRow);
    this.findInput = q;
    this.replaceInput = rep;
    return bar;
  }
  openFind(replace = false) {
    if (this.sourceMode) this.exitSource(true);
    this.findBar.classList.add('show');
    this.findBar.classList.toggle('replace', replace);
    const { from, to } = this.editor.state.selection;
    const selText = this.editor.state.doc.textBetween(from, to);
    if (selText && selText.length < 80) this.findInput.value = selText;
    this.findInput.focus(); this.findInput.select();
    this.editor.commands.setSearch(this.findInput.value);
  }
  closeFind() {
    this.findBar.classList.remove('show');
    this.editor.commands.setSearch('');
    this.editor.commands.focus();
  }
}
