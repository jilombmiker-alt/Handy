(() => {
  'use strict';
  const root = document.getElementById('mail-root'), api = window.notchAPI;
  if (!root || !api?.mailGet) return;
  const errors = {
    auth_failed: '邮箱拒绝了授权。请检查 IMAP 是否开启，并重新生成授权码／应用专用密码。',
    connection_failed: '无法连接邮件服务器。请检查网络和服务商设置，再重试；不是 macOS 录屏权限问题。',
    timeout: '连接超时。请检查网络，再重试；上一批内容仍保留。',
    cancelled: '已取消，账号和上一批内容未改动。', busy: '正在连接，请稍候或取消。',
    invalid_account: '请选对应服务商并填写完整邮箱地址。本版暂不支持自定义域名邮箱。',
    invalid_secret: '请填写客户端授权码或应用专用密码，不是登录密码。',
    duplicate_account: '这个邮箱已添加，可在账号管理中重新授权。', account_limit: '最多添加 10 个邮箱。',
    secure_storage_unavailable: 'macOS 安全存储当前不可用，未保存明文。请完全退出后重开再试。',
    vault_unreadable: '本机邮箱授权库无法读取，未覆盖原文件。请保留数据目录备份，重开应用后重试。',
    save_failed: '本机保存失败，输入仍保留。请检查磁盘空间再试。',
    conflict: '账号配置已变化，未覆盖。请刷新账号信息后重新保存，输入仍保留。',
    stale_message: '这封邮件的缓存已失效，请刷新列表后重新打开。',
    forbidden: '邮件功能未启用，请在设置的显示功能中开启。',
  };
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (text, action, parent) => { const b = el('button', text); b.type = 'button'; b.onclick = action; parent.append(b); return b; };
  const field = (parent, label, name, type = 'text') => {
    const l = el('label', label), n = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
    if (n.tagName === 'INPUT') n.type = type; n.name = name; l.append(n); parent.append(l); return n;
  };
  const dateText = ms => ms ? new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未刷新';
  let state = { accounts: [], providers: [] }, selected = '', selectedMail = null, bodyText = '', busy = false, editingId = '', editRevision = 0, dirty = false, reading = 0, transferring = false, cancelled = false;
  root.className = 'mail-view';
  const head = el('header', null, 'mail-head'), title = el('h2', '邮件'); head.append(title);
  const actions = el('div', null, 'mail-actions'); head.append(actions); root.append(head);
  const refresh = button('刷新未读', refreshMail, actions);
  const cancel = button('取消连接', () => { cancelled = true; void api.mailCancel(); }, actions); cancel.hidden = true;
  button('管理账号', () => { management.hidden = !management.hidden; if (!management.hidden) drawAccounts(); }, actions);
  const status = el('p', '', 'mail-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
  function say(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function report(r) { if (!r?.ok) { say(errors[r?.error] || '操作未完成，请重试。原内容未改动。', true); return false; } return true; }
  function setBusy(value) { busy = value; refresh.disabled = value; submit.disabled = value; cancel.hidden = !value; }
  async function invoke(fn) { try { return await fn(); } catch { return { ok: false, error: 'operation_failed' }; } }

  const management = el('section', null, 'mail-management'); management.hidden = true; root.append(management);
  const managementHead = el('div', null, 'mail-actions'); management.append(managementHead, el('p', '授权信息加密保存在本机。这里只收信，不发信、不删除、不改已读状态。', 'mail-muted'));
  button('添加邮箱', () => openAccount(), managementHead);
  button('刷新账号信息', async () => { await load(); editRevision = state.revision; say('账号信息已刷新，表单输入未改动。'); }, managementHead);
  const accountList = el('div', null, 'mail-account-list'); management.append(accountList);
  const form = el('form', null, 'mail-account-form'); form.hidden = true; management.append(form);
  const provider = field(form, '邮箱服务商', 'provider', 'select'), email = field(form, '邮箱地址', 'email', 'email'); email.required = true; email.maxLength = 254; email.autocomplete = 'off';
  const hint = el('p', '', 'mail-muted'); form.append(hint);
  const help = button('打开授权说明', () => openProvider(provider.value, true), form);
  const secret = field(form, '授权码 / 应用专用密码', 'secret', 'password'); secret.required = true; secret.maxLength = 256; secret.autocomplete = 'new-password';
  form.append(el('p', '点击后仅向所选邮箱服务商验证。不要填写网页登录密码，也不要将授权码发到聊天中。', 'mail-muted'));
  const formActions = el('div', null, 'mail-actions'); form.append(formActions);
  const submit = button('连接并保存', () => {}, formActions); submit.type = 'submit'; submit.onclick = null; submit.className = 'mail-primary';
  button('放弃输入', () => { if (busy) return say('请先取消连接。'); form.reset(); secret.value = ''; dirty = false; form.hidden = true; }, formActions);
  form.oninput = () => { dirty = true; }; provider.onchange = () => { hint.textContent = state.providers.find(p => p.id === provider.value)?.hint || ''; };
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return; setBusy(true); say('正在验证连接，通常需要几秒…');
    const r = await invoke(() => api.mailSave({ provider: provider.value, email: email.value, secret: secret.value, id: editingId || undefined, revision: editRevision, confirmed: true }));
    setBusy(false);
    if (report(r)) { secret.value = ''; dirty = false; form.hidden = true; await load(); say('已连接并加密保存。点击“刷新未读”收取邮件。'); }
  };

  const toolbar = el('div', null, 'mail-toolbar'), filter = field(toolbar, '查看', 'account', 'select'); root.append(toolbar);
  filter.onchange = () => { selected = filter.value; drawMessages(); };
  const coverage = el('p', '', 'mail-muted'); toolbar.append(coverage);
  const layout = el('div', null, 'mail-layout'), list = el('div', null, 'mail-list'), detail = el('section', null, 'mail-detail');
  list.setAttribute('aria-label', '未读邮件'); detail.setAttribute('aria-label', '邮件详情'); layout.append(list, detail); root.append(layout);
  detail.append(el('p', '选一封邮件，快速看一眼。', 'mail-empty'));

  async function openProvider(id, help = false) { report(await invoke(() => api.mailOpen({ provider: id, help }))); }
  function openAccount(a) {
    if (dirty) return say('授权信息尚未保存，请先连接保存或放弃输入。', true);
    if (busy) return say('请先等待连接结束或取消。');
    form.hidden = false; editingId = a?.id || ''; editRevision = state.revision; provider.value = a?.provider || 'qq'; provider.disabled = !!a; email.value = a?.email || ''; email.readOnly = !!a; secret.value = ''; provider.onchange(); email.focus();
  }
  function drawAccounts() {
    accountList.replaceChildren();
    for (const a of state.accounts) {
      const row = el('div', null, 'mail-account-row'); row.append(el('span', a.email));
      button('重新授权', () => openAccount(a), row);
      button('打开邮箱', () => openProvider(a.provider), row);
      let armed = false;
      const remove = button('移除连接', async () => {
        if (busy || dirty) return say('请先完成或放弃当前账号编辑。', true);
        if (!armed) { armed = true; remove.textContent = '确认移除本机连接'; return; }
        const r = await invoke(() => api.mailRemove({ id: a.id, revision: state.revision, confirmed: true }));
        if (report(r)) { if (selectedMail?.account.id === a.id) { reading++; selectedMail = null; detail.replaceChildren(); } await load(); say('已移除本机连接，没有删除任何邮件。需要彻底撤销时，请到邮箱服务商删除对应授权码。'); }
      }, row);
      accountList.append(row);
    }
  }
  async function load() {
    const r = await invoke(() => api.mailGet());
    if (!report(r)) return false;
    state = r;
    if (!provider.options.length) for (const p of state.providers) { const o = el('option', p.name); o.value = p.id; provider.append(o); }
    const options = [el('option', '全部邮箱')]; options[0].value = '';
    for (const a of state.accounts) { const o = el('option', a.email); o.value = a.id; options.push(o); }
    filter.replaceChildren(...options); if (!state.accounts.some(a => a.id === selected)) selected = ''; filter.value = selected;
    drawAccounts(); drawMessages(); return true;
  }
  function drawMessages() {
    list.replaceChildren(); const accounts = state.accounts.filter(a => !selected || a.id === selected);
    const rows = accounts.flatMap(account => account.items.map(m => ({ ...m, account }))).sort((a, b) => b.date - a.date);
    const searching=accounts.some(a=>a.search);
    coverage.textContent = state.accounts.length ? (searching?'搜索结果 · 主题 / 发件人 / 日期筛选 · ':'未读邮件 · ')+'每个邮箱最近 5000 封内，最多显示 50 封' : '支持 QQ、163、Gmail、iCloud';
    for (const a of accounts) if (a.error) {
      const error = el('div', null, 'mail-account-error'); error.append(el('p', `${a.email} · ${errors[a.error] || '连接失败，请重试。'}${a.refreshedAt ? ' 下方为上次结果。' : ''}`));
      button('授权说明', () => openProvider(a.provider, true), error); list.append(error);
    }
    if (!rows.length) {
      const empty = el('div', null, 'mail-empty');
      empty.append(el('h3', !state.accounts.length ? '把常用邮箱放在一起' : accounts.some(a => !a.refreshedAt) ? '点击刷新，收取未读邮件' : searching?'本次范围内没有匹配邮件':'本次范围内没有未读邮件'));
      empty.append(el('p', !state.accounts.length ? '先添加一个邮箱。只有主动刷新时才会读取，不向 AI 发送邮件。' : '这里不更改已读状态。更多历史邮件和附件，请到原邮箱处理。'));
      if (!state.accounts.length) button('添加邮箱', () => { management.hidden = false; openAccount(); }, empty);
      list.append(empty);
    }
    for (const m of rows) {
      const b = button('', () => readMail(m), list); b.className = 'mail-message'; b.setAttribute('aria-pressed', String(m.id === selectedMail?.id));
      b.append(el('strong', m.subject), el('span', `${m.from} · ${dateText(m.date)}`), el('small', `${m.account.email} · 刷新于 ${dateText(m.account.refreshedAt)}`));
    }
  }
  async function refreshMail() {
    if (busy) return; cancelled = false; setBusy(true); say('正在收取未读邮件…');
    const accounts = state.accounts.filter(a => !selected || a.id === selected); let failed = 0;
    // Two concurrent connections keep multiple mailboxes responsive without a burst of logins.
    let cursor = 0;
    const worker = async () => { while (!cancelled && cursor < accounts.length) { const a = accounts[cursor++]; const r = await invoke(() => api.mailRefresh({ id: a.id })); if (!r.ok) failed++; } };
    await Promise.all([worker(), worker()]); setBusy(false); await load();
    say(!accounts.length ? '先添加一个邮箱。' : failed ? '部分邮箱未更新，旧结果仍保留。可查看错误说明后重试。' : '未读已更新，原邮箱的已读状态不变。', failed > 0);
  }
  async function readMail(m) {
    if (transferring) return say('先保存或放弃本次转存内容。', true);
    if (busy) return say('正在连接，请稍候或取消。');
    const token = ++reading; selectedMail = m; bodyText = ''; drawMessages(); detail.replaceChildren();
    detail.append(el('h3', m.subject), el('p', `${m.from} · ${dateText(m.date)}\n${m.account.email}`, 'mail-muted'));
    const controls = el('div', null, 'mail-actions'); detail.append(controls);
    button('到原邮箱处理', () => openProvider(m.account.provider), controls);
    const note = button('转笔记', () => transfer('note'), controls), todo = button('转待办', () => transfer('todo'), controls); note.disabled = todo.disabled = true;
    const content = el('p', '正在读取文本…', 'mail-body'); detail.append(content); setBusy(true);
    const r = await invoke(() => api.mailRead({ accountId: m.account.id, messageId: m.id })); setBusy(false);
    if (token !== reading) return;
    if (r.ok) {
      bodyText = r.text || ''; content.textContent = r.htmlOnly ? '这封邮件没有可预览的纯文本。为避免加载追踪图片，请到原邮箱查看排版和附件。' : bodyText || '邮件没有文本内容。';
      if (r.truncated) detail.append(el('p', '仅预览部分正文，完整内容请到原邮箱查看。', 'mail-muted'));
      note.disabled = todo.disabled = false;
    } else { content.textContent = errors[r.error] || '读取失败，原邮件未改动。'; button('重试读取', () => readMail(m), detail); }
  }
  function transfer(kind) {
    if (!selectedMail || transferring) return;
    transferring = true;
    const box = el('form', null, 'mail-transfer'), t = field(box, '标题', 'title'), text = field(box, '确认保存的内容', 'content', 'textarea');
    t.value = selectedMail.subject.slice(0, 200); t.maxLength = 200; t.required = true;
    const sourceText = [`来自：${selectedMail.from} · ${selectedMail.account.email}`, bodyText].filter(Boolean).join('\n\n');
    text.maxLength = kind === 'todo' ? 8000 : 30000; text.value = sourceText.slice(0, text.maxLength);
    if (sourceText.length > text.maxLength) box.append(el('p', `本次转存只取前 ${text.maxLength} 字，可在保存前删改。原邮件不变。`, 'mail-muted'));
    const day = kind === 'todo' ? field(box, '安排在哪天（不自动指定时段）', 'day', 'date') : null;
    if (day) { day.value = window.PlannerModel?.day?.(Date.now()) || new Date().toLocaleDateString('sv-SE'); day.required = true; }
    const buttons = el('div', null, 'mail-actions'); box.append(buttons);
    const save = button(kind === 'note' ? '确认存为笔记' : '确认加入待办', () => {}, buttons); save.type = 'submit'; save.onclick = null; save.className = 'mail-primary';
    button('放弃转存', () => { if (!save.disabled) { transferring = false; box.remove(); } }, buttons);
    const resultText = el('p', '', 'mail-muted'); resultText.setAttribute('role', 'status'); box.append(resultText);
    const operationId = crypto.randomUUID(), itemId = 'plan-' + crypto.randomUUID();
    box.onsubmit = async e => {
      e.preventDefault(); if (save.disabled) return; save.disabled = true;
      let r;
      try {
        if (kind === 'note') r = await window.Notebook.create('note', `${t.value}\n\n${text.value}`);
        else {
          const current = await api.plannerGet(); if (!current.ok) r = current;
          else r = await api.plannerCommand({ action: 'apply', revision: current.state.revision, requestId: operationId, changes: [{ mode: 'add', id: itemId, title: t.value, body: text.value, scheduled: false, date: day.value, start: null, end: null, kind: 'task', category: 'P3', area: 'work', status: 'planned' }], source: text.value });
        }
      } catch { r = { ok: false }; }
      save.disabled = false;
      if (r?.ok) { transferring = false; box.remove(); say(kind === 'note' ? '已保存到笔记。邮件仍保留在原邮箱。' : '已加入待办，未指定时段。邮件仍保留在原邮箱。'); }
      else resultText.textContent = '保存失败，输入仍保留。请检查日期或本机存储后重试。';
    };
    detail.append(box); box.scrollIntoView({ block: 'nearest' }); t.focus();
  }
  window.addEventListener('beforeunload', event => { if (dirty || transferring || busy) { event.preventDefault(); event.returnValue = false; } });
  window.HandyMail={async showSearch(snapshot){
    if(dirty||transferring||busy){say('查询已完成，当前编辑仍保留。结束编辑后刷新账号信息查看查询结果。');return false;}
    reading++;selectedMail=null;bodyText='';selected='';state=snapshot;detail.replaceChildren(el('p','选择一封邮件查看；不改已读状态。','mail-empty'));
    const options=[el('option','本次查询的全部邮箱')];options[0].value='';
    for(const a of state.accounts){const option=el('option',a.email);option.value=a.id;options.push(option);}filter.replaceChildren(...options);drawMessages();
    const rows=state.accounts.filter(a=>!a.error).flatMap(account=>account.items.map(m=>({...m,account})));
    if(rows.length===1)await readMail(rows[0]);return true;
  }};
  // Purely local account metadata on launch; no connection or mailbox read until a click.
  void load();
})();
