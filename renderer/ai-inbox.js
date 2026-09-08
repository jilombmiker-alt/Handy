(function initAiInbox() {
  const api = window.notchAPI;
  const RECEIPTS_KEY = 'notch-ai-tool-receipts-v1';
  const MAX_RECEIPTS = 200;
  const VALID_ID = /^[A-Za-z0-9:_-]{1,260}$/;
  const TARGET_LABELS = { todo: '待办', note: '笔记', link: '链接', unknown: '待确认' };

  const form = document.getElementById('ai-inbox-form');
  const input = document.getElementById('ai-inbox-input');
  const sourceType = document.getElementById('ai-source-type');
  const createButton = document.getElementById('ai-create-proposal');
  const cancelButton = document.getElementById('ai-cancel-run');
  const runStatus = document.getElementById('ai-run-status');
  const statusAction = document.getElementById('ai-status-action');
  const history = document.getElementById('ai-run-history');
  const refreshHistoryButton = document.getElementById('ai-refresh-history');
  const proposalForm = document.getElementById('ai-proposal-form');
  const proposalEmpty = document.getElementById('ai-proposal-empty');
  const proposalTarget = document.getElementById('ai-proposal-target');
  const proposalExplanation = document.getElementById('ai-proposal-explanation');
  const confidence = document.getElementById('ai-confidence');
  const confirmButton = document.getElementById('ai-confirm-proposal');
  const formError = document.getElementById('ai-form-error');
  const openSettingsButton = document.getElementById('ai-open-settings');
  const targetFields = Array.from(document.querySelectorAll('[data-ai-target-fields]'));
  const pendingReceipts = new Map();
  let activeRun = null;
  let recentRuns = [];

  const fields = {
    todoTitle: document.getElementById('ai-todo-title'),
    todoDue: document.getElementById('ai-todo-due'),
    todoCategory: document.getElementById('ai-todo-category'),
    noteTitle: document.getElementById('ai-note-title'),
    noteContent: document.getElementById('ai-note-content'),
    linkTitle: document.getElementById('ai-link-title'),
    linkUrl: document.getElementById('ai-link-url'),
    linkCategory: document.getElementById('ai-link-category'),
  };

  function readReceipts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveReceipt(key, result) {
    const receipts = readReceipts();
    receipts[key] = { ...result, savedAt: Date.now() };
    const entries = Object.entries(receipts)
      .sort((left, right) => Number(right[1]?.savedAt || 0) - Number(left[1]?.savedAt || 0))
      .slice(0, MAX_RECEIPTS);
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(Object.fromEntries(entries)));
  }

  function executeLocalTool(toolName, toolFields) {
    let record = null;
    if (toolName === 'create_todo') record = window.NotchDataTools?.saveTodo?.(toolFields);
    if (toolName === 'save_note') record = window.NotchDataTools?.saveNote?.(toolFields);
    if (toolName === 'save_link') record = window.NotchWorkspaceTools?.saveLink?.(toolFields);
    if (!record?.id) throw new Error('local_write_failed');
    const summary = toolName === 'create_todo'
      ? String(record.text || toolFields.title || '待办')
      : String(record.title || toolFields.title || (toolName === 'save_note' ? '笔记' : '链接'));
    return { ok: true, recordId: String(record.id), summary: summary.slice(0, 240) };
  }

  async function handleToolRequest(request) {
    const requestId = String(request?.requestId || '');
    const idempotencyKey = String(request?.context?.idempotencyKey || '');
    const toolName = String(request?.toolName || '');
    if (!VALID_ID.test(requestId) || !VALID_ID.test(idempotencyKey)) return;
    if (!['create_todo', 'save_note', 'save_link'].includes(toolName)) {
      api?.completeAiToolRequest?.(requestId, { ok: false });
      return;
    }
    const receipt = readReceipts()[idempotencyKey];
    if (receipt?.ok === true && receipt.recordId) {
      api?.completeAiToolRequest?.(requestId, receipt);
      return;
    }
    if (pendingReceipts.has(idempotencyKey)) {
      const result = await pendingReceipts.get(idempotencyKey).catch(() => ({ ok: false }));
      api?.completeAiToolRequest?.(requestId, result);
      return;
    }
    const operation = Promise.resolve().then(() => executeLocalTool(toolName, request.fields || {}));
    pendingReceipts.set(idempotencyKey, operation);
    try {
      const result = await operation;
      saveReceipt(idempotencyKey, result);
      api?.completeAiToolRequest?.(requestId, result);
    } catch (error) {
      api?.completeAiToolRequest?.(requestId, { ok: false });
    } finally {
      pendingReceipts.delete(idempotencyKey);
    }
  }

  api?.onAiToolRequest?.(handleToolRequest);
  window.NotchAiTools = Object.freeze({ executeLocalTool, handleToolRequest });

  function statusCopy(run) {
    if (!run) return '输入一段文字，AI 只会生成建议，不会直接改动你的数据。';
    if (run.status === 'submitting') return '正在准备本次整理…';
    if (run.status === 'running') return 'AI 正在判断它更适合成为待办、笔记还是链接…';
    if (run.status === 'waiting_user') return '建议已生成。请在右侧检查并修改，确认后才会写入。';
    if (run.status === 'executing') return `正在写入${TARGET_LABELS[run.proposal?.target] || '本机数据'}…`;
    if (run.status === 'succeeded') return `${TARGET_LABELS[run.proposal?.target] || '内容'}已写入：${run.toolCall?.result?.summary || '保存成功'}`;
    if (run.status === 'cancelled') return '本次整理已取消，原始输入仍保留。';
    const messages = {
      ai_not_configured: '还没有配置 AI 模型。配置 API 后即可生成建议。',
      ai_timeout: 'AI 响应超时，原始输入已保留，可以直接重试。',
      ai_rate_limited: '模型暂时繁忙，稍后可直接重试。',
      app_restarted: '应用重启中断了这次处理，原始输入已保留。',
      tool_execution_failed: '写入本机数据失败，没有确认成功。请检查后重新生成。',
    };
    return messages[run.errorCode] || run.errorMessage || '处理失败，原始输入已保留，可以重试。';
  }

  function setBusy(run) {
    const busy = ['submitting', 'running', 'executing'].includes(run?.status);
    if (createButton) createButton.disabled = busy;
    if (confirmButton) confirmButton.disabled = run?.status === 'executing';
    if (cancelButton) {
      cancelButton.hidden = !['submitting', 'running'].includes(run?.status);
      cancelButton.disabled = false;
    }
  }

  function localDateTime(iso) {
    const timestamp = Date.parse(String(iso || ''));
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  function showTargetFields(target) {
    targetFields.forEach((section) => { section.hidden = section.dataset.aiTargetFields !== target; });
    if (confirmButton) confirmButton.textContent = `确认并写入${TARGET_LABELS[target] || '内容'}`;
  }

  function fillProposal(run) {
    const proposal = run?.proposal;
    if (!proposal || run.status !== 'waiting_user') {
      if (proposalForm) proposalForm.hidden = true;
      if (proposalEmpty) proposalEmpty.hidden = false;
      if (confidence) confidence.hidden = true;
      return;
    }
    const target = ['todo', 'note', 'link'].includes(proposal.target) ? proposal.target : 'todo';
    proposalTarget.value = target;
    fields.todoTitle.value = proposal.target === 'todo' ? (proposal.fields.title || '') : (proposal.target === 'unknown' ? run.source.text.slice(0, 160) : '');
    fields.todoDue.value = proposal.target === 'todo' ? localDateTime(proposal.fields.dueAt) : '';
    fields.todoCategory.value = proposal.target === 'todo' ? (proposal.fields.category || '') : '';
    fields.noteTitle.value = proposal.target === 'note' ? (proposal.fields.title || '') : '';
    fields.noteContent.value = proposal.target === 'note' ? (proposal.fields.content || '') : (proposal.target === 'unknown' ? run.source.text : '');
    fields.linkTitle.value = proposal.target === 'link' ? (proposal.fields.title || '') : '';
    fields.linkUrl.value = proposal.target === 'link' ? (proposal.fields.url || '') : '';
    fields.linkCategory.value = proposal.target === 'link' ? (proposal.fields.category || '') : '';
    proposalExplanation.textContent = proposal.explanation || '请根据实际用途检查以下内容。';
    confidence.textContent = `置信度 ${Math.round(proposal.confidence * 100)}%`;
    confidence.hidden = false;
    proposalEmpty.hidden = true;
    proposalForm.hidden = false;
    formError.hidden = true;
    openSettingsButton.hidden = true;
    showTargetFields(target);
  }

  function configureStatusAction(run) {
    if (!statusAction) return;
    statusAction.hidden = true;
    statusAction.dataset.action = '';
    if (run?.status === 'failed' && run.errorCode === 'ai_not_configured') {
      statusAction.textContent = '配置 API';
      statusAction.dataset.action = 'settings';
      statusAction.hidden = false;
    } else if (run?.status === 'failed' && run.source?.text) {
      statusAction.textContent = '用原文重试';
      statusAction.dataset.action = 'retry';
      statusAction.hidden = false;
    } else if (run?.status === 'succeeded' && run.proposal?.target) {
      statusAction.textContent = `打开${TARGET_LABELS[run.proposal.target] || '目标页'}`;
      statusAction.dataset.action = 'open-target';
      statusAction.hidden = false;
    }
  }

  function renderRun(run) {
    activeRun = run || null;
    if (run?.source?.text && document.activeElement !== input) {
      input.value = run.source.text;
      sourceType.value = run.source.type === 'voice_transcript' ? 'voice_transcript' : 'text';
    }
    runStatus.textContent = statusCopy(run);
    runStatus.dataset.state = run?.status || 'idle';
    setBusy(run);
    fillProposal(run);
    configureStatusAction(run);
  }

  function historyLabel(run) {
    if (run.status === 'succeeded') return '已写入';
    if (run.status === 'waiting_user') return '待确认';
    if (run.status === 'failed') return '失败';
    if (run.status === 'cancelled') return '已取消';
    return '处理中';
  }

  function renderHistory() {
    if (!history) return;
    history.replaceChildren();
    if (!recentRuns.length) {
      const empty = document.createElement('span');
      empty.className = 'ai-history-empty';
      empty.textContent = '还没有处理记录';
      history.append(empty);
      return;
    }
    recentRuns.slice(0, 8).forEach((run) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.runId = run.id;
      button.className = run.id === activeRun?.id ? 'active' : '';
      const copy = document.createElement('span');
      copy.textContent = run.source?.text || '未命名内容';
      const state = document.createElement('small');
      state.textContent = historyLabel(run);
      state.dataset.state = run.status;
      button.append(copy, state);
      history.append(button);
    });
  }

  async function loadHistory() {
    if (!api?.aiListRuns) {
      runStatus.textContent = '当前版本没有可用的 AI 本机桥接。';
      return;
    }
    const result = await api.aiListRuns(20).catch(() => null);
    if (!result?.ok) return;
    recentRuns = result.runs || [];
    renderHistory();
  }

  function proposalFromForm() {
    const target = proposalTarget.value;
    const proposal = {
      version: 1,
      target,
      confidence: Number(activeRun?.proposal?.confidence) || 0,
      needsUserEdit: false,
      fields: {},
      explanation: activeRun?.proposal?.explanation || '用户已检查并编辑',
    };
    if (target === 'todo') {
      const title = fields.todoTitle.value.trim();
      if (!title) throw new Error('请填写待办标题');
      const due = fields.todoDue.value;
      if (!due) throw new Error('请为待办选择截止时间');
      proposal.fields = { title, dueAt: new Date(due).toISOString() };
      if (fields.todoCategory.value.trim()) proposal.fields.category = fields.todoCategory.value.trim();
    }
    if (target === 'note') {
      const content = fields.noteContent.value.trim();
      if (!content) throw new Error('请填写笔记正文');
      proposal.fields = { title: fields.noteTitle.value.trim(), content };
    }
    if (target === 'link') {
      const url = fields.linkUrl.value.trim();
      let parsed;
      try { parsed = new URL(url); } catch (error) { throw new Error('请填写有效的公开网址'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('链接只能使用 http 或 https');
      proposal.fields = { title: fields.linkTitle.value.trim(), url: parsed.toString() };
      if (fields.linkCategory.value.trim()) proposal.fields.category = fields.linkCategory.value.trim();
    }
    return proposal;
  }

  async function createProposal() {
    const text = input.value.trim();
    if (!text) {
      runStatus.textContent = '请先输入要整理的内容。';
      input.focus();
      return;
    }
    runStatus.textContent = '正在提交…';
    setBusy({ status: 'submitting' });
    const result = await api?.aiCreateProposal?.({ text, sourceType: sourceType.value }).catch(() => null);
    if (!result?.ok || !result.run) {
      runStatus.textContent = result?.message || '无法开始这次整理，请稍后重试。';
      setBusy(null);
      return;
    }
    renderRun(result.run);
    await loadHistory();
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void createProposal();
  });

  cancelButton?.addEventListener('click', async () => {
    if (!activeRun?.id) return;
    cancelButton.disabled = true;
    const result = await api?.aiCancelRun?.(activeRun.id).catch(() => null);
    if (result?.run) renderRun(result.run);
    await loadHistory();
  });

  proposalTarget?.addEventListener('change', () => {
    formError.hidden = true;
    showTargetFields(proposalTarget.value);
  });

  proposalForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeRun?.id || activeRun.status !== 'waiting_user') return;
    let editedProposal;
    try {
      editedProposal = proposalFromForm();
      formError.hidden = true;
    } catch (error) {
      formError.textContent = error.message;
      formError.hidden = false;
      return;
    }
    confirmButton.disabled = true;
    const result = await api?.aiConfirmProposal?.(activeRun.id, editedProposal, true).catch(() => null);
    if (!result?.ok || !result.run) {
      formError.textContent = result?.message || '写入失败，请检查内容后重试。';
      formError.hidden = false;
      confirmButton.disabled = false;
      return;
    }
    renderRun(result.run);
    await loadHistory();
  });

  function openApiSettings() {
    document.getElementById('tab-button-settings')?.click();
    setTimeout(() => document.getElementById('settings-api-configure')?.click(), 120);
  }

  openSettingsButton?.addEventListener('click', openApiSettings);
  statusAction?.addEventListener('click', () => {
    if (statusAction.dataset.action === 'settings') openApiSettings();
    if (statusAction.dataset.action === 'retry') void createProposal();
    if (statusAction.dataset.action === 'open-target') {
      const target = activeRun?.proposal?.target;
      if (['todo', 'note', 'link'].includes(target)) document.getElementById(`tab-button-${target === 'note' ? 'notes' : target === 'link' ? 'links' : 'todo'}`)?.click();
    }
  });

  history?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-run-id]');
    if (!button) return;
    const result = await api?.aiGetRun?.(button.dataset.runId).catch(() => null);
    if (result?.run) renderRun(result.run);
    renderHistory();
  });

  refreshHistoryButton?.addEventListener('click', () => void loadHistory());
  api?.onAiRunChanged?.((run) => {
    const index = recentRuns.findIndex((item) => item.id === run.id);
    if (index >= 0) recentRuns.splice(index, 1);
    recentRuns.unshift(run);
    if (!activeRun || activeRun.id === run.id) renderRun(run);
    renderHistory();
  });
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'inbox') void loadHistory();
  });

  renderRun(null);
  void loadHistory();
})();
