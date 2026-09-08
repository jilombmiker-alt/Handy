(() => {
  'use strict';
  const M = window.PanelPreviewModel, state = M.createState();
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Small outline vocabulary follows the existing renderer's 24px / 1.5 stroke convention.
  const paths = {
    note: '<path d="M14 4H5v16h14v-9M11 13l1-4 7-7 3 3-7 7-4 1Z"/>',
    todo: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 3 3 5-6"/>',
    record: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    clip: '<rect x="5" y="5" width="14" height="16" rx="3"/><rect x="9" y="2" width="6" height="5" rx="1.5"/><path d="M9 12h6m-6 4h4"/>',
    links: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6m-3 0v3m6 1 2-2"/>',
    music: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
    packs: '<path d="M3 7h7l2-3h8v15H3V7Z"/><path d="M7 11h9m-9 4h6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    play: '<path d="m9 5 10 7-10 7V5Z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    previous: '<path d="M6 5v14m13-14-9 7 9 7V5Z"/>',
    next: '<path d="M18 5v14M5 5l9 7-9 7V5Z"/>',
    flag: '<path d="M5 21V3h13l-3 5 3 5H5"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  const button = (action, text, cls = '', attrs = '') => `<button type="button" data-action="${action}" class="${cls}" ${attrs}>${text}</button>`;
  const time = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`; };
  const clips = ['先把最重要的一件事做完，再处理零散消息。', '设计不是减少功能，而是减少为了完成一件事所需的步骤。', '下次讨论：把想法、下一步和交付时间分开记录。'];
  const packs = [
    ['整理想法', '请保留我的本意，把下面的口述整理为：核心想法、待确认问题、下一步。不补充我没有提供的事实。'],
    ['写作检查', '请检查下文是否清楚、具体、没有重复。先指出问题，再给出保持原意的修改建议。'],
    ['结束前回看', '今天推进了什么？还卡在哪里？下一步最小的行动是什么？']
  ];
  const tracks = ['慢慢来', '窗边', '安静的下午'];
  function say(message) {
    $('#announcement').textContent = message;
    $('#activity').textContent = message;
  }
  function setOpen(opened) {
    state.opened = opened;
    const surface = $('#surface');
    surface.classList.toggle('closed', !opened);
    surface.inert = !opened;
    surface.setAttribute('aria-hidden', String(!opened));
    $('#summon').textContent = opened ? '重新唤出面板 · Space' : '唤出面板 · Space';
    if (opened) { render(); focusTool(); } else $('#summon').focus();
  }
  function selectTool(id) {
    if (!M.tools.some(t => t.id === id)) return;
    state.tool = id; state.opened = true;
    $('#surface').classList.remove('closed'); $('#surface').inert = false; $('#surface').setAttribute('aria-hidden', 'false');
    render(); focusTool();
  }
  function focusTool() {
    const selector = !state.tool && state.mode === 'panel' ? '[data-field="draft"]' : { note: '[data-field="draft"]', todo: '[data-field="todoDraft"]', clip: '[data-field="clipQuery"]', links: '[data-field="linkDraft"]', packs: '[data-field="packDraft"]' }[state.tool];
    const target = selector ? $(selector) : $('#content button');
    target?.focus();
  }
  function field(label, name, value, options = {}) {
    const { multi = false, placeholder = '', cls = '', max = 5000 } = options;
    return `<label class="field"><span>${esc(label)}</span>${multi
      ? `<textarea class="${cls}" data-field="${name}" maxlength="${max}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="${cls}" data-field="${name}" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>`;
  }
  function note(compact = false) {
    return `${compact ? '<h3>随手记</h3>' : ''}
      <label><span class="sr-only">随手记内容</span><textarea data-field="draft" class="note-input" maxlength="5000" placeholder="刚刚想到什么？">${esc(state.draft)}</textarea></label>
      <div class="actions"><span class="muted" id="draft-status">${state.draft ? '草稿已在本页暂存' : '不必取标题，先记下来'}</span>${button('save-note','结束这条记录','primary',state.draft.trim() ? '' : 'disabled')}</div>
      ${!compact ? `<details class="local-list"><summary>本次预览记录 · ${state.notes.length}</summary>${state.notes.map(n => `<p class="saved-note">${esc(n)}</p>`).join('') || '<p class="help">结束记录后，可以在这里找回。</p>'}</details>` : ''}`;
  }
  function todo(compact = false) {
    return `${compact ? '<h3>今日待办</h3>' : '<p class="section-label">演示安排 · 完成情况由你决定</p>'}
      <div class="task-list">${state.todos.map(t => `<label class="task-row ${t.done ? 'done' : ''}"><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span></label>`).join('')}</div>
      <form class="add-form" data-form="todo"><label class="sr-only" for="todo-draft">新增待办</label><input id="todo-draft" data-field="todoDraft" value="${esc(state.todoDraft)}" maxlength="180" placeholder="再加一件事…"><button type="submit" class="secondary">添加</button></form>`;
  }
  function recording() {
    const r = state.record;
    return `<div class="record-stage"><p class="section-label"><span class="record-light ${r.running ? 'active' : ''}"></span>${r.finished ? '本次演示已结束' : r.running ? '模拟录音进行中' : '口述一个想法'}</p>
      <div class="clock record-time">${time(M.elapsed(r, Date.now()))}</div>
      <div class="actions">${button('record-toggle', r.running ? '暂停' : r.finished ? '开始新的模拟录音' : r.elapsed ? '继续模拟录音' : '开始模拟录音', 'primary')}
      ${button('record-mark', icon('flag') + ' 标记重点', 'secondary', r.running ? '' : 'disabled')}
      ${button('record-finish', '结束并存为记录', '', !r.finished && (r.running || r.elapsed) ? '' : 'disabled')}</div>
      <p class="marks">${r.marks.length ? '重点标记：' + r.marks.map(time).join(' · ') : '重要的地方，随手做个记号'}</p>
      <p class="help">仅模拟录音状态，不使用麦克风、不生成真实转写。</p></div>
      ${r.finished ? `<div class="result"><h3>已添加一条演示记录</h3><p>用示例口述展示结束后的衔接，不代表真实识别结果。</p>${button('view-record-note','查看这条记录','secondary')}</div>` : ''}`;
  }
  function timer() {
    const t = state.timer;
    return `<div class="timer-stage"><div class="timer-settings"><label><span class="sr-only">计时方式</span><select id="timer-mode" ${t.running ? 'disabled' : ''}><option value="down" ${t.mode === 'down' ? 'selected' : ''}>设定时长</option><option value="up" ${t.mode === 'up' ? 'selected' : ''}>先开始，看看用多久</option></select></label>
      <label ${t.mode === 'up' ? 'hidden' : ''}><input id="timer-minutes" aria-label="计时分钟数" type="number" min="1" max="180" step="1" value="${t.minutes}" ${t.running ? 'disabled' : ''}> 分钟</label></div>
      <div class="clock timer-time"></div><div class="actions">${button('timer-toggle', t.running ? '暂停计时' : '开始计时', 'primary')}${button('timer-finish','结束这次','',t.running || t.elapsed ? '' : 'disabled')}</div>
      <p class="help">本页计时可实际运行。收起继续计时，刷新会清空；不发送系统提醒。</p></div>
      <details class="local-list"><summary>本次预览的用时记录 · ${t.history.length}</summary>${t.history.map(v => `<p class="saved-note">${v.mode === 'down' ? '设定时长' : '正计时'} · 实际 ${time(v.elapsed)}</p>`).join('') || '<p class="help">结束后显示本次用时。</p>'}</details>`;
  }
  function clipboard() {
    return `${field('搜索演示片段', 'clipQuery', state.clipQuery, { placeholder: '输入你记得的几个字', max: 100 })}<div id="clip-list" class="item-list"></div>
      <label class="field result"><span>演示输入框 · 点选片段后直接填入</span><textarea class="preview-target" data-field="reused" placeholder="不会操作你电脑里的真实剪贴板">${esc(state.reused)}</textarea></label>`;
  }
  function renderClipRows() {
    if (!$('#clip-list')) return;
    $('#clip-list').innerHTML = clips.map((text, i) => ({ text, i })).filter(c => c.text.includes(state.clipQuery.trim())).map(c =>
      button('reuse-clip', `<span class="item-text"><strong>${esc(c.text)}</strong><small>示例文字 · 点选即填入</small></span>${icon('arrow')}`, 'item-row', `data-index="${c.i}"`)
    ).join('') || '<p class="empty">没有匹配的片段，换几个字试试。</p>';
  }
  function links() {
    return `<p class="section-label">示例收藏 · 不抓取网页，不打开浏览器</p><div class="item-list">${state.links.map((l, i) => `<div class="item-row">${icon('links')}<span class="item-text"><strong>${esc(l.title)}</strong><small>${esc(l.group)} · ${esc(l.url)}</small></span>${button('link-to-note','放入随手记','text-button',`data-index="${i}"`)}</div>`).join('')}</div>
      <form data-form="link" class="add-form"><label for="link-draft" class="sr-only">新增链接</label><input id="link-draft" data-field="linkDraft" value="${esc(state.linkDraft)}" placeholder="粘贴一个 https:// 链接" maxlength="2000"><button type="submit" class="secondary">收藏到预览</button></form><p class="help" id="link-error" role="status"></p>`;
  }
  function music() {
    return `<div class="music-player"><div class="album" aria-hidden="true">${icon('music')}</div><div><h3 class="track-title">${tracks[state.track]}</h3><p class="help">演示曲目 · 无声音，不连接音乐软件</p><div class="music-controls">
      ${button('music-prev',icon('previous'),'icon-button','aria-label="上一首演示曲目"')}${button('music-play',icon(state.playing ? 'pause' : 'play'),'primary',`aria-label="${state.playing ? '暂停' : '播放'}演示曲目"`)}${button('music-next',icon('next'),'icon-button','aria-label="下一首演示曲目"')}</div></div></div>
      <p class="help">${state.playing ? '正在演示播放状态。' : '未播放。'}这里试控制位置与操作手感，不测试播放器适配。</p>`;
  }
  function materials() {
    return `<div class="item-list">${packs.map(([title, text], i) => button('select-pack', `<span class="item-text"><strong>${title}</strong><small>${esc(text.slice(0, 40))}…</small></span>${icon('arrow')}`, 'item-row', `data-index="${i}"`)).join('')}</div>
      <div class="result">${field('可直接编辑的模板文字', 'packDraft', state.packDraft, { multi: true, cls: 'preview-target', placeholder: '选一份资料，文字就会出现在这里。' })}${button('pack-to-note', '放入随手记', 'secondary', state.packDraft.trim() ? '' : 'disabled')}<p class="help">仅演示文字取用，不执行步骤，不向 AI 发送内容。</p></div>`;
  }
  function launcher() {
    return `<label class="search">${icon('search')}<span class="sr-only">查找工具</span><input id="tool-search" placeholder="找工具，或直接按 1–8" maxlength="60" autocomplete="off"></label>
      <div class="tool-grid" id="tool-grid">${M.tools.map(t => button('open-tool', `${icon(t.id)}<kbd>${t.key}</kbd><span class="tool-name">${t.name}</span><small>${t.hint}</small>`, 'tool-tile', `data-tool="${t.id}"`)).join('')}</div><p id="tool-empty" class="empty" hidden>没有匹配的工具，换个名称试试。</p>`;
  }
  function quickPanel() {
    return `<div class="quick-grid"><section aria-label="快捷随手记">${note(true)}</section><section aria-label="快捷待办">${todo(true)}</section></div>
      <div class="quick-controls"><section class="quick-control"><div><h3>录音</h3><small><span class="record-time">00:00</span> · 模拟，不使用麦克风</small></div>${button('quick-record', icon(state.record.running ? 'pause' : 'record') + (state.record.running ? '查看录音' : '开始模拟'), '')}</section>
      <section class="quick-control"><div><h3>专注一会</h3><small><span class="timer-time">30:00</span> · 收起后继续</small></div>${button('quick-timer', icon('timer') + (state.timer.running ? '查看计时' : '开始计时'), '')}</section></div>`;
  }
  function render() {
    const oldAction = document.activeElement?.dataset?.action, oldTool = document.activeElement?.dataset?.tool;
    const tool = M.tools.find(t => t.id === state.tool);
    $('#back').hidden = !tool;
    $('#surface-title').textContent = tool ? tool.name : state.mode === 'launcher' ? '随手用' : '现在，做一点。';
    $('#surface-subtitle').textContent = tool ? '同一个面板 · 直接使用' : state.mode === 'launcher' ? '选一个，现在开始' : '常用的，已经在手边';
    const views = { note, todo, record: recording, clip: clipboard, links, timer, music, packs: materials };
    $('#content').innerHTML = tool ? views[tool.id]() : state.mode === 'launcher' ? launcher() : quickPanel();
    const nav = $('#tool-nav'); nav.hidden = !tool && state.mode === 'launcher';
    nav.innerHTML = M.tools.map(t => button('open-tool', `${icon(t.id)}${t.name}`, '', `data-tool="${t.id}" title="${t.key} · ${t.name}" ${state.tool === t.id ? 'aria-current="page"' : ''}`)).join('');
    $('#activity').textContent = state.draft ? '草稿保留在本页，切换不会丢失' : '演示数据 · 刷新清空';
    renderClipRows(); updateTimes();
    if (oldAction) Array.from(document.querySelectorAll('#surface button[data-action]')).find(b => b.dataset.action === oldAction && b.dataset.tool === oldTool && !b.disabled)?.focus({ preventScroll: true });
  }
  function updateTimes() {
    const now = Date.now(), r = M.elapsed(state.record, now), t = M.elapsed(state.timer, now);
    document.querySelectorAll('.record-time').forEach(n => n.textContent = time(r));
    document.querySelectorAll('.timer-time').forEach(n => n.textContent = time(state.timer.mode === 'up' ? t : state.timer.minutes * 60000 - t));
    if (state.timer.running && state.timer.mode === 'down' && t >= state.timer.minutes * 60000) {
      state.timer.elapsed = state.timer.minutes * 60000; state.timer.running = false;
      const toggle = $('[data-action="timer-toggle"]'); if (toggle) toggle.textContent = '重新开始';
      $('#timer-mode')?.removeAttribute('disabled'); $('#timer-minutes')?.removeAttribute('disabled');
      say('时间到了。本次计时结束，待办状态没有改变。');
    }
  }
  function recordToggle() {
    const r = state.record;
    if (r.running) M.pause(r, Date.now());
    else { if (r.finished) { r.elapsed = 0; r.marks = []; r.finished = false; } M.start(r, Date.now()); }
    render();
  }
  const actions = {
    'open-tool': b => selectTool(b.dataset.tool),
    'save-note': () => { if (M.saveNote(state)) { render(); say('已结束这条记录，仅保存在本次预览。'); $('[data-field="draft"]')?.focus(); } },
    'record-toggle': recordToggle,
    'record-mark': () => { if (state.record.running) { state.record.marks.push(M.elapsed(state.record, Date.now())); render(); say('已标记这一刻。'); } },
    'record-finish': () => {
      const r = state.record; if (r.finished || !r.running && !r.elapsed) return;
      M.pause(r, Date.now()); r.finished = true;
      state.recordNote = `【演示记录，非真实转写】\n让临时想法有一个更短的记录入口。先记下来，再决定下一步。\n模拟用时：${time(r.elapsed)}${r.marks.length ? '\n重点标记：' + r.marks.map(time).join('、') : ''}`;
      state.notes.unshift(state.recordNote); render(); say('示例口述已成为一条独立演示记录。');
    },
    'view-record-note': () => { selectTool('note'); const details = $('.local-list'); if (details) { details.open = true; details.scrollIntoView({ block: 'nearest' }); } },
    'timer-toggle': () => {
      const t = state.timer;
      if (t.running) M.pause(t, Date.now());
      else { if (t.mode === 'down' && t.elapsed >= t.minutes * 60000) t.elapsed = 0; M.start(t, Date.now()); }
      render();
    },
    'timer-finish': () => { const t = state.timer; if (!t.running && !t.elapsed) return; M.pause(t, Date.now()); t.history.unshift({ elapsed: t.elapsed, mode: t.mode }); t.elapsed = 0; render(); say('本次用时已保留在预览里，不修改待办。'); },
    'quick-record': () => { if (!state.record.running) { if (state.record.finished) { state.record.elapsed = 0; state.record.marks = []; state.record.finished = false; } M.start(state.record, Date.now()); } selectTool('record'); },
    'quick-timer': () => { const t = state.timer; if (t.mode === 'down' && t.elapsed >= t.minutes * 60000) t.elapsed = 0; M.start(t, Date.now()); selectTool('timer'); },
    'reuse-clip': b => { state.reused = clips[Number(b.dataset.index)]; $('[data-field="reused"]').value = state.reused; say('已填入下面的演示输入框，真实剪贴板未改变。'); },
    'link-to-note': b => { const l = state.links[Number(b.dataset.index)]; state.draft += `${state.draft ? '\n\n' : ''}${l.title}\n${l.url}`; selectTool('note'); say('链接已追加到预览草稿，原有输入保留。'); },
    'music-play': () => { state.playing = !state.playing; render(); },
    'music-prev': () => { state.track = (state.track + tracks.length - 1) % tracks.length; render(); },
    'music-next': () => { state.track = (state.track + 1) % tracks.length; render(); },
    'select-pack': b => { state.packDraft = packs[Number(b.dataset.index)][1]; render(); $('[data-field="packDraft"]').focus(); },
    'pack-to-note': () => { if (!state.packDraft.trim()) return; state.draft += `${state.draft ? '\n\n' : ''}${state.packDraft}`; selectTool('note'); say('模板已追加到预览草稿。'); }
  };
  $('#surface').addEventListener('click', e => {
    const b = e.target.closest('button[data-action]'); if (b && !b.disabled) actions[b.dataset.action]?.(b);
  });
  $('#surface').addEventListener('input', e => {
    const key = e.target.dataset.field;
    if (['draft', 'todoDraft', 'clipQuery', 'reused', 'linkDraft', 'packDraft'].includes(key)) state[key] = e.target.value;
    if (key === 'draft') { $('#draft-status').textContent = '草稿已在本页暂存'; $('[data-action="save-note"]').disabled = !state.draft.trim(); }
    if (key === 'packDraft') $('[data-action="pack-to-note"]').disabled = !state.packDraft.trim();
    if (key === 'clipQuery') renderClipRows();
    if (e.target.id === 'tool-search') {
      const term = e.target.value.trim().toLowerCase(); let count = 0;
      document.querySelectorAll('.tool-tile').forEach(b => { const t = M.tools.find(t => t.id === b.dataset.tool); b.hidden = !`${t.name}${t.hint}${t.id}`.toLowerCase().includes(term); if (!b.hidden) count++; });
      $('#tool-empty').hidden = count > 0;
    }
  });
  $('#surface').addEventListener('change', e => {
    if (e.target.dataset.todo) { const t = state.todos.find(t => t.id === Number(e.target.dataset.todo)); t.done = e.target.checked; e.target.closest('.task-row').classList.toggle('done', t.done); say(t.done ? '已标记完成，可再次点击撤回。' : '已恢复为未完成。'); }
    if (e.target.id === 'timer-mode' && !state.timer.running) { state.timer.mode = e.target.value; state.timer.elapsed = 0; render(); }
    if (e.target.id === 'timer-minutes' && !state.timer.running) {
      const value = Number(e.target.value);
      if (!Number.isInteger(value) || value < 1 || value > 180) { e.target.value = state.timer.minutes; say('请设置 1–180 的整数分钟，已保留原时长。'); }
      else { state.timer.minutes = value; state.timer.elapsed = 0; updateTimes(); }
    }
  });
  $('#surface').addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.dataset.form === 'todo') { if (M.addTodo(state)) { render(); $('[data-field="todoDraft"]').focus(); say('待办已加入本次预览。'); } }
    if (e.target.dataset.form === 'link') {
      try {
        const u = new URL(state.linkDraft.trim()); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error();
        state.links.unshift({ title: u.hostname, url: u.href, group: '本次预览收藏' }); state.linkDraft = ''; render(); say('已加入预览收藏，未访问该网址。');
      } catch { $('#link-error').textContent = '请输入完整的 http / https 链接，不含账号密码。原输入仍保留。'; }
    }
  });
  $('#back').onclick = () => { state.tool = null; render(); $('#content button')?.focus(); };
  $('#collapse').onclick = () => setOpen(false);
  $('#summon').onclick = () => setOpen(true);
  $('#theme').onclick = () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#theme').textContent = dark ? '纯白' : '黑曜石'; $('#theme').setAttribute('aria-pressed', String(dark));
  };
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    state.mode = b.dataset.mode; state.tool = null;
    document.querySelectorAll('[data-mode]').forEach(n => n.setAttribute('aria-pressed', String(n === b)));
    $('#mode-title').textContent = state.mode === 'launcher' ? '一个入口，随叫随到。' : '展开，就能开始。';
    $('#mode-copy').textContent = state.mode === 'launcher' ? '选中工具，就在这里开始。不跳页面，不开新窗。' : '常用操作直接在手边，更多工具仍在同一个面板。';
    setOpen(true);
  });
  document.addEventListener('keydown', e => {
    const editing = Boolean(e.target.closest('input,textarea,select,[contenteditable="true"]'));
    const action = M.shortcut(e, editing);
    if (!action || action === 'toggle' && e.target.closest('button,summary')) return;
    if (!state.opened && action !== 'toggle') return;
    e.preventDefault();
    if (action === 'hide') setOpen(false); else if (action === 'toggle') setOpen(!state.opened); else selectTool(action);
  });
  $('#desktop').addEventListener('click', e => { if (e.target === $('#desktop')) setOpen(false); });
  render();
  setInterval(updateTimes, 250);
})();
