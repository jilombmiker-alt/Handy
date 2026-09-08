const RUN_STATUSES = new Set([
  'idle',
  'submitting',
  'running',
  'waiting_user',
  'executing',
  'succeeded',
  'failed',
  'cancelled',
]);

const TRANSITIONS = {
  idle: new Set(['submitting']),
  submitting: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['waiting_user', 'failed', 'cancelled']),
  waiting_user: new Set(['executing', 'failed', 'cancelled']),
  executing: new Set(['succeeded', 'failed']),
  succeeded: new Set([]),
  failed: new Set([]),
  cancelled: new Set([]),
};

function createRun(input, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const text = String(input && input.text || '').replace(/\u0000/g, '').trim().slice(0, 8000);
  const sourceType = input && input.sourceType === 'voice_transcript' ? 'voice_transcript' : 'text';
  if (!text) throw new TypeError('ai_input_required');
  const id = String(options.id || '').trim();
  if (!id) throw new TypeError('ai_run_id_required');
  return {
    id,
    createdAt: now,
    updatedAt: now,
    source: { type: sourceType, text },
    status: 'idle',
    model: '',
    promptName: '',
    promptVersion: '',
    proposal: null,
    toolCall: null,
    durationMs: 0,
    errorCode: '',
    errorMessage: '',
    retryable: false,
  };
}

function transitionRun(run, nextStatus, patch = {}, now = Date.now()) {
  if (!run || typeof run !== 'object' || !RUN_STATUSES.has(run.status)) throw new TypeError('invalid_run');
  if (!RUN_STATUSES.has(nextStatus) || !TRANSITIONS[run.status].has(nextStatus)) {
    throw new TypeError(`invalid_run_transition:${run.status}:${nextStatus}`);
  }
  return { ...run, ...patch, id: run.id, createdAt: run.createdAt, status: nextStatus, updatedAt: now };
}

function isTerminalStatus(status) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

module.exports = { RUN_STATUSES, TRANSITIONS, createRun, transitionRun, isTerminalStatus };
