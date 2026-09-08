const { AiCoreError, normalizeAiError } = require('./errors');
const { parseProposalResponse } = require('./proposal-schema');

function createModelAdapter(options = {}) {
  if (typeof options.request !== 'function') throw new TypeError('model_request_required');
  const timeoutMs = Math.max(1, Math.min(120000, Number(options.timeoutMs) || 12000));
  const model = String(options.model || 'unconfigured');

  return {
    model,
    async generateProposal(payload = {}) {
      if (payload.signal && payload.signal.aborted) {
        throw new AiCoreError('ai_cancelled', '请求已取消');
      }
      const controller = new AbortController();
      let timedOut = false;
      let rejectExternalAbort;
      const externalAbort = new Promise((resolve, reject) => { rejectExternalAbort = reject; });
      const onExternalAbort = () => {
        controller.abort();
        rejectExternalAbort(new AiCoreError('ai_cancelled', '请求已取消'));
      };
      if (payload.signal) payload.signal.addEventListener('abort', onExternalAbort, { once: true });
      let cancelTimeout = () => {};
      const timeout = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new AiCoreError('ai_timeout', '模型响应超时', { retryable: true }));
        }, timeoutMs);
        cancelTimeout = () => clearTimeout(timeoutId);
      });
      try {
        const request = Promise.resolve().then(() => options.request({
          input: payload.input,
          prompt: payload.prompt,
          signal: controller.signal,
        }));
        const response = await Promise.race([request, timeout, externalAbort]);
        const parsed = parseProposalResponse(response && Object.prototype.hasOwnProperty.call(response, 'content')
          ? response.content
          : response);
        if (!parsed.ok) {
          throw new AiCoreError('ai_invalid_response', '模型返回的建议格式无效', { retryable: true });
        }
        return { proposal: parsed.value, model: String(response && response.model || model) };
      } catch (error) {
        if (timedOut) throw new AiCoreError('ai_timeout', '模型响应超时', { retryable: true, cause: error });
        throw normalizeAiError(error);
      } finally {
        cancelTimeout();
        if (payload.signal) payload.signal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

module.exports = { createModelAdapter };
