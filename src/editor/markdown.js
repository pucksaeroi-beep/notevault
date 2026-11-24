// HTML ⇄ Markdown (GFM). Colours, font sizes and other styling that Markdown can't express
// are kept as inline HTML where possible, otherwise dropped.
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { marked } from 'marked';
import { CALLOUTS } from './extensions.js';

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', hr: '---' });
td.use(gfm);

// tight lists: "- item" / "1. item" (TipTap wraps every item in <p>, which turndown would make loose)
td.addRule('listParagraph', {
  filter: (n) => n.nodeName === 'P' && n.parentNode?.nodeName === 'LI',
  replacement: (c, node) => (node.nextElementSibling ? c + '\n' : c),
});
td.addRule('listItem', {
  filter: 'li',
  replacement: (content, node, options) => {
    const parent = node.parentNode;
    let prefix = options.bulletListMarker + ' ';
    if (parent.nodeName === 'OL') {
      const start = Number(parent.getAttribute('start')) || 1;
      prefix = start + Array.prototype.indexOf.call(parent.children, node) + '. ';
    }
    const pad = ' '.repeat(prefix.length);
    content = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n/g, '\n' + pad);
    return prefix + content + '\n';
  },
});
td.addRule('taskItem', {
  filter: (n) => n.nodeName === 'LI' && n.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const checked = node.getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.replace(/^\n+|\n+$/g, '').replace(/\n{2,}/g, '\n\n  ').replace(/([^\n])\n(?=[^\n])/g, '$1\n  ')}\n`;
  },
});
td.addRule('taskList', {
  filter: (n) => n.nodeName === 'UL' && n.getAttribute('data-type') === 'taskList',
  replacement: (content) => '\n\n' + content + '\n\n',
});
td.addRule('taskCheckbox', { filter: (n) => n.nodeName === 'LABEL' && n.closest?.('li[data-type="taskItem"]'), replacement: () => '' });
td.addRule('callout', {
  filter: (n) => n.nodeName === 'DIV' && n.hasAttribute('data-callout'),
  replacement: (content, node) => {
    const type = (node.getAttribute('data-callout') || 'info').toUpperCase();
    const body = content.trim().split('\n').map((l) => '> ' + l).join('\n');
    return `\n\n> [!${type}]\n${body}\n\n`;
  },
});
td.addRule('highlight', { filter: 'mark', replacement: (c) => `==${c}==` });
td.addRule('underline', { filter: 'u', replacement: (c) => `<u>${c}</u>` });
td.addRule('cellParagraph', {
  filter: (n) => n.nodeName === 'P' && (n.parentNode?.nodeName === 'TD' || n.parentNode?.nodeName === 'TH'),
  replacement: (c, node) => (node.nextElementSibling ? c + '<br>' : c),
});
td.addRule('image', {
  filter: 'img',
  replacement: (_c, node) => {
    const alt = node.getAttribute('alt') || '';
    const src = node.getAttribute('src') || '';
    const w = node.getAttribute('width');
    return w ? `<img src="${src}" alt="${alt}" width="${w}">` : `![${alt}](${src})`;
  },
});

export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  // TipTap writes <colgroup> and a <div> wrapper inside task items; strip noise first.
  doc.querySelectorAll('colgroup').forEach((n) => n.remove());
  doc.querySelectorAll('li[data-type="taskItem"] > div').forEach((d) => d.replaceWith(...d.childNodes));
  // GFM tables need a header row: promote the first row when it has none.
  doc.querySelectorAll('table').forEach((t) => {
    const first = t.querySelector('tr');
    if (first && !first.querySelector('th')) first.querySelectorAll('td').forEach((c) => { const th = doc.createElement('th'); th.innerHTML = c.innerHTML; c.replaceWith(th); });
  });
  return td.turndown(doc.body.firstChild.innerHTML).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

marked.setOptions({ gfm: true, breaks: false });

export function markdownToHtml(md) {
  const raw = marked.parse(String(md));
  const doc = new DOMParser().parseFromString(`<div id="r">${raw}</div>`, 'text/html');
  const root = doc.getElementById('r');
  // [ ] / [x] list items → TipTap task lists
  root.querySelectorAll('li').forEach((li) => {
    const box = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
    if (!box) return;
    const ul = li.parentElement;
    ul.setAttribute('data-type', 'taskList');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', box.checked || box.hasAttribute('checked') ? 'true' : 'false');
    box.remove();
  });
  // > [!NOTE] blockquotes → callouts
  root.querySelectorAll('blockquote').forEach((bq) => {
    const p = bq.querySelector('p');
    const m = p && p.textContent.match(/^\s*\[!(\w+)\]\s*/);
    if (!m) return;
    const type = m[1].toLowerCase();
    const map = { tip: 'success', important: 'idea', caution: 'danger' };
    const kind = CALLOUTS[type] ? type : map[type] || 'info';
    p.innerHTML = p.innerHTML.replace(/^\s*\[!\w+\]\s*(<br>)?\s*/, '');
    if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
    const div = doc.createElement('div');
    div.setAttribute('data-callout', kind);
    div.append(...bq.childNodes);
    if (!div.children.length) div.append(doc.createElement('p'));
    bq.replaceWith(div);
  });
  // ==highlight== outside code
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('code,pre')) texts.push(walker.currentNode);
  for (const t of texts) {
    if (!t.nodeValue.includes('==')) continue;
    const parts = t.nodeValue.split(/==([^=\n]+)==/);
    if (parts.length < 3) continue;
    const frag = doc.createDocumentFragment();
    parts.forEach((p, i) => { if (i % 2) { const m = doc.createElement('mark'); m.textContent = p; frag.append(m); } else if (p) frag.append(p); });
    t.replaceWith(frag);
  }
  return root.innerHTML;
}

export function looksLikeMarkdown(text) {
  if (!text || text.length < 3) return false;
  const lines = text.split('\n');
  let score = 0;
  for (const l of lines.slice(0, 200)) {
    if (/^#{1,6}\s+\S/.test(l)) score += 2;
    else if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(l)) score += 2;
    else if (/^\s*([-*+]|\d+\.)\s+\S/.test(l)) score += 1;
    else if (/^>\s/.test(l)) score += 1;
    else if (/^```/.test(l)) score += 2;
    else if (/^\|.*\|\s*$/.test(l)) score += 1;
    if (/\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(l)) score += 1;
  }
  return score >= 2;
}
