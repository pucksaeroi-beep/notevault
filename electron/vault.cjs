// Encrypted password vault (AES-256-GCM, key from scrypt(master password)).
// File layout of <library>/vault.json — no plaintext ever touches disk:
// {
//   v: 1,
//   kdf:  { alg: "scrypt", salt, N, r, p },   // KEK = scrypt(master password)
//   wrap: { iv, ct, tag },                     // DEK encrypted with KEK
//   data: { iv, ct, tag }                      // {items:[...]} encrypted with DEK
// }
// The DEK never changes, so changing the master password only re-wraps it.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KDF = { N: 1 << 17, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;
const KEEP_BACKUPS = 30;

const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');

function files(dir) {
  return { vault: path.join(dir, 'vault.json'), backups: path.join(dir, 'backups') };
}

function kek(password, kdf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFC'), unb64(kdf.salt), 32,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}

function open(key, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, unb64(box.iv));
  d.setAuthTag(unb64(box.tag));
  return Buffer.concat([d.update(unb64(box.ct)), d.final()]);
}

function exists(dir) { return fs.existsSync(files(dir).vault); }
function readFile(dir) { return JSON.parse(fs.readFileSync(files(dir).vault, 'utf8')); }

function writeFile(dir, obj) {
  const f = files(dir);
  fs.mkdirSync(f.backups, { recursive: true, mode: 0o700 });
  if (fs.existsSync(f.vault)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(f.vault, path.join(f.backups, `vault-${stamp}.json`));
    const old = fs.readdirSync(f.backups).filter((n) => n.startsWith('vault-')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(f.backups, n));
  }
  const tmp = f.vault + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, f.vault);
}

async function create(dir, password, items = []) {
  if (String(password).length < 6) throw new Error('รหัสผ่านหลักต้องมีอย่างน้อย 6 ตัวอักษร');
  const kdf = { alg: 'scrypt', salt: b64(crypto.randomBytes(16)), ...KDF };
  const dek = crypto.randomBytes(32);
  writeFile(dir, { v: 1, kdf, wrap: seal(await kek(password, kdf), dek), data: seal(dek, Buffer.from(JSON.stringify({ items }))) });
  return dek;
}

/** Returns the DEK, or null when the password is wrong. */
async function unlock(dir, password) {
  const f = readFile(dir);
  try { return open(await kek(password, f.kdf), f.wrap); } catch { return null; }
}

/** Checks a DEK (e.g. one restored from Touch ID storage) against the vault. */
function verify(dir, dek) {
  try { open(dek, readFile(dir).data); return true; } catch { return false; }
}

function load(dir, dek) { return JSON.parse(open(dek, readFile(dir).data).toString('utf8')); }

function save(dir, dek, doc) {
  const f = readFile(dir);
  f.data = seal(dek, Buffer.from(JSON.stringify(doc)));
  writeFile(dir, f);
}

async function changePassword(dir, oldPw, newPw) {
  if (String(newPw).length < 6) throw new Error('รหัสผ่านหลักต้องมีอย่างน้อย 6 ตัวอักษร');
  const dek = await unlock(dir, oldPw);
  if (!dek) return false;
  const f = readFile(dir);
  f.kdf = { alg: 'scrypt', salt: b64(crypto.randomBytes(16)), ...KDF };
  f.wrap = seal(await kek(newPw, f.kdf), dek);
  writeFile(dir, f);
  return true;
}

// ---- item sanitising (same shape as the Inmylife vault, plus optional field.kind) ----
const KINDS = new Set(['text', 'password', 'url', 'email', 'phone', 'totp', 'pin', 'multiline']);
const TYPES = new Set(['login', 'card', 'bank', 'wifi', 'identity', 'note', 'other']);
const str = (v, max = 20000) => (v == null ? '' : String(v)).slice(0, max);
const rid = () => crypto.randomBytes(8).toString('hex');

function sanitizeItem(raw) {
  const now = Date.now();
  const fields = Array.isArray(raw.fields) ? raw.fields.slice(0, 100) : [];
  return {
    id: /^[\w-]{4,64}$/.test(raw.id || '') ? raw.id : rid(),
    type: TYPES.has(raw.type) ? raw.type : 'other',
    title: str(raw.title, 300) || 'ไม่มีชื่อ',
    category: str(raw.category, 100),
    icon: str(raw.icon, 16),
    fields: fields.map((f) => {
      const kind = KINDS.has(f.kind) ? f.kind : (f.secret ? 'password' : 'text');
      return {
        id: /^[\w-]{2,64}$/.test(f.id || '') ? f.id : rid(),
        label: str(f.label, 200),
        value: str(f.value, 20000),
        kind,
        secret: kind === 'password' || kind === 'pin' || kind === 'totp' || !!f.secret,
      };
    }),
    notes: str(raw.notes, 100000),
    favorite: !!raw.favorite,
    createdAt: Number(raw.createdAt) || now,
    updatedAt: now,
  };
}

/** Encrypt / decrypt a locked note body with the vault DEK. */
function sealJson(dek, obj) { return seal(dek, Buffer.from(JSON.stringify(obj))); }
function openJson(dek, box) { return JSON.parse(open(dek, box).toString('utf8')); }

module.exports = { exists, create, unlock, verify, load, save, changePassword, sanitizeItem, sealJson, openJson };
