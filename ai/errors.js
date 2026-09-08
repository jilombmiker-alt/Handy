class AiCoreError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = 'AiCoreError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.status = Number.isFinite(options.status) ? options.status : 0;
    if (options.cause) this.cause = options.cause;
  }
}

function normalizeAiError(error) {
  if (error instanceof AiCoreError) return error;
  const status = Number(error && (error.status || error.statusCode || error.response && error.response.status)) || 0;
  const code = String(error && error.code || '').toUpperCase();
  const name = String(error && error.name || '');

  if (name === 'AbortError' || code === 'ABORT_ERR' || code === 'AI_CANCELLED') {
    return new AiCoreError('ai_cancelled', '请求已取消', { cause: error });
  }
  if (code === 'AI_TIMEOUT' || code === 'ETIMEDOUT') {
    return new AiCoreError('ai_timeout', '模型响应超时', { retryable: true, cause: error });
  }
  if (status === 401 || status === 403) {
    return new AiCoreError('ai_auth_failed', '模型密钥无效或无权限', { status, cause: error });
  }
  if (status === 429) {
    return new AiCoreError('ai_rate_limited', '模型请求过于频繁', { retryable: true, status, cause: error });
  }
  if (status >= 500) {
    return new AiCoreError('ai_provider_unavailable', '模型服务暂时不可用', { retryable: true, status, cause: error });
  }
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)) {
    return new AiCoreError('ai_network_failed', '网络连接失败', { retryable: true, cause: error });
  }
  return new AiCoreError('ai_unknown_error', 'AI 请求失败', { retryable: false, status, cause: error });
}

module.exports = { AiCoreError, normalizeAiError };
