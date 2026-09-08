const { AiCoreError } = require('./errors');

const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;

function completionEndpoint(baseUrl) {
  const source = String(baseUrl || '').trim().replace(/\/$/, '');
  return source.endsWith('/chat/completions') ? source : `${source}/chat/completions`;
}

async function readProviderText(response, maxBytes = MAX_PROVIDER_RESPONSE_BYTES) {
  if (response && response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch (error) {}
        throw new AiCoreError('ai_invalid_response', '模型响应过大', { retryable: true });
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw) > maxBytes) {
    throw new AiCoreError('ai_invalid_response', '模型响应过大', { retryable: true });
  }
  return raw;
}

function createOpenAiCompatibleRequest(options = {}) {
  if (typeof options.getConfig !== 'function') throw new TypeError('get_config_required');
  if (typeof options.validateEndpoint !== 'function') throw new TypeError('validate_endpoint_required');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch_required');

  return async function requestProposal(payload = {}) {
    const config = options.getConfig() || {};
    const apiKey = String(config.apiKey || '').trim();
    const model = String(config.model || '').trim().slice(0, 120);
    if (!apiKey || !model) throw new AiCoreError('ai_not_configured', '请先配置 AI 模型密钥');
    const endpoint = completionEndpoint(config.baseUrl);
    const safeEndpoint = await options.validateEndpoint(endpoint);
    if (!safeEndpoint) throw new AiCoreError('ai_invalid_endpoint', '模型地址无效');

    const response = await fetchImpl(safeEndpoint, {
      method: 'POST',
      redirect: 'error',
      signal: payload.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TO-DO-Panel/1.0 (+local-ai-inbox)',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: Math.max(200, Math.min(Math.min(8000,Number(options.maxTokensCeiling)||2400), Number(options.maxTokens) || 600)),
        response_format: { type: 'json_object' },
        ...(String(config.baseUrl || '').includes('deepseek.com') ? { thinking: { type: 'disabled' } } : {}),
        messages: [
          { role: 'system', content: String(payload.prompt && payload.prompt.system || '') },
          {
            role: 'user',
            content: `${String(payload.prompt && payload.prompt.user || payload.input || '')}\n\n当前本机时间：${new Date().toString()}`,
          },
        ],
      }),
    });
    if (!response || !response.ok) {
      try { await response?.body?.cancel?.(); } catch (cancelError) {}
      const error = new Error('provider_request_failed');
      error.status = Number(response && response.status) || 0;
      throw error;
    }
    const raw = await readProviderText(response);
    let result;
    try { result = JSON.parse(raw); } catch (error) {
      throw new AiCoreError('ai_invalid_response', '模型响应不是 JSON', { retryable: true, cause: error });
    }
    const content = result && result.choices && result.choices[0]
      && result.choices[0].message && result.choices[0].message.content;
    if(result?.choices?.[0]?.finish_reason==='length')throw new AiCoreError('ai_invalid_response','模型输出被截断，未采用结果');
    if (typeof content !== 'string' && (!content || typeof content !== 'object')) {
      throw new AiCoreError('ai_invalid_response', '模型响应缺少建议内容', { retryable: true });
    }
    return { content, model: String(result.model || model).slice(0, 120) };
  };
}

module.exports = { MAX_PROVIDER_RESPONSE_BYTES, completionEndpoint, readProviderText, createOpenAiCompatibleRequest };
