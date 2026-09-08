const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { AiCoreError } = require('../ai/errors');
const { completionEndpoint, readProviderText, createOpenAiCompatibleRequest } = require('../ai/openai-compatible-provider');
const { normalizeCreateInput, publicRun, registerAiIpc } = require('../ai/electron-ipc');

const proposal = {
  version: 1,
  target: 'note',
  confidence: 0.9,
  needsUserEdit: false,
  fields: { title: '会议结论', content: '客户更关心交付周期' },
  explanation: '属于知识记录',
};

function run(overrides = {}) {
  return {
    id: 'run-1',
    createdAt: 1,
    updatedAt: 2,
    source: { type: 'text', text: '保存会议结论' },
    status: 'waiting_user',
    model: 'mock-v1',
    promptName: 'voice-inbox-router',
    promptVersion: '1.0.0',
    proposal,
    toolCall: null,
    durationMs: 20,
    errorCode: '',
    errorMessage: '',
    retryable: false,
    providerRawBody: 'must never reach renderer',
    apiKey: 'must never reach renderer',
    ...overrides,
  };
}

class FakeIpcMain {
  constructor() { this.handlers = new Map(); }
  handle(channel, handler) { this.handlers.set(channel, handler); }
  removeHandler(channel) { this.handlers.delete(channel); }
  invoke(channel, event, payload) { return this.handlers.get(channel)(event, payload); }
}

test('OpenAI-compatible endpoint keeps an existing completion path', () => {
  assert.equal(completionEndpoint('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.equal(completionEndpoint('https://api.example.com/chat/completions'), 'https://api.example.com/chat/completions');
});

test('provider refuses missing credentials before endpoint lookup or network access', async () => {
  let validations = 0;
  let requests = 0;
  const request = createOpenAiCompatibleRequest({
    getConfig: () => ({ baseUrl: 'https://api.example.com', model: 'router', apiKey: '' }),
    validateEndpoint: async () => { validations += 1; return new URL('https://api.example.com/chat/completions'); },
    fetchImpl: async () => { requests += 1; return null; },
  });
  await assert.rejects(() => request({}), (error) => error.code === 'ai_not_configured');
  assert.equal(validations, 0);
  assert.equal(requests, 0);
});

test('provider sends a bounded prompt and returns only model content metadata', async () => {
  let requestOptions;
  const request = createOpenAiCompatibleRequest({
    getConfig: () => ({ baseUrl: 'https://api.example.com/v1', model: 'router-v1', apiKey: 'test-only-key' }),
    validateEndpoint: async (value) => new URL(value),
    fetchImpl: async (url, options) => {
      requestOptions = { url: String(url), ...options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ model: 'router-v1.1', choices: [{ message: { content: JSON.stringify(proposal) } }] }),
      };
    },
  });
  const result = await request({ input: '会议结论', prompt: { system: '只返回 JSON', user: '保存会议结论' } });
  assert.equal(result.model, 'router-v1.1');
  assert.equal(JSON.parse(result.content).target, 'note');
  assert.equal(requestOptions.url, 'https://api.example.com/v1/chat/completions');
  const body = JSON.parse(requestOptions.body);
  assert.equal(body.messages[0].content, '只返回 JSON');
  assert.match(body.messages[1].content, /^保存会议结论/);
  assert.equal(body.max_tokens, 600);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(requestOptions.headers.Authorization, 'Bearer test-only-key');
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
});

test('provider rejects unsafe endpoints and oversized responses', async () => {
  const unsafe = createOpenAiCompatibleRequest({
    getConfig: () => ({ baseUrl: 'http://127.0.0.1', model: 'router', apiKey: 'key' }),
    validateEndpoint: async () => null,
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  await assert.rejects(() => unsafe({}), (error) => error.code === 'ai_invalid_endpoint');

  const oversized = createOpenAiCompatibleRequest({
    getConfig: () => ({ baseUrl: 'https://api.example.com', model: 'router', apiKey: 'key' }),
    validateEndpoint: async (value) => value,
    fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(256 * 1024 + 1) }),
  });
  await assert.rejects(() => oversized({}), (error) => error.code === 'ai_invalid_response');
});

test('provider stops streaming as soon as the response exceeds its byte limit', async () => {
  let cancelled = false;
  const chunks = [Buffer.from('1234'), Buffer.from('5678')];
  const response = {
    body: {
      getReader: () => ({
        read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true },
        cancel: async () => { cancelled = true; },
      }),
    },
  };
  await assert.rejects(() => readProviderText(response, 6), (error) => error.code === 'ai_invalid_response');
  assert.equal(cancelled, true);
});

test('provider preserves only HTTP status for later error normalization', async () => {
  const request = createOpenAiCompatibleRequest({
    getConfig: () => ({ baseUrl: 'https://api.example.com', model: 'router', apiKey: 'key' }),
    validateEndpoint: async (value) => value,
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'provider secret body' }),
  });
  await assert.rejects(() => request({}), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.message, 'provider_request_failed');
    return true;
  });
});

test('IPC input normalization rejects empty, oversized, and non-string values', () => {
  assert.equal(normalizeCreateInput({ text: '' }), null);
  assert.equal(normalizeCreateInput({ text: 42 }), null);
  assert.equal(normalizeCreateInput({ text: 'x'.repeat(8001) }), null);
  assert.deepEqual(normalizeCreateInput({ text: '  记录结论  ', sourceType: 'voice_transcript' }), {
    text: '记录结论',
    sourceType: 'voice_transcript',
  });
});

test('public IPC run whitelists fields and strips provider data and unexpected tool output', () => {
  const value = publicRun(run({
    toolCall: {
      name: 'save_note',
      idempotencyKey: 'run-1:hash',
      status: 'succeeded',
      result: { ok: true, recordId: 'note-1', summary: '会议结论', secret: 'hidden' },
      providerTrace: 'hidden',
    },
  }));
  assert.equal(value.apiKey, undefined);
  assert.equal(value.providerRawBody, undefined);
  assert.equal(value.toolCall.providerTrace, undefined);
  assert.equal(value.toolCall.result.secret, undefined);
  assert.equal(value.toolCall.result.recordId, 'note-1');
});

test('AI IPC rejects untrusted senders without constructing the service', async () => {
  const ipcMain = new FakeIpcMain();
  let serviceReads = 0;
  registerAiIpc({
    ipcMain,
    getService: () => { serviceReads += 1; return {}; },
    isTrustedSender: () => false,
  });
  const response = await ipcMain.invoke('ai:list-runs', { sender: 'notification' }, {});
  assert.deepEqual(response, { ok: false, error: 'forbidden' });
  assert.equal(serviceReads, 0);
});

test('AI IPC exposes create, list, get, cancel, and confirmed execution through bounded responses', async () => {
  const ipcMain = new FakeIpcMain();
  const stored = run();
  const service = {
    createProposal: async (input) => run({ source: { type: input.sourceType, text: input.text } }),
    cancelRun: () => true,
    getRun: () => stored,
    listRuns: () => [stored],
    confirmProposal: async (id, edited, confirmed) => {
      assert.equal(id, 'run-1');
      assert.equal(confirmed, true);
      return run({ status: 'succeeded', proposal: edited || proposal });
    },
  };
  const dispose = registerAiIpc({ ipcMain, getService: () => service, isTrustedSender: (event) => event.sender === 'main' });
  assert.equal((await ipcMain.invoke('ai:create-proposal', { sender: 'main' }, { text: '保存结论' })).run.status, 'waiting_user');
  assert.equal((await ipcMain.invoke('ai:list-runs', { sender: 'main' }, { limit: 999 })).runs.length, 1);
  assert.equal((await ipcMain.invoke('ai:get-run', { sender: 'main' }, { runId: 'run-1' })).run.id, 'run-1');
  assert.equal((await ipcMain.invoke('ai:cancel-run', { sender: 'main' }, { runId: 'run-1' })).ok, true);
  assert.equal((await ipcMain.invoke('ai:confirm-proposal', { sender: 'main' }, {
    runId: 'run-1', confirmed: true, proposal,
  })).run.status, 'succeeded');
  assert.equal((await ipcMain.invoke('ai:confirm-proposal', { sender: 'main' }, { runId: 'run-1' })).error, 'confirmation_required');
  dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test('AI IPC maps known core errors without leaking arbitrary exception messages', async () => {
  const ipcMain = new FakeIpcMain();
  registerAiIpc({
    ipcMain,
    isTrustedSender: () => true,
    getService: () => ({
      getRun: () => { throw new Error('database path and secret details'); },
      createProposal: async () => { throw new AiCoreError('ai_not_configured', '请先配置 AI 模型密钥'); },
    }),
  });
  const known = await ipcMain.invoke('ai:create-proposal', {}, { text: '记录' });
  assert.deepEqual(known, { ok: false, error: 'ai_not_configured', message: '请先配置 AI 模型密钥', retryable: false });
  const unknown = await ipcMain.invoke('ai:get-run', {}, { runId: 'run-1' });
  assert.deepEqual(unknown, { ok: false, error: 'ai_ipc_failed', message: 'AI 操作失败', retryable: false });
});

test('main process and preload expose only the explicit AI bridge to the trusted panel window', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(mainSource, /new AiRunStore\(\{ filePath: workspacePath\(AI_RUNS_FILE\) \}\)/);
  assert.match(mainSource, /event\.sender === mainWindow\.webContents/);
  assert.match(mainSource, /create_todo: \(fields, context\) => aiToolBridge\.execute\('create_todo'/);
  assert.match(mainSource, /save_note: \(fields, context\) => aiToolBridge\.execute\('save_note'/);
  assert.match(mainSource, /save_link: \(fields, context\) => aiToolBridge\.execute\('save_link'/);
  assert.match(mainSource, /service\.recoverInterruptedRuns\(\)/);
  for (const method of [
    'aiCreateProposal',
    'aiCancelRun',
    'aiGetRun',
    'aiListRuns',
    'aiConfirmProposal',
    'onAiRunChanged',
    'onAiToolRequest',
    'completeAiToolRequest',
  ]) {
    assert.match(preloadSource, new RegExp(`${method}:`), method);
  }
  assert.doesNotMatch(preloadSource, /require\(['"]\.\/ai\//);
});
