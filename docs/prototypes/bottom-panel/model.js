(function (root) {
  'use strict';
  const tools = [
    ['note', '随手记', '想到就写'], ['todo', '待办', '安排与进展'],
    ['record', '录音', '口述一个想法'], ['clip', '剪贴板', '找回并复用'],
    ['links', '链接', '收好灵感来源'], ['timer', '计时', '留一段专注时间'],
    ['music', '音乐', '随手控制播放'], ['packs', '资料包', '取用常用文字']
  ].map(([id, name, hint], i) => ({ id, name, hint, key: String(i + 1) }));
  function createState() {
    return {
      mode: 'launcher', tool: null, opened: true, draft: '', notes: [],
      todoDraft: '', todos: [
        { id: 1, text: '梳理今天最重要的一件事', done: false },
        { id: 2, text: '留 30 分钟阅读与学习', done: false },
        { id: 3, text: '整理昨天的随手记录', done: true }
      ],
      record: { running: false, elapsed: 0, started: 0, marks: [], finished: false },
      timer: { mode: 'down', minutes: 30, running: false, elapsed: 0, started: 0, history: [] },
      clipQuery: '', reused: '', linkDraft: '', links: [
        { title: '界面设计参考', url: 'https://example.com/design', group: '设计灵感' },
        { title: '下次想读的文章', url: 'https://example.com/read', group: '稍后阅读' }
      ],
      packDraft: '', track: 0, playing: false
    };
  }
  function elapsed(session, now) { return session.elapsed + (session.running ? Math.max(0, now - session.started) : 0); }
  function pause(session, now) { session.elapsed = elapsed(session, now); session.running = false; }
  function start(session, now) { if (!session.running) { session.started = now; session.running = true; } }
  function shortcut(event, editing) {
    if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return null;
    if (event.key === 'Escape') return 'hide';
    if (editing || event.shiftKey) return null;
    if (event.key === ' ') return 'toggle';
    return tools.find(t => t.key === event.key)?.id || null;
  }
  function saveNote(state) {
    const text = state.draft.trim(); if (!text) return false;
    state.notes.unshift(text); state.draft = ''; return true;
  }
  function addTodo(state) {
    const text = state.todoDraft.trim(); if (!text) return false;
    state.todos.unshift({ id: Math.max(0, ...state.todos.map(t => t.id)) + 1, text, done: false });
    state.todoDraft = ''; return true;
  }
  const api = { tools, createState, elapsed, pause, start, shortcut, saveNote, addTodo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PanelPreviewModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
