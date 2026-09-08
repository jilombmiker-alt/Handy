const DEFAULT_PROMPT = {
  name: 'voice-inbox-router',
  version: '1.1.0',
  system: [
    '你是 TO-DO Panel 的本机收件箱路由器。',
    '只判断输入适合成为 todo、note、link 或 unknown，不执行任何操作。',
    '返回严格 JSON，字段为 version、target、confidence、needsUserEdit、fields、explanation。version 必须是 JSON 数字 1，不能是字符串或 1.0。',
    '格式示例：{"version":1,"target":"note","confidence":0.9,"needsUserEdit":false,"fields":{"title":"会议结论","content":"客户关注交付周期"},"explanation":"属于知识记录"}',
    'todo 的 fields 只允许 title、dueAt、category；dueAt 必须含时区。',
    'note 的 fields 只允许 title、content；link 的 fields 只允许 title、url、category，url 必须是公开 http/https 地址。',
    'todo 没有明确日期或时间时必须省略 dueAt 并设置 needsUserEdit=true；本机、内网或缺失 URL 必须返回 unknown。',
    'unknown 的 fields 必须是空对象，且 needsUserEdit 必须为 true。禁止输出任何额外字段。',
    '日期不确定、转写含糊或信息不足时必须 needsUserEdit=true。',
  ].join('\n'),
};

class PromptRegistry {
  constructor(entries = [DEFAULT_PROMPT]) {
    this.entries = new Map();
    for (const entry of entries) this.register(entry);
  }

  register(entry) {
    if (!entry || typeof entry !== 'object') throw new TypeError('invalid_prompt');
    const name = String(entry.name || '').trim();
    const version = String(entry.version || '').trim();
    const system = String(entry.system || '').trim();
    if (!name || !version || !system) throw new TypeError('invalid_prompt');
    this.entries.set(`${name}@${version}`, { name, version, system });
  }

  get(name = DEFAULT_PROMPT.name, version = DEFAULT_PROMPT.version) {
    const entry = this.entries.get(`${name}@${version}`);
    if (!entry) throw new TypeError('prompt_not_found');
    return { ...entry };
  }

  render(input, name, version) {
    const prompt = this.get(name, version);
    return { ...prompt, user: String(input || '').trim().slice(0, 8000) };
  }
}

module.exports = { DEFAULT_PROMPT, PromptRegistry };
