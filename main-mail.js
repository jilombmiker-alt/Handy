'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns');
const { isPrivateAddress } = require('./main-services');

const PROVIDERS = Object.freeze({
  qq: { name: 'QQ 邮箱', host: 'imap.qq.com', domains: ['qq.com', 'foxmail.com'], web: 'https://mail.qq.com/', help: 'https://mail.qq.com/', hint: '打开 QQ 邮箱 → 设置 → 账号 → 开启 IMAP，生成客户端授权码。填写授权码，不是 QQ 登录密码。' },
  netease: { name: '163 邮箱', host: 'imap.163.com', domains: ['163.com'], web: 'https://mail.163.com/', help: 'https://mail.163.com/', hint: '打开 163 邮箱 → 设置 → POP3/SMTP/IMAP → 开启 IMAP 并新增授权密码。填写授权码，不是邮箱登录密码。' },
  gmail: { name: 'Gmail', host: 'imap.gmail.com', domains: ['gmail.com', 'googlemail.com'], web: 'https://mail.google.com/', help: 'https://support.google.com/accounts/answer/185833', hint: '需开启两步验证，并为 TO-DO Panel 生成应用专用密码。若账号没有此选项，不要降低安全设置，可先使用网页版；本版尚未接入 Google OAuth。Gmail 还需当前网络可直连其邮件服务器。' },
  icloud: { name: 'iCloud 邮箱', host: 'imap.mail.me.com', domains: ['icloud.com', 'me.com', 'mac.com'], web: 'https://www.icloud.com/mail/', help: 'https://support.apple.com/en-us/102654', hint: '在 Apple 账户 → 登录和安全 → App 专用密码中生成。填写 iCloud 邮箱地址，不是任意 Apple 账户登录地址。无需 Apple 开发者账号。' },
});
const MAX_BODY_BYTES = 64 * 1024;
const cut = (v, n) => String(v || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n);
const fail = error => ({ ok: false, error });
const uid = () => crypto.randomUUID();

function normalizeAccount(input) {
  const provider = Object.hasOwn(PROVIDERS, input?.provider) ? PROVIDERS[input.provider] : null;
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!provider || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+$/.test(email) || !provider.domains.includes(email.split('@')[1])) throw Error('invalid_account');
  const secret = typeof input.secret === 'string' ? input.secret.replace(/\s/g, '') : '';
  if (!secret || secret.length > 256 || /[\x00-\x1f\x7f]/.test(secret)) throw Error('invalid_secret');
  return { provider: input.provider, email, secret };
}

// Pin resolution to public IPs; the configured hostname remains the TLS identity.
function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true }, (error, rows) => {
    if (error) return callback(error);
    const safe = rows.filter(row => !isPrivateAddress(row.address));
    if (!safe.length || safe.length !== rows.length) return callback(Error('unsafe_address'));
    const family = typeof options === 'number' ? options : options?.family;
    const matches = family ? safe.filter(row => row.family === family) : safe;
    if (!matches.length) return callback(Error('address_unavailable'));
    if (options?.all) callback(null, matches); else callback(null, matches[0].address, matches[0].family);
  });
}

function clientOptions(account) {
  const p = Object.hasOwn(PROVIDERS, account.provider) ? PROVIDERS[account.provider] : null;
  if (!p) throw Error('invalid_account');
  return { host: p.host, port: 993, secure: true, auth: { user: account.email, pass: account.secret },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', lookup: publicLookup },
    logger: false, logRaw: false, emitLogs: false, disableAutoIdle: true, disableCompression: true,
    clientInfo: { name: 'TO-DO Panel', version: '1' },
    connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000 };
}

function plainPart(node, depth = 0) {
  if (!node || depth > 16 || node.type === 'message/rfc822' || String(node.disposition).toLowerCase() === 'attachment') return null;
  if (node.type === 'text/plain') return { part: node.part || '1', size: Number(node.size) || 0 };
  for (const child of (node.childNodes || []).slice(0, 100)) { const found = plainPart(child, depth + 1); if (found) return found; }
  return null;
}

function errorCode(e) {
  if (['cancelled', 'timeout', 'stale_message', 'not_found'].includes(e?.message)) return e.message;
  if (e?.authenticationFailed || /AUTH|LOGIN|CREDENTIAL/i.test(e?.serverResponseCode || e?.code || '')) return 'auth_failed';
  return 'connection_failed';
}

function createMailStore(file, encryption) {
  let state, fingerprint;
  function read() {
    if (!encryption.isEncryptionAvailable()) throw Error('secure_storage_unavailable');
    try {
      if (!fs.existsSync(file)) { if (state?.revision) throw Error(); return state = { version: 1, revision: 0, accounts: [] }; }
      if (fs.statSync(file).size > 256 * 1024) throw Error();
      const bytes = fs.readFileSync(file), hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (state && fingerprint === hash) return state;
      const parsed = JSON.parse(encryption.decryptString(bytes));
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || parsed.revision < 0 || !Array.isArray(parsed.accounts) || parsed.accounts.length > 10) throw Error();
      for (const a of parsed.accounts) { normalizeAccount(a); if (typeof a.id !== 'string') throw Error(); }
      if (new Set(parsed.accounts.map(a => a.id)).size !== parsed.accounts.length || new Set(parsed.accounts.map(a => a.email)).size !== parsed.accounts.length) throw Error();
      parsed.accounts = parsed.accounts.map(a => ({ id: a.id, ...normalizeAccount(a) }));
      fingerprint = hash;
      return state = parsed;
    } catch { throw Error('vault_unreadable'); }
  }
  function snapshot() {
    try { const s = read(); return { ok: true, revision: s.revision, accounts: s.accounts.map(({ secret, ...a }) => a) }; }
    catch (e) { return fail(e.message); }
  }
  function write(accounts, revision) {
    const s = read();
    if (s.revision !== revision) return fail('conflict');
    if (!encryption.isEncryptionAvailable()) return fail('secure_storage_unavailable');
    const next = { version: 1, revision: s.revision + 1, accounts };
    const temp = file + '.' + uid() + '.tmp';
    try {
      const encrypted = encryption.encryptString(JSON.stringify(next));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temp, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file); state = next; fingerprint = crypto.createHash('sha256').update(encrypted).digest('hex'); return snapshot();
    } catch { try { fs.unlinkSync(temp); } catch {} return fail('save_failed'); }
  }
  return { snapshot, account: id => read().accounts.find(a => a.id === id),
    save(input, revision) {
      const s = read();
      if (s.revision !== revision) return fail('conflict');
      const a = normalizeAccount(input), old = s.accounts.find(a => a.id === input.id);
      if (input.id && !old) return fail('not_found');
      if (s.accounts.some(v => v.email === a.email && v.id !== old?.id)) return fail('duplicate_account');
      if (!old && s.accounts.length >= 10) return fail('account_limit');
      return write([...s.accounts.filter(v => v.id !== old?.id), { ...a, id: old?.id || uid() }], revision);
    },
    remove(id, revision) { if (!read().accounts.some(a => a.id === id)) return fail('not_found'); return write(read().accounts.filter(a => a.id !== id), revision); },
  };
}

function createMailService({ file, encryption, makeClient = options => new (require('imapflow').ImapFlow)(options), timeoutMs = 30000 }) {
  const store = createMailStore(file, encryption), caches = new Map(), jobs = new Map();
  let disposed = false;
  function snapshot() {
    const s = store.snapshot();
    return { ...s, providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, hint: p.hint })),
      accounts: (s.accounts || []).map(a => ({ ...a, busy: jobs.has(a.id), ...(caches.get(a.id) || { items: [], refreshedAt: null, error: '' }) })) };
  }
  async function withClient(key, account, work) {
    if (disposed) return fail('cancelled');
    if (jobs.has(key)) return fail('busy');
    let client, timer, rejectAbort;
    const job = { cancel() { rejectAbort?.(Error('cancelled')); try { client?.close(); } catch {} } };
    jobs.set(key, job);
    try {
      client = makeClient(clientOptions(account));
      client.on('error', () => {}); // Errors are sanitized below, never logged with credentials/server text.
      const aborted = new Promise((_, reject) => { rejectAbort = reject; });
      timer = setTimeout(() => { rejectAbort(Error('timeout')); try { client.close(); } catch {} }, timeoutMs);
      const result = await Promise.race([ (async () => {
        await client.connect();
        if (jobs.get(key) !== job || disposed) throw Error('cancelled');
        await client.mailboxOpen('INBOX', { readOnly: true });
        return work(client);
      })(), aborted ]);
      return { ok: true, ...result };
    } catch (e) { return fail(errorCode(e)); }
    finally { clearTimeout(timer); try { client?.close(); } catch {} if (jobs.get(key) === job) jobs.delete(key); }
  }
  async function save(input) {
    if (input?.confirmed !== true) return fail('confirmation_required');
    const s = store.snapshot(); if (!s.ok) return s;
    if (input.revision !== s.revision) return fail('conflict');
    let a;
    try { a = normalizeAccount(input); } catch (e) { return fail(e.message); }
    if (input.id && !s.accounts.some(v => v.id === input.id)) return fail('not_found');
    if (s.accounts.some(v => v.email === a.email && v.id !== input.id)) return fail('duplicate_account');
    if (!input.id && s.accounts.length >= 10) return fail('account_limit');
    const r = await withClient('setup', a, async () => ({}));
    if (!r.ok) return r;
    try {
      const saved = store.save({ ...a, id: input.id }, input.revision);
      if (saved.ok && input.id) { jobs.get(input.id)?.cancel(); caches.delete(input.id); }
      return saved.ok ? snapshot() : saved;
    } catch (e) { return fail(e.message); }
  }
  async function refresh(id) {
    let a; try { a = store.account(id); } catch (e) { return fail(e.message); }
    if (!a) return fail('not_found');
    const r = await withClient(id, a, async client => {
      const count = client.mailbox.exists, validity = String(client.mailbox.uidValidity);
      const found = count ? await client.search({ seen: false, seq: `${Math.max(1, count - 4999)}:*` }, { uid: true }) : [];
      const uids = (found || []).slice(-50).reverse(), items = [];
      if (uids.length) for await (const m of client.fetch(uids, { envelope: true, internalDate: true, bodyStructure: true }, { uid: true })) {
        const env = m.envelope || {}, from = (env.from || []).slice(0, 4).map(v => cut(v.name || v.address, 150)).join('、');
        const date = new Date(m.internalDate || env.date || 0).getTime();
        items.push({ id: `${id}:${validity}:${m.uid}`, uid: m.uid, validity, subject: cut(env.subject, 500) || '（无主题）', from: from || '（未知发件人）', date: Number.isFinite(date) ? date : 0, part: plainPart(m.bodyStructure) });
      }
      return { items: items.sort((a, b) => b.uid - a.uid), scanned: Math.min(count, 5000), matched: (found || []).length, refreshedAt: Date.now(), error: '' };
    });
    try { const current = store.account(id); if (!current || current.email !== a.email || current.secret !== a.secret || disposed) return fail('cancelled'); }
    catch (e) { return fail(e.message); }
    if (r.error !== 'busy' && r.error !== 'cancelled') caches.set(id, r.ok ? r : { ...(caches.get(id) || { items: [], refreshedAt: null }), error: r.error });
    return r.ok ? snapshot() : r;
  }
  async function read(accountId, messageId) {
    let a; try { a = store.account(accountId); } catch (e) { return fail(e.message); }
    const m = caches.get(accountId)?.items.find(m => m.id === messageId);
    if (!a || !m) return fail('stale_message');
    if (!m.part) return { ok: true, text: '', htmlOnly: true };
    return withClient(accountId, a, async client => {
      if (String(client.mailbox.uidValidity) !== m.validity) throw Error('stale_message');
      const message = await client.download(m.uid, m.part.part, { uid: true, maxBytes: MAX_BODY_BYTES, chunkSize: 16384 });
      if (!message?.content) throw Error('not_found');
      const buffers = []; let size = 0;
      for await (const chunk of message.content) { const b = Buffer.from(chunk); size += b.length; if (size > MAX_BODY_BYTES * 4) { message.content.destroy(); break; } buffers.push(b); }
      return { text: cut(Buffer.concat(buffers).toString('utf8'), 30000), truncated: m.part.size >= MAX_BODY_BYTES || size >= 30000 };
    });
  }
  function remove(input) {
    if (!input?.confirmed) return fail('confirmation_required');
    try { const r = store.remove(input.id, input.revision); if (r.ok) { jobs.get(input.id)?.cancel(); caches.delete(input.id); } return r.ok ? snapshot() : r; }
    catch (e) { return fail(e.message); }
  }
  return { snapshot, save, refresh, read, remove,
    cancel() { for (const job of jobs.values()) job.cancel(); return { ok: true }; },
    url(provider, help) { return Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider][help ? 'help' : 'web'] : undefined; },
    dispose() { disposed = true; for (const job of jobs.values()) job.cancel(); caches.clear(); },
  };
}

function createMailRuntime(options) {
  const { ipcMain, safeStorage, shell } = require('electron');
  const service = createMailService({ ...options, encryption: safeStorage });
  for (const [action, fn] of Object.entries({ get: () => service.snapshot(), save: p => service.save(p), refresh: p => service.refresh(p?.id), read: p => service.read(p?.accountId, p?.messageId), remove: p => service.remove(p), cancel: () => service.cancel(), open: async p => {
    const url = service.url(p?.provider, p?.help === true); if (!url) return fail('invalid_account'); await shell.openExternal(url); return { ok: true };
  } })) ipcMain.handle('mail:' + action, async (event, payload) => {
    if (!options.allowed(event)) return fail('forbidden');
    try { return await fn(payload); } catch { return fail('operation_failed'); }
  });
  return service;
}

module.exports = { PROVIDERS, normalizeAccount, clientOptions, plainPart, createMailStore, createMailService, createMailRuntime };
