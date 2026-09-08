class ToolRegistry {
  constructor(entries = {}) {
    this.tools = new Map();
    for (const [name, handler] of Object.entries(entries)) this.register(name, handler);
  }

  register(name, handler) {
    const normalizedName = String(name || '').trim();
    if (!['create_todo', 'save_note', 'save_link'].includes(normalizedName)) throw new TypeError('tool_not_allowed');
    if (typeof handler !== 'function') throw new TypeError('tool_handler_required');
    this.tools.set(normalizedName, handler);
  }

  has(name) {
    return this.tools.has(name);
  }

  async execute(name, fields, context = {}) {
    const handler = this.tools.get(name);
    if (!handler) throw new TypeError('tool_not_registered');
    const result = await handler({ ...fields }, { ...context });
    if (!result || result.ok !== true || !String(result.recordId || '').trim()) throw new TypeError('tool_execution_failed');
    return { ok: true, recordId: String(result.recordId), summary: String(result.summary || '').slice(0, 240) };
  }
}

module.exports = { ToolRegistry };
