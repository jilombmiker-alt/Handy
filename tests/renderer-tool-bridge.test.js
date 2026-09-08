const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  normalizeToolResult,
  RendererToolBridge,
} = require('../ai/renderer-tool-bridge');

test('renderer tool bridge accepts only bounded successful results', () => {
  assert.deepEqual(normalizeToolResult({ ok: true, recordId: 'todo-1', summary: '已保存' }), {
    ok: true,
    recordId: 'todo-1',
    summary: '已保存',
  });
  assert.equal(normalizeToolResult({ ok: false, recordId: 'todo-1' }), null);
  assert.equal(normalizeToolResult({ ok: true, recordId: '' }), null);
});

test('renderer tool bridge sends a whitelisted request and accepts only the trusted panel response', async () => {
  const ipcMain = new EventEmitter();
  const sent = [];
  const webContents = {
    isDestroyed: () => false,
    send: (channel, payload) => {
      sent.push({ channel, payload });
      process.nextTick(() => {
        ipcMain.emit('ai:tool-result', { sender: 'notification-window' }, {
          requestId: payload.requestId,
          result: { ok: true, recordId: 'spoofed' },
        });
        ipcMain.emit('ai:tool-result', { sender: 'panel-window' }, {
          requestId: payload.requestId,
          result: { ok: true, recordId: 'todo-1', summary: '发布检查' },
        });
      });
    },
  };
  const bridge = new RendererToolBridge({
    ipcMain,
    getWebContents: () => webContents,
    isTrustedSender: (event) => event.sender === 'panel-window',
    idFactory: () => 'request-1',
  });
  const result = await bridge.execute('create_todo', { title: '发布检查' }, {
    runId: 'run-1',
    idempotencyKey: 'run-1:fingerprint',
  });
  assert.deepEqual(result, { ok: true, recordId: 'todo-1', summary: '发布检查' });
  assert.equal(sent[0].channel, 'ai:tool-request');
  assert.deepEqual(sent[0].payload.fields, { title: '发布检查' });
  assert.equal(sent[0].payload.context.idempotencyKey, 'run-1:fingerprint');
  bridge.dispose();
});

test('renderer tool bridge fails closed for unknown tools and missing idempotency', async () => {
  const ipcMain = new EventEmitter();
  const bridge = new RendererToolBridge({
    ipcMain,
    getWebContents: () => ({ isDestroyed: () => false, send: () => {} }),
    isTrustedSender: () => true,
  });
  await assert.rejects(() => bridge.execute('open_application', {}, { idempotencyKey: 'key' }), /tool_not_allowed/);
  await assert.rejects(() => bridge.execute('save_note', { content: 'x' }, {}), /idempotency_key_required/);
  bridge.dispose();
});
