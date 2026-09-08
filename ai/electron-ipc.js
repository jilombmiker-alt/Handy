const { AiCoreError } = require('./errors');
const { normalizeProposal } = require('./proposal-schema');

const RUN_ID_PATTERN = /^[A-Za-z0-9:_-]{1,180}$/;

function validRunId(value) {
  const id = String(value || '').trim();
  return RUN_ID_PATTERN.test(id) ? id : '';
}

function normalizeCreateInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (typeof payload.text !== 'string') return null;
  const text = payload.text.replace(/\u0000/g, '').trim();
  if (!text || text.length > 8000) return null;
  return {
    text,
    sourceType: payload.sourceType === 'voice_transcript' ? 'voice_transcript' : 'text',
  };
}

function publicRun(run) {
  if (!run || typeof run !== 'object') return null;
  const parsedProposal = run.proposal ? normalizeProposal(run.proposal) : null;
  const result = run.toolCall && run.toolCall.result;
  const toolCall = run.toolCall && typeof run.toolCall === 'object' ? {
    name: String(run.toolCall.name || '').slice(0, 80),
    idempotencyKey: String(run.toolCall.idempotencyKey || '').slice(0, 260),
    status: String(run.toolCall.status || '').slice(0, 40),
    result: result && typeof result === 'object' ? {
      ok: result.ok === true,
      recordId: String(result.recordId || '').slice(0, 180),
      summary: String(result.summary || '').slice(0, 240),
    } : null,
  } : null;
  return {
    id: String(run.id || ''),
    createdAt: Number(run.createdAt) || 0,
    updatedAt: Number(run.updatedAt) || 0,
    source: {
      type: run.source && run.source.type === 'voice_transcript' ? 'voice_transcript' : 'text',
      text: String(run.source && run.source.text || '').slice(0, 8000),
    },
    status: String(run.status || ''),
    model: String(run.model || '').slice(0, 120),
    promptName: String(run.promptName || '').slice(0, 120),
    promptVersion: String(run.promptVersion || '').slice(0, 40),
    proposal: parsedProposal && parsedProposal.ok ? parsedProposal.value : null,
    toolCall,
    durationMs: Math.max(0, Number(run.durationMs) || 0),
    errorCode: String(run.errorCode || '').slice(0, 120),
    errorMessage: String(run.errorMessage || '').slice(0, 240),
    retryable: run.retryable === true,
  };
}

function safeError(error) {
  if (error instanceof AiCoreError) {
    return { ok: false, error: error.code, message: error.message, retryable: error.retryable === true };
  }
  return { ok: false, error: 'ai_ipc_failed', message: 'AI 操作失败', retryable: false };
}

function registerAiIpc(options = {}) {
  const ipcMain = options.ipcMain;
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipc_main_required');
  if (typeof options.getService !== 'function') throw new TypeError('get_service_required');
  const isTrustedSender = typeof options.isTrustedSender === 'function' ? options.isTrustedSender : () => false;
  const channels = [];
  const handle = (channel, handler) => {
    channels.push(channel);
    ipcMain.handle(channel, async (event, payload) => {
      if (!isTrustedSender(event)) return { ok: false, error: 'forbidden' };
      try { return await handler(options.getService(), payload); } catch (error) { return safeError(error); }
    });
  };

  handle('ai:create-proposal', async (service, payload) => {
    const input = normalizeCreateInput(payload);
    if (!input) return { ok: false, error: 'invalid_input' };
    return { ok: true, run: publicRun(await service.createProposal(input)) };
  });
  handle('ai:cancel-run', (service, payload) => {
    const runId = validRunId(payload && payload.runId);
    if (!runId) return { ok: false, error: 'invalid_run_id' };
    const cancelled = service.cancelRun(runId);
    return cancelled
      ? { ok: true, run: publicRun(service.getRun(runId)) }
      : { ok: false, error: 'run_not_cancellable' };
  });
  handle('ai:get-run', (service, payload) => {
    const runId = validRunId(payload && payload.runId);
    if (!runId) return { ok: false, error: 'invalid_run_id' };
    const run = service.getRun(runId);
    return run ? { ok: true, run: publicRun(run) } : { ok: false, error: 'run_not_found' };
  });
  handle('ai:list-runs', (service, payload) => {
    const limit = Math.max(1, Math.min(50, Number(payload && payload.limit) || 20));
    return { ok: true, runs: service.listRuns(limit).map(publicRun).filter(Boolean) };
  });
  handle('ai:confirm-proposal', async (service, payload) => {
    const runId = validRunId(payload && payload.runId);
    if (!runId) return { ok: false, error: 'invalid_run_id' };
    if (!payload || payload.confirmed !== true) return { ok: false, error: 'confirmation_required' };
    if (payload.proposal != null && (typeof payload.proposal !== 'object' || Array.isArray(payload.proposal))) {
      return { ok: false, error: 'invalid_proposal' };
    }
    const run = await service.confirmProposal(runId, payload.proposal || null, true);
    return { ok: true, run: publicRun(run) };
  });

  return () => {
    if (typeof ipcMain.removeHandler === 'function') channels.forEach((channel) => ipcMain.removeHandler(channel));
  };
}

module.exports = { RUN_ID_PATTERN, validRunId, normalizeCreateInput, publicRun, safeError, registerAiIpc };
