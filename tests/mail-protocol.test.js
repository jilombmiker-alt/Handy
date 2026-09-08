'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const net = require('node:net'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ImapFlow } = require('imapflow');
const { createMailService } = require('../main-mail');

test('real ImapFlow against loopback fixture uses EXAMINE and BODY.PEEK, decodes Chinese, never writes mail', { timeout: 10000 }, async t => {
  const commands = [], sockets = new Set();
  const body = '中文测试正文，只读。', header = 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n';
  const structure = `("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "8BIT" ${Buffer.byteLength(body)} 1)`;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR ID] Synthetic mail fixture\r\n');
    let pending = '';
    socket.on('data', bytes => {
      pending += bytes.toString();
      while (pending.includes('\r\n')) {
        const index = pending.indexOf('\r\n'), line = pending.slice(0, index); pending = pending.slice(index + 2);
        const tag = line.split(' ')[0], command = line.slice(tag.length + 1); commands.push(command.replace(/AUTHENTICATE.*/, 'AUTHENTICATE [fixture]'));
        const done = () => socket.write(`${tag} OK done\r\n`);
        if (/^CAPABILITY/.test(command)) { socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR ID\r\n'); done(); }
        else if (/^(AUTHENTICATE|LOGIN)/.test(command)) done();
        else if (/^ID /.test(command)) { socket.write('* ID NIL\r\n'); done(); }
        else if (/^LIST /.test(command)) { socket.write('* LIST (\\Inbox) "/" "INBOX"\r\n'); done(); }
        else if (/^EXAMINE /.test(command)) socket.write(`* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\n* OK [UIDNEXT 2] next\r\n${tag} OK [READ-ONLY] opened\r\n`);
        else if (/^UID SEARCH/.test(command)) { socket.write('* SEARCH 1\r\n'); done(); }
        else if (/^UID FETCH/.test(command)) {
          if (command.includes('BODY.PEEK[TEXT]')) {
            socket.write(`* 1 FETCH (UID 1 RFC822.SIZE 200 BODY[HEADER] {${Buffer.byteLength(header)}}\r\n${header} BODY[TEXT]<0> {${Buffer.byteLength(body)}}\r\n${body})\r\n`);
          } else {
            socket.write(`* 1 FETCH (UID 1 INTERNALDATE "07-Sep-2026 09:00:00 +0800" ENVELOPE ("Mon, 07 Sep 2026 09:00:00 +0800" "=?UTF-8?B?5Lit5paH5qCH6aKY?=" (("Test" NIL "test" "example.com")) NIL NIL NIL NIL NIL NIL "<fixture@example.com>") BODYSTRUCTURE ${structure})\r\n`);
          }
          done();
        } else if (/^LOGOUT/.test(command)) { socket.end(`* BYE done\r\n${tag} OK bye\r\n`); }
        else socket.write(`${tag} BAD unsupported synthetic command\r\n`);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mail-protocol-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createMailService({ file: path.join(dir, 'fixture.enc'), timeoutMs: 1500,
    encryption: { isEncryptionAvailable: () => true, encryptString: v => Buffer.from(v), decryptString: v => v.toString() },
    // Only this test replaces transport security with a local, synthetic protocol server.
    makeClient: options => new ImapFlow({ ...options, host: '127.0.0.1', port: server.address().port, secure: false, doSTARTTLS: false, tls: undefined }),
  }); t.after(() => service.dispose());
  const save = await service.save({ provider: 'qq', email: 'fixture@qq.com', secret: 'synthetic', revision: 0, confirmed: true });
  assert.equal(save.ok, true, JSON.stringify({ save, commands })); const id = save.accounts[0].id;
  const refresh = await service.refresh(id); assert.equal(refresh.ok, true, JSON.stringify({ refresh, commands }));
  assert.equal(refresh.accounts[0].items[0].subject, '中文标题');
  const read = await service.read(id, refresh.accounts[0].items[0].id); assert.equal(read.text, body, JSON.stringify({ read, commands }));
  assert.ok(commands.some(c => c.startsWith('EXAMINE '))); assert.ok(commands.some(c => c.includes('BODY.PEEK[TEXT]')));
  assert.equal(commands.some(c => /^(SELECT|APPEND|STORE|EXPUNGE|UID STORE|UID MOVE|UID COPY)/.test(c)), false);
});
