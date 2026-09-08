const crypto = require('crypto');
const { AiCoreError, normalizeAiError } = require('./errors');
const { normalizeProposal } = require('./proposal-schema');
const { createRun, transitionRun } = require('./run-state');
const { DEFAULT_PROMPT, PromptRegistry } = require('./prompt-registry');
const { TARGET_TO_TOOL, authorizeTool } = require('./permission-policy');

class AiService {
  constructor(options = {}) {
    if (!options.adapter || typeof options.adapter.generateProposal !== 'function') throw new TypeError('adapter_required');
    if (!options.runStore || typeof options.runStore.upsert !== 'function') throw new TypeError('run_store_required');
    if (!options.toolRegistry || typeof options.toolRegistry.execute !== 'function') throw new TypeError('tool_registry_required');
    this.adapter = options.adapter;
    this.runStore = options.runStore;
    this.toolRegistry = options.toolRegistry;
    this.promptRegistry = options.promptRegistry || new PromptRegistry();
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => crypto.randomUUID();
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    this.onRunChanged = typeof options.onRunChanged === 'function' ? options.onRunChanged : () => {};
    this.controllers = new Map();
    this.confirmations = new Map();
  }

  save(run) {
    this.runStore.upsert(run);
    try {
      this.logger({ runId: run.id, status: run.status, errorCode: run.errorCode || '', durationMs: run.durationMs || 0 });
    } catch (error) {}
    try { this.onRunChanged(run); } catch (error) {}
    return run;
  }

  getRun(runId) {
    return this.runStore.get(String(runId || ''));
  }

  listRuns(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.runStore.list().slice(0, safeLimit);
  }

  async createProposal(input) {
    let run = createRun(input, { id: this.idFactory(), now: this.now() });
    run = this.save(transitionRun(run, 'submitting', {}, this.now()));
    const prompt = this.promptRegistry.render(run.source.text, DEFAULT_PROMPT.name, DEFAULT_PROMPT.version);
    run = this.save(transitionRun(run, 'running', {
      promptName: prompt.name,
      promptVersion: prompt.version,
      model: this.adapter.model || '',
    }, this.now()));
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const startedAt = this.now();
    try {
      const result = await this.adapter.generateProposal({ input: run.source.text, prompt, signal: controller.signal });
      run = transitionRun(run, 'waiting_user', {
        proposal: result.proposal,
        model: result.model || run.model,
        durationMs: Math.max(0, this.now() - startedAt),
      }, this.now());
      return this.save(run);
    } catch (error) {
      const normalized = normalizeAiError(error);
      run = transitionRun(run, normalized.code === 'ai_cancelled' ? 'cancelled' : 'failed', {
        durationMs: Math.max(0, this.now() - startedAt),
        errorCode: normalized.code,
        errorMessage: normalized.message,
        retryable: normalized.retryable,
      }, this.now());
      return this.save(run);
    } finally {
      this.controllers.delete(run.id);
    }
  }

  cancelRun(runId) {
    const id = String(runId || '');
    const controller = this.controllers.get(id);
    if (controller) controller.abort();
    const run = this.runStore.get(id);
    if (!run || !['submitting', 'running', 'waiting_user'].includes(run.status)) return false;
    this.save(transitionRun(run, 'cancelled', { errorCode: 'ai_cancelled', errorMessage: '请求已取消' }, this.now()));
    return true;
  }

  async confirmProposal(runId, editedProposal, confirmed = false) {
    const id = String(runId || '');
    if (this.confirmations.has(id)) return this.confirmations.get(id);
    const operation = this.performConfirmation(id, editedProposal, confirmed)
      .finally(() => this.confirmations.delete(id));
    this.confirmations.set(id, operation);
    return operation;
  }

  async performConfirmation(runId, editedProposal, confirmed) {
    let run = this.runStore.get(runId);
    if (!run) throw new AiCoreError('run_not_found', '找不到这次 AI 运行');
    if (run.status === 'succeeded') return run;
    const parsed = normalizeProposal(editedProposal || run.proposal);
    if (!parsed.ok) throw new AiCoreError('invalid_proposal', '建议内容格式无效');
    const toolName = TARGET_TO_TOOL[parsed.value.target] || '';
    const permission = authorizeTool({ run, proposal: parsed.value, confirmed, toolName });
    if (!permission.ok) throw new AiCoreError(permission.error, '当前操作未获允许');
    if (!this.toolRegistry.has(toolName)) throw new AiCoreError('tool_not_registered', '目标工具尚未接入');

    run = this.save(transitionRun(run, 'executing', {
      proposal: parsed.value,
      toolCall: { name: toolName, idempotencyKey: permission.idempotencyKey, status: 'running' },
      errorCode: '',
      errorMessage: '',
      retryable: false,
    }, this.now()));
    try {
      const result = await this.toolRegistry.execute(toolName, parsed.value.fields, {
        runId: run.id,
        idempotencyKey: permission.idempotencyKey,
      });
      run = transitionRun(run, 'succeeded', {
        toolCall: { ...run.toolCall, status: 'succeeded', result },
      }, this.now());
      return this.save(run);
    } catch (error) {
      run = transitionRun(run, 'failed', {
        toolCall: { ...run.toolCall, status: 'failed' },
        errorCode: 'tool_execution_failed',
        errorMessage: '写入本机数据失败',
        retryable: true,
      }, this.now());
      return this.save(run);
    }
  }

  recoverInterruptedRuns() {
    const recovered = [];
    for (const run of this.runStore.list()) {
      if (!['submitting', 'running', 'executing'].includes(run.status)) continue;
      const failed = transitionRun(run, 'failed', {
        errorCode: 'app_restarted',
        errorMessage: '应用重启导致本次运行中断，可重新提交',
        retryable: true,
        toolCall: run.toolCall ? { ...run.toolCall, status: 'interrupted' } : null,
      }, this.now());
      this.save(failed);
      recovered.push(failed);
    }
    return recovered;
  }

  cancelAll() {
    const activeIds = [...this.controllers.keys()];
    for (const id of activeIds) this.cancelRun(id);
    return activeIds.length;
  }
}

module.exports = { AiService };
