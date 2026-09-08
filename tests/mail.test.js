'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { normalizeAccount, clientOptions, plainPart, createMailStore, createMailService } = require('../main-mail');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mail-unit-')), key = crypto.randomBytes(32);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const b = Buffer.concat([c.update(value, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]); },
    decryptString(b) { const c = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(); },
  };
  return { file: path.join(dir, 'accounts.enc'), encryption };
}
const account = { provider: 'qq', email: 'fixture@qq.com', secret: 'fixture-authorization-only' };
class FakeClient extends EventEmitter {
  constructor(options, behavior = {}) { super(); this.options = options; this.behavior = behavior; this.mailbox = { exists: 7000, uidValidity: 9n }; this.closed = false; }
  async connect() { if (this.behavior.connect) return this.behavior.connect(); }
  async mailboxOpen(name, options) { assert.equal(name, 'INBOX'); assert.deepEqual(options, { readOnly: true }); }
  async search(q, options) { assert.deepEqual(q, { seen: false, seq: '2001:*' }); assert.deepEqual(options, { uid: true }); return Array.from({ length: 70 }, (_, i) => i + 1); }
  async *fetch(uids, q, options) {
    assert.equal(uids.length, 50); assert.deepEqual(options, { uid: true }); assert.equal(q.source, undefined);
    for (const uid of uids) yield { uid, envelope: { subject: '<img src=x onerror=alert(1)> 中文标题', from: [{ name: '测试发件人' }] }, internalDate: new Date('2026-09-07T01:00:00Z'), bodyStructure: { type: 'text/plain', part: '1', size: 40 } };
  }
  async download(uid, part, options) { assert.equal(part, '1'); assert.equal(options.uid, true); assert.equal(options.maxBytes, 65536); return { content: Readable.from(['中文正文，只读获取。']) }; }
  close() { this.closed = true; }
}
test('four providers fix TLS endpoints and reject arbitrary domains, blank secrets and private endpoint override', () => {
  for (const [provider, email] of [['qq', 'a@qq.com'], ['netease', 'a@163.com'], ['gmail', 'a@gmail.com'], ['icloud', 'a@icloud.com']]) {
    const a = normalizeAccount({ provider, email, secret: 'a b c d', host: '127.0.0.1' }); assert.equal(a.secret, 'abcd');
    const c = clientOptions(a); assert.equal(c.port, 993); assert.equal(c.secure, true); assert.equal(c.tls.rejectUnauthorized, true); assert.equal(c.logger, false); assert.notEqual(c.host, '127.0.0.1');
  }
  assert.throws(() => normalizeAccount({ ...account, email: 'test@localhost' }), /invalid_account/);
  assert.throws(() => normalizeAccount({ ...account, provider: '__proto__' }), /invalid_account/);
  assert.throws(() => normalizeAccount({ ...account, secret: '' }), /invalid_secret/);
});
test('encrypted account store masks secrets, preserves corruption and revisions', t => {
  const f = fixture(t), s = createMailStore(f.file, f.encryption);
  assert.equal(s.save(account, 0).ok, true); assert.equal(fs.readFileSync(f.file).includes(account.secret), false);
  assert.equal(s.snapshot().accounts[0].secret, undefined); assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(s.save({ ...account, email: 'second@qq.com' }, 0).error, 'conflict');
  fs.writeFileSync(f.file, 'broken'); assert.equal(s.snapshot().error, 'vault_unreadable');
  assert.throws(() => s.save(account, 1), /vault_unreadable/); assert.equal(fs.readFileSync(f.file, 'utf8'), 'broken');
});
test('unavailable encryption does not write plaintext', t => {
  const f = fixture(t); f.encryption.isEncryptionAvailable = () => false;
  const s = createMailStore(f.file, f.encryption); assert.equal(s.snapshot().error, 'secure_storage_unavailable'); assert.equal(fs.existsSync(f.file), false);
});
test('only explicit verification saves account; read-only limited unread and on-demand body', async t => {
  const f = fixture(t), clients = [], s = createMailService({ ...f, makeClient: o => { const c = new FakeClient(o); clients.push(c); return c; } }); t.after(() => s.dispose());
  assert.equal(s.snapshot().accounts.length, 0); assert.equal(clients.length, 0);
  assert.equal((await s.save({ ...account, revision: 0 })).error, 'confirmation_required');
  const saved = await s.save({ ...account, revision: 0, confirmed: true }); assert.equal(saved.ok, true); assert.equal(clients.length, 1);
  const id = saved.accounts[0].id; const r = await s.refresh(id); assert.equal(r.ok, true); assert.equal(r.accounts[0].items.length, 50); assert.equal(r.accounts[0].matched, 70);
  assert.equal(r.accounts[0].scanned, 5000); assert.equal(JSON.stringify(r).includes(account.secret), false);
  assert.equal((await s.read(id, r.accounts[0].items[0].id)).text, '中文正文，只读获取。'); assert.ok(clients.every(c => c.closed));
  assert.equal((await s.read(id, 'foreign-id')).error, 'stale_message');
  const recreated = createMailService({ ...f, makeClient: o => new FakeClient(o) }); t.after(() => recreated.dispose()); assert.equal(recreated.snapshot().accounts[0].items.length, 0);
});
test('authentication failure is sanitized and does not persist or replace previous authorization', async t => {
  const f = fixture(t); let fail = false;
  const s = createMailService({ ...f, makeClient: o => new FakeClient(o, { connect: async () => { if (fail) { const e = Error('server echoed secret: ' + account.secret); e.authenticationFailed = true; throw e; } } }) }); t.after(() => s.dispose());
  const saved = await s.save({ ...account, revision: 0, confirmed: true }); const id = saved.accounts[0].id;
  await s.refresh(id); fail = true; const original = fs.readFileSync(f.file);
  assert.deepEqual(await s.save({ ...account, id, revision: 1, confirmed: true, secret: 'bad' }), { ok: false, error: 'auth_failed' }); assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal((await s.refresh(id)).error, 'auth_failed'); assert.equal(s.snapshot().accounts[0].items.length, 50); assert.equal(s.snapshot().accounts[0].error, 'auth_failed');
});
test('timeouts and cancel release connection; late auth cannot save account', async t => {
  const f = fixture(t), clients = []; let resolveConnect;
  const s = createMailService({ ...f, timeoutMs: 20, makeClient: o => { const c = new FakeClient(o, { connect: () => new Promise(r => { resolveConnect = r; }) }); clients.push(c); return c; } }); t.after(() => s.dispose());
  assert.equal((await s.save({ ...account, confirmed: true, revision: 0 })).error, 'timeout'); assert.equal(clients[0].closed, true);
  resolveConnect(); await new Promise(r => setImmediate(r)); assert.equal(s.snapshot().accounts.length, 0);
  const pending = s.save({ ...account, confirmed: true, revision: 0 }); s.cancel(); assert.equal((await pending).error, 'cancelled'); resolveConnect();
  assert.equal(s.snapshot().accounts.length, 0);
});
test('disconnect is confirmed, preserves other accounts and drops cache', async t => {
  const f = fixture(t), s = createMailService({ ...f, makeClient: o => new FakeClient(o) }); t.after(() => s.dispose());
  const saved = await s.save({ ...account, confirmed: true, revision: 0 }), id = saved.accounts[0].id;
  await s.refresh(id); assert.equal(s.remove({ id, revision: 1 }).error, 'confirmation_required');
  assert.equal(s.remove({ id, revision: 0, confirmed: true }).error, 'conflict');
  assert.equal(s.remove({ id, revision: 1, confirmed: true }).accounts.length, 0); assert.equal((await s.read(id, 'old')).error, 'stale_message');
});
test('body selection ignores attachments and HTML without rendering', () => {
  assert.equal(plainPart({ type: 'text/html', part: '1' }), null);
  assert.equal(plainPart({ type: 'text/plain', disposition: 'attachment', part: '1' }), null);
  assert.equal(plainPart({ type: 'message/rfc822', childNodes: [{ type: 'text/plain', part: '1' }] }), null);
  assert.deepEqual(plainPart({ type: 'multipart/mixed', childNodes: [{ type: 'text/plain', disposition: 'attachment', part: '1' }, { type: 'text/plain', part: '2', size: 20 }] }), { part: '2', size: 20 });
});

test('one mailbox failure does not erase another mailbox; disconnect keeps other accounts', async t => {
  const f = fixture(t); let failingHost = '';
  const s = createMailService({ ...f, makeClient: o => new FakeClient(o, { connect: async () => { if (o.host === failingHost) throw Error('network unreachable'); } }) }); t.after(() => s.dispose());
  const first = await s.save({ ...account, confirmed: true, revision: 0 });
  const second = await s.save({ provider: 'netease', email: 'fixture@163.com', secret: 'synthetic-code', confirmed: true, revision: 1 });
  const [a, b] = second.accounts; assert.equal(second.accounts.length, 2);
  const both = await Promise.all([s.refresh(a.id), s.refresh(b.id)]); assert.ok(both.every(r => r.ok));
  failingHost = 'imap.163.com'; assert.equal((await s.refresh(b.id)).ok, false);
  assert.equal(s.snapshot().accounts.find(v => v.id === a.id).error, ''); assert.equal(s.snapshot().accounts.find(v => v.id === b.id).items.length, 50);
  const removed = s.remove({ id: first.accounts[0].id, revision: second.revision, confirmed: true }); assert.equal(removed.accounts.length, 1); assert.equal(removed.accounts[0].email, 'fixture@163.com');
});

test('failed atomic rename preserves encrypted data and prior revision', t => {
  const f = fixture(t), s = createMailStore(f.file, f.encryption); const saved = s.save(account, 0), before = fs.readFileSync(f.file), rename = fs.renameSync;
  fs.renameSync = (source, target) => { if (target === f.file) throw Error('ENOSPC'); return rename(source, target); };
  try { assert.equal(s.save({ ...account, email: 'second@qq.com' }, saved.revision).error, 'save_failed'); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(s.snapshot().revision, saved.revision);
});
