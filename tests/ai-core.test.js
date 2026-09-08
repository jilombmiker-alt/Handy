const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { AiCoreError, normalizeAiError } = require('../ai/errors');
const { normalizeProposal, parseProposalResponse, isPublicHttpUrl } = require('../ai/proposal-schema');
const { createRun, transitionRun } = require('../ai/run-state');
const { PromptRegistry } = require('../ai/prompt-registry');
const { createModelAdapter } = require('../ai/model-adapter');
const { authorizeTool, proposalFingerprint } = require('../ai/permission-policy');
const { ToolRegistry } = require('../ai/tool-registry');
const { AiRunStore } = require('../ai/run-store');
const { AiService } = require('../ai/service');

const routerEvaluationCases = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../docs/evals/ai-router-20.json'),
  'utf8'
));

const todoProposal = {
  version: 1,
  target: 'todo',
  confidence: 0.92,
  needsUserEdit: false,
  fields: {
    title: '交方案',
    dueAt: '2026-09-01T15:00:00+08:00',
    category: 'Vibe coding',
  },
  explanation: '包含明确动作和时间',
};

function temporaryStore(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-panel-ai-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new AiRunStore({ filePath: path.join(directory, 'ai-runs.json'), ...options });
}

test('proposal schema normalizes a valid todo and preserves an explicit timezone instant', () => {
  const result = normalizeProposal(todoProposal);
  assert.equal(result.ok, true);
  assert.equal(result.value.fields.title, '交方案');
  assert.equal(result.value.fields.dueAt, '2026-09-01T07:00:00.000Z');
});

test('proposal schema safely canonicalizes compatible version strings only', () => {
  for (const version of ['1', '1.0']) {
    const result = normalizeProposal({ ...todoProposal, version });
    assert.equal(result.ok, true);
    assert.equal(result.value.version, 1);
  }
  assert.deepEqual(normalizeProposal({ ...todoProposal, version: '2.0' }).details, ['invalid_version']);
  assert.deepEqual(normalizeProposal({ ...todoProposal, version: 1.1 }).details, ['invalid_version']);
});

test('proposal schema rejects unknown fields and safely downgrades incomplete todos and private links', () => {
  assert.deepEqual(normalizeProposal({ ...todoProposal, surprise: true }).details, ['unknown_key:surprise']);
  const incompleteTodo = normalizeProposal({
    ...todoProposal,
    fields: { title: '时间不确定' },
  });
  assert.equal(incompleteTodo.ok, true);
  assert.equal(incompleteTodo.value.target, 'todo');
  assert.equal(incompleteTodo.value.needsUserEdit, true);
  assert.equal(incompleteTodo.value.fields.dueAt, undefined);
  assert.equal(isPublicHttpUrl('http://127.0.0.1/private'), false);
  assert.equal(isPublicHttpUrl('https://example.com/docs'), true);
  const privateLink = normalizeProposal({
    version: 1,
    target: 'link',
    confidence: 1,
    needsUserEdit: false,
    fields: { url: 'http://192.168.1.2/admin' },
    explanation: '',
  });
  assert.equal(privateLink.ok, true);
  assert.equal(privateLink.value.target, 'unknown');
  assert.equal(privateLink.value.needsUserEdit, true);
  assert.deepEqual(privateLink.value.fields, {});
});

test('proposal parser accepts fenced JSON but unknown proposals always require editing', () => {
  const note = parseProposalResponse('```json\n{"version":1,"target":"note","confidence":0.8,"needsUserEdit":false,"fields":{"title":"会议","content":"客户关心交付周期"},"explanation":"知识记录"}\n```');
  assert.equal(note.ok, true);
  assert.equal(note.value.fields.content, '客户关心交付周期');
  const unknown = normalizeProposal({
    version: 1,
    target: 'unknown',
    confidence: 0.2,
    needsUserEdit: false,
    fields: {},
    explanation: '信息不足',
  });
  assert.deepEqual(unknown.details, ['unknown_requires_edit']);
});

test('run state allows only the declared forward transitions', () => {
  const idle = createRun({ text: '明天交方案' }, { id: 'run-1', now: 10 });
  const submitting = transitionRun(idle, 'submitting', {}, 20);
  const running = transitionRun(submitting, 'running', {}, 30);
  assert.equal(running.updatedAt, 30);
  assert.throws(() => transitionRun(running, 'succeeded'), /invalid_run_transition/);
  assert.equal(transitionRun(running, 'waiting_user').status, 'waiting_user');
});

test('AI errors expose stable user-facing codes without provider response bodies', () => {
  assert.equal(normalizeAiError({ status: 401, message: 'secret provider body' }).code, 'ai_auth_failed');
  assert.equal(normalizeAiError({ status: 429 }).retryable, true);
  assert.equal(normalizeAiError({ code: 'ENETUNREACH' }).code, 'ai_network_failed');
  assert.equal(normalizeAiError(new AiCoreError('custom', 'safe')).code, 'custom');
});

test('prompt registry requires explicit versions and renders bounded user input', () => {
  const registry = new PromptRegistry();
  const prompt = registry.render(' 保存会议笔记 ');
  assert.equal(prompt.name, 'voice-inbox-router');
  assert.equal(prompt.version, '1.1.0');
  assert.equal(prompt.user, '保存会议笔记');
  assert.match(prompt.system, /格式示例：\{"version":1/);
  assert.match(prompt.system, /公开 http\/https 地址/);
  assert.throws(() => registry.get('voice-inbox-router', '9.9.9'), /prompt_not_found/);
});

test('real router evaluation fixture stays fixed, unique, and acceptance-ready', () => {
  assert.equal(routerEvaluationCases.length, 20);
  assert.equal(new Set(routerEvaluationCases.map((item) => item.id)).size, 20);
  assert.equal(routerEvaluationCases.every((item) => typeof item.input === 'string' && item.input.trim()), true);
  assert.equal(routerEvaluationCases.every((item) => ['todo', 'note', 'link', 'unknown'].includes(item.expectedTarget)), true);
  assert.deepEqual(
    Object.fromEntries(['todo', 'note', 'link', 'unknown'].map((target) => [
      target,
      routerEvaluationCases.filter((item) => item.expectedTarget === target).length,
    ])),
    { todo: 7, note: 5, link: 4, unknown: 4 }
  );
});

test('model adapter parses a mock provider response and records its actual model', async () => {
  const adapter = createModelAdapter({
    model: 'fallback-model',
    request: async () => ({ content: `\`\`\`json\n${JSON.stringify(todoProposal)}\n\`\`\``, model: 'mock-router-v1' }),
  });
  const result = await adapter.generateProposal({ input: '明天下午三点交方案', prompt: {} });
  assert.equal(result.proposal.target, 'todo');
  assert.equal(result.model, 'mock-router-v1');
});

test('model adapter turns malformed output and timeouts into stable retryable errors', async () => {
  const malformed = createModelAdapter({ request: async () => 'not json' });
  await assert.rejects(() => malformed.generateProposal({}), (error) => {
    assert.equal(error.code, 'ai_invalid_response');
    return true;
  });

  // 即使供应商 SDK 完全忽略 AbortSignal，也必须由适配层自己的计时器结束请求。
  const timeout = createModelAdapter({ timeoutMs: 5, request: () => new Promise(() => {}) });
  await assert.rejects(() => timeout.generateProposal({}), (error) => {
    assert.equal(error.code, 'ai_timeout');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('model adapter does not call a provider when the request was already cancelled', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const adapter = createModelAdapter({ request: async () => { calls += 1; return todoProposal; } });
  await assert.rejects(() => adapter.generateProposal({ signal: controller.signal }), (error) => error.code === 'ai_cancelled');
  assert.equal(calls, 0);
});

test('run store writes atomically, returns clones, and limits history', (t) => {
  let timestamp = 100;
  const store = temporaryStore(t, { maxRuns: 2, now: () => timestamp += 1 });
  for (const id of ['one', 'two', 'three']) {
    store.upsert(createRun({ text: id }, { id, now: timestamp }));
  }
  assert.deepEqual(store.list().map((run) => run.id), ['three', 'two']);
  const read = store.get('three');
  read.source.text = 'mutated outside';
  assert.equal(store.get('three').source.text, 'three');
  assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(path.dirname(store.filePath)).some((name) => name.endsWith('.tmp')), false);
});

test('run store backs up corrupt data instead of silently overwriting the only copy', (t) => {
  const store = temporaryStore(t, { now: () => 1234 });
  fs.writeFileSync(store.filePath, '{broken json', { mode: 0o600 });
  assert.deepEqual(store.list(), []);
  const names = fs.readdirSync(path.dirname(store.filePath));
  assert.equal(names.includes('ai-runs.json.corrupt-1234'), true);
  assert.equal(JSON.parse(fs.readFileSync(store.filePath, 'utf8')).schemaVersion, 1);
});

test('run store treats structurally invalid runs as corrupt data', (t) => {
  const store = temporaryStore(t, { now: () => 5678 });
  fs.writeFileSync(store.filePath, JSON.stringify({ schemaVersion: 1, runs: [{ id: 'missing-state' }] }), { mode: 0o600 });
  assert.deepEqual(store.list(), []);
  assert.equal(fs.existsSync(`${store.filePath}.corrupt-5678`), true);
});

test('permission policy requires confirmation, matching tool, and a stable idempotency key', () => {
  const run = transitionRun(
    transitionRun(transitionRun(createRun({ text: '交方案' }, { id: 'r1', now: 1 }), 'submitting', {}, 2), 'running', {}, 3),
    'waiting_user',
    { proposal: todoProposal },
    4
  );
  assert.equal(authorizeTool({ run, proposal: todoProposal, confirmed: false, toolName: 'create_todo' }).error, 'confirmation_required');
  assert.equal(authorizeTool({ run, proposal: todoProposal, confirmed: true, toolName: 'save_note' }).error, 'tool_target_mismatch');
  const allowed = authorizeTool({ run, proposal: todoProposal, confirmed: true, toolName: 'create_todo' });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.idempotencyKey, `r1:${proposalFingerprint(todoProposal)}`);
});

test('tool registry exposes only the three local write tools', async () => {
  assert.throws(() => new ToolRegistry({ delete_everything: async () => ({ ok: true }) }), /tool_not_allowed/);
  const tools = new ToolRegistry({ save_note: async (fields) => ({ ok: true, recordId: 'n1', summary: fields.title }) });
  assert.deepEqual(await tools.execute('save_note', { title: '会议' }), { ok: true, recordId: 'n1', summary: '会议' });
  await assert.rejects(() => tools.execute('create_todo', {}), /tool_not_registered/);
});

test('AI service creates an editable proposal and confirms it exactly once', async (t) => {
  const store = temporaryStore(t);
  let executions = 0;
  const tools = new ToolRegistry({
    create_todo: async (fields, context) => {
      executions += 1;
      assert.match(context.idempotencyKey, /^service-run:/);
      await new Promise((resolve) => setImmediate(resolve));
      return { ok: true, recordId: 'todo-1', summary: fields.title };
    },
  });
  const logs = [];
  const events = [];
  const service = new AiService({
    adapter: { model: 'mock', generateProposal: async () => ({ proposal: normalizeProposal(todoProposal).value, model: 'mock-v1' }) },
    runStore: store,
    toolRegistry: tools,
    idFactory: () => 'service-run',
    logger: (entry) => logs.push(entry),
    onRunChanged: (entry) => events.push(entry.status),
  });
  const waiting = await service.createProposal({ text: '明天下午三点交方案', sourceType: 'voice_transcript' });
  assert.equal(waiting.status, 'waiting_user');
  assert.equal(waiting.source.type, 'voice_transcript');
  const [first, second] = await Promise.all([
    service.confirmProposal(waiting.id, null, true),
    service.confirmProposal(waiting.id, null, true),
  ]);
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(second, first);
  assert.equal(executions, 1);
  assert.equal(store.get(waiting.id).toolCall.result.recordId, 'todo-1');
  assert.equal(logs.some((entry) => Object.hasOwn(entry, 'text')), false);
  assert.deepEqual(events, ['submitting', 'running', 'waiting_user', 'executing', 'succeeded']);
});

test('AI service never executes a write without confirmation', async (t) => {
  const store = temporaryStore(t);
  let executions = 0;
  const service = new AiService({
    adapter: { model: 'mock', generateProposal: async () => ({ proposal: normalizeProposal(todoProposal).value }) },
    runStore: store,
    toolRegistry: new ToolRegistry({ create_todo: async () => { executions += 1; return { ok: true, recordId: 'bad' }; } }),
    idFactory: () => 'unconfirmed-run',
  });
  const waiting = await service.createProposal({ text: '明天下午三点交方案' });
  await assert.rejects(() => service.confirmProposal(waiting.id, null, false), (error) => error.code === 'confirmation_required');
  assert.equal(executions, 0);
  assert.equal(store.get(waiting.id).status, 'waiting_user');
});

test('AI service preserves the original input and retry flag when the provider fails', async (t) => {
  const store = temporaryStore(t);
  const service = new AiService({
    adapter: { model: 'mock', generateProposal: async () => { throw new AiCoreError('ai_rate_limited', '请求过多', { retryable: true }); } },
    runStore: store,
    toolRegistry: new ToolRegistry(),
    idFactory: () => 'failed-run',
  });
  const failed = await service.createProposal({ text: '不要丢掉这段输入' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.source.text, '不要丢掉这段输入');
  assert.equal(failed.errorCode, 'ai_rate_limited');
  assert.equal(failed.retryable, true);
});

test('AI service is not broken by an observability sink failure', async (t) => {
  const store = temporaryStore(t);
  const service = new AiService({
    adapter: { model: 'mock', generateProposal: async () => ({ proposal: normalizeProposal(todoProposal).value }) },
    runStore: store,
    toolRegistry: new ToolRegistry(),
    idFactory: () => 'logger-run',
    logger: () => { throw new Error('logging unavailable'); },
  });
  const result = await service.createProposal({ text: '日志挂了也要保留结果' });
  assert.equal(result.status, 'waiting_user');
});

test('AI service cancellation aborts an active mock request and persists cancellation', async (t) => {
  const store = temporaryStore(t);
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const service = new AiService({
    adapter: createModelAdapter({ request: ({ signal }) => new Promise((resolve, reject) => {
      started();
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
    }) }),
    runStore: store,
    toolRegistry: new ToolRegistry(),
    idFactory: () => 'cancelled-run',
  });
  const resultPromise = service.createProposal({ text: '取消这次请求' });
  await ready;
  assert.equal(service.cancelRun('cancelled-run'), true);
  assert.equal(store.get('cancelled-run').status, 'cancelled');
  const result = await resultPromise;
  assert.equal(result.status, 'cancelled');
  assert.equal(store.get(result.id).errorCode, 'ai_cancelled');
});

test('AI service recovers interrupted work but keeps waiting proposals intact', (t) => {
  const store = temporaryStore(t);
  const idle = createRun({ text: '运行中' }, { id: 'running', now: 1 });
  const running = transitionRun(transitionRun(idle, 'submitting', {}, 2), 'running', {}, 3);
  const waiting = transitionRun(running, 'waiting_user', { proposal: todoProposal }, 4);
  store.upsert(running);
  store.upsert({ ...waiting, id: 'waiting' });
  const service = new AiService({
    adapter: { generateProposal: async () => ({ proposal: todoProposal }) },
    runStore: store,
    toolRegistry: new ToolRegistry(),
  });
  const recovered = service.recoverInterruptedRuns();
  assert.equal(recovered.length, 1);
  assert.equal(store.get('running').status, 'failed');
  assert.equal(store.get('running').errorCode, 'app_restarted');
  assert.equal(store.get('waiting').status, 'waiting_user');
});
