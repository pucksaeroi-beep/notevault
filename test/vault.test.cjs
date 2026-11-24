'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vault = require('../electron/vault.cjs');
const { Library } = require('../electron/library.cjs');
const mock = require('../electron/mock.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nv-test-'));

test('create → unlock → load round trip, nothing in plaintext on disk', async () => {
  const dir = tmp();
  const items = mock.sampleVaultItems().map(vault.sanitizeItem);
  const dek = await vault.create(dir, 'correct horse', items);
  const raw = fs.readFileSync(path.join(dir, 'vault.json'), 'utf8');
  assert.ok(!raw.includes('Demo-Pass-1234!'), 'password must not appear in the file');
  assert.ok(!raw.includes('Gmail'), 'titles must not appear in the file');
  const k = await vault.unlock(dir, 'correct horse');
  assert.ok(k && k.equals(dek));
  assert.strictEqual(vault.load(dir, k).items.length, items.length);
});

test('wrong password returns null', async () => {
  const dir = tmp();
  await vault.create(dir, 'secret-1', []);
  assert.strictEqual(await vault.unlock(dir, 'secret-2'), null);
});

test('changePassword keeps data and rejects the old password', async () => {
  const dir = tmp();
  const dek = await vault.create(dir, 'old-pass', [vault.sanitizeItem({ title: 'x' })]);
  assert.strictEqual(await vault.changePassword(dir, 'nope-nope', 'new-pass'), false);
  assert.strictEqual(await vault.changePassword(dir, 'old-pass', 'new-pass'), true);
  assert.strictEqual(await vault.unlock(dir, 'old-pass'), null);
  const k = await vault.unlock(dir, 'new-pass');
  assert.ok(k.equals(dek));
  assert.strictEqual(vault.load(dir, k).items[0].title, 'x');
});

test('save writes a backup and verify() checks the key', async () => {
  const dir = tmp();
  const dek = await vault.create(dir, 'pw-123456', []);
  vault.save(dir, dek, { items: [vault.sanitizeItem({ title: 'a' })] });
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).length >= 1);
  assert.ok(vault.verify(dir, dek));
  assert.ok(!vault.verify(dir, Buffer.alloc(32)));
});

test('sanitizeItem accepts the Inmylife item shape', () => {
  const it = vault.sanitizeItem({ id: 'abc123', type: 'login', title: 'T', category: 'C',
    fields: [{ id: 'f1', label: 'user', value: 'u', secret: false }, { id: 'f2', label: 'pw', value: 'p', secret: true }], notes: 'n', favorite: 1 });
  assert.strictEqual(it.fields[0].kind, 'text');
  assert.strictEqual(it.fields[1].kind, 'password');
  assert.strictEqual(it.fields[1].secret, true);
  assert.strictEqual(it.favorite, true);
  assert.strictEqual(vault.sanitizeItem({ type: 'weird' }).type, 'other');
});

test('locked note body round trip', () => {
  const dek = require('crypto').randomBytes(32);
  const box = vault.sealJson(dek, { html: '<p>hi</p>', text: 'hi' });
  assert.deepStrictEqual(vault.openJson(dek, box), { html: '<p>hi</p>', text: 'hi' });
});

test('library: save/list/get/delete notes, assets, bad ids rejected', () => {
  const lib = new Library(tmp());
  assert.ok(lib.isEmpty());
  lib.saveNote({ id: 'n-test1', title: 'A', html: '<p>x</p>', text: 'x', updatedAt: 1 });
  const list = lib.listNotes();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].html, undefined, 'list must not carry the body');
  assert.strictEqual(lib.getNote('n-test1').html, '<p>x</p>');
  assert.throws(() => lib.getNote('../etc/passwd'));
  const url = lib.saveAsset(Buffer.from('fakepng'), 'png');
  assert.match(url, /^nv:\/\/asset\/[0-9a-f]{24}\.png$/);
  assert.ok(lib.assetPath(url.split('/').pop()));
  assert.strictEqual(lib.assetPath('../x.png'), null);
  lib.deleteNote('n-test1');
  assert.ok(lib.isEmpty());
});
