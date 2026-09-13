const STORAGE_KEY = 'notch-todo-data';
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TODO_CATEGORY_KEY = 'notch-todo-category-names-v1';
const TODO_CATEGORY_DEFAULTS = {
  P0: '课程',
  P1: '自媒体&写作',
  P2: 'Vibe coding',
  P3: '日常',
};

const app = document.getElementById('app');
const notch = document.getElementById('notch');
const panel = document.getElementById('panel');
const statusToast = document.getElementById('status-toast');
const statusToastMessage = document.getElementById('status-toast-message');
const statusToastAction = document.getElementById('status-toast-action');

function collectLocalStorageSnapshot() {
  const result = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) result[key] = localStorage.getItem(key);
  }
  return result;
}

async function hydratePortableWorkspace() {
  if (!window.notchAPI?.loadWorkspaceData) return;
  try {
    const snapshot = await window.notchAPI.loadWorkspaceData();
    let imported = false;
    if (sessionStorage.getItem('notch-workspace-hydrated') !== '1' && snapshot && typeof snapshot === 'object') {
      Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string' && localStorage.getItem(key) === null) {
          localStorage.setItem(key, value);
          imported = true;
        }
      });
      sessionStorage.setItem('notch-workspace-hydrated', '1');
    }
    if (imported) {
      location.reload();
      return;
    }
    setInterval(() => window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).catch(() => {}), 2000);
  } catch (error) {}
}
hydratePortableWorkspace();
window.notchAPI?.onWorkspaceChanged?.(() => {
  sessionStorage.removeItem('notch-workspace-hydrated');
  window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).finally(() => location.reload());
});

let statusToastTimer = null;
let statusToastHideTimer = null;
let statusToastActionHandler = null;
let statusToastExpireHandler = null;

function dismissStatusToast(commitPending = true) {
  if (statusToastTimer) clearTimeout(statusToastTimer);
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastTimer = null;
  statusToastHideTimer = null;
  const onExpire = statusToastExpireHandler;
  statusToastExpireHandler = null;
  statusToastActionHandler = null;
  const actionHadFocus = statusToastAction === document.activeElement;
  if (actionHadFocus) {
    const activeTabButton = document.querySelector('.tab.active');
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  if (statusToast) {
    statusToast.classList.remove('visible');
    statusToast.setAttribute('aria-hidden', 'true');
  }
  if (statusToastAction) statusToastAction.hidden = true;
  statusToastHideTimer = setTimeout(() => {
    statusToastHideTimer = null;
    if (statusToast) statusToast.hidden = true;
    if (statusToastMessage) statusToastMessage.textContent = '';
  }, 180);
  if (commitPending && onExpire) onExpire();
}

function showStatusToast(message, options = {}) {
  dismissStatusToast(true);
  if (!statusToast || !statusToastMessage) return;
  const { actionLabel, onAction, onExpire, duration = 1800 } = options;
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastHideTimer = null;
  statusToast.hidden = false;
  statusToast.setAttribute('aria-hidden', 'false');
  statusToastMessage.textContent = message;
  statusToastActionHandler = typeof onAction === 'function' ? onAction : null;
  statusToastExpireHandler = typeof onExpire === 'function' ? onExpire : null;
  if (statusToastAction && statusToastActionHandler) {
    statusToastAction.textContent = actionLabel || '撤销';
    statusToastAction.hidden = false;
  }
  statusToast.classList.add('visible');
  statusToastTimer = setTimeout(() => dismissStatusToast(true), duration);
}

if (statusToastAction) {
  statusToastAction.addEventListener('click', () => {
    const handler = statusToastActionHandler;
    dismissStatusToast(false);
    if (handler) handler();
  });
}

window.addEventListener('beforeunload', () => dismissStatusToast(true));

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { P0: [], P1: [], P2: [], P3: [] };
    const parsed = JSON.parse(raw);
    return {
      P0: normalizeTodoItems(parsed && parsed.P0),
      P1: normalizeTodoItems(parsed && parsed.P1),
      P2: normalizeTodoItems(parsed && parsed.P2),
      P3: normalizeTodoItems(parsed && parsed.P3),
    };
  } catch (e) {
    return { P0: [], P1: [], P2: [], P3: [] };
  }
}

function normalizeTodoItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text
          ? { id: generateId(), text, done: false, createdAt: Date.now() }
          : null;
      }
      if (!item || typeof item !== 'object' || typeof item.text !== 'string') return null;
      const text = item.text.trim();
      if (!text) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : generateId(),
        text,
        done: item.done === true,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        deadline: Number.isFinite(Date.parse(String(item.deadline || '')))
          ? new Date(Date.parse(String(item.deadline))).toISOString()
          : '',
        remindedAt: Math.max(0, Number(item.remindedAt) || 0),
      };
    })
    .filter(Boolean);
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // ignore quota errors
  }
  if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
    const reminders = PRIORITIES.flatMap((priority) => data[priority] || []);
    window.notchAPI.scheduleTodoReminders(reminders).catch(() => {});
  }
}

let data = loadData();
let todoCategoryNames = loadTodoCategoryNames();
const todoSelections = Object.fromEntries(PRIORITIES.map((priority) => [priority, new Set()]));
const todoSelectionAnchors = Object.fromEntries(PRIORITIES.map((priority) => [priority, null]));
let editingTodo = null;

function loadTodoCategoryNames() {
  try {
    return window.NotchDomain.normalizeTodoCategoryNames(
      JSON.parse(localStorage.getItem(TODO_CATEGORY_KEY) || 'null'),
      TODO_CATEGORY_DEFAULTS
    );
  } catch (error) {
    return { ...TODO_CATEGORY_DEFAULTS };
  }
}

function persistTodoCategoryNames() {
  try {
    localStorage.setItem(TODO_CATEGORY_KEY, JSON.stringify(todoCategoryNames));
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话中的分类名。
  }
}

function applyTodoCategoryNames() {
  PRIORITIES.forEach((categoryId) => {
    const name = todoCategoryNames[categoryId];
    const input = document.querySelector(`.todo-category-name[data-category="${categoryId}"]`);
    const addInput = document.querySelector(`.add-row input[data-priority="${categoryId}"]`);
    if (input) input.value = name;
    if (addInput) addInput.setAttribute('aria-label', `添加${name}待办`);
  });
}
if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
  window.notchAPI
    .scheduleTodoReminders(PRIORITIES.flatMap((priority) => data[priority] || []))
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onTodoReminder === 'function') {
  window.notchAPI.onTodoReminder((payload) => {
    if (!payload || !payload.id) return;
    let changed = false;
    PRIORITIES.forEach((priority) => {
      const item = (data[priority] || []).find((todo) => (
        todo.id === payload.id && String(todo.deadline || '') === String(payload.deadline || '')
      ));
      if (!item) return;
      item.remindedAt = Math.max(0, Number(payload.remindedAt) || Date.now());
      changed = true;
    });
    if (changed) saveData(data);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function checkSvg() {
  return '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todoItemHtml(priority, item) {
  const doneClass = item.done ? ' done' : '';
  const selectedClass = todoSelections[priority]?.has(item.id) ? ' multi-selected' : '';
  const safeId = escapeHtml(item.id);
  const safeText = escapeHtml(item.text);
  const deadline = Number.isFinite(Date.parse(String(item.deadline || '')))
    ? new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(item.deadline))
    : '';
  const toggleLabel = item.done ? `恢复未完成：${safeText}` : `标记完成：${safeText}`;
  const battery = window.NotchDomain.todoTimeBattery(item, Date.now());
  // 逾期项整条填满红色并只显示一个白色感叹号：剩余 0% 是「快到了」，
  // 逾期是「已经欠账」，两者不能长得一样。
  const batteryHtml = battery
    ? `<span class="todo-battery" data-tone="${battery.tone}"${battery.overdue ? ' data-overdue="true" role="img"' : ''} title="${battery.label}" aria-label="${battery.label}"><i style="--battery:${battery.overdue ? 100 : battery.percent}%"></i><b>${battery.overdue ? '!' : `${battery.percent}%`}</b></span>`
    : '';
  const isEditing = editingTodo?.priority === priority && editingTodo?.id === item.id;
  const contentHtml = isEditing
    ? `<div class="todo-inline-editor"><input class="todo-inline-name" value="${safeText}" maxlength="80" aria-label="修改待办名称" />${batteryHtml}<button class="todo-inline-deadline" type="button" data-action="edit-deadline">${deadline || '日期'}</button><button class="todo-inline-save" type="button" data-action="save-edit" aria-label="保存修改">✓</button></div>`
    : `<button class="todo-copy" type="button" data-action="edit" title="${safeText}" aria-label="修改：${safeText}"><span class="todo-text">${safeText}</span>${batteryHtml}${deadline ? `<time class="todo-ddl" datetime="${escapeHtml(item.deadline)}">${escapeHtml(deadline)}</time>` : ''}</button>`;
  return `
    <li class="todo-item${doneClass}${selectedClass}" data-id="${safeId}" data-priority="${priority}">
      <button class="checkbox" type="button" data-action="toggle" aria-label="${toggleLabel}" aria-pressed="${item.done}">${checkSvg()}</button>
      ${contentHtml}
      <button class="delete" type="button" data-action="delete" aria-label="删除：${safeText}">×</button>
    </li>
  `;
}

function captureTodoPositions(priority) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return new Map();
  return new Map(Array.from(list.querySelectorAll('.todo-item[data-id]')).map((item) => (
    [item.dataset.id, item.getBoundingClientRect()]
  )));
}

function animateTodoOrder(priority, previousPositions) {
  if (!previousPositions?.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  requestAnimationFrame(() => {
    list.querySelectorAll('.todo-item[data-id]').forEach((item) => {
      const previous = previousPositions.get(item.dataset.id);
      if (!previous || typeof item.animate !== 'function') return;
      const current = item.getBoundingClientRect();
      const offset = previous.top - current.top;
      if (Math.abs(offset) < 1) return;
      item.animate([
        { transform: `translateY(${offset}px)` },
        { transform: 'translateY(0)' },
      ], {
        duration: 360,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
      });
    });
  });
}

function renderList(priority, options = {}) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  const items = window.NotchDomain.sortTodosForDisplay(data[priority] || []);
  list.innerHTML = items.map((item) => todoItemHtml(priority, item)).join('');
  updateTodoBulkButton(priority);
  animateTodoOrder(priority, options.previousPositions);
  if (options.focusId) {
    requestAnimationFrame(() => list.querySelector(
      `.todo-item[data-id="${CSS.escape(options.focusId)}"] [data-action="${options.focusAction || 'toggle'}"]`
    )?.focus({ preventScroll: true }));
  }
}

function updateTodoBulkButton(priority) {
  const button = document.querySelector(`[data-bulk-priority="${priority}"]`);
  const count = todoSelections[priority]?.size || 0;
  if (!button) return;
  button.hidden = count === 0;
  button.textContent = '删除';
  button.setAttribute('aria-label', count ? `删除 ${count} 项` : '删除所选');
}

function updateCount(priority) {
  const countEl = document.querySelector(`.count[data-priority="${priority}"]`);
  if (!countEl) return;
  const items = data[priority] || [];
  const pending = items.filter((t) => !t.done).length;
  countEl.textContent = String(pending);
}

function renderAll() {
  PRIORITIES.forEach((p) => {
    renderList(p);
    updateCount(p);
  });
}

setInterval(() => PRIORITIES.forEach(renderList), 60_000);

// 渲染重建 innerHTML 后，给指定条目挂一次性动画类；动画结束即卸载，不污染后续渲染
function flashItemClass(priority, id, cls) {
  const el = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"]`
  );
  if (!el) return;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function flashCheckboxPop(priority, id) {
  const box = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"] .checkbox`
  );
  if (!box) return;
  box.classList.add('pop');
  box.addEventListener('animationend', () => box.classList.remove('pop'), { once: true });
}

function addTodo(priority, text, deadline) {
  const item = window.NotchDomain.createTodo(text, deadline, generateId(), Date.now());
  if (!item) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority].push(item);
  saveData(data);
  renderList(priority, { previousPositions });
  updateCount(priority);
  flashItemClass(priority, item.id, 'enter');
  const added = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${item.id}"]`
  );
  if (added) {
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      added.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
  return item;
}

function resolveAiTodoPriority(category) {
  const requested = String(category || '').trim().toLocaleLowerCase('zh-CN');
  if (PRIORITIES.includes(String(category || '').toUpperCase())) return String(category).toUpperCase();
  const matched = PRIORITIES.find((priority) => (
    String(todoCategoryNames[priority] || '').trim().toLocaleLowerCase('zh-CN') === requested
  ));
  return matched || 'P3';
}

function editTodo(priority, id, text, deadline) {
  const index = (data[priority] || []).findIndex((item) => item.id === id);
  if (index < 0) return false;
  const updated = window.NotchDomain.updateTodo(data[priority][index], text, deadline);
  if (!updated) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority][index] = updated;
  saveData(data);
  renderList(priority, { previousPositions, focusId: id, focusAction: 'edit' });
  return true;
}

function toggleTodo(priority, id) {
  const list = data[priority];
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const previousPositions = captureTodoPositions(priority);
  const restoreFocus = document.activeElement?.closest('.todo-item')?.dataset.id === id;
  list[idx].done = !list[idx].done;
  const nowDone = list[idx].done;
  saveData(data);
  renderList(priority, {
    previousPositions,
    focusId: restoreFocus ? id : '',
    focusAction: 'toggle',
  });
  updateCount(priority);
  if (nowDone) requestAnimationFrame(() => flashCheckboxPop(priority, id)); // 勾选弹一下
}

function deleteTodo(priority, id) {
  const list = data[priority];
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = list.splice(index, 1);
  const itemEl = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"]`
  );
  const shouldRestoreFocus = !!(itemEl && itemEl.contains(document.activeElement));
  const nearbyItem = itemEl && (itemEl.nextElementSibling || itemEl.previousElementSibling);
  if (itemEl) itemEl.remove();
  saveData(data);
  updateCount(priority);
  if (shouldRestoreFocus) {
    const nextFocus =
      (nearbyItem && nearbyItem.querySelector('[data-action="toggle"]')) ||
      document.querySelector(`.add-row input[data-priority="${priority}"]`);
    if (nextFocus) nextFocus.focus({ preventScroll: true });
  }
  const summary = removed.text.length > 18 ? `${removed.text.slice(0, 18)}…` : removed.text;
  showStatusToast(`已删除“${summary}”`, {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (list.some((item) => item.id === removed.id)) return;
      list.splice(Math.min(index, list.length), 0, removed);
      saveData(data);
      renderList(priority);
      updateCount(priority);
      const restored = document.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"] [data-action="toggle"]`
      );
      if (restored) restored.focus({ preventScroll: true });
      showStatusToast('已撤销删除');
    },
  });
}

let isExpanded = false;
let modeBusy = false;
let pendingMode = null;
let restoreNotchFocusAfterCollapse = false;
// 从折叠态展开的瞬间置 true，岛体落定后自动清除；
// setActiveTab 读取此标志决定是否延后重活，已展开态切 Tab 不受影响。
let _justExpanded = false;

const PANEL_MOTION_FALLBACK_MS = 300;
const OPENING_SETTLE_MS = 220;
const HEAVY_LOAD_AFTER_OPEN_MS = 240;

function nextAnimationFrame() {
  // A hidden Electron window may stop delivering rAF. A collapse/reopen race
  // must not leave the mode queue waiting forever on an invisible frame.
  return new Promise((resolve) => {
    let settled=false,frame;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);resolve();};
    const timer=setTimeout(finish,80);
    frame=requestAnimationFrame(finish);
  });
}

function waitForPanelMotion() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      panel.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (
        event.target === panel &&
        event.propertyName === 'opacity' &&
        event.pseudoElement === '::before'
      ) {
        finish();
      }
    };
    const timer = setTimeout(finish, PANEL_MOTION_FALLBACK_MS);
    panel.addEventListener('transitionend', onEnd);
  });
}

async function ipcSetMode(mode) {
  if (!window.notchAPI || typeof window.notchAPI.setMode !== 'function') return;
  try {
    await window.notchAPI.setMode(mode);
  } catch (e) {
    // ignore
  }
}

async function ipcBeginCollapse() {
  if (!window.notchAPI || typeof window.notchAPI.beginCollapse !== 'function') return;
  try {
    await window.notchAPI.beginCollapse();
  } catch (e) {
    // ignore
  }
}

function syncPanelAccessibility(expanded) {
  const focusWasInPanel = !!(panel && panel.contains(document.activeElement));
  if (!expanded) {
    restoreNotchFocusAfterCollapse = document.hasFocus();
    if (focusWasInPanel) document.activeElement.blur();
  } else {
    restoreNotchFocusAfterCollapse = false;
  }
  if (panel) {
    panel.inert = !expanded;
    panel.setAttribute('aria-hidden', String(!expanded));
  }
  if (!notch) return;
  notch.setAttribute('aria-expanded', String(expanded));
  notch.setAttribute('aria-label', expanded ? '收起 Handy' : '展开 Handy');
  if (expanded && document.activeElement === notch) {
    const activeTabButton = document.querySelector(`.tab[data-tab="${activeTab}"]`);
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  notch.setAttribute('aria-hidden', String(expanded));
  notch.tabIndex = expanded ? -1 : 0;
}

// 原生窗口只提供动画需要的透明画布；用户看到的黑色岛体由 CSS 连续形变。
// 收起必须等岛体退场完成后再缩原生窗口，避免最后一帧被裁掉。
async function setMode(expanded) {
  if(!expanded && window.ToolLauncher){
    try{await window.ToolLauncher.flush();}catch{await ipcSetMode('expanded');showStatusToast('内容未保存，请重试或复制备份后再收起。');return;}
  }
  if (modeBusy) {
    pendingMode = expanded;
    return;
  }
  if (expanded === isExpanded) return;
  modeBusy = true;
  isExpanded = expanded;
  try {
    await window.PanelPlacement?.refresh?.();
    if (expanded) {
      // 每次召回都从首页建立空间记忆；上次停留的工具页不影响下一次展开。
      if(!window.notchAPI?.launcherLayout){
        if (activeTab !== 'home') await setActiveTab('home');
        else applyTabDom('home');
      }
      syncPanelAccessibility(true);
      app.classList.remove('collapsed', 'closing');
      app.classList.add('opening');
      void panel.offsetWidth;
      // offsetWidth 只强制布局，不强制绘制；而 rAF 回调发生在绘制之前。
      // 必须等两帧、确认 .opening 的透明折叠条真的进了合成器，再让主进程放大窗口，
      // 否则放大时被钉在新原点上的仍是那条黑色折叠条（菜单栏黑块闪烁的成因）。
      await nextAnimationFrame();
      await nextAnimationFrame();
      await ipcSetMode('expanded');
      await nextAnimationFrame();
      await nextAnimationFrame();
      app.classList.remove('opening');
      app.classList.add('expanded');
      replayHomeMasonryReveal();
      // 展开后面板从隐藏变为可见，tab 尺寸此时才可量，校准激活胶囊位置
      requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
      // 标记"刚从折叠展开"——setActiveTab 会把图片等重活延后到动画落定后再跑。
      // 360ms 覆盖岛体 340ms 形变并留一帧余量，过后让切 Tab 恢复即时加载。
      _justExpanded = true;
      setTimeout(() => {
        _justExpanded = false;
      }, OPENING_SETTLE_MS);
      setTimeout(() => {
        if (!isExpanded) return;
        if (activeTab === 'clip') renderClipList();
      }, HEAVY_LOAD_AFTER_OPEN_MS);
    } else {
      const motion = waitForPanelMotion();
      syncPanelAccessibility(false);
      // 隐私优先：不要把摄像头释放放在 rAF 之后，隐藏窗口可能暂停动画帧。
      stopMirror();
      await ipcBeginCollapse();
      app.classList.add('closing');
      await nextAnimationFrame();
      await motion;
      await nextAnimationFrame();
      await nextAnimationFrame();
      await ipcSetMode('collapsed');
      app.classList.remove('expanded', 'closing', 'opening');
      app.classList.add('collapsed');
      if (restoreNotchFocusAfterCollapse && document.hasFocus() && notch) {
        notch.focus({ preventScroll: true });
      }
      restoreNotchFocusAfterCollapse = false;
    }
    document.dispatchEvent(new CustomEvent('notch:modechange', {
      detail: { expanded: isExpanded },
    }));
  } finally {
    modeBusy = false;
    if (pendingMode !== null) {
      const nextMode = pendingMode;
      pendingMode = null;
      if (nextMode !== isExpanded) setMode(nextMode);
    }
  }
}

notch.addEventListener('click', (e) => {
  e.stopPropagation();
  setMode(!isExpanded);
});

notch.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  setMode(!isExpanded);
});

syncPanelAccessibility(false);

panel.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Esc 收起面板（菜单栏会拦截顶部刘海条的点击，给收起多一条可靠路径）；
// 焦点在输入框/速记里时，第一次 Esc 只退出输入。
// Escape 不会原生到达页面（被浏览器层吞掉），由主进程 before-input-event 转发
if (window.notchAPI && typeof window.notchAPI.onEscape === 'function') {
  window.notchAPI.onEscape(() => {
    const menu=document.querySelector('.handy-menu:popover-open');
    if(menu){menu.hidePopover();document.querySelector(`[aria-controls="${menu.id}"]`)?.focus();return;}
    if (window.PanelDetachHandles?.cancelActive()) return;
    if (window.PanelPlacement?.closeMenu()) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.blur();
      return;
    }
    if (document.querySelector('.multi-selected')) {
      PRIORITIES.forEach((priority) => {
        todoSelections[priority].clear();
        todoSelectionAnchors[priority] = null;
        renderList(priority);
      });
      document.dispatchEvent(new CustomEvent('notch:clear-selection'));
      return;
    }
    if (isExpanded) setMode(false);
  });
}

if (window.notchAPI && typeof window.notchAPI.onToggleShortcut === 'function') {
  window.notchAPI.onToggleShortcut(() => setMode(!isExpanded));
}

// 失焦与点击收起共用同一个状态机，保证退场节奏一致。
if (window.notchAPI && typeof window.notchAPI.onCollapseRequest === 'function') {
  window.notchAPI.onCollapseRequest(() => {
    if (isExpanded) setMode(false);
  });
}

// 全局快捷键召唤也走同一套 Tab 与展开状态机，避免出现另一种突兀的入场路径。
if (window.notchAPI && typeof window.notchAPI.onOpenClip === 'function') {
  window.notchAPI.onOpenClip(async () => {
    await setActiveTab('clip');
    if (!isExpanded) await setMode(true);
  });
}

// 布局度量（主进程按屏计算下发）：折叠条高 / 菜单栏占位高 / 各 Tab 目标尺寸
let layoutMetrics = null;

function applyLayoutMetrics(metrics) {
  if (!metrics) return;
  layoutMetrics = metrics;
  if (metrics.stripHeight) {
    document.documentElement.style.setProperty('--notch-h', `${metrics.stripHeight}px`);
  }
  if (metrics.menuBarHeight) {
    document.documentElement.style.setProperty('--mb-h', `${metrics.menuBarHeight}px`);
  }
}

if (window.notchAPI && typeof window.notchAPI.getMetrics === 'function') {
  window.notchAPI
    .getMetrics()
    .then(applyLayoutMetrics)
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onMetricsChanged === 'function') {
  window.notchAPI.onMetricsChanged(applyLayoutMetrics);
}

// ============ Tab 切换 ============
const TAB_KEY = 'notch-active-tab';
const ALL_TABS = ['home', 'inbox', 'mail', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'];
let TABS = ALL_TABS.filter((name) => name !== 'clip');
let tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const tabIndicator = document.getElementById('tab-indicator');
const collapseBtn = document.getElementById('collapse-btn');

let activeTab = 'home';

function applyFeatureSettings(settings) {
  const features = { ...(settings && settings.features || {}), home: true, settings: true };
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    const enabled = button.dataset.tab === 'home'
      || button.dataset.tab === 'settings'
      || features[button.dataset.tab] !== false;
    button.hidden = !enabled;
    button.setAttribute('aria-hidden', String(!enabled));
  });
  TABS = window.NotchDomain.visiblePanelTabs(ALL_TABS, features);
  tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
  tabButtons.forEach((button) => button.classList.remove('tab-split-start'));
  document.getElementById('tabs')?.classList.toggle('is-split', tabButtons.length > 4);
  if (tabButtons.length > 4) {
    tabButtons[Math.ceil(tabButtons.length / 2)]?.classList.add('tab-split-start');
  }
  if (!TABS.includes(activeTab)) setActiveTab('home');
  requestAnimationFrame(positionIndicator);
}

if (window.notchAPI?.getAppSettings) {
  window.notchAPI.getAppSettings().then(applyFeatureSettings).catch(() => {});
  window.notchAPI.onAppSettingsChanged?.(applyFeatureSettings);
}

function positionIndicator() {
  const btn = tabButtons.find((b) => b.dataset.tab === activeTab);
  if (!btn || !tabIndicator) return;
  tabIndicator.style.width = `${btn.offsetWidth}px`;
  tabIndicator.style.transform = `translateX(${btn.offsetLeft}px)`;
}

function applyTabDom(name) {
  tabButtons.forEach((b) => {
    const selected = b.dataset.tab === name;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  tabPanels.forEach((p) => {
    const selected = p.id === `tab-${name}`;
    p.classList.toggle('active', selected);
    p.inert = !selected;
    p.setAttribute('aria-hidden', String(!selected));
  });
  positionIndicator();
  requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
  document.dispatchEvent(new CustomEvent('notch:tabchange', { detail: { tab: name } }));
}

async function ipcSetTab(name) {
  if (!window.notchAPI || typeof window.notchAPI.setTab !== 'function') return;
  try {
    await window.notchAPI.setTab(name);
  } catch (e) {
    // ignore
  }
}

// 固定展开尺寸下，Tab 只切换内容与指示器，不再改变原生窗口边界。
async function morphToTab(name) {
  await ipcSetTab(name);
  applyTabDom(name);
  positionIndicator();
}

let tabBusy = false;
let pendingTab = null;

async function setActiveTab(name) {
  window.PanelDetachHandles?.cancelActive();
  try { await window.Notebook?.flush(); } catch { return; }
  if (!TABS.includes(name)) name = 'home';
  if (tabBusy) {
    pendingTab = name; // 补间中连点：记住最后目标，结束后追赶
    return;
  }
  if (name === activeTab) {
    applyTabDom(name);
    return;
  }
  tabBusy = true;
  activeTab = name;
  if (name !== 'home') stopMirror();
  try {
    // 图片预加载等重活的调度策略：
    //   - 已展开态切 Tab：_justExpanded=false → 立即执行，保持即时响应
    //   - 从折叠态展开（_justExpanded=true）：延后到展开动画基本落定后再跑，
    //     避免与面板 scale 手势争首帧 CPU/GPU，消除展开卡顿
    // renderClipList 延后只是缩略图晚一点出现，可接受。
    const _tabNameForDeferred = name; // 闭包捕获当前目标 Tab
    const runHeavyLoads = () => {
      if (_tabNameForDeferred === 'clip') renderClipList();
      if (_tabNameForDeferred === 'notes') renderNotesLibrary();
    };
    if (_justExpanded) {
      // 双帧后再延迟重活，让岛体形变先完成，避免抢首帧 CPU/GPU。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(runHeavyLoads, HEAVY_LOAD_AFTER_OPEN_MS))
      );
    } else {
      // 已展开态切 Tab：立即执行，无感知延迟
      runHeavyLoads();
    }
    if (isExpanded) {
      await morphToTab(name);
    } else {
      // 折叠态只记录目标尺寸（主进程不变形），展开时一步到位
      await ipcSetTab(name);
      applyTabDom(name);
    }
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch (e) {
      // ignore quota errors
    }
  } finally {
    tabBusy = false;
    if (pendingTab && pendingTab !== activeTab) {
      const next = pendingTab;
      pendingTab = null;
      setActiveTab(next);
    } else {
      pendingTab = null;
    }
  }
}

// 胶囊滑动结束后兜底再校准一次（窗口变形期间布局可能回流）
if (tabIndicator) {
  tabIndicator.addEventListener('transitionend', positionIndicator);
}

Array.from(document.querySelectorAll('.tab[data-tab]')).forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveTab(btn.dataset.tab);
  });
  btn.addEventListener('keydown', (e) => {
    const currentIndex = tabButtons.indexOf(btn);
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    }
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextButton = tabButtons[nextIndex];
    nextButton.focus({ preventScroll: true });
    setActiveTab(nextButton.dataset.tab);
  });
});

// 只在面板已展开且没有正在输入时处理数字导航。这是「先唤出、再选模块」
// 的两段式快捷键，不需要再向 macOS 注册 8 组全局快捷键。
const PANEL_NUMBER_TABS = {
  1: 'home',
  2: 'todo',
  3: 'notes',
  4: 'links',
  5: 'recordings',
  6: 'clip',
  7: 'credentials',
  8: 'settings',
  9: 'inbox',
};

document.addEventListener('keydown', (event) => {
  if(window.notchAPI?.launcherLayout)return; // ToolShortcutModel owns the new launcher's bindings.
  if (!isExpanded || event.repeat || event.isComposing) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), audio, video')) return;
  const tab = PANEL_NUMBER_TABS[event.key];
  if (!tab) return;
  event.preventDefault();
  event.stopPropagation();
  if (!TABS.includes(tab)) {
    showStatusToast('该功能已隐藏，可在设置里重新开启');
    return;
  }
  setActiveTab(tab);
}, true);

// 托盘里的“设置快捷键…”会把设置入口以内联浮层放到面板中。
// 这里绑定所有 Tab（包括启动时隐藏的剪贴板），避免功能启用后按钮仍没有事件。
const shortcutRecorder = document.getElementById('shortcut-recorder');
const shortcutRecorderBackdrop = document.getElementById('shortcut-recorder-backdrop');
const shortcutRecorderValue = document.getElementById('shortcut-recorder-value');
const shortcutRecorderCancel = document.getElementById('shortcut-recorder-cancel');
const shortcutRecorderStatus = document.getElementById('shortcut-recorder-status');
const shortcutRecorderTest = document.getElementById('shortcut-recorder-test');
const shortcutRecorderCountdown = document.getElementById('shortcut-recorder-countdown');
const shortcutRecorderStart = document.getElementById('shortcut-recorder-start');
const shortcutRecorderRetry = document.getElementById('shortcut-recorder-retry');
const shortcutRecorderConfirm = document.getElementById('shortcut-recorder-confirm');
const DEFAULT_SHORTCUT_TEST_CANDIDATE = 'Alt+Shift+Space';
let shortcutRecorderActive = false;
let shortcutCandidate = '';
let shortcutTestActive = false;
let shortcutTestTriggered = false;
let shortcutCountdownTimer = null;
let shortcutPreviousFocus = null;

function clearShortcutCountdown() {
  if (shortcutCountdownTimer) clearInterval(shortcutCountdownTimer);
  shortcutCountdownTimer = null;
}

function setShortcutStatus(message, state = '') {
  if (!shortcutRecorderStatus) return;
  shortcutRecorderStatus.textContent = message;
  if (state) shortcutRecorderStatus.dataset.state = state;
  else delete shortcutRecorderStatus.dataset.state;
}

function resetShortcutCapture(message = '直接按下新的组合键，或选一个下方示例。') {
  clearShortcutCountdown();
  shortcutCandidate = DEFAULT_SHORTCUT_TEST_CANDIDATE;
  shortcutTestActive = false;
  shortcutTestTriggered = false;
  if (shortcutRecorderValue) {
    shortcutRecorderValue.textContent = window.NotchDomain.panelShortcutLabel(shortcutCandidate);
  }
  if (shortcutRecorderTest) shortcutRecorderTest.hidden = true;
  if (shortcutRecorderStart) {
    shortcutRecorderStart.hidden = false;
    shortcutRecorderStart.disabled = false;
    shortcutRecorderStart.removeAttribute('aria-busy');
  }
  if (shortcutRecorderRetry) shortcutRecorderRetry.hidden = true;
  if (shortcutRecorderConfirm) shortcutRecorderConfirm.hidden = true;
  setShortcutStatus(message, 'ready');
}

async function closeShortcutRecorder() {
  clearShortcutCountdown();
  if (shortcutTestActive) {
    await window.notchAPI?.cancelPanelShortcutTest?.().catch(() => null);
  }
  shortcutRecorderActive = false;
  shortcutTestActive = false;
  if (shortcutRecorderBackdrop) shortcutRecorderBackdrop.hidden = true;
  if (shortcutPreviousFocus instanceof HTMLElement && shortcutPreviousFocus.isConnected) {
    shortcutPreviousFocus.focus({ preventScroll: true });
  }
  shortcutPreviousFocus = null;
}

function keyEventToAccelerator(event) {
  const keyAliases = {
    ' ': 'Space', Spacebar: 'Space', Escape: 'Escape', Esc: 'Escape',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  };
  let key = keyAliases[event.key] || event.key;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key)) return '';
  const parts = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function selectShortcutCandidate(accelerator) {
  shortcutCandidate = accelerator;
  const label = window.NotchDomain.panelShortcutLabel(accelerator);
  const assessment = window.NotchDomain.shortcutConflictAssessment(accelerator);
  if (shortcutRecorderValue) shortcutRecorderValue.textContent = label;
  setShortcutStatus(assessment.message, assessment.state === 'blocked' ? 'error' : 'ready');
  if (shortcutRecorderStart) shortcutRecorderStart.disabled = assessment.state !== 'ready';
}

shortcutRecorder?.addEventListener('keydown', (event) => {
  if (!shortcutRecorderActive) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    void closeShortcutRecorder();
    return;
  }
  if (event.key === 'Tab') {
    const focusable = [...shortcutRecorder.querySelectorAll('button:not([hidden]):not(:disabled)')];
    if (!focusable.length) {
      event.preventDefault();
      shortcutRecorder.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === shortcutRecorder)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
    return;
  }
  if (event.target instanceof Element && event.target.closest('button') && (event.key === 'Enter' || event.key === ' ')) return;
  event.preventDefault();
  event.stopPropagation();
  if (shortcutTestActive) return;
  const accelerator = keyEventToAccelerator(event);
  if (!accelerator) {
    setShortcutStatus('还差一个主按键：请再按一个字母、数字或空格键。', 'error');
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(accelerator)) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = window.NotchDomain.panelShortcutLabel(accelerator);
    setShortcutStatus('这会抢占正常输入。请同时按住 Command、Control 或 Option 中的一个键。', 'error');
    return;
  }
  selectShortcutCandidate(accelerator);
});

shortcutRecorder?.querySelectorAll('[data-shortcut-preset]').forEach((button) => {
  button.addEventListener('click', () => selectShortcutCandidate(button.dataset.shortcutPreset));
});

shortcutRecorderStart?.addEventListener('click', async () => {
  if (!shortcutCandidate || shortcutTestActive || !window.notchAPI?.beginPanelShortcutTest) return;
  shortcutRecorderStart.disabled = true;
  shortcutRecorderStart.setAttribute('aria-busy', 'true');
  setShortcutStatus('正在检查系统和其他应用是否已占用…', 'ready');
  const result = await window.notchAPI.beginPanelShortcutTest(shortcutCandidate).catch(() => ({ ok: false, error: 'unavailable' }));
  shortcutRecorderStart.removeAttribute('aria-busy');
  if (!result?.ok) {
    shortcutRecorderStart.disabled = false;
    const message = result?.error === 'accessibility_required'
      ? '左侧双修饰键需要 Handy 的辅助功能权限。请在本页系统权限中打开设置，授权后重新检测；旧快捷键仍可用。'
      : result?.error === 'native_unavailable'
      ? '原生按键组件未就绪，请安装完整新版；旧快捷键仍可用。'
      : result?.error === 'occupied'
      ? '这组按键已被系统或其他应用占用，请换一组。'
      : result?.error === 'invalid'
        ? '这组按键与 macOS 常用操作冲突，请换一组。'
        : '暂时无法开始测试，旧快捷键仍然有效。';
    setShortcutStatus(message, 'error');
    return;
  }
  shortcutTestActive = true;
  shortcutTestTriggered = false;
  shortcutRecorderStart.hidden = true;
  shortcutRecorderRetry.hidden = true;
  shortcutRecorderTest.hidden = false;
  let seconds = Math.ceil((result.timeoutMs || 15000) / 1000);
  shortcutRecorderCountdown.textContent = `${seconds} 秒`;
  shortcutCountdownTimer = setInterval(() => {
    seconds = Math.max(0, seconds - 1);
    if (shortcutRecorderCountdown) shortcutRecorderCountdown.textContent = `${seconds} 秒`;
  }, 1000);
  setShortcutStatus('系统占用检查通过。面板将收起，请到常用应用里按一次这组键。', 'ready');
  setTimeout(() => {
    if (shortcutTestActive && !shortcutTestTriggered && isExpanded) void setMode(false);
  }, 850);
});

shortcutRecorderRetry?.addEventListener('click', async () => {
  if (shortcutTestActive) await window.notchAPI?.cancelPanelShortcutTest?.().catch(() => null);
  resetShortcutCapture('旧快捷键已恢复。请直接按下另一组组合键。');
  shortcutRecorder?.focus({ preventScroll: true });
});

shortcutRecorderConfirm?.addEventListener('click', async () => {
  if (!shortcutTestActive || !shortcutTestTriggered || !shortcutCandidate) return;
  shortcutRecorderConfirm.disabled = true;
  shortcutRecorderConfirm.setAttribute('aria-busy', 'true');
  const result = await window.notchAPI?.confirmPanelShortcutTest?.(shortcutCandidate).catch(() => ({ ok: false }));
  shortcutRecorderConfirm.disabled = false;
  shortcutRecorderConfirm.removeAttribute('aria-busy');
  if (!result?.ok) {
    setShortcutStatus('没有保存成功，旧快捷键仍然保留。', 'error');
    return;
  }
  const label = window.NotchDomain.panelShortcutLabel(shortcutCandidate);
  shortcutTestActive = false;
  shortcutTestTriggered = false;
  showStatusToast(`快捷键已保存：${label}`);
  await closeShortcutRecorder();
});

shortcutRecorderCancel?.addEventListener('click', () => void closeShortcutRecorder());
shortcutRecorderBackdrop?.addEventListener('click', (event) => {
  if (event.target === shortcutRecorderBackdrop) void closeShortcutRecorder();
});

async function openShortcutRecorder() {
  if (!isExpanded) await setMode(true);
  shortcutRecorderActive = true;
  shortcutPreviousFocus = document.activeElement;
  shortcutRecorderBackdrop.hidden = false;
  resetShortcutCapture();
  requestAnimationFrame(() => shortcutRecorder.focus({ preventScroll: true }));
}
window.notchAPI?.onRecordShortcut?.(openShortcutRecorder);
document.addEventListener('notch:record-shortcut', openShortcutRecorder);

window.notchAPI?.onPanelShortcutTestTriggered?.((payload) => {
  if (!shortcutTestActive || payload?.shortcut !== shortcutCandidate) return;
  clearShortcutCountdown();
  shortcutTestTriggered = true;
  if (shortcutRecorderCountdown) shortcutRecorderCountdown.textContent = '已成功唤回';
  if (shortcutRecorderRetry) shortcutRecorderRetry.hidden = false;
  if (shortcutRecorderConfirm) shortcutRecorderConfirm.hidden = false;
  setShortcutStatus('面板已成功唤回。请确认刚才的应用没有同时执行其他操作；没有冲突再点“确认使用”。', 'success');
});

window.notchAPI?.onPanelShortcutTestEnded?.((payload) => {
  if (!shortcutRecorderActive || !shortcutTestActive || shortcutTestTriggered) return;
  if (payload?.reason === 'expired') {
    resetShortcutCapture('15 秒内没有检测到新快捷键，已自动恢复旧快捷键。请换一组再试。');
    setShortcutStatus(shortcutRecorderStatus.textContent, 'error');
  }
});

if (collapseBtn) {
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(false);
  });
}

// 顶栏空白现在用于移动；收起只由明确按钮、快捷键或失焦触发。

function initTab() {
  setActiveTab('home');
}

document.querySelectorAll('.todo-category-name[data-category]').forEach((input) => {
  const finishCategoryEdit = () => {
    const categoryId = input.dataset.category;
    todoCategoryNames = window.NotchDomain.normalizeTodoCategoryNames({
      ...todoCategoryNames,
      [categoryId]: input.value,
    }, TODO_CATEGORY_DEFAULTS);
    persistTodoCategoryNames();
    applyTodoCategoryNames();
  };
  input.addEventListener('change', finishCategoryEdit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      input.value = todoCategoryNames[input.dataset.category];
      input.blur();
    }
  });
});

applyTodoCategoryNames();

const todoEditorBackdrop = document.getElementById('todo-date-popover');
const todoEditorMonth = document.getElementById('todo-editor-month');
const todoCalendarPrevious = document.getElementById('todo-calendar-previous');
const todoCalendarNext = document.getElementById('todo-calendar-next');
const todoCalendarGrid = document.getElementById('todo-calendar-grid');
const todoEditorHour = document.getElementById('todo-editor-hour');
const todoEditorMinute = document.getElementById('todo-editor-minute');
const todoEditorError = document.getElementById('todo-editor-error');
let todoEditorContext = null;
let todoEditorYear = new Date().getFullYear();
let todoEditorMonthIndex = new Date().getMonth();
let todoEditorDay = new Date().getDate();

function fillTodoTimeOptions() {
  if (todoEditorHour && !todoEditorHour.options.length) {
    for (let hour = 0; hour < 24; hour += 1) todoEditorHour.add(new Option(String(hour).padStart(2, '0'), String(hour)));
  }
  if (todoEditorMinute && !todoEditorMinute.options.length) {
    for (let minute = 0; minute < 60; minute += 5) todoEditorMinute.add(new Option(String(minute).padStart(2, '0'), String(minute)));
  }
}

function renderTodoCalendar() {
  if (!todoCalendarGrid) return;
  const now = new Date();
  const days = new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(todoEditorYear, todoEditorMonthIndex, 1).getDay() + 6) % 7;
  if (todoEditorMonth) todoEditorMonth.textContent = `${todoEditorYear}年 ${todoEditorMonthIndex + 1}月`;
  todoCalendarGrid.replaceChildren();
  for (let index = 0; index < firstWeekday; index += 1) todoCalendarGrid.append(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    button.dataset.day = String(day);
    button.className = day === todoEditorDay ? 'selected' : '';
    if (todoEditorYear === now.getFullYear() && todoEditorMonthIndex === now.getMonth() && day === now.getDate()) {
      button.classList.add('today');
    }
    todoCalendarGrid.append(button);
  }
}

function closeTodoEditor() {
  if (todoEditorBackdrop) todoEditorBackdrop.hidden = true;
  if (todoEditorContext?.mode === 'edit') {
    const { priority } = todoEditorContext;
    renderList(priority);
  }
  todoEditorContext = null;
}

function selectedTodoDeadline() {
  return window.NotchDomain.calendarDeadline({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
    day: todoEditorDay,
    hour: todoEditorHour?.value,
    minute: todoEditorMinute?.value,
  });
}

function applyTodoEditorSelection(markManual = true) {
  if (!todoEditorContext) return false;
  const deadline = selectedTodoDeadline();
  if (!deadline || Date.parse(deadline) <= Date.now()) {
    if (todoEditorError) todoEditorError.textContent = '请选择晚于当前时间的截止点';
    return false;
  }
  if (todoEditorError) todoEditorError.textContent = '';
  const { priority, id, mode } = todoEditorContext;
  if (mode === 'edit') {
    const todo = (data[priority] || []).find((item) => item.id === id);
    if (!todo) return false;
    todo.deadline = deadline;
    saveData(data);
  } else {
    const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
    if (!trigger) return false;
    trigger.dataset.deadline = deadline;
    trigger.dataset.deadlineSource = markManual ? 'manual' : (trigger.dataset.deadlineSource || 'default');
    trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
      day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(deadline));
    trigger.classList.add('selected');
    trigger.classList.remove('invalid');
  }
  return true;
}

function openTodoEditor(priority, item = null, anchor = null) {
  const now = new Date();
  const addInput = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  const candidate = item && item.deadline ? new Date(item.deadline) : trigger?.dataset.deadline ? new Date(trigger.dataset.deadline) : null;
  const selectedDate = candidate && Number.isFinite(candidate.getTime())
    ? candidate
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
  todoEditorContext = { priority, id: item && item.id || '', mode: item ? 'edit' : 'add' };
  todoEditorYear = selectedDate.getFullYear();
  todoEditorMonthIndex = selectedDate.getMonth();
  todoEditorDay = selectedDate.getDate();
  fillTodoTimeOptions();
  if (todoEditorHour) todoEditorHour.value = String(selectedDate.getHours());
  if (todoEditorMinute) todoEditorMinute.value = String(Math.floor(selectedDate.getMinutes() / 5) * 5);
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
  if (todoEditorBackdrop) {
    const target = anchor || (item
      ? document.querySelector(`.todo-item[data-id="${CSS.escape(item.id)}"] .todo-inline-deadline`)
      : trigger);
    const quadrant = target?.closest('.quadrant') || document.querySelector(`.quadrant[data-priority="${priority}"]`);
    quadrant?.appendChild(todoEditorBackdrop);
    todoEditorBackdrop.hidden = false;
    todoEditorBackdrop.style.removeProperty('left');
    todoEditorBackdrop.style.removeProperty('top');
    todoEditorBackdrop.style.right = '12px';
    todoEditorBackdrop.style.bottom = '58px';
  }
  applyTodoEditorSelection(false);
}

todoCalendarGrid?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  todoEditorDay = Number(button.dataset.day);
  renderTodoCalendar();
  applyTodoEditorSelection(true);
});
function moveTodoCalendar(offset) {
  const shifted = window.NotchDomain.shiftCalendarMonth({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
  }, offset);
  if (!shifted) return;
  todoEditorYear = shifted.year;
  todoEditorMonthIndex = shifted.month;
  todoEditorDay = Math.min(todoEditorDay, new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate());
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
}

todoCalendarPrevious?.addEventListener('click', () => moveTodoCalendar(-1));
todoCalendarNext?.addEventListener('click', () => moveTodoCalendar(1));
todoEditorHour?.addEventListener('change', () => applyTodoEditorSelection(true));
todoEditorMinute?.addEventListener('change', () => applyTodoEditorSelection(true));

document.addEventListener('pointerdown', (event) => {
  if (todoEditorBackdrop?.hidden) return;
  if (todoEditorBackdrop.contains(event.target) || event.target.closest('.todo-deadline-trigger, .todo-inline-deadline')) return;
  closeTodoEditor();
}, true);

function applyDefaultTodoDeadline(trigger, now = new Date()) {
  if (!trigger || (trigger.dataset.deadline && trigger.dataset.deadlineSource !== 'default')) return;
  const deadline = window.NotchDomain.defaultTodoDeadline(now);
  if (!deadline) return;
  trigger.dataset.deadline = deadline;
  trigger.dataset.deadlineSource = 'default';
  trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(deadline));
  trigger.classList.add('selected');
}

function refreshDefaultTodoDeadlines(now = new Date()) {
  document.querySelectorAll('.todo-deadline-trigger[data-deadline-priority]').forEach((trigger) => {
    if (trigger.dataset.deadlineSource === 'manual') return;
    applyDefaultTodoDeadline(trigger, now);
  });
}

PRIORITIES.forEach((priority) => {
  const input = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const deadlineInput = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  if (!input) return;
  applyDefaultTodoDeadline(deadlineInput);

  const submitTodo = () => {
    const value = input.value;
    if (!value.trim()) return;
    if (!deadlineInput || !deadlineInput.dataset.deadline) {
      deadlineInput?.classList.add('invalid');
      openTodoEditor(priority);
      return;
    }
    if (!addTodo(priority, value, deadlineInput.dataset.deadline)) {
      deadlineInput.classList.add('invalid');
      showStatusToast('截止时间格式不正确');
      return;
    }
    input.value = '';
    delete deadlineInput.dataset.deadline;
    delete deadlineInput.dataset.deadlineSource;
    applyDefaultTodoDeadline(deadlineInput);
    deadlineInput.classList.remove('invalid');
    input.focus({ preventScroll: true });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (e.repeat) return;
    submitTodo();
  });
  deadlineInput?.addEventListener('click', () => openTodoEditor(priority));
});

PRIORITIES.forEach((priority) => {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    if (e.shiftKey) {
      e.preventDefault();
      const result = window.NotchDomain.updateRangeSelection(
        window.NotchDomain.sortTodosForDisplay(data[priority] || []).map((todo) => todo.id),
        [...todoSelections[priority]],
        id,
        todoSelectionAnchors[priority],
        true
      );
      todoSelections[priority] = new Set(result.selected);
      todoSelectionAnchors[priority] = result.anchor;
      renderList(priority);
      return;
    }
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle') {
      toggleTodo(priority, id);
    } else if (action === 'edit') {
      const todo = (data[priority] || []).find((item) => item.id === id);
      if (todo) {
        editingTodo = { priority, id };
        renderList(priority);
        requestAnimationFrame(() => document.querySelector(`.todo-item[data-id="${CSS.escape(id)}"] .todo-inline-name`)?.focus({ preventScroll: true }));
      }
    } else if (action === 'edit-deadline') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      if (todo) openTodoEditor(priority, todo, target);
    } else if (action === 'save-edit') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      const name = item.querySelector('.todo-inline-name')?.value.trim() || '';
      if (!todo || !name || !todo.deadline) return;
      editingTodo = null;
      editTodo(priority, id, name, todo.deadline);
    } else if (action === 'delete') {
      deleteTodo(priority, id);
    }
  });
  list.addEventListener('keydown', (event) => {
    const item = event.target.closest('.todo-item');
    if (!item || !event.target.matches('.todo-inline-name')) return;
    if (event.key === 'Escape') {
      editingTodo = null;
      renderList(priority);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      item.querySelector('[data-action="save-edit"]')?.click();
    }
  });
});

document.querySelectorAll('.todo-bulk-delete[data-bulk-priority]').forEach((button) => {
  button.addEventListener('click', () => {
    const priority = button.dataset.bulkPriority;
    const selected = todoSelections[priority];
    if (!selected || !selected.size) return;
    data[priority] = (data[priority] || []).filter((item) => !selected.has(item.id));
    selected.clear();
    todoSelectionAnchors[priority] = null;
    saveData(data);
    renderList(priority);
    updateCount(priority);
    showStatusToast('已删除所选待办');
  });
});

// ============ 首页 · 时钟·日期 ============
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const clockDateEl = document.getElementById('clock-date');
const clockHEl = document.getElementById('clock-h');
const clockMEl = document.getElementById('clock-m');
const clockSsEl = document.getElementById('clock-ss');
let todoDefaultRefreshKey = '';

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function tickClock() {
  if (!clockHEl || !clockMEl) return;
  const now = new Date();
  const h = pad2(now.getHours());
  const m = pad2(now.getMinutes());
  if (clockHEl.textContent !== h) clockHEl.textContent = h;
  if (clockMEl.textContent !== m) clockMEl.textContent = m;
  if (clockSsEl) clockSsEl.textContent = pad2(now.getSeconds());
  if (clockDateEl) {
    const dateStr = `${WEEKDAYS[now.getDay()]} · ${now.getMonth() + 1}/${now.getDate()}`;
    if (clockDateEl.textContent !== dateStr) clockDateEl.textContent = dateStr;
  }
  const refreshKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours() > 23 || (now.getHours() === 23 && now.getMinutes() >= 30)}`;
  if (refreshKey !== todoDefaultRefreshKey) {
    todoDefaultRefreshKey = refreshKey;
    refreshDefaultTodoDeadlines(now);
  }
}

tickClock();
setInterval(tickClock, 1000);

// 计时由主进程 simple-timer 服务负责，界面在 timer-host.js 挂载。

// ============ 首页 · Markdown 速记 ============
// textarea 中的原始 Markdown 始终是唯一数据源；预览只用 DOM API + textContent 构建，
// 不执行用户输入的 HTML，也不自动加载远程图片。
const NOTE_KEY = 'notch-home-note';
const NOTE_ARCHIVE_KEY = 'notch-note-archive-v1';
const NOTE_ACTIVE_ARCHIVE_KEY = 'notch-note-active-archive-v1';
const noteInput = document.getElementById('home-note');
const notePreview = document.getElementById('home-note-preview');
const noteSaveButton = document.getElementById('note-save-btn');
const notesList = document.getElementById('notes-list');
const notesSearch = document.getElementById('notes-search');
const notesDetail = document.getElementById('notes-detail');
const notesCount = document.getElementById('notes-count');
const noteFormatActions = document.getElementById('note-format-actions');
const noteModeButtons = Array.from(document.querySelectorAll('[data-note-mode]'));
const noteEditButton = document.getElementById('note-edit-btn');
const homeNote = document.querySelector('.home-note');

const NOTE_INLINE_PATTERNS = [
  { type: 'code', regex: /`([^`\n]+)`/g },
  { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
  { type: 'strong', regex: /\*\*([^*\n]+)\*\*/g },
  { type: 'strong', regex: /__([^_\n]+)__/g },
  { type: 'delete', regex: /~~([^~\n]+)~~/g },
  { type: 'emphasis', regex: /\*([^*\n]+)\*/g },
  { type: 'emphasis', regex: /_([^_\n]+)_/g },
];

const NOTE_TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const NOTE_BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NOTE_ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const NOTE_QUOTE_RE = /^\s*>\s?(.*)$/;
const NOTE_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+)$/;
const NOTE_FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/;
const NOTE_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function findNextInlineToken(text, fromIndex) {
  let next = null;
  NOTE_INLINE_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = fromIndex;
    const match = pattern.regex.exec(text);
    if (
      match &&
      (!next || match.index < next.match.index ||
        (match.index === next.match.index && priority < next.priority))
    ) {
      next = { type: pattern.type, match, priority };
    }
  });
  return next;
}

function safeMarkdownUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (e) {
    return null;
  }
}

function appendInlineMarkdown(parent, source, depth = 0) {
  const text = String(source || '');
  if (!text || depth > 6) {
    if (text) parent.append(document.createTextNode(text));
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor);
    if (!token) {
      parent.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    const { type, match } = token;
    if (match.index > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (type === 'code') {
      const code = document.createElement('code');
      code.textContent = match[1];
      parent.append(code);
    } else if (type === 'link') {
      const href = safeMarkdownUrl(match[2]);
      if (!href) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const link = document.createElement('a');
        link.dataset.noteHref = href;
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        link.rel = 'noreferrer';
        appendInlineMarkdown(link, match[1], depth + 1);
        parent.append(link);
      }
    } else {
      const tagName = type === 'strong' ? 'strong' : type === 'delete' ? 'del' : 'em';
      const formatted = document.createElement(tagName);
      appendInlineMarkdown(formatted, match[1], depth + 1);
      parent.append(formatted);
    }

    cursor = match.index + match[0].length;
  }
}

function appendMarkdownLines(parent, lines) {
  lines.forEach((line, index) => {
    if (index > 0) parent.append(document.createElement('br'));
    appendInlineMarkdown(parent, line);
  });
}

function isMarkdownBlockStart(line) {
  if (!line.trim()) return true;
  return (
    NOTE_FENCE_RE.test(line) ||
    NOTE_HEADING_RE.test(line) ||
    NOTE_QUOTE_RE.test(line) ||
    NOTE_TASK_RE.test(line) ||
    NOTE_ORDERED_RE.test(line) ||
    NOTE_BULLET_RE.test(line) ||
    NOTE_RULE_RE.test(line)
  );
}

function buildMarkdownPreview(source) {
  const fragment = document.createDocumentFragment();
  const normalized = String(source || '').replace(/\r\n?/g, '\n');

  if (!normalized.trim()) {
    const empty = document.createElement('p');
    empty.className = 'note-preview-empty';
    empty.textContent = '写点内容后，在这里查看排版';
    fragment.append(empty);
    return fragment;
  }

  const lines = normalized.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(NOTE_FENCE_RE);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLength = fenceMatch[1].length;
      const closeFence = new RegExp('^\\s*' + fenceChar + '{' + fenceLength + ',}\\s*$');
      const codeLines = [];
      index += 1;
      while (index < lines.length && !closeFence.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fenceMatch[2]) code.dataset.language = fenceMatch[2];
      code.textContent = codeLines.join('\n');
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const headingMatch = line.match(NOTE_HEADING_RE);
    if (headingMatch) {
      const heading = document.createElement('h' + headingMatch[1].length);
      appendInlineMarkdown(heading, headingMatch[2]);
      fragment.append(heading);
      index += 1;
      continue;
    }

    if (NOTE_RULE_RE.test(line)) {
      fragment.append(document.createElement('hr'));
      index += 1;
      continue;
    }

    const quoteMatch = line.match(NOTE_QUOTE_RE);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(NOTE_QUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      const quote = document.createElement('blockquote');
      appendMarkdownLines(quote, quoteLines);
      fragment.append(quote);
      continue;
    }

    const taskMatch = line.match(NOTE_TASK_RE);
    if (taskMatch) {
      const list = document.createElement('ul');
      list.className = 'note-task-list';
      while (index < lines.length) {
        const match = lines[index].match(NOTE_TASK_RE);
        if (!match) break;
        const done = match[1].toLowerCase() === 'x';
        const item = document.createElement('li');
        item.className = 'note-task-item' + (done ? ' done' : '');
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', String(done));
        const box = document.createElement('span');
        box.className = 'note-task-box';
        box.setAttribute('aria-hidden', 'true');
        box.textContent = done ? '✓' : '';
        const content = document.createElement('span');
        appendInlineMarkdown(content, match[2]);
        item.append(box, content);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const orderedMatch = line.match(NOTE_ORDERED_RE);
    if (orderedMatch) {
      const list = document.createElement('ol');
      const start = Number.parseInt(orderedMatch[1], 10);
      if (Number.isFinite(start) && start !== 1) list.start = start;
      while (index < lines.length) {
        const match = lines[index].match(NOTE_ORDERED_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[2]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const bulletMatch = line.match(NOTE_BULLET_RE);
    if (bulletMatch) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        if (NOTE_TASK_RE.test(lines[index])) break;
        const match = lines[index].match(NOTE_BULLET_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[1]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendMarkdownLines(paragraph, paragraphLines);
    fragment.append(paragraph);
  }

  return fragment;
}

function renderNotePreview() {
  if (!noteInput || !notePreview) return;
  notePreview.replaceChildren(buildMarkdownPreview(noteInput.value));
}

function replaceNoteText(
  start,
  end,
  replacement,
  selectionStart,
  selectionEnd,
  selectionDirection = 'none'
) {
  if (!noteInput) return;
  noteInput.setRangeText(replacement, start, end, 'end');
  noteInput.focus({ preventScroll: true });
  noteInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapNoteSelection(open, close, placeholder) {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);

  const hasOuterMarkers =
    selected &&
    start >= open.length &&
    noteInput.value.slice(start - open.length, start) === open &&
    noteInput.value.slice(end, end + close.length) === close;
  if (hasOuterMarkers) {
    replaceNoteText(
      start - open.length,
      end + close.length,
      selected,
      start - open.length,
      end - open.length,
      direction
    );
    return;
  }

  if (selected && selected.startsWith(open) && selected.endsWith(close)) {
    const unwrapped = selected.slice(open.length, selected.length - close.length);
    replaceNoteText(start, end, unwrapped, start, start + unwrapped.length, direction);
    return;
  }

  const content = selected || placeholder;
  const replacement = open + content + close;
  replaceNoteText(
    start,
    end,
    replacement,
    start + open.length,
    start + open.length + content.length,
    direction
  );
}

function stripNoteBlockPrefix(line) {
  return line.replace(
    /^(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/,
    ''
  );
}

function applyNoteLineFormat(type) {
  if (!noteInput) return;
  const value = noteInput.value;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd;
  if (end > start && value[end - 1] === '\n') {
    lineEnd = end - 1;
  } else {
    const nextBreak = value.indexOf('\n', end);
    lineEnd = nextBreak === -1 ? value.length : nextBreak;
  }

  const original = value.slice(lineStart, lineEnd);
  const lines = original.split('\n');
  const matchers = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
    ordered: /^\d+[.)]\s+/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    quote: /^>\s+/,
  };
  const matcher = matchers[type];
  if (!matcher) return;
  const nonEmptyLines = lines.filter((line) => line.trim());
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => matcher.test(line.trimStart()));
  let orderedIndex = 1;

  const transformed = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    if (shouldRemove) return indentation + body.replace(matcher, '');
    const content = stripNoteBlockPrefix(body) || (
      type === 'heading' ? '标题' :
      type === 'task' ? '待办' :
      type === 'quote' ? '引用' : '项目'
    );
    if (type === 'ordered') return indentation + String(orderedIndex++) + '. ' + content;
    if (type === 'heading') return indentation + '# ' + content;
    if (type === 'task') return indentation + '- [ ] ' + content;
    if (type === 'quote') return indentation + '> ' + content;
    return indentation + '- ' + content;
  }).join('\n');

  const emptySingleLine = lines.length === 1 && !original.trim() && !shouldRemove;
  let nextStart = lineStart;
  let nextEnd = lineStart + transformed.length;
  if (emptySingleLine) {
    const indentationLength = original.match(/^\s*/)[0].length;
    const prefixLength =
      type === 'heading' ? 2 :
      type === 'task' ? 6 :
      type === 'ordered' ? 3 : 2;
    nextStart += indentationLength + prefixLength;
  }
  replaceNoteText(lineStart, lineEnd, transformed, nextStart, nextEnd, direction);
}

function applyNoteLink() {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);
  const label = selected || '链接文字';
  const url = 'https://';
  const replacement = '[' + label + '](' + url + ')';
  if (selected) {
    const urlStart = start + label.length + 3;
    replaceNoteText(start, end, replacement, urlStart, urlStart + url.length, direction);
  } else {
    replaceNoteText(start, end, replacement, start + 1, start + 1 + label.length, direction);
  }
}

let noteComposing = false;

function applyNoteFormat(type) {
  if (!noteInput || noteComposing) return;
  if (type === 'bold') return wrapNoteSelection('**', '**', '加粗文字');
  if (type === 'italic') return wrapNoteSelection('*', '*', '斜体文字');
  if (type === 'code') return wrapNoteSelection('`', '`', '代码');
  if (type === 'link') return applyNoteLink();
  applyNoteLineFormat(type);
}

let noteMode = 'edit';
let noteSelection = { start: 0, end: 0, direction: 'none', scrollTop: 0 };

function setNoteMode(mode, focusTarget = true) {
  if (!noteInput || !notePreview) return;
  const previousMode = noteMode;
  noteMode = mode === 'preview' ? 'preview' : 'edit';
  const isPreview = noteMode === 'preview';

  if (isPreview) {
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
    renderNotePreview();
  } else if (previousMode === 'edit') {
    // 重复点击已选中的“编辑”时保留用户当下光标，而不是恢复旧选区。
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
  }

  noteInput.hidden = isPreview;
  notePreview.hidden = !isPreview;
  if (noteFormatActions) noteFormatActions.hidden = isPreview;
  if (homeNote) homeNote.classList.toggle('is-preview', isPreview);
  noteModeButtons.forEach((button) => {
    const active = button.dataset.noteMode === noteMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (noteEditButton) {
    noteEditButton.classList.toggle('active', !isPreview);
    noteEditButton.textContent = isPreview ? '编辑' : '完成';
    noteEditButton.setAttribute('aria-pressed', String(!isPreview));
  }

  if (!focusTarget) return;
  requestAnimationFrame(() => {
    if (isPreview) {
      notePreview.focus({ preventScroll: true });
    } else {
      noteInput.focus({ preventScroll: true });
      noteInput.setSelectionRange(
        noteSelection.start,
        noteSelection.end,
        noteSelection.direction
      );
      noteInput.scrollTop = noteSelection.scrollTop;
    }
  });
}

function continueNoteList(event) {
  if (
    !noteInput ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing ||
    noteInput.selectionStart !== noteInput.selectionEnd
  ) {
    return false;
  }

  const value = noteInput.value;
  const cursor = noteInput.selectionStart;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = value.indexOf('\n', cursor);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const patterns = [
    {
      regex: /^(\s*)[-*+]\s+\[[ xX]\]\s*(.*)$/,
      prefix: () => '- [ ] ',
    },
    {
      regex: /^(\s*)(\d+)[.)]\s+(.*)$/,
      prefix: (match) => String(Number.parseInt(match[2], 10) + 1) + '. ',
    },
    {
      regex: /^(\s*)[-*+]\s+(.*)$/,
      prefix: () => '- ',
    },
    {
      regex: /^(\s*)>\s?(.*)$/,
      prefix: () => '> ',
    },
  ];

  const definition = patterns.find((candidate) => candidate.regex.test(line));
  if (!definition) return false;
  const match = line.match(definition.regex);
  const content = match[match.length - 1];
  const indentation = match[1];
  event.preventDefault();

  if (!content.trim()) {
    replaceNoteText(
      lineStart,
      lineEnd,
      indentation,
      lineStart + indentation.length,
      lineStart + indentation.length
    );
    return true;
  }

  const prefix = indentation + definition.prefix(match);
  const insertion = '\n' + prefix;
  replaceNoteText(cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

if (noteInput) {
  try {
    noteInput.value = localStorage.getItem(NOTE_KEY) || '';
  } catch (e) {
    // ignore
  }

  let noteTimer = null;
  const saveNote = () => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    try {
      localStorage.setItem(NOTE_KEY, noteInput.value);
    } catch (e) {
      // ignore quota errors
    }
  };

  noteInput.addEventListener('input', () => {
    if (!noteInput.value.trim()) localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    renderNotePreview();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 300);
  });
  noteInput.addEventListener('blur', saveNote);
  noteInput.addEventListener('compositionstart', () => {
    noteComposing = true;
  });
  noteInput.addEventListener('compositionend', () => {
    noteComposing = false;
  });
  noteInput.addEventListener('keydown', (event) => {
    if (continueNoteList(event)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    event.preventDefault();
    applyNoteFormat(key === 'b' ? 'bold' : 'italic');
  });

  window.addEventListener('beforeunload', saveNote);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNote();
  });

  noteInput.hidden = false;
}

function loadNoteArchive() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTE_ARCHIVE_KEY) || '[]');
    return window.NotchDomain.normalizeNoteArchive(parsed);
  } catch (error) {
    return [];
  }
}

let selectedNoteId = '';

function noteArchiveTitle(note) {
  return String(note && note.title || '').trim() || '未命名笔记';
}

function noteArchiveExcerpt(note) {
  const lines = String(note && note.content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.join(' ').replace(/[#*_~`>\[\]]/g, '').slice(0, 86);
}

function noteArchiveTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function renderNotesDetail(notes = loadNoteArchive()) {
  if (!notesDetail) return;
  const note = notes.find((item) => item.id === selectedNoteId);
  if (window.Notebook?.beforeRender(note) === false) return;
  notesDetail.replaceChildren();
  if (window.Notebook?.mount(notesDetail, note)) return;
  if (!note) {
    const empty = document.createElement('div');
    empty.className = 'notes-detail-empty';
    const hasArchive = loadNoteArchive().length > 0;
    empty.innerHTML = hasArchive
      ? '<span class="notes-empty-mark" aria-hidden="true">⌕</span><strong>没有匹配的笔记</strong><p>试试搜索其他关键词。</p>'
      : '<span class="notes-empty-mark" aria-hidden="true">✎</span><strong>还没有保存的笔记</strong><p>在首页的「随笔记」中写下内容，点击保存后会出现在这里。</p>';
    notesDetail.append(empty);
    return;
  }

  const header = document.createElement('header');
  header.className = 'notes-detail-head';
  const heading = document.createElement('div');
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'notes-detail-title';
  title.dataset.noteId = note.id;
  title.value = String(note.title || '');
  title.placeholder = '未命名笔记';
  title.maxLength = 80;
  title.autocomplete = 'off';
  title.spellcheck = false;
  title.setAttribute('aria-label', '笔记标题，可直接修改');
  const time = document.createElement('time');
  time.className = 'notes-detail-time';
  time.textContent = `更新于 ${noteArchiveTime(note.updatedAt)}`;
  heading.append(title, time);
  const actions = document.createElement('div');
  actions.className = 'notes-detail-actions';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'notes-delete';
  remove.dataset.action = 'delete-note';
  remove.setAttribute('aria-label', '删除笔记');
  remove.title = '删除笔记';
  remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h10l1-12"/></svg>';
  actions.append(remove);
  if(note.sourceQuickRecordId){
    const source=document.createElement('button');source.type='button';source.className='nb-entry';source.textContent='来源随手记';
    source.onclick=()=>window.Notebook.openQuick({recordId:note.sourceQuickRecordId});actions.prepend(source);
  }
  header.append(heading, actions);

  const editor = document.createElement('textarea');
  editor.id = 'notes-editor';
  editor.className = 'notes-editor';
  editor.dataset.noteId = note.id;
  editor.value = note.content;
  editor.placeholder = '直接输入笔记内容…';
  editor.setAttribute('aria-label', `编辑笔记：${noteArchiveTitle(note)}`);
  editor.spellcheck = false;
  notesDetail.append(header, editor);
  window.LinkLibrary?.renderNoteReferences(note.id,notesDetail);
  window.Notebook?.mountHandle(notesDetail, 'note', note.id);
  requestNoteTitle(note);
}

let notesSaveTimer = null;
let pendingNotesEditor = null;
const noteTitleAttempts = new Set();

async function requestNoteTitle(note) {
  if (
    !note
    || note.title
    || note.titleSource === 'user'
    || !String(note.content || '').trim()
    || noteTitleAttempts.has(note.id)
    || !window.notchAPI?.organizeMaterial
  ) return;
  noteTitleAttempts.add(note.id);
  const expectedContent = note.content;
  const result = await window.notchAPI.organizeMaterial({ kind: 'note', text: expectedContent }).catch(() => null);
  if (!result?.ok || !result.title) {
    noteTitleAttempts.delete(note.id);
    return;
  }
  const next = window.NotchDomain.applyGeneratedNoteTitle(
    loadNoteArchive(),
    note.id,
    result.title,
    expectedContent
  );
  const updated = next.find((item) => item.id === note.id);
  if (!updated?.title || updated.titleSource !== 'model') {
    noteTitleAttempts.delete(note.id);
    return;
  }
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next.slice(0, 200)));
  renderNotesLibrary();
}

function updateSavedNotePresentation(note) {
  if (!note) return;
  const title = noteArchiveTitle(note);
  const detailTitle = notesDetail?.querySelector('.notes-detail-title');
  const detailTime = notesDetail?.querySelector('.notes-detail-time');
  if (detailTitle && document.activeElement !== detailTitle) detailTitle.value = note.title || '';
  if (detailTime) detailTime.textContent = `已保存 · ${noteArchiveTime(note.updatedAt)}`;
  const row = notesList?.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
  if (!row) return;
  const rowTitle = row.querySelector('strong');
  const rowExcerpt = row.querySelector('span');
  const rowTime = row.querySelector('time');
  if (rowTitle) rowTitle.textContent = title;
  if (rowExcerpt) rowExcerpt.textContent = noteArchiveExcerpt(note);
  if (rowTime) rowTime.textContent = noteArchiveTime(note.updatedAt);
}

function persistNotesEditor(editor) {
  if (!editor || !editor.dataset.noteId) return;
  const notes = window.NotchDomain.updateNoteInArchive(
    loadNoteArchive(),
    editor.dataset.noteId,
    editor.value,
    Date.now()
  );
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  const updated = notes.find((note) => note.id === editor.dataset.noteId);
  if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === editor.dataset.noteId && noteInput) {
    noteInput.value = editor.value;
    localStorage.setItem(NOTE_KEY, editor.value);
    renderNotePreview();
  }
  updateSavedNotePresentation(updated);
  if (pendingNotesEditor === editor) pendingNotesEditor = null;
}

function flushNotesEditorSave() {
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  const editor = pendingNotesEditor;
  pendingNotesEditor = null;
  if (editor) persistNotesEditor(editor);
}

function scheduleNotesEditorSave(editor) {
  pendingNotesEditor = editor;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  const time = notesDetail?.querySelector('.notes-detail-time');
  if (time) time.textContent = '正在保存…';
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    const pending = pendingNotesEditor;
    pendingNotesEditor = null;
    if (pending) persistNotesEditor(pending);
  }, 220);
}

function renderNotesLibrary() {
  if (!notesList) return;
  const archive = loadNoteArchive();
  const notes = window.NotchDomain.filterNotes(archive, notesSearch?.value || '');
  if (notesCount) notesCount.textContent = `${archive.length} 篇`;
  if (!notes.some((note) => note.id === selectedNoteId)) selectedNoteId = notes[0]?.id || '';
  notesList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    empty.textContent = archive.length ? '没有找到相关笔记' : '保存的笔记会出现在这里';
    notesList.append(empty);
    renderNotesDetail(notes);
    return;
  }
  notes.forEach((note) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `notes-list-item${note.id === selectedNoteId ? ' active' : ''}`;
    button.dataset.noteId = note.id;
    button.dataset.lineSidebarItem = '';
    button.setAttribute('aria-pressed', String(note.id === selectedNoteId));
    const title = document.createElement('strong');
    title.textContent = noteArchiveTitle(note);
    const excerpt = document.createElement('span');
    excerpt.textContent = noteArchiveExcerpt(note);
    const time = document.createElement('time');
    time.textContent = noteArchiveTime(note.updatedAt);
    button.append(title, excerpt, time);
    notesList.append(button);
  });
  renderNotesDetail(notes);
}

function saveAiNote(fields = {}) {
  const content = String(fields.content || '').replace(/\u0000/g, '').trim().slice(0, 12000);
  if (!content) return null;
  const title = Array.from(String(fields.title || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
  const timestamp = Date.now();
  const note = {
    id: generateId(),
    title,
    titleSource: title ? 'user' : '',
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const notes = [note, ...loadNoteArchive()].slice(0, 200);
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
  selectedNoteId = note.id;
  renderNotesLibrary();
  return note;
}

window.NotchDataTools = Object.freeze({
  saveTodo(fields = {}) {
    const priority = resolveAiTodoPriority(fields.category);
    return addTodo(priority, fields.title, fields.dueAt || '');
  },
  saveNote: saveAiNote,
});

noteSaveButton?.addEventListener('click', () => {
  const content = noteInput?.value.trim() || '';
  if (!content) {
    showStatusToast('先写点内容再存档');
    return;
  }
  const notes = loadNoteArchive();
  let activeId = localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) || '';
  const existing = notes.find((item) => item.id === activeId);
  if (existing) {
    existing.content = content;
    existing.updatedAt = Date.now();
  } else {
    activeId = generateId();
    notes.unshift({ id: activeId, content, createdAt: Date.now(), updatedAt: Date.now() });
  }
  localStorage.setItem(NOTE_ACTIVE_ARCHIVE_KEY, activeId);
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  localStorage.setItem(NOTE_KEY, noteInput.value);
  selectedNoteId = activeId;
  renderNotesLibrary();
  showStatusToast('笔记已保存');
});

notesList?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-note-id]');
  if (!row) return;
  flushNotesEditorSave();
  selectedNoteId = row.dataset.noteId;
  renderNotesLibrary();
});

notesSearch?.addEventListener('input', () => {
  flushNotesEditorSave();
  renderNotesLibrary();
});

notesDetail?.addEventListener('input', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const notes = window.NotchDomain.updateNoteTitle(
      loadNoteArchive(),
      title.dataset.noteId,
      title.value,
      Date.now()
    );
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
    updateSavedNotePresentation(notes.find((note) => note.id === title.dataset.noteId));
    return;
  }
  const editor = event.target.closest('#notes-editor');
  if (editor) scheduleNotesEditorSave(editor);
});

notesDetail?.addEventListener('focusout', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const note = loadNoteArchive().find((item) => item.id === title.dataset.noteId);
    if (note) title.value = note.title;
  }
  if (event.target.closest('#notes-editor')) flushNotesEditorSave();
});

notesDetail?.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  flushNotesEditorSave();
  const notes = loadNoteArchive();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) return;
  if (action === 'delete-note') {
    const next = notes.filter((item) => item.id !== note.id);
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next));
    if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === note.id) {
      localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    }
    selectedNoteId = next[0]?.id || '';
    renderNotesLibrary();
    showStatusToast('笔记已删除');
    return;
  }
});

document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab !== 'notes') flushNotesEditorSave();
});
window.addEventListener('beforeunload', flushNotesEditorSave);

if (noteFormatActions) {
  noteFormatActions.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-note-format]')) event.preventDefault();
  });
  noteFormatActions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-format]');
    if (!button) return;
    applyNoteFormat(button.dataset.noteFormat);
  });
}

noteModeButtons.forEach((button) => {
  button.addEventListener('click', () => setNoteMode(button.dataset.noteMode));
});
noteEditButton?.addEventListener('click', () => setNoteMode(noteMode === 'preview' ? 'edit' : 'preview'));

if (notePreview) {
  notePreview.addEventListener('click', (event) => {
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
  notePreview.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
}

// ============ 首页 · 自适应 Bento 布局（长按换位 + 迷你/小/中/大组件） ============
const HOME_ORDER_KEY = 'notch-home-order-v3';
const HOME_SIZES_KEY = 'notch-home-widget-sizes-v2';
const HOME_ORDER_DEFAULTS = ['music', 'pomodoro', 'windows', 'recorder', 'mirror', 'note', 'commands'];
const HOME_SIZE_DEFAULTS = {
  music: 'medium',
  windows: 'large',
  recorder: 'small',
  mirror: 'medium',
  note: 'medium',
  commands: 'mini',
  pomodoro: 'mini',
};
const HOME_SIZE_LABELS = { mini: '迷你', small: '小', medium: '中', large: '大' };
const homeBento = document.getElementById('home-bento');
const homeTiles = homeBento
  ? Array.from(homeBento.querySelectorAll('[data-home-module]'))
  : [];

function loadHomeOrder() {
  try {
    const rawSaved = JSON.parse(localStorage.getItem(HOME_ORDER_KEY) || 'null');
    const saved = Array.isArray(rawSaved)
      ? rawSaved.map((id) => id === 'character' ? 'music' : id)
      : rawSaved;
    if (
      Array.isArray(saved)
      && saved.length === HOME_ORDER_DEFAULTS.length
      && new Set(saved).size === HOME_ORDER_DEFAULTS.length
      && saved.every((id) => HOME_ORDER_DEFAULTS.includes(id))
    ) return saved;

    // 从旧固定槽位布局平滑迁移；原时钟 / 人物位置由音乐组件接管。
    const legacy = JSON.parse(localStorage.getItem('notch-home-layout-v2') || 'null');
    const legacySlots = ['tall-left', 'small-top', 'medium-top', 'square-top', 'tall-right', 'wide-bottom'];
    if (legacy && typeof legacy === 'object') {
      const migrated = Object.entries(legacy)
        .sort((a, b) => legacySlots.indexOf(a[1]) - legacySlots.indexOf(b[1]))
        .map(([id]) => id === 'clock' || id === 'character' ? 'music' : id)
        .filter((id) => HOME_ORDER_DEFAULTS.includes(id));
      if (migrated.length === HOME_ORDER_DEFAULTS.length && new Set(migrated).size === migrated.length) {
        return migrated;
      }
    }
  } catch (error) {
    // 使用默认顺序。
  }
  return [...HOME_ORDER_DEFAULTS];
}

function loadHomeSizes() {
  try {
    return window.NotchDomain.normalizeHomeWidgetSizes(
      JSON.parse(localStorage.getItem(HOME_SIZES_KEY) || 'null'),
      HOME_SIZE_DEFAULTS,
      '',
      48
    );
  } catch (error) {
    return { ...HOME_SIZE_DEFAULTS };
  }
}

let homeOrder = loadHomeOrder();
let homeSizes = loadHomeSizes();

window.resetPanelLayout = () => {
  homeOrder = [...HOME_ORDER_DEFAULTS];
  homeSizes = { ...HOME_SIZE_DEFAULTS };
  saveHomeLayout();
  window.PanelAppearance?.setLayout('calm');
  applyHomeLayout(false);
  showStatusToast('已恢复整洁布局，笔记、待办和录音保持不变');
};

function saveHomeLayout() {
  try {
    localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(homeOrder));
    localStorage.setItem(HOME_SIZES_KEY, JSON.stringify(homeSizes));
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话内的布局。
  }
}

function applyHomeLayout(animate = false) {
  if (!homeBento) return;
  const firstRects = animate
    ? new Map(homeTiles.map((tile) => [tile, tile.getBoundingClientRect()]))
    : null;

  const packedLayout = window.NotchDomain.packHomeWidgetLayout(homeOrder, homeSizes, 12, 4);
  homeTiles.forEach((tile) => {
    const moduleId = tile.dataset.homeModule;
    const orderIndex = Math.max(0, homeOrder.indexOf(moduleId));
    const size = homeSizes[moduleId] || HOME_SIZE_DEFAULTS[moduleId];
    tile.style.order = String(orderIndex);
    tile.dataset.widgetSize = size;
    tile.style.setProperty('--bento-index', String(orderIndex));
    const placement = packedLayout && packedLayout[moduleId];
    if (placement) {
      tile.style.gridColumn = `${placement.column + 1} / span ${placement.width}`;
      tile.style.gridRow = `${placement.row + 1} / span ${placement.height}`;
    } else {
      tile.style.removeProperty('grid-column');
      tile.style.removeProperty('grid-row');
    }
    const sizeButton = tile.querySelector('[data-widget-size-cycle]');
    if (sizeButton) {
      sizeButton.dataset.currentSize = size;
      sizeButton.setAttribute('aria-label', `${HOME_SIZE_LABELS[size]}组件，点击切换尺寸`);
      sizeButton.title = `组件尺寸：${HOME_SIZE_LABELS[size]}`;
    }
  });

  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  homeBento.getBoundingClientRect();
  homeTiles.forEach((tile) => {
    const first = firstRects.get(tile);
    const last = tile.getBoundingClientRect();
    if (!first || (!first.width && !first.height)) return;
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const scaleX = first.width / Math.max(1, last.width);
    const scaleY = first.height / Math.max(1, last.height);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleY - 1) < 0.01) return;
    tile.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
        { transform: 'translate(0, 0) scale(1, 1)' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    );
  });
}

function replayHomeMasonryReveal() {
  if (!homeBento || activeTab !== 'home') return;
  homeBento.classList.remove('masonry-reveal');
  void homeBento.offsetWidth;
  homeBento.classList.add('masonry-reveal');
  setTimeout(() => homeBento.classList.remove('masonry-reveal'), 820);
  setTimeout(replayMirrorPixelReveal, 420);
}

homeTiles.forEach((tile) => {
  if(tile.dataset.homeModule==='music')return;
  const sizeButton = document.createElement('button');
  sizeButton.type = 'button';
  sizeButton.className = 'widget-size-control motion-icon';
  sizeButton.dataset.widgetSizeCycle = tile.dataset.homeModule;
  sizeButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>';
  tile.appendChild(sizeButton);
});

applyHomeLayout(false);

if (homeBento) {
  let pendingLongPress = null;
  let dragState = null;
  let suppressHomeClickUntil = 0;

  const clearDropTarget = () => {
    homeTiles.forEach((tile) => tile.classList.remove('layout-drop-target'));
  };

  const finishHomeDrag = (event, cancelled = false) => {
    if (pendingLongPress) clearTimeout(pendingLongPress.timer);
    pendingLongPress = null;
    if (!dragState) return;
    const { tile, target, pointerId } = dragState;
    if (tile.hasPointerCapture?.(pointerId)) tile.releasePointerCapture(pointerId);
    tile.classList.remove('is-dragging', 'hit-test-off');
    tile.style.removeProperty('--home-drag-x');
    tile.style.removeProperty('--home-drag-y');
    homeBento.classList.remove('layout-dragging');
    clearDropTarget();
    if (!cancelled && target && target !== tile) {
      const sourceId = tile.dataset.homeModule;
      const targetId = target.dataset.homeModule;
      const sourceIndex = homeOrder.indexOf(sourceId);
      const targetIndex = homeOrder.indexOf(targetId);
      [homeOrder[sourceIndex], homeOrder[targetIndex]] = [homeOrder[targetIndex], homeOrder[sourceIndex]];
      window.PanelAppearance?.setLayout('custom');
      applyHomeLayout(true);
      saveHomeLayout();
      showStatusToast('首页布局已更新');
    }
    dragState = null;
    suppressHomeClickUntil = Date.now() + 260;
  };

  homeBento.addEventListener('pointerdown', (event) => {
    // 只有明确选择自定义布局时允许换位，正常使用不与拖出争抢手势。
    if (document.documentElement.dataset.homeLayout !== 'custom') return;
    if (event.button !== 0 || event.isPrimary === false) return;
    const tile = event.target.closest('[data-home-module]');
    if (!tile || event.target.closest('button, input, textarea, select, a, audio, [contenteditable]')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    pendingLongPress = {
      tile,
      startX,
      startY,
      pointerId: event.pointerId,
      timer: setTimeout(() => {
        if (!pendingLongPress) return;
        tile.setPointerCapture?.(event.pointerId);
        homeBento.classList.add('layout-dragging');
        tile.classList.add('is-dragging');
        dragState = {
          tile,
          target: null,
          pointerId: event.pointerId,
          startX,
          startY,
        };
        pendingLongPress = null;
        if (navigator.vibrate) navigator.vibrate(18);
      }, 420),
    };
  });

  homeBento.addEventListener('click', (event) => {
    const sizeButton = event.target.closest('[data-widget-size-cycle]');
    if (!sizeButton) return;
    event.preventDefault();
    event.stopPropagation();
    const moduleId = sizeButton.dataset.widgetSizeCycle;
    if(moduleId==='music')return;
    window.PanelAppearance?.setLayout('custom');
    const sequence = ['mini', 'small', 'medium', 'large'];
    const current = homeSizes[moduleId] || HOME_SIZE_DEFAULTS[moduleId];
    const requested = sequence[(sequence.indexOf(current) + 1) % sequence.length];
    homeSizes = window.NotchDomain.normalizeHomeWidgetSizes({
      ...homeSizes,
      [moduleId]: requested,
    }, HOME_SIZE_DEFAULTS, moduleId, 48);
    applyHomeLayout(true);
    saveHomeLayout();
    showStatusToast(`${HOME_SIZE_LABELS[homeSizes[moduleId]]}组件 · 其他模块已自适应`);
  });

  homeBento.addEventListener('pointermove', (event) => {
    if (pendingLongPress) {
      const moved = Math.hypot(
        event.clientX - pendingLongPress.startX,
        event.clientY - pendingLongPress.startY
      );
      if (moved > 8) {
        clearTimeout(pendingLongPress.timer);
        pendingLongPress = null;
      }
      return;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { tile, startX, startY } = dragState;
    tile.style.setProperty('--home-drag-x', `${event.clientX - startX}px`);
    tile.style.setProperty('--home-drag-y', `${event.clientY - startY}px`);
    tile.classList.add('hit-test-off');
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-home-module]');
    tile.classList.remove('hit-test-off');
    clearDropTarget();
    dragState.target = hovered && hovered !== tile && homeBento.contains(hovered) ? hovered : null;
    dragState.target?.classList.add('layout-drop-target');
  });

  homeBento.addEventListener('pointerup', (event) => finishHomeDrag(event));
  homeBento.addEventListener('pointercancel', (event) => finishHomeDrag(event, true));
  homeBento.addEventListener('pointerleave', () => {
    if (!dragState && pendingLongPress) {
      clearTimeout(pendingLongPress.timer);
      pendingLongPress = null;
    }
  });
  homeBento.addEventListener('click', (event) => {
    if (Date.now() >= suppressHomeClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

// ============ 距离感应 Dock 悬浮 ============
function bindDockSurface(surface, selector, maxScale = 1.14) {
  if (!surface) return;
  let frame = null;
  const reset = () => {
    surface.querySelectorAll(selector).forEach((item) => {
      item.style.removeProperty('--dock-scale');
      item.style.removeProperty('--dock-lift');
      item.style.removeProperty('--dock-glow');
    });
  };
  surface.addEventListener('pointermove', (event) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      surface.querySelectorAll(selector).forEach((item) => {
        const rect = item.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
        const radius = Math.max(72, Math.min(150, rect.width * 2.2));
        const strength = Math.max(0, 1 - distance / radius) ** 2;
        item.style.setProperty('--dock-scale', (1 + (maxScale - 1) * strength).toFixed(3));
        item.style.setProperty('--dock-lift', `${(-5 * strength).toFixed(2)}px`);
        item.style.setProperty('--dock-glow', strength.toFixed(3));
      });
    });
  });
  surface.addEventListener('pointerleave', reset);
}

[
  ['#window-list', '.window-item', 1.12],
].forEach(([surfaceSelector, itemSelector, scale]) => {
  document.querySelectorAll(surfaceSelector).forEach((surface) => {
    bindDockSurface(surface, itemSelector, scale);
  });
});

// ============ 首页 · 用户图片画廊与实时镜子 ============
const homeMirror = document.querySelector('.home-mirror');
const mirrorStage = document.getElementById('mirror-stage');
const mirrorGalleryControls = document.querySelector('.mirror-gallery-controls');
const mirrorPhotoAction = document.getElementById('mirror-photo-action');
const mirrorPhotos = Array.from(document.querySelectorAll('.mirror-photo'));
const mirrorGalleryPlaceholder = document.getElementById('mirror-gallery-placeholder');
const mirrorGalleryPosition = document.getElementById('mirror-gallery-position');
const mirrorPrevious = document.getElementById('mirror-previous');
const mirrorNext = document.getElementById('mirror-next');
const mirrorAdd = document.getElementById('mirror-add');
const mirrorCamera = document.getElementById('mirror-camera');
const mirrorVideo = document.getElementById('mirror-video');
const mirrorDisplacement = document.getElementById('mirror-displacement');
const mirrorWaterCanvas = document.getElementById('mirror-water-canvas');
const mirrorPixelReveal = document.getElementById('mirror-pixel-reveal');
const mirrorSizeControl = homeMirror?.querySelector('.widget-size-control');
let mirrorLiquidFrame = null;
let mirrorLiquidScale = 0;
let mirrorLastPoint = null;
let mirrorWaterFrame = null;
let mirrorLastTrailAt = 0;
let mirrorWaterRipples = [];
let mirrorStream = null;
let mirrorStarting = false;
let mirrorZoom = 1;
let mirrorGallery = { version: 1, activeId: '', items: [], maxItems: 12 };
let mirrorGalleryDataUrl = '';
let mirrorGalleryLoadGeneration = 0;

mirrorGalleryControls?.addEventListener('focusin', () => {
  mirrorGalleryControls.classList.add('keyboard-active');
});
mirrorGalleryControls?.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!mirrorGalleryControls.contains(document.activeElement)) {
      mirrorGalleryControls.classList.remove('keyboard-active');
    }
  }, 0);
});
mirrorSizeControl?.addEventListener('focus', () => homeMirror?.classList.add('size-control-active'));
mirrorSizeControl?.addEventListener('blur', () => homeMirror?.classList.remove('size-control-active'));

function normalizePublicMirrorGallery(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const seen = new Set();
  const items = (Array.isArray(source.items) ? source.items : []).map((item) => {
    const id = String(item?.id || '').trim();
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return { id, createdAt: Math.max(0, Number(item.createdAt) || 0) };
  }).filter(Boolean).slice(0, 12);
  const requestedActiveId = String(source.activeId || '').trim();
  return {
    version: 1,
    activeId: items.some((item) => item.id === requestedActiveId) ? requestedActiveId : (items[0]?.id || ''),
    items,
    maxItems: Math.max(1, Math.min(12, Number(source.maxItems) || 12)),
  };
}

function mirrorGalleryIndex() {
  return mirrorGallery.items.findIndex((item) => item.id === mirrorGallery.activeId);
}

function updateMirrorGalleryControls() {
  const count = mirrorGallery.items.length;
  const index = mirrorGalleryIndex();
  const unavailable = Boolean(mirrorStream || mirrorStarting);
  if (mirrorGalleryPosition) mirrorGalleryPosition.textContent = count ? `${index + 1} / ${count}` : '0 / 0';
  if (mirrorPrevious) mirrorPrevious.disabled = unavailable || count <= 1;
  if (mirrorNext) mirrorNext.disabled = unavailable || count <= 1;
  if (mirrorAdd) mirrorAdd.disabled = unavailable || count >= mirrorGallery.maxItems;
  if (mirrorPhotoAction) {
    mirrorPhotoAction.disabled = unavailable;
    mirrorPhotoAction.setAttribute('aria-label', count ? '更换当前图片' : '添加图片');
  }
  if (mirrorCamera) {
    mirrorCamera.setAttribute('aria-label', mirrorStream || mirrorStarting ? '关闭实时镜子' : '打开实时镜子');
    mirrorCamera.setAttribute('aria-pressed', String(Boolean(mirrorStream)));
    mirrorCamera.disabled = mirrorStarting;
  }
}

function renderMirrorGalleryImage(dataUrl = '') {
  const validImage = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/');
  mirrorGalleryDataUrl = validImage ? dataUrl : '';
  mirrorPhotos.forEach((image) => {
    image.hidden = !validImage;
    if (validImage) image.src = dataUrl;
    else image.removeAttribute('src');
  });
  if (mirrorGalleryPlaceholder) mirrorGalleryPlaceholder.hidden = validImage;
  homeMirror?.classList.toggle('empty-gallery', !validImage);
  updateMirrorGalleryControls();
  document.dispatchEvent(new CustomEvent('notch:mirror-gallery-changed', {
    detail: { gallery: mirrorGallery, dataUrl: mirrorGalleryDataUrl },
  }));
}

async function applyMirrorGallery(value) {
  mirrorGallery = normalizePublicMirrorGallery(value);
  const generation = ++mirrorGalleryLoadGeneration;
  if (!mirrorGallery.activeId || !window.notchAPI?.getMirrorImage) {
    renderMirrorGalleryImage('');
    return;
  }
  const activeId = mirrorGallery.activeId;
  const dataUrl = await window.notchAPI.getMirrorImage(activeId).catch(() => null);
  if (generation !== mirrorGalleryLoadGeneration || activeId !== mirrorGallery.activeId) return;
  renderMirrorGalleryImage(dataUrl || '');
}

async function refreshMirrorGallery() {
  const gallery = await window.notchAPI?.getMirrorGallery?.().catch(() => null);
  await applyMirrorGallery(gallery || {});
}

async function addMirrorGalleryImages() {
  if (!window.notchAPI?.addMirrorImages) return null;
  if (mirrorGallery.items.length >= mirrorGallery.maxItems) {
    showStatusToast('图片画廊已达到 12 张上限');
    return { ok: false, error: 'gallery_full' };
  }
  const result = await window.notchAPI.addMirrorImages().catch(() => ({ ok: false }));
  if (result?.canceled) return result;
  if (!result?.ok) {
    showStatusToast(result?.error === 'gallery_full' ? '图片画廊已达到 12 张上限' : '没有添加图片，请选择有效且尺寸适中的图片');
    return result;
  }
  await applyMirrorGallery(result.gallery);
  const skipped = Number(result.skippedCount) || 0;
  showStatusToast(skipped ? `已添加 ${result.addedCount} 张，另有 ${skipped} 张未通过校验` : `已添加 ${result.addedCount} 张图片`);
  return result;
}

async function replaceActiveMirrorImage() {
  if (!mirrorGallery.activeId) return addMirrorGalleryImages();
  if (!window.notchAPI?.replaceMirrorImage) return null;
  const result = await window.notchAPI.replaceMirrorImage(mirrorGallery.activeId).catch(() => ({ ok: false }));
  if (result?.canceled) return result;
  if (!result?.ok) {
    showStatusToast('图片更换失败，请选择有效且尺寸适中的图片');
    return result;
  }
  await applyMirrorGallery(result.gallery);
  showStatusToast('当前图片已更换');
  return result;
}

async function stepMirrorGallery(direction) {
  const count = mirrorGallery.items.length;
  if (count <= 1 || !window.notchAPI?.selectMirrorImage) return null;
  const current = Math.max(0, mirrorGalleryIndex());
  const nextIndex = (current + (direction < 0 ? -1 : 1) + count) % count;
  const nextId = mirrorGallery.items[nextIndex].id;
  const result = await window.notchAPI.selectMirrorImage(nextId).catch(() => ({ ok: false }));
  if (!result?.ok) {
    showStatusToast('无法切换图片，请重试');
    return result;
  }
  await applyMirrorGallery(result.gallery);
  return result;
}

async function removeActiveMirrorImage() {
  if (!mirrorGallery.activeId || !window.notchAPI?.removeMirrorImage) return null;
  const result = await window.notchAPI.removeMirrorImage(mirrorGallery.activeId).catch(() => ({ ok: false }));
  if (result?.canceled) return result;
  if (!result?.ok) {
    showStatusToast('图片移除失败，请重试');
    return result;
  }
  await applyMirrorGallery(result.gallery);
  showStatusToast('图片已移到废纸篓');
  return result;
}

window.NotchMirrorGallery = Object.freeze({
  getState: () => ({ gallery: mirrorGallery, dataUrl: mirrorGalleryDataUrl }),
  refresh: refreshMirrorGallery,
  addImages: addMirrorGalleryImages,
  replaceActive: replaceActiveMirrorImage,
  previous: () => stepMirrorGallery(-1),
  next: () => stepMirrorGallery(1),
  removeActive: removeActiveMirrorImage,
});

window.notchAPI?.onMirrorGalleryChanged?.((gallery) => { void applyMirrorGallery(gallery); });
void refreshMirrorGallery();

function replayMirrorPixelReveal() {
  if (!mirrorPixelReveal || !homeMirror || activeTab !== 'home') return;
  if (!mirrorPixelReveal.childElementCount) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 80; index++) {
      const pixel = document.createElement('i');
      const row = Math.floor(index / 10);
      const column = index % 10;
      pixel.style.setProperty('--pixel-delay', `${(row * 24 + column * 13 + ((row + column) % 3) * 17)}ms`);
      fragment.appendChild(pixel);
    }
    mirrorPixelReveal.appendChild(fragment);
  }
  mirrorPixelReveal.classList.remove('revealing');
  void mirrorPixelReveal.offsetWidth;
  mirrorPixelReveal.classList.add('revealing');
  setTimeout(() => mirrorPixelReveal.classList.remove('revealing'), 1120);
}

function resizeMirrorWaterCanvas() {
  if (!mirrorWaterCanvas || !mirrorStage) return null;
  const bounds = mirrorStage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (mirrorWaterCanvas.width !== width || mirrorWaterCanvas.height !== height) {
    mirrorWaterCanvas.width = width;
    mirrorWaterCanvas.height = height;
  }
  return { bounds, dpr };
}

function animateMirrorWater(now) {
  const metrics = resizeMirrorWaterCanvas();
  const context = mirrorWaterCanvas?.getContext('2d');
  if (!metrics || !context) {
    mirrorWaterFrame = null;
    return;
  }
  context.clearRect(0, 0, mirrorWaterCanvas.width, mirrorWaterCanvas.height);
  mirrorWaterRipples = mirrorWaterRipples.filter((ripple) => now - ripple.startedAt < 1250);
  context.save();
  context.scale(metrics.dpr, metrics.dpr);
  context.globalCompositeOperation = 'screen';
  mirrorWaterRipples.forEach((ripple) => {
    const progress = Math.min(1, (now - ripple.startedAt) / 1250);
    const eased = 1 - (1 - progress) ** 3;
    for (let ring = 0; ring < 3; ring++) {
      const radius = 6 + eased * (34 + ripple.speed * 1.8) + ring * 7;
      context.beginPath();
      context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(190, 222, 255, ${Math.max(0, (1 - progress) * (0.17 - ring * 0.035))})`;
      context.lineWidth = Math.max(0.65, 1.55 - progress);
      context.stroke();
    }
  });
  context.restore();
  if (mirrorWaterRipples.length) mirrorWaterFrame = requestAnimationFrame(animateMirrorWater);
  else mirrorWaterFrame = null;
}

function addMirrorWaterRipple(x, y, speed) {
  mirrorWaterRipples.push({ x, y, speed: Math.min(18, speed), startedAt: performance.now() });
  if (mirrorWaterRipples.length > 18) mirrorWaterRipples.shift();
  if (!mirrorWaterFrame) mirrorWaterFrame = requestAnimationFrame(animateMirrorWater);
}

function setMirrorZoom(value) {
  mirrorZoom = value;
  mirrorStage?.style.setProperty('--mirror-zoom', String(mirrorZoom));
}

function stopMirror() {
  if (mirrorStream) {
    mirrorStream.getTracks().forEach((track) => track.stop());
    mirrorStream = null;
  }
  if (mirrorVideo) {
    mirrorVideo.pause();
    mirrorVideo.srcObject = null;
  }
  mirrorStarting = false;
  setMirrorZoom(1);
  if (mirrorLiquidFrame) cancelAnimationFrame(mirrorLiquidFrame);
  mirrorLiquidFrame = null;
  mirrorLiquidScale = 0;
  mirrorLastPoint = null;
  mirrorWaterRipples = [];
  if (mirrorWaterFrame) cancelAnimationFrame(mirrorWaterFrame);
  mirrorWaterFrame = null;
  const waterContext = mirrorWaterCanvas?.getContext('2d');
  waterContext?.clearRect(0, 0, mirrorWaterCanvas.width, mirrorWaterCanvas.height);
  mirrorDisplacement?.setAttribute('scale', '0');
  homeMirror?.classList.remove('live', 'camera-starting', 'liquid-active', 'ripple-active');
  mirrorCamera?.setAttribute('aria-label', '打开实时镜子');
  mirrorCamera?.setAttribute('aria-pressed', 'false');
  mirrorCamera?.removeAttribute('aria-busy');
  updateMirrorGalleryControls();
}

async function startMirror() {
  if (mirrorStarting || mirrorStream || !mirrorVideo) return;
  mirrorStarting = true;
  homeMirror?.classList.add('camera-starting');
  mirrorCamera?.setAttribute('aria-busy', 'true');
  updateMirrorGalleryControls();
  try {
    const permitted = !window.notchAPI || typeof window.notchAPI.ensureCamera !== 'function'
      ? true
      : await window.notchAPI.ensureCamera();
    if (!permitted) throw new Error('camera_permission_denied');
    if (!mirrorStarting || !isExpanded || activeTab !== 'home') return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 1280 },
      },
    });
    if (!isExpanded || activeTab !== 'home' || !mirrorStarting) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    mirrorStream = stream;
    mirrorVideo.srcObject = stream;
    await mirrorVideo.play();
    setMirrorZoom(1);
    homeMirror?.classList.remove('liquid-active');
    homeMirror?.classList.add('live');
    mirrorCamera?.setAttribute('aria-label', '关闭实时镜子');
    mirrorCamera?.setAttribute('aria-pressed', 'true');
  } catch (error) {
    stopMirror();
    const denied = error && (
      error.name === 'NotAllowedError' || error.message === 'camera_permission_denied'
    );
    showStatusToast(denied ? '需要摄像头权限才能打开镜子' : '暂时无法打开摄像头');
  } finally {
    mirrorStarting = false;
    homeMirror?.classList.remove('camera-starting');
    mirrorCamera?.removeAttribute('aria-busy');
    updateMirrorGalleryControls();
  }
}

function animateMirrorLiquid() {
  // 慢衰减保留轨迹长尾，Canvas 同时绘制传播中的同心波。
  mirrorLiquidScale += (0 - mirrorLiquidScale) * 0.035;
  mirrorDisplacement?.setAttribute('scale', mirrorLiquidScale.toFixed(2));
  if (mirrorLiquidScale > 0.35) {
    mirrorLiquidFrame = requestAnimationFrame(animateMirrorLiquid);
  } else {
    mirrorLiquidFrame = null;
  }
}

if (mirrorStage) {
  mirrorStage.addEventListener('pointerenter', () => {
    if (!mirrorStream && mirrorGalleryDataUrl) homeMirror?.classList.add('liquid-active');
  });
  mirrorStage.addEventListener('pointermove', (event) => {
    if (mirrorStream || !mirrorGalleryDataUrl) return;
    const bounds = mirrorStage.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const speed = mirrorLastPoint
      ? Math.hypot(event.clientX - mirrorLastPoint.x, event.clientY - mirrorLastPoint.y)
      : 0;
    mirrorLastPoint = { x: event.clientX, y: event.clientY };
    mirrorStage.style.setProperty('--liquid-x', `${(x * 100).toFixed(2)}%`);
    mirrorStage.style.setProperty('--liquid-y', `${(y * 100).toFixed(2)}%`);
    mirrorStage.style.setProperty('--liquid-shift-x', `${((0.5 - x) * 10).toFixed(2)}px`);
    mirrorStage.style.setProperty('--liquid-shift-y', `${((0.5 - y) * 10).toFixed(2)}px`);
    mirrorLiquidScale = Math.min(38, Math.max(mirrorLiquidScale, 14 + speed * 0.85));
    if (event.timeStamp - mirrorLastTrailAt > 42 && speed > 1.5) {
      mirrorLastTrailAt = event.timeStamp;
      addMirrorWaterRipple(event.clientX - bounds.left, event.clientY - bounds.top, speed);
    }
    if (!mirrorLiquidFrame) mirrorLiquidFrame = requestAnimationFrame(animateMirrorLiquid);
  });
  mirrorStage.addEventListener('pointerleave', () => {
    mirrorLastPoint = null;
    homeMirror?.classList.remove('liquid-active');
  });
  mirrorStage.addEventListener('wheel', (event) => {
    if (!window.NotchDomain.shouldHandleMirrorPinch({
      live: Boolean(mirrorStream),
      ctrlKey: event.ctrlKey,
    })) return;
    event.preventDefault();
    setMirrorZoom(window.NotchDomain.adjustMirrorZoom(mirrorZoom, event.deltaY));
  }, { passive: false });
}

mirrorPhotoAction?.addEventListener('click', () => { void replaceActiveMirrorImage(); });
mirrorAdd?.addEventListener('click', () => { void addMirrorGalleryImages(); });
mirrorPrevious?.addEventListener('click', () => { void stepMirrorGallery(-1); });
mirrorNext?.addEventListener('click', () => { void stepMirrorGallery(1); });
mirrorCamera?.addEventListener('click', async () => {
  if (mirrorStream || mirrorStarting) {
    stopMirror();
    return;
  }
  replayMirrorPixelReveal();
  await startMirror();
});

// ============ 首页 · 收藏剪贴 ============
const clipfavListEl = document.getElementById('clipfav-list');

function renderClipFavs() {
  if (!clipfavListEl) return;
  // 脏标记：clipHistory / clipFavorites / clipImageCache 均未变则跳过重建
  if (clipDataVersion === lastRenderedFavsVersion) return;

  // 按 clipFavorites 顺序取条目（过滤掉已删的）
  const favEntries = clipFavorites
    .map((id) => clipHistory.find((e) => e.id === id))
    .filter(Boolean);

  if (!favEntries.length) {
    clipfavListEl.innerHTML =
      '<button class="clipfav-empty" type="button" data-action="goto-clip">' +
      '去"剪贴板"Tab 给常用记录加星 →' +
      '</button>';
    lastRenderedFavsVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  // 渲染每条收藏
  clipfavListEl.innerHTML = favEntries
    .map((entry) => {
      const safeId = escapeHtml(entry.id);

      if (entry.type === 'image') {
        const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
        const mediaHtml = dataUrl
          ? `<img class="clipfav-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
          : `<div class="clipfav-thumb-placeholder">图</div>`;
        return (
          `<div class="clipfav-item clip-type-image" data-id="${safeId}" role="button" tabindex="0" title="图片">` +
          mediaHtml +
          `<span class="clipfav-text">图片</span>` +
          `</div>`
        );
      }

      // text | url
      const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
      const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
      let preview = entry.text || '';
      if (isUrl) {
        try {
          preview = new URL(entry.text).hostname || entry.text;
        } catch (_) {
          preview = entry.text || '';
        }
      }
      const safePreview = escapeHtml(preview);
      const safeTitle = escapeHtml(entry.text || '');
      return (
        `<div class="clipfav-item ${typeClass}" data-id="${safeId}" role="button" tabindex="0" title="${safeTitle}">` +
        `<span class="clipfav-text">${safePreview}</span>` +
        `</div>`
      );
    })
    .join('');
  lastRenderedFavsVersion = clipDataVersion; // 标记本次渲染版本

  // 按需预加载图片缩略图（命中后二次渲染刷新）
  // preloadClipImage 会自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  const missingImageEntries = favEntries.filter(
    (e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath)
  );
  if (missingImageEntries.length > 0) {
    Promise.all(missingImageEntries.map((e) => preloadClipImage(e.imagePath))).then(() => {
      const anyLoaded = missingImageEntries.some((e) => clipImageCache.has(e.imagePath));
      if (anyLoaded) renderClipFavs();
    });
  }
}

if (clipfavListEl) {
  clipfavListEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    // 空态：跳转 clip Tab
    if (e.target.closest('[data-action="goto-clip"]')) {
      setActiveTab('clip');
      return;
    }
    // 条目点击：复制
    const item = e.target.closest('.clipfav-item[data-id]');
    if (item) {
      const id = item.dataset.id;
      if (await copyClipEntry(id)) {
        item.classList.add('copied');
        setTimeout(() => item.classList.remove('copied'), 800);
      }
    }
  });
  clipfavListEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.repeat) return;
    const item = e.target.closest('.clipfav-item[data-id]');
    if (!item) return;
    e.preventDefault();
    if (await copyClipEntry(item.dataset.id)) {
      item.classList.add('copied');
      setTimeout(() => item.classList.remove('copied'), 800);
    }
  });
}

// ============ 剪贴板历史 ============
const CLIP_HISTORY_KEY = 'notch-clip-history';
const CLIP_FAV_KEY = 'notch-clip-favorites';
const CLIP_MAX = 100;
const CLIP_URL_RE = /^https?:\/\//i;
const starOutlineSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
const starFilledSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';

function loadClipHistory() {
  try {
    const raw = localStorage.getItem(CLIP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeClipEntry).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function normalizeClipEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const type = ['text', 'url', 'image', 'file'].includes(entry.type) ? entry.type : 'text';
  const text = typeof entry.text === 'string' ? entry.text : null;
  const imagePath = typeof entry.imagePath === 'string' ? entry.imagePath : null;
  const contentKey = typeof entry.contentKey === 'string' ? entry.contentKey : '';
  if (type === 'image' ? !imagePath : type === 'file' ? !entry.fileId : text === null) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
    type,
    text,
    imagePath,
    fileId:typeof entry.fileId==='string'?entry.fileId:null,
    fileNames:Array.isArray(entry.fileNames)?entry.fileNames.filter(n=>typeof n==='string'):[],
    contentKey,
    repeatCount: Math.max(1, Math.floor(Number(entry.repeatCount) || 1)),
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
  };
}

function saveClipHistory(list) {
  try {
    localStorage.setItem(CLIP_HISTORY_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    showStatusToast('剪贴记录未能保存，请检查本机存储；原内容仍在剪贴板中');
    return false;
  }
}

function loadClipFavorites() {
  try {
    const raw = localStorage.getItem(CLIP_FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p === 'string');
  } catch (e) {
    return [];
  }
}

function saveClipFavorites(list) {
  try {
    localStorage.setItem(CLIP_FAV_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

let clipHistory = loadClipHistory();
let clipFavorites = loadClipFavorites();
let clipFilter = 'all'; // all | text | image | faved
const clipImageCache = new Map(); // imagePath -> dataUrl，仅内存

function remapClipFavorites(replacements) {
  const mapping = new Map((Array.isArray(replacements) ? replacements : [])
    .filter((item) => item && item.fromId && item.toId)
    .map((item) => [item.fromId, item.toId]));
  if (!mapping.size) return;
  clipFavorites = Array.from(new Set(clipFavorites.map((id) => mapping.get(id) || id)));
  saveClipFavorites(clipFavorites);
}

function cleanupEvictedClipImages(evicted) {
  const retainedPaths = new Set(clipHistory
    .filter((entry) => entry.type === 'image' && entry.imagePath)
    .map((entry) => entry.imagePath));
  const paths = Array.from(new Set((Array.isArray(evicted) ? evicted : [])
    .filter((entry) => entry && entry.type === 'image' && entry.imagePath && !retainedPaths.has(entry.imagePath))
    .map((entry) => entry.imagePath)));
  if (!paths.length) return;
  paths.forEach((imagePath) => clipImageCache.delete(imagePath));
  window.notchAPI?.deleteClipImages?.(paths).catch(() => {});
}

async function compactStoredClipHistory() {
  if (!window.notchAPI?.normalizeClipHistory || !window.NotchDomain?.compactClipboardHistory) return;
  try {
    const revision = clipDataVersion;
    const enriched = await window.notchAPI.normalizeClipHistory(clipHistory);
    if (revision !== clipDataVersion) return;
    const compacted = window.NotchDomain.compactClipboardHistory(enriched, CLIP_MAX);
    if (!saveClipHistory(compacted.history)) return;
    clipHistory = compacted.history.map(normalizeClipEntry).filter(Boolean);
    remapClipFavorites(compacted.replacements);
    cleanupEvictedClipImages(compacted.evicted);
    saveClipHistory(clipHistory);
    clipDataVersion++;
    renderClipList();
    renderClipFavs();
  } catch (error) {
    // 旧数据迁移失败不影响本次使用，下次启动可以继续尝试。
  }
}

// 脏标记 —— 单调递增版本号：凡影响 renderClipList / renderClipFavs 输出的变更都自增。
// 宁可多自增（多一次重建）也不能漏（界面不更新）。
// 注意：preloadClipImage 在图片入缓存后也要自增，确保二次渲染不被脏标记挡掉。
let clipDataVersion = 0;
let lastRenderedClipVersion = -1; // renderClipList 上次渲染时的版本号
let lastRenderedFavsVersion = -1; // renderClipFavs 上次渲染时的版本号

const clipListEl = document.getElementById('clip-list');
const clipToolbarEl = document.getElementById('clip-toolbar');
const clipClearBtn = document.getElementById('clip-clear-btn');
let clipClearArmed = false;

// 防重入标志：renderClipList 内按需图片预加载完成后的二次渲染
let clipRenderPending = false;

async function preloadClipImage(imagePath) {
  if (!imagePath) return;
  if (clipImageCache.has(imagePath)) return;
  if (!window.notchAPI || typeof window.notchAPI.readClipImage !== 'function') return;
  try {
    const dataUrl = await window.notchAPI.readClipImage(imagePath);
    if (dataUrl) {
      clipImageCache.set(imagePath, dataUrl);
      clipDataVersion++; // 图片入缓存 → 版本自增，确保二次渲染不被脏标记挡掉（缩略图必须显示）
    }
  } catch (e) {
    // ignore read errors
  }
}

async function addClipEntry(raw) {
  const id = generateId();
  const entry = {
    id,
    type: raw.type || 'text',
    text: raw.text || null,
    imagePath: raw.imagePath || null,
    fileId:raw.fileId||null,fileNames:raw.fileNames||[],
    contentKey: typeof raw.contentKey === 'string' ? raw.contentKey : '',
    repeatCount: 1,
    timestamp: Date.now(),
  };

  // 相同内容只保留一个卡片，再次复制时移到最前并累加次数。
  const updated = window.NotchDomain.prependClipboardHistory(clipHistory, entry, CLIP_MAX);
  if (!saveClipHistory(updated.history)) return;
  clipHistory = updated.history;
  clipDataVersion++; // Invalidate in-flight migration before thumbnail I/O yields.
  remapClipFavorites(updated.replacements);
  const evicted = updated.evicted;
  cleanupEvictedClipImages(evicted);

  saveClipHistory(clipHistory);

  // 图片条目预加载缩略图
  if (entry.type === 'image' && entry.imagePath) {
    await preloadClipImage(entry.imagePath);
  }

  clipDataVersion++; // clipHistory 已变（含 FIFO 淘汰）
  renderClipList();
  renderClipFavs();
}

function formatClipTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function clipEntryHtml(entry, faved) {
  const favClass = faved ? ' faved' : '';
  const star = faved ? starFilledSvg : starOutlineSvg;
  const favLabel = faved ? '取消收藏' : '收藏';
  const timeStr = escapeHtml(formatClipTime(entry.timestamp));
  const repeatHtml = Number(entry.repeatCount) > 1
    ? `<span class="clip-repeat" aria-label="重复 ${Math.floor(Number(entry.repeatCount))} 次">×${Math.floor(Number(entry.repeatCount))}</span>`
    : '';
  const safeId = escapeHtml(entry.id);

  if (entry.type === 'image') {
    const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
    const thumbHtml = dataUrl
      ? `<img class="clip-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
      : `<span class="clip-thumb-placeholder">图片加载中…</span>`;
    return `<div class="clip-item clip-item-image clip-type-image" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制图片">
    <span class="clip-thumb-wrap">${thumbHtml}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span>${repeatHtml}</span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
  }

  // text | url 条目
  const safeText = escapeHtml(entry.text || '');
  const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
  const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
  const accessiblePreview = escapeHtml(
    (entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '空白内容'
  );
  return `<div class="clip-item clip-item-text ${typeClass}" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制：${accessiblePreview}">
    <span class="clip-text">${safeText}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span>${repeatHtml}</span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
}

function getFilteredClipItems() {
  if (clipFilter === 'all') return clipHistory;
  if (clipFilter === 'text') return clipHistory.filter((e) => e.type === 'text' || e.type === 'url');
  if (clipFilter === 'image') return clipHistory.filter((e) => e.type === 'image');
  if (clipFilter === 'faved') {
    const favSet = new Set(clipFavorites);
    return clipHistory.filter((e) => favSet.has(e.id));
  }
  return clipHistory;
}

function renderClipList() {
  window.QuickClipboard?.changed();
  if (!clipListEl) return;
  // 脏标记：数据/过滤器/图片缓存均未变则跳过全量重建
  if (clipDataVersion === lastRenderedClipVersion) return;

  const items = getFilteredClipItems();
  const favSet = new Set(clipFavorites);

  if (items.length === 0) {
    clipListEl.innerHTML =
      '<div class="clip-empty">' +
      (clipHistory.length ? '没有符合条件的记录' : '复制点什么，历史会出现在这里') +
      '</div>';
    lastRenderedClipVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  clipListEl.innerHTML = items.map((e) => clipEntryHtml(e, favSet.has(e.id))).join('');
  lastRenderedClipVersion = clipDataVersion; // 标记本次渲染版本（在预加载之前）

  // 按需预加载图片：收集当前 items 里 cache 未命中的 image 条目
  // preloadClipImage 成功后自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  if (clipRenderPending) return; // 防重入：已有预加载任务在途
  const missingPaths = items
    .filter((e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath))
    .map((e) => e.imagePath);

  if (missingPaths.length === 0) return;

  clipRenderPending = true;
  Promise.all(missingPaths.map((p) => preloadClipImage(p)))
    .then(() => {
      clipRenderPending = false;
      // 只有至少有一条路径成功填入 cache 才重渲，避免无意义刷新
      const anyLoaded = missingPaths.some((p) => clipImageCache.has(p));
      if (anyLoaded) renderClipList();
    })
    .catch(() => {
      clipRenderPending = false;
    });
}

// ---- 工具栏事件委托 ----
if (clipToolbarEl) {
  clipToolbarEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const filterBtn = e.target.closest('.clip-filter');
    if (filterBtn) {
      clipFilter = filterBtn.dataset.filter || 'all';
      clipToolbarEl.querySelectorAll('.clip-filter').forEach((b) => {
        const selected = b === filterBtn;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      clipDataVersion++; // clipFilter 已变 → 输出变化
      renderClipList();
      return;
    }
    if (e.target.closest('#clip-clear-btn')) {
      requestClearClipHistory();
    }
  });
  clipToolbarEl.querySelectorAll('.clip-filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
}

// ---- 列表事件委托 ----
if (clipListEl) {
  clipListEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.clip-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    // 优先判断子按钮
    const favoriteButton = e.target.closest('.clip-fav-btn');
    if (favoriteButton) {
      toggleClipFavorite(id, {
        restoreFocus: document.activeElement === favoriteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    const deleteButton = e.target.closest('.clip-del-btn');
    if (deleteButton) {
      deleteClipEntry(id, {
        restoreFocus: document.activeElement === deleteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    if (e.target.closest('[data-action="copy"]')) copyClipEntry(id);
  });
}

function focusClipControl(ids, action = 'copy') {
  if (!clipListEl) return;
  for (const id of ids.filter(Boolean)) {
    const target = clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`
    );
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  const activeFilter = clipToolbarEl && clipToolbarEl.querySelector('.clip-filter.active');
  if (activeFilter) activeFilter.focus({ preventScroll: true });
}

function toggleClipFavorite(id, focusContext = null) {
  const idx = clipFavorites.indexOf(id);
  if (idx === -1) {
    clipFavorites.push(id);
  } else {
    clipFavorites.splice(idx, 1);
  }
  clipDataVersion++; // clipFavorites 已变
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    const sameItemButton = clipListEl && clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="fav"]`
    );
    if (sameItemButton) {
      sameItemButton.focus({ preventScroll: true });
    } else {
      focusClipControl([focusContext.nextId, focusContext.previousId]);
    }
  }
}

function deleteClipEntry(id, focusContext = null) {
  const idx = clipHistory.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const entry = clipHistory[idx];
  const favoriteIndex = clipFavorites.indexOf(id);
  clipHistory.splice(idx, 1);
  clipFavorites = clipFavorites.filter((fid) => fid !== id);
  clipDataVersion++; // clipHistory + clipFavorites 已变
  saveClipHistory(clipHistory);
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    focusClipControl([focusContext.nextId, focusContext.previousId]);
  }
  showStatusToast('已删除剪贴记录', {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (clipHistory.some((item) => item.id === id)) return;
      clipHistory.splice(Math.min(idx, clipHistory.length), 0, entry);
      if (favoriteIndex !== -1) {
        clipFavorites.splice(Math.min(favoriteIndex, clipFavorites.length), 0, id);
      }
      clipDataVersion++;
      saveClipHistory(clipHistory);
      saveClipFavorites(clipFavorites);
      renderClipList();
      renderClipFavs();
      focusClipControl([id]);
      showStatusToast('已撤销删除');
    },
    onExpire: () => {
      if (entry.type !== 'image' || !entry.imagePath) return;
      clipImageCache.delete(entry.imagePath);
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages([entry.imagePath]).catch(() => {});
      }
    },
  });
}

function resetClipClearConfirmation() {
  clipClearArmed = false;
  if (clipClearBtn) {
    clipClearBtn.classList.remove('confirming');
    clipClearBtn.setAttribute('aria-label', '清空历史');
  }
}

function requestClearClipHistory() {
  if (clipHistory.length === 0) {
    showStatusToast('剪贴板历史已是空的');
    return;
  }
  if (!clipClearArmed) {
    clipClearArmed = true;
    if (clipClearBtn) {
      clipClearBtn.classList.add('confirming');
      clipClearBtn.setAttribute('aria-label', `再次点击确认清空 ${clipHistory.length} 条历史`);
    }
    showStatusToast(`再点一次垃圾桶，清空 ${clipHistory.length} 条记录`, {
      duration: 3000,
      onExpire: resetClipClearConfirmation,
    });
    return;
  }
  resetClipClearConfirmation();
  clearClipHistory();
}

if (clipClearBtn) {
  clipClearBtn.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  });
}

function clearClipHistory() {
  const removedCount = clipHistory.length;
  const imagePaths = clipHistory
    .filter((e) => e.type === 'image' && e.imagePath)
    .map((e) => e.imagePath);
  clipHistory = [];
  clipFavorites = [];
  clipImageCache.clear();
  clipDataVersion++; // 全部数据已清空
  saveClipHistory([]);
  saveClipFavorites([]);
  if (imagePaths.length > 0 && window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
    window.notchAPI.deleteClipImages(imagePaths).catch(() => {});
  }
  renderClipList();
  renderClipFavs();
  showStatusToast(`已清空 ${removedCount} 条剪贴记录`);
}

async function copyClipEntry(id) {
  const entry = clipHistory.find((e) => e.id === id);
  if (!entry) return false;
  if (!window.notchAPI) return false;
  try {
    const result = typeof window.notchAPI.pasteClipboard === 'function'
      ? await window.notchAPI.pasteClipboard(entry)
      : { ok: await window.notchAPI.writeClipboard(entry), pasted: false };
    if (!result?.ok) {
      showStatusToast('复制失败，请重试');
      return false;
    }
    showStatusToast(result.pasted
      ? '已向原输入框发送粘贴指令'
      : result.permissionRequired
        ? '请开启辅助功能权限；内容已复制'
        : entry.type === 'image' ? '图片已复制，可直接粘贴' : '已复制，可直接粘贴');
  } catch (e) {
    showStatusToast('复制失败，请重试');
    return false;
  }
  // 视觉反馈：800ms 后移除 copied 类
  const itemEl = clipListEl && clipListEl.querySelector(`.clip-item[data-id="${CSS.escape(id)}"]`);
  if (itemEl) {
    itemEl.classList.add('copied');
    setTimeout(() => itemEl.classList.remove('copied'), 800);
  }
  return true;
}

// ---- IPC 推送监听 ----
if (window.notchAPI && typeof window.notchAPI.onNewClipEntry === 'function') {
  window.notchAPI.onNewClipEntry((raw) => {
    addClipEntry(raw);
  });
}

renderAll();
renderClipList(); // 首屏确保 clip-list DOM 就绪时渲染一次（幂等）
renderClipFavs(); // 首屏渲染收藏剪贴块
void compactStoredClipHistory(); // 精确哈希合并旧版本留下的重复图片
initTab();
