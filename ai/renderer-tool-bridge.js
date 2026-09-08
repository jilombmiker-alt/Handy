const crypto = require('crypto');

const ALLOWED_TOOLS = new Set(['create_todo', 'save_note', 'save_link']);
const REQUEST_CHANNEL = 'ai:tool-request';
const RESULT_CHANNEL = 'ai:tool-result';

function boundedText(value, maxLength) {
  return Array.from(String(value || '').replace(/\u0000/g, '').trim()).slice(0, maxLength).join('');
}

function normalizeToolResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.ok !== true) return null;
  const recordId = boundedText(value.recordId, 180);
  if (!recordId) return null;
  return {
    ok: true,
    recordId,
    summary: boundedText(value.summary, 240),
  };
}

class RendererToolBridge {
  constructor(options = {}) {
    if (!options.ipcMain || typeof options.ipcMain.on !== 'function') throw new TypeError('ipc_main_required');
    if (typeof options.getWebContents !== 'function') throw new TypeError('get_web_contents_required');
    this.ipcMain = options.ipcMain;
    this.getWebContents = options.getWebContents;
    this.isTrustedSender = typeof options.isTrustedSender === 'function' ? options.isTrustedSender : () => false;
    this.timeoutMs = Math.max(500, Math.min(30_000, Number(options.timeoutMs) || 6000));
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => crypto.randomUUID();
    this.pending = new Map();
    this.onResult = this.onResult.bind(this);
    this.ipcMain.on(RESULT_CHANNEL, this.onResult);
  }

  onResult(event, payload) {
    if (!this.isTrustedSender(event) || !payload || typeof payload !== 'object') return;
    const requestId = boundedText(payload.requestId, 180);
    const operation = this.pending.get(requestId);
    if (!operation) return;
    this.pending.delete(requestId);
    clearTimeout(operation.timer);
    const result = normalizeToolResult(payload.result);
    if (result) operation.resolve(result);
    else operation.reject(new TypeError('renderer_tool_failed'));
  }

  execute(toolName, fields, context = {}) {
    const name = boundedText(toolName, 80);
    if (!ALLOWED_TOOLS.has(name)) return Promise.reject(new TypeError('tool_not_allowed'));
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return Promise.reject(new TypeError('invalid_tool_fields'));
    }
    const serialized = JSON.stringify(fields);
    if (Buffer.byteLength(serialized) > 32 * 1024) return Promise.reject(new TypeError('tool_fields_too_large'));
    const webContents = this.getWebContents();
    if (!webContents || webContents.isDestroyed?.() || typeof webContents.send !== 'function') {
      return Promise.reject(new TypeError('renderer_unavailable'));
    }
    const requestId = boundedText(this.idFactory(), 180);
    if (!requestId || this.pending.has(requestId)) return Promise.reject(new TypeError('invalid_request_id'));
    const idempotencyKey = boundedText(context.idempotencyKey, 260);
    if (!idempotencyKey) return Promise.reject(new TypeError('idempotency_key_required'));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new TypeError('renderer_tool_timeout'));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        webContents.send(REQUEST_CHANNEL, {
          requestId,
          toolName: name,
          fields: JSON.parse(serialized),
          context: {
            runId: boundedText(context.runId, 180),
            idempotencyKey,
          },
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new TypeError('renderer_unavailable'));
      }
    });
  }

  dispose() {
    this.ipcMain.removeListener?.(RESULT_CHANNEL, this.onResult);
    for (const operation of this.pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new TypeError('renderer_tool_bridge_disposed'));
    }
    this.pending.clear();
  }
}

module.exports = {
  ALLOWED_TOOLS,
  REQUEST_CHANNEL,
  RESULT_CHANNEL,
  normalizeToolResult,
  RendererToolBridge,
};
