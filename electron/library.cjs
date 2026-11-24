// Notes storage: plain JSON files in a folder the user can move (e.g. into iCloud Drive).
//   <root>/notes/<id>.json   one note per file
//   <root>/folders.json      folder list
//   <root>/assets/<name>     pasted / inserted images (served as nv://asset/<name>)
//   <root>/vault.json        encrypted password vault (see vault.cjs)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[\w-]{4,64}$/;
const ASSET_RE = /^[\w-]{4,80}\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i;

class Library {
  constructor(root) {
    this.root = root;
    this.notesDir = path.join(root, 'notes');
    this.assetsDir = path.join(root, 'assets');
    for (const d of [root, this.notesDir, this.assetsDir]) fs.mkdirSync(d, { recursive: true });
  }

  noteFile(id) {
    if (!ID_RE.test(id)) throw new Error('bad note id');
    return path.join(this.notesDir, id + '.json');
  }

  isEmpty() { return fs.readdirSync(this.notesDir).filter((n) => n.endsWith('.json')).length === 0; }

  /** Metadata + plain text of every note (the body HTML is loaded on open). */
  listNotes() {
    const out = [];
    for (const name of fs.readdirSync(this.notesDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const n = JSON.parse(fs.readFileSync(path.join(this.notesDir, name), 'utf8'));
        const { html, enc, ...meta } = n;
        out.push(meta);
      } catch { /* skip a broken file instead of failing the whole list */ }
    }
    return out;
  }

  getNote(id) {
    const f = this.noteFile(id);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  }

  saveNote(note) {
    const f = this.noteFile(note.id);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(note));
    fs.renameSync(tmp, f);
    const { html, enc, ...meta } = note;
    return meta;
  }

  deleteNote(id) {
    const f = this.noteFile(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  getFolders() {
    const f = path.join(this.root, 'folders.json');
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
  }

  saveFolders(list) {
    const clean = (Array.isArray(list) ? list : []).filter((x) => x && ID_RE.test(x.id)).map((x) => ({
      id: x.id, name: String(x.name || 'โฟลเดอร์').slice(0, 120), icon: String(x.icon || '').slice(0, 16),
      color: String(x.color || '').slice(0, 20), order: Number(x.order) || 0,
    }));
    fs.writeFileSync(path.join(this.root, 'folders.json'), JSON.stringify(clean, null, 2));
    return clean;
  }

  saveAsset(buf, ext) {
    ext = String(ext || 'png').toLowerCase().replace(/[^a-z]/g, '') || 'png';
    if (ext === 'jpeg') ext = 'jpg';
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);
    const name = `${hash}.${ext}`;
    if (!ASSET_RE.test(name)) throw new Error('unsupported image type');
    const f = path.join(this.assetsDir, name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
    return `nv://asset/${name}`;
  }

  assetPath(name) {
    if (!ASSET_RE.test(name)) return null;
    const f = path.join(this.assetsDir, name);
    return fs.existsSync(f) ? f : null;
  }

  /** Copy the whole library (notes, assets, encrypted vault) to a timestamped folder. */
  backupTo(destDir) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const dest = path.join(destDir, `NoteVault-backup-${stamp}`);
    fs.cpSync(this.root, dest, { recursive: true, filter: (src) => !src.endsWith('.tmp') });
    return dest;
  }
}

module.exports = { Library, ID_RE };
