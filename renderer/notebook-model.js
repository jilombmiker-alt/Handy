(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.NotebookModel = model;
})(typeof window === 'undefined' ? globalThis : window, () => {
  'use strict';
  const text = (value, max = 16000) => String(value ?? '').replace(/\u0000/g, '').slice(0, max);
  const uid = () => globalThis.crypto?.randomUUID?.() || `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function meeting(value = {}) {
    return {
      stage: ['prep', 'live', 'review'].includes(value.stage) ? value.stage : 'prep',
      mode: value.mode === 'free' ? 'free' : 'topics',
      objective: text(value.objective, 2000), background: text(value.background),
      freeText: text(value.freeText, 60000), confirmedAt: Number(value.confirmedAt) || 0,
      topics: (Array.isArray(value.topics) ? value.topics : []).slice(0, 40).map((t) => ({
        id: text(t.id || uid(), 100), title: text(t.title, 300), focus: text(t.focus, 2000),
        notes: text(t.notes, 12000), status: ['decided', 'pending', 'skipped'].includes(t.status) ? t.status : 'unchecked',
      })),
      tasks: (Array.isArray(value.tasks) ? value.tasks : []).slice(0, 60).map((t) => ({
        id: text(t.id || uid(), 100), text: text(t.text, 2000), owner: text(t.owner, 200), due: text(t.due, 200),
      })),
      noTasks: value.noTasks === true,
      materials: (Array.isArray(value.materials) ? value.materials : []).slice(0,5).map((f) => ({ name:text(f.name,200),text:text(f.text,24000) })),
      referenceIds: (Array.isArray(value.referenceIds) ? value.referenceIds : []).slice(0,20).map((id) => text(id,180)),
      questions: text(value.questions, 4000),
    };
  }
  function reviewErrors(value) {
    const m = meeting(value), errors = [];
    if (!m.topics.length && !m.freeText.trim()) errors.push('请先留下议题或自由记录。');
    m.topics.forEach((t, i) => {
      if (t.status === 'unchecked') errors.push(`议题 ${i + 1} 还未核对。`);
      if (t.status === 'decided' && !t.notes.trim()) errors.push(`议题 ${i + 1} 请补充结论。`);
    });
    m.tasks.forEach((t, i) => { if (!t.text.trim() || !t.owner.trim()) errors.push(`任务 ${i + 1} 请填写事项与负责人。`); });
    if (!m.tasks.length && !m.noTasks) errors.push('请添加后续事项，或确认本次没有后续任务。');
    return errors;
  }
  function toText(value) {
    const m = meeting(value);
    return [`会议目标：${m.objective}`, m.background && `背景：${m.background}`,
      ...m.topics.map((t, i) => `${i + 1}. ${t.title}\n讨论重点：${t.focus}\n${t.notes}\n状态：${({ unchecked: '待核对', decided: '有结论', pending: '待定', skipped: '未讨论' })[t.status]}`),
      m.freeText && `自由记录\n${m.freeText}`, m.questions && `待确认\n${m.questions}`,
      ...m.tasks.map((t) => `后续事项：${t.text}｜${t.owner}｜${t.due}`)].filter(Boolean).join('\n\n');
  }
  function proposal(value) {
    if (typeof value === 'string') value = JSON.parse(value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (!value || typeof value !== 'object' || !Array.isArray(value.topics) || !value.topics.length || value.topics.length > 8) throw Error('invalid_response');
    if (typeof value.objective !== 'string' || !value.objective.trim()) throw Error('invalid_response');
    if (value.topics.some((t) => !t || typeof t.title !== 'string' || !t.title.trim() || typeof t.focus !== 'string')) throw Error('invalid_response');
    return { objective: text(value.objective, 1000), topics: value.topics.map((t) => ({ title: text(t.title, 300), focus: text(t.focus, 1500) })),
      questions: Array.isArray(value.questions) ? value.questions.map((q) => text(q, 500)).slice(0, 8).join('\n') : text(value.questions, 4000) };
  }
  function version(note) {
    const raw = JSON.stringify(note); let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
    return `${note.updatedAt || 0}:${hash >>> 0}`;
  }
  return { text, uid, meeting, reviewErrors, toText, proposal, version };
});
