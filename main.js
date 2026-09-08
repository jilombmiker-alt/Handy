const {
  app,
  BrowserWindow,
  screen,
  powerMonitor,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
  systemPreferences,
  clipboard,
  globalShortcut,
  safeStorage,
  dialog,
} = require('electron');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dns = require('dns');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');
const {
  isPrivateAddress,
  extractPageTitle,
  recordingExtension,
  normalizeWindowRows,
  todoReminderState,
  taskNotificationIdentity,
  normalizeCredentialInput,
  parseSmartLinkMetadata,
  extractFaviconHref,
  parseSmartMaterialMetadata,
  clipboardServicePolicy,
  updateFeaturePreference,
  DEFAULT_PANEL_SHORTCUT,
  isSafePanelShortcut,
  normalizePanelShortcut,
  controlSodaMusic,
  sodaShortcutSpec,
  selectTranscriptionSettings,
  MIRROR_GALLERY_MAX_ITEMS,
  normalizeMirrorGallery,
} = require('./main-services');
const { AiService } = require('./ai/service');
const { AiRunStore } = require('./ai/run-store');
const { ToolRegistry } = require('./ai/tool-registry');
const { createModelAdapter } = require('./ai/model-adapter');
const { createOpenAiCompatibleRequest } = require('./ai/openai-compatible-provider');
const { registerAiIpc, publicRun: publicAiRun } = require('./ai/electron-ipc');
const { RendererToolBridge } = require('./ai/renderer-tool-bridge');
const { createMeetingPrep } = require('./ai/meeting-prep');
const {createVoiceOrganizer}=require('./ai/voice-organizer');
const {createPlannerStore}=require('./main-planner');
const {createPlannerAI}=require('./ai/planner');
const plannerModel=require('./renderer/planner-model');
const plannerStore=createPlannerStore(()=>workspacePath('daily-planner-v1.json'));
const timerStore=require('./main-timer').createTimerStore(()=>workspacePath('simple-timer-v1.json'));
let simpleTimerInterval=null,timerTickBusy=false;
let plannerAI=null,plannerTimer=null,plannerLocked=false;
const voiceMemoModel=require('./renderer/voice-memo-model');
let voiceOrganizer=null;
const { createFloatingRuntime } = require('./main-floats');
const launcherModel = require('./renderer/launcher-model');
let launcherLayout = 'home';
const { createClipboardRuntime } = require('./main-clipboard');
const { createPanelPlacement } = require('./main-panel-placement');
const { MODIFIER_SHORTCUT, createModifierShortcut } = require('./main-modifier-shortcut');
const modifierShortcut = createModifierShortcut(() => handlePanelShortcutInvocation());
let shortcutRegistrationError = '';
let panelPlacement = null;
const { readPermissionSnapshot, permissionMessage, windowScanFailure, createPermissionRelaunch, applicationLocation, shouldShowOnLaunch, createPermissionRequest } = require('./main-permissions');
let floatingRuntime = null;
let materialPacks = null;
let mailRuntime = null;

// Keep the historical data directory so upgrading users retain notes, links,
// recordings and encrypted settings after the public product rename.
const LEGACY_USER_DATA_PATH = path.join(app.getPath('appData'), 'Dynamic Panel');
const TEST_USER_DATA_PATH = String(process.env.PANEL_TEST_USER_DATA_PATH || '').trim();
const IS_TEST_RUNTIME = process.env.PANEL_TEST_MODE === '1' && path.isAbsolute(TEST_USER_DATA_PATH);
app.setName('Handy');
app.setPath('userData', IS_TEST_RUNTIME ? TEST_USER_DATA_PATH : LEGACY_USER_DATA_PATH);

// ============ 托盘图标 PNG 生成 ============
// 直接在主进程编码 PNG，避免引入额外资源文件
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 4);
    scanlines[off] = 0;
    pixels.copy(scanlines, off + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(scanlines);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 生成刘海形状：扁平顶 + 圆角底，居中偏上
function makeNotchPng(scale) {
  const size = 16 * scale;
  const pixels = Buffer.alloc(size * size * 4);

  // 形状参数（pt 单位 × scale）
  const W = 10 * scale; // 刘海宽
  const H = 5 * scale; // 刘海高
  const R = 2 * scale; // 下方圆角半径
  const x0 = (size - W) / 2;
  const y0 = 3.5 * scale; // 距顶 padding

  function isInside(px, py) {
    if (px < x0 || px > x0 + W || py < y0 || py > y0 + H) return false;
    const bottomR = y0 + H - R;
    if (py < bottomR) return true;
    const leftR = x0 + R;
    const rightR = x0 + W - R;
    if (px >= leftR && px <= rightR) return true;
    if (px < leftR) {
      const dx = leftR - px;
      const dy = py - bottomR;
      return dx * dx + dy * dy <= R * R;
    }
    const dx = px - rightR;
    const dy = py - bottomR;
    return dx * dx + dy * dy <= R * R;
  }

  // 4×4 超采样抗锯齿
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let count = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (isInside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) count++;
        }
      }
      const alpha = Math.round((count / 16) * 255);
      const idx = (y * size + x) * 4;
      pixels[idx + 3] = alpha;
    }
  }

  return encodePng(size, size, pixels);
}

function createNotchTrayIcon() {
  const png2x = makeNotchPng(2);
  const icon = nativeImage.createFromBuffer(png2x, { scaleFactor: 2 });
  icon.setTemplateImage(true);
  return icon;
}

const COLLAPSED_WIDTH = 200;
const COLLAPSED_MIN_HEIGHT = 38;
// NOTCH_LIP（原 6px 唇边）已移除：折叠条高度现在恰好等于菜单栏高（≈物理刘海高），
// 一个像素都不超出物理刘海。虽然折叠条完全在菜单栏拦截带内，
// 但本项目窗口使用 setAlwaysOnTop(true,'screen-saver') 级别，
// 实测菜单栏不拦截该级别窗口的点击，折叠条仍可点击展开。
// （见项目记忆 notch-top-geometry-constraint / commit f12aea1）

// 所有 Tab 共用同一展开尺寸，切换内容时不再改变原生窗口边界。
// 原生窗口只在折叠/展开两个模式间切换，避免 Tab 切换产生明显的宽高跳变。
const EXPANDED_WIDTH = 1240;
const EXPANDED_PANEL_HEIGHT = 540;
const TAB_SIZES = {
  home: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  inbox: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  mail: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  todo: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  notes: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  clip: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  links: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  recordings: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  credentials: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
  settings: { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT },
};
// 与渲染层结构常量对应：panel padding-top(--s-2 8) + 顶栏(--topbar-h 40)
// + panels margin-top(--s-3 12) + panel padding-bottom(--s-4 16)。内容顶到屏幕最上沿，不留菜单栏带。
const EXPANDED_CHROME_Y = 76;
const SCREEN_MARGIN = 24; // 宽度超屏时两侧保留的安全边
const COLLAPSE_WATCHDOG_MS = 650;

const CLIP_MAX_ITEMS = 100;
const CLIP_POLL_INTERVAL_MS = 750;
const CLIP_IMAGE_POLL_INTERVAL_MS = 3000;
const CLIP_IMAGES_DIR_NAME = 'clipboard-images';

const RECORDINGS_DIR_NAME = 'recordings';
const TRANSCRIPTION_SETTINGS_FILE = 'transcription-settings.json';
const CREDENTIALS_VAULT_FILE = 'credentials.vault.json';
const APP_SETTINGS_FILE = 'app-settings.json';
const WORKSPACE_SETTINGS_FILE = 'workspace-settings.json';
const WORKSPACE_DATA_FILE = 'workspace.json';
const AI_RUNS_FILE = 'ai-runs.json';
const MIRROR_LEGACY_IMAGE_FILE = 'mirror-cover.jpg';
const MIRROR_IMAGES_DIR_NAME = 'mirror-images';
const MIRROR_GALLERY_FILE = 'mirror-gallery.json';
const SODA_MUSIC_APP = '/Applications/汽水音乐.app';
const TRANSCRIPTION_MODEL = 'qwen3-asr-flash-realtime';
const TRANSCRIPTION_SAMPLE_RATE = 16000;
const TRANSCRIPTION_FINISH_TIMEOUT_MS = 7000;
const RECORDING_MAX_BYTES = 200 * 1024 * 1024;
const LINK_FETCH_TIMEOUT_MS = 8000;
const LINK_FETCH_MAX_BYTES = 512 * 1024;
const LINK_FETCH_MAX_REDIRECTS = 3;

const TASK_NOTIFICATION_WIDTH = 400;
const TASK_NOTIFICATION_HEIGHT = 96;
const TASK_NOTIFICATION_SCREEN_MARGIN = 12;
const TASK_NOTIFICATION_VISIBLE_MS = 6000;
const TASK_NOTIFICATION_LEAVE_MS = 360;
const TASK_NOTIFICATION_DEDUPE_MS = 2000;
const TASK_NOTIFICATION_MAX_QUEUE = 5;
const TASK_NOTIFICATION_BODY_LIMIT = 64 * 1024;
const TASK_NOTIFICATION_HOST = '127.0.0.1';
const TASK_NOTIFICATION_PORT = 43821;
// /notify/<source> 的来源白名单：只放行已知 Agent，其余一律 404。
const TASK_NOTIFICATION_SOURCES = new Set(['codex', 'gpt', 'claude']);
const TODO_REMINDER_LEAD_MS = 60 * 60 * 1000;

let mainWindow = null;
let tray = null;
let currentMode = 'collapsed';
let currentTab = 'home';
let collapseWatchdog = null;
let collapseGeneration = 0;
let hideWhenCollapsed = false;
let isQuitting = false;
let mediaPermissionRequests = 0;
let transientSystemInteractionRequests = 0;
let cameraBlurDeferred = false;
let sodaMusicBridge = null;
let sodaMusicBusy = false;

let notificationWindow = null;
let notificationWindowReady = false;
let notificationServer = null;
let notificationServerAvailable = false;
let activeTaskNotification = null;
let taskNotificationLeaving = false;
let taskNotificationTimer = null;
let taskNotificationFallbackTimer = null;
let taskNotificationTimerStartedAt = 0;
let taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
let taskNotificationPaused = false;
const taskNotificationQueue = [];
const recentTaskNotifications = new Map();
const taskCompletionHistory = [];
let todoReminderTimer = null;
let scheduledTodoReminders = [];

let clipPollTimer = null;
let clipPolling = false; // 互斥锁：大图 toPNG 同步耗时，防止上一轮未完成又进入
let lastClipTextFingerprint = null;
let lastClipImageFingerprint = null;
let lastClipImageProbeAt = 0;
let pendingClipboardSelfWrite = null;
let configuredShortcut = '';
let pendingShortcutTest = null;
let aiRuntime = null;
let quickClipboard = null;
let lastClipFileFingerprint = null;
let windowScanCache = new Map();
let windowScanError='not_scanned',windowScanPending=null;
const windowGroups=require('./main-window-groups').createWindowGroups({file:()=>workspacePath('window-groups-v1.json'),scan:()=>({items:[...windowScanCache.values()],error:windowScanError})});
if(IS_TEST_RUNTIME)module.exports.windowGroups={store:windowGroups,icon:readWindowAppIcon,setScan(result){windowScanCache=new Map((result.items||[]).map(v=>[v.id,v]));windowScanError=result.error||null;}};
const windowIconCache = new Map();
const transcriptionSessions = new Map();

function isTrustedMainRenderer(event) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event
    && event.sender === mainWindow.webContents
  );
}

const aiToolBridge = new RendererToolBridge({
  ipcMain,
  getWebContents: () => (
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  ),
  isTrustedSender: isTrustedMainRenderer,
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (currentMode === 'collapsed') openRendererPanel('launcher:open', { kind:'resume' });
      else { mainWindow.show(); mainWindow.focus(); }
    }
  });
}

// 多屏适配：定位到"鼠标当前所在屏"的物理顶端居中
// 这样接上外接屏后，无论副屏在主屏的左/右/上/下，刘海都跟着用户视线走
function getTargetDisplay() {
  try {
    const cursor = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursor);
  } catch (e) {
    return screen.getPrimaryDisplay();
  }
}

// 窗口当前所在屏：模式切换 / Tab 变形必须锚定在这块屏上。
// 若跟随光标（getTargetDisplay），失焦收起瞬间会把刘海"瞬移"到光标所在的另一块屏。
function getWindowDisplay() {
  try {
    if (mainWindow) return screen.getDisplayMatching(mainWindow.getBounds());
  } catch (e) {
    // fallthrough
  }
  return getTargetDisplay();
}

function getCenteredBounds(width, height, display) {
  const d = display || getTargetDisplay();
  return {
    x: Math.round(d.bounds.x + (d.bounds.width - width) / 2),
    y: d.bounds.y, // 副屏的 y 不一定是 0，可能是负数（如外接屏在主屏上方）
    width,
    height,
  };
}

// macOS 菜单栏会拦截其高度带内的所有鼠标点击（即使窗口绘制在其上方），
// 刘海屏机型菜单栏高约 37pt，等于物理刘海高度。
function getMenuBarHeight(display) {
  return Math.max(0, display.workArea.y - display.bounds.y);
}

function getCollapsedHeight(display) {
  const mb = getMenuBarHeight(display);
  // 折叠条高度恰好等于菜单栏带（≈物理刘海高），一个像素都不超出物理刘海。
  // 无刘海的外接屏 menuBarHeight 仍是真实菜单栏高，能正常露头；
  // 异常取到 0 才回退兜底（COLLAPSED_MIN_HEIGHT = 38px）。
  return mb > 0 ? mb : COLLAPSED_MIN_HEIGHT;
}

// 展开尺寸按当前 Tab 取值；宽度超出屏幕时 clamp 到工作区内。
// 窗口从屏幕最顶垂下（y=0），内容直接顶到最上沿，高度不含菜单栏带。
function getExpandedSize(display) {
  const size = TAB_SIZES[currentTab] || TAB_SIZES.home;
  return {
    width: Math.min(size.width, display.workArea.width - SCREEN_MARGIN),
    height: Math.min(
      EXPANDED_CHROME_Y + size.panelHeight,
      Math.max(getCollapsedHeight(display), display.bounds.height - SCREEN_MARGIN)
    ),
  };
}

// display 不传时锚定窗口当前所在屏；只有"召唤"类动作（启动/重新居中/显示）才传光标屏。
// 一律瞬时 setBounds：系统动画 resize 会持续重绘 web 内容（卡顿）。
// 原生窗口只提供透明画布，用户可见的岛体形变交给渲染层 CSS。
function getBoundsForMode(mode, display) {
  const d = display || getWindowDisplay();
  if (mode === 'expanded') {
    return launcherModel.bounds(d.workArea, launcherLayout);
  }
  return getCenteredBounds(COLLAPSED_WIDTH, getCollapsedHeight(d), d);
}

function cancelCollapseWatchdog() {
  collapseGeneration++;
  if (collapseWatchdog) {
    clearTimeout(collapseWatchdog);
    collapseWatchdog = null;
  }
}

function applyMode(mode, display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  cancelCollapseWatchdog();
  currentMode = mode;
  panelPlacement?.syncHandle(mode === 'expanded');
  mainWindow.setBounds(getBoundsForMode(mode, display));
  // 折叠态需要压在菜单栏上，但展开后使用 floating 层即可。一直占用
  // screen-saver 层会把文件选择器、权限框和其他应用的转写浮层压在下面。
  mainWindow.setAlwaysOnTop(true, mode === 'expanded' ? 'floating' : 'screen-saver');
  mainWindow.setFocusable(mode === 'expanded');
  mainWindow.setIgnoreMouseEvents(false);
  if (mode === 'expanded') {
    hideWhenCollapsed = false;
    mainWindow.setOpacity(1);
  } else {
    // Electron/macOS 会把 y=0 自动夹到菜单栏下沿（例如本机从 0 变成 33），
    // 因而任何可见的折叠窗口都会压住当前应用。收起态只保留原生 Tray 图标，
    // 中央窗口完全隐藏；这是唯一不会侵占应用内容区的系统级实现。
    hideWhenCollapsed = false;
    mainWindow.setOpacity(0);
    mainWindow.hide();
    refreshTrayMenu();
  }
}

// 纯重新定位不能改变收起事务，否则屏幕变化会取消 watchdog 并重新吞掉鼠标。
function repositionWindow(display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBounds(getBoundsForMode(currentMode, display));
  panelPlacement?.syncHandle(currentMode === 'expanded');
}

function beginNativeCollapse() {
  if (!mainWindow || currentMode !== 'expanded') return;
  panelPlacement?.cancel();
  const targetWindow = mainWindow;
  const generation = ++collapseGeneration;
  targetWindow.setIgnoreMouseEvents(true);
  if (collapseWatchdog) clearTimeout(collapseWatchdog);
  collapseWatchdog = setTimeout(() => {
    if (generation !== collapseGeneration) return;
    collapseWatchdog = null;
    if (mainWindow === targetWindow && currentMode === 'expanded') {
      applyMode('collapsed');
    }
  }, COLLAPSE_WATCHDOG_MS);
}

function requestRendererCollapse() {
  if (!mainWindow || currentMode !== 'expanded') return;
  beginNativeCollapse();
  mainWindow.webContents.send('window:request-collapse');
}

function hideWindowAfterCollapse() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (currentMode === 'expanded') {
    hideWhenCollapsed = true;
    requestRendererCollapse();
    return;
  }
  hideWhenCollapsed = false;
  mainWindow.hide();
  refreshTrayMenu();
}

async function withTransientSystemInteraction(callback) {
  transientSystemInteractionRequests++;
  const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    ? mainWindow
    : null;
  if (parent) {
    parent.setFocusable(true);
    parent.setAlwaysOnTop(true, 'floating');
  }
  try {
    return await callback(parent);
  } finally {
    transientSystemInteractionRequests = Math.max(0, transientSystemInteractionRequests - 1);
    if (parent && !parent.isDestroyed()) {
      parent.setAlwaysOnTop(true, currentMode === 'expanded' ? 'floating' : 'screen-saver');
      parent.setFocusable(currentMode === 'expanded');
    }
    if (transientSystemInteractionRequests === 0 && cameraBlurDeferred) {
      cameraBlurDeferred = false;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) requestRendererCollapse();
    }
  }
}

function showPanelOpenDialog(options) {
  return withTransientSystemInteraction((parent) => (
    parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
  ));
}

function showPanelMessageBox(options) {
  return withTransientSystemInteraction((parent) => (
    parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
  ));
}

// ============ Codex / Claude / GPT 任务完成提醒 ============
// 使用独立的非激活窗口，避免打断主刘海窗口的展开、收起和焦点状态机。

function pickTaskNotificationValue(payload, keys) {
  for (const key of keys) {
    const value = payload[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value);
    }
  }
  return '';
}

function cleanTaskNotificationText(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const firstLine = String(value)
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';
  const cleaned = firstLine
    .replace(/^[#>*`_~\-\s]+/, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(cleaned);
  return characters.length > maxLength ? characters.slice(0, maxLength).join('') : cleaned;
}

function isSubagentNotification(payload) {
  const agentType = pickTaskNotificationValue(payload, [
    'agent_type',
    'agent-type',
    'agentType',
  ]).toLowerCase();
  const hookEvent = pickTaskNotificationValue(payload, [
    'hook_event_name',
    'hook-event-name',
    'hookEventName',
  ]).toLowerCase();
  // Claude Code 的 agent_type 存的是子代理名（Explore / security-reviewer 等），
  // 不含 subagent 字样，只有身处子代理时才带 agent_id，故以该字段存在为准。
  const agentId = pickTaskNotificationValue(payload, ['agent_id', 'agent-id', 'agentId']);
  return Boolean(agentId)
    || hookEvent.includes('subagent')
    || agentType.includes('subagent')
    || payload.is_subagent === true
    || payload.isSubagent === true;
}

function normalizeTaskNotification(payload, source) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (isSubagentNotification(payload)) return null;
  const identity = taskNotificationIdentity(payload, source);

  const taskId = cleanTaskNotificationText(
    pickTaskNotificationValue(payload, [
      'turn_id',
      'turn-id',
      'turnId',
      'thread_id',
      'thread-id',
      'threadId',
      'session_id',
      'session-id',
      'sessionId',
      'task_id',
      'task-id',
      'taskId',
      'id',
    ]),
    160
  );

  const completedAtValue = Number(
    pickTaskNotificationValue(payload, ['completed_at', 'completed-at', 'completedAt'])
  );
  const completedAt = Number.isFinite(completedAtValue) && completedAtValue > 0
    ? completedAtValue
    : Date.now();

  return {
    eventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    source,
    taskId,
    title: identity.title,
    project: identity.project,
    completedAt,
  };
}

function getPendingTaskNotificationCount() {
  return taskNotificationQueue.reduce(
    (total, item) => total + (item.summaryCount || 1),
    0
  );
}

function sendTaskNotificationQueueCount() {
  if (
    !notificationWindow ||
    notificationWindow.isDestroyed() ||
    !notificationWindowReady ||
    !activeTaskNotification
  ) {
    return;
  }
  notificationWindow.webContents.send(
    'task-notification:queue',
    getPendingTaskNotificationCount()
  );
}

function enqueueTaskNotification(notification) {
  if (!notification) return 'ignored';
  const now = Date.now();
  for (const [key, seenAt] of recentTaskNotifications) {
    if (now - seenAt > TASK_NOTIFICATION_DEDUPE_MS) recentTaskNotifications.delete(key);
  }

  const identity = notification.source==='planner' ? notification.eventId : notification.taskId || `${notification.title}:${notification.project}`;
  const dedupeKey = `${notification.source}:${identity}`;
  const lastSeenAt = recentTaskNotifications.get(dedupeKey);
  if (lastSeenAt && now - lastSeenAt <= TASK_NOTIFICATION_DEDUPE_MS) return 'duplicate';
  recentTaskNotifications.set(dedupeKey, now);

  if (notification.source !== 'todo' && notification.source !== 'planner') {
    taskCompletionHistory.unshift(notification);
    if (taskCompletionHistory.length > 20) taskCompletionHistory.length = 20;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-completion:new', notification);
    }
  }

  if (taskNotificationQueue.length < TASK_NOTIFICATION_MAX_QUEUE) {
    taskNotificationQueue.push(notification);
  } else {
    const lastIndex = taskNotificationQueue.length - 1;
    const previous = taskNotificationQueue[lastIndex];
    const summaryCount = previous.isSummary ? previous.summaryCount + 1 : 2;
    taskNotificationQueue[lastIndex] = {
      ...notification,
      source: 'task',
      taskId: '',
      title: `另有 ${summaryCount} 个任务已完成`,
      project: '',
      isSummary: true,
      summaryCount,
    };
  }

  if (activeTaskNotification) {
    sendTaskNotificationQueueCount();
  } else {
    showNextTaskNotification();
  }
  return 'queued';
}

function clearTodoReminderTimer() {
  if (todoReminderTimer) clearTimeout(todoReminderTimer);
  todoReminderTimer = null;
}

function fireTodoReminder(todo) {
  const deadline = Date.parse(String(todo.deadline || ''));
  const notification = {
    eventId: `todo-${todo.id}-${deadline}`,
    source: 'todo',
    taskId: String(todo.id || ''),
    title: String(todo.text || '').trim() || '待办即将截止',
    project: '',
    detail: '将在 1 小时内截止',
    deadline,
    completedAt: Date.now(),
  };
  enqueueTaskNotification(notification);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('todo:reminded', {
      id: notification.taskId,
      deadline: String(todo.deadline || ''),
      remindedAt: notification.completedAt,
    });
  }
}

function scheduleNextTodoReminder() {
  clearTodoReminderTimer();
  const now = Date.now();
  let nextDelay = Infinity;
  for (const todo of scheduledTodoReminders) {
    const status = todoReminderState(todo, now, TODO_REMINDER_LEAD_MS);
    if (status.state === 'due') {
      todo.remindedAt = now;
      fireTodoReminder(todo);
      continue;
    }
    if (status.state === 'scheduled') nextDelay = Math.min(nextDelay, status.delayMs);
  }
  if (Number.isFinite(nextDelay)) {
    todoReminderTimer = setTimeout(scheduleNextTodoReminder, Math.max(250, nextDelay));
  }
}

ipcMain.handle('todos:schedule-reminders', (event, items) => {
  scheduledTodoReminders = Array.isArray(items)
    ? items
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || '').slice(0, 160),
        text: String(item.text || '').trim().slice(0, 160),
        deadline: String(item.deadline || ''),
        done: item.done === true,
        remindedAt: Math.max(0, Number(item.remindedAt) || 0),
      }))
      .filter((item) => item.id && item.text)
    : [];
  scheduleNextTodoReminder();
  return { ok: true, count: scheduledTodoReminders.length };
});

ipcMain.handle('pomodoro:notify', (event, minutes) => {
  const safeMinutes = Math.max(1, Math.min(120, Math.round(Number(minutes) || 25)));
  const completedAt = Date.now();
  const notification = {
    eventId: `pomodoro-${completedAt}`,
    taskId: `pomodoro-${completedAt}`,
    source: 'pomodoro',
    project: '番茄钟',
    title: '专注完成',
    body: `${safeMinutes} 分钟专注计时已结束`,
    completedAt,
  };
  return { ok: true, result: enqueueTaskNotification(notification) };
});

function getTaskNotificationBounds(display) {
  const d = display || getTargetDisplay();
  const width = Math.min(
    TASK_NOTIFICATION_WIDTH,
    Math.max(280, d.bounds.width - TASK_NOTIFICATION_SCREEN_MARGIN * 2)
  );
  return getCenteredBounds(width, TASK_NOTIFICATION_HEIGHT, d);
}

function recoverClosedTaskNotificationWindow(targetWindow) {
  if (notificationWindow !== targetWindow) return;
  const interruptedNotification = activeTaskNotification;
  clearTaskNotificationTimers();
  notificationWindow = null;
  notificationWindowReady = false;
  activeTaskNotification = null;
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  if (!isQuitting && interruptedNotification) {
    taskNotificationQueue.unshift(interruptedNotification);
  }
  if (!isQuitting) setTimeout(showNextTaskNotification, 80);
}

function createTaskNotificationWindow() {
  if (notificationWindow && !notificationWindow.isDestroyed()) return notificationWindow;
  const bounds = getTaskNotificationBounds();
  notificationWindowReady = false;
  notificationWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    hiddenInMissionControl: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const targetWindow = notificationWindow;
  notificationWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  notificationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notificationWindow.setIgnoreMouseEvents(false);
  notificationWindow.loadFile(path.join(__dirname, 'renderer', 'notification.html'));

  targetWindow.webContents.once('did-finish-load', () => {
    if (notificationWindow !== targetWindow || targetWindow.isDestroyed()) return;
    notificationWindowReady = true;
    showNextTaskNotification();
  });

  targetWindow.webContents.on('render-process-gone', () => {
    if (!targetWindow.isDestroyed()) targetWindow.destroy();
  });
  targetWindow.on('closed', () => {
    recoverClosedTaskNotificationWindow(targetWindow);
  });
  return notificationWindow;
}

function clearTaskNotificationTimers() {
  if (taskNotificationTimer) {
    clearTimeout(taskNotificationTimer);
    taskNotificationTimer = null;
  }
  if (taskNotificationFallbackTimer) {
    clearTimeout(taskNotificationFallbackTimer);
    taskNotificationFallbackTimer = null;
  }
}

function scheduleTaskNotificationDismiss() {
  if (!activeTaskNotification || taskNotificationLeaving || taskNotificationPaused) return;
  if (taskNotificationTimer) clearTimeout(taskNotificationTimer);
  taskNotificationTimerStartedAt = Date.now();
  taskNotificationTimer = setTimeout(
    beginTaskNotificationDismiss,
    Math.max(0, taskNotificationRemainingMs)
  );
}

function setTaskNotificationPaused(paused) {
  if (!activeTaskNotification || taskNotificationLeaving || taskNotificationPaused === paused) return;
  taskNotificationPaused = paused;
  if (paused) {
    if (taskNotificationTimer) {
      taskNotificationRemainingMs = Math.max(
        0,
        taskNotificationRemainingMs - (Date.now() - taskNotificationTimerStartedAt)
      );
      clearTimeout(taskNotificationTimer);
      taskNotificationTimer = null;
    }
  } else {
    scheduleTaskNotificationDismiss();
  }
}

function showNextTaskNotification() {
  if (activeTaskNotification || taskNotificationQueue.length === 0 || isQuitting) return;
  const targetWindow = createTaskNotificationWindow();
  if (!notificationWindowReady || !targetWindow || targetWindow.isDestroyed()) return;

  activeTaskNotification = taskNotificationQueue.shift();
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  targetWindow.setBounds(getTaskNotificationBounds(getTargetDisplay()));
  targetWindow.showInactive();
  targetWindow.webContents.send('task-notification:show', {
    ...activeTaskNotification,
    pendingCount: getPendingTaskNotificationCount(),
    visibleMs: TASK_NOTIFICATION_VISIBLE_MS,
  });
  scheduleTaskNotificationDismiss();
}

function beginTaskNotificationDismiss() {
  if (!activeTaskNotification || taskNotificationLeaving) return;
  taskNotificationLeaving = true;
  clearTaskNotificationTimers();
  const eventId = activeTaskNotification.eventId;
  if (notificationWindow && !notificationWindow.isDestroyed() && notificationWindowReady) {
    notificationWindow.webContents.send('task-notification:hide', eventId);
  }
  taskNotificationFallbackTimer = setTimeout(
    () => finishTaskNotification(eventId),
    TASK_NOTIFICATION_LEAVE_MS + 120
  );
}

function finishTaskNotification(eventId) {
  if (!activeTaskNotification || activeTaskNotification.eventId !== eventId) return;
  clearTaskNotificationTimers();
  if (notificationWindow && !notificationWindow.isDestroyed()) notificationWindow.hide();
  activeTaskNotification = null;
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  setTimeout(showNextTaskNotification, 80);
}

function sendTaskNotificationResponse(response, statusCode, body) {
  if (response.headersSent) return;
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  response.end(json);
}

function startTaskNotificationServer() {
  if (notificationServer) return;
  const server = http.createServer((request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url || '/', `http://${TASK_NOTIFICATION_HOST}`);
    } catch (error) {
      sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_url' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendTaskNotificationResponse(response, 200, { ok: true });
      return;
    }

    const sourceMatch = /^\/notify\/([a-z0-9-]{1,32})$/i.exec(requestUrl.pathname);
    const requestedSource = sourceMatch ? sourceMatch[1].toLowerCase() : '';
    const source = TASK_NOTIFICATION_SOURCES.has(requestedSource) ? requestedSource : null;
    if (request.method !== 'POST' || !source) {
      sendTaskNotificationResponse(response, 404, { ok: false, error: 'not_found' });
      return;
    }
    const contentType = String(request.headers['content-type'] || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      sendTaskNotificationResponse(response, 415, {
        ok: false,
        error: 'application_json_required',
      });
      return;
    }

    const chunks = [];
    let bodyLength = 0;
    let bodyTooLarge = false;
    request.on('data', (chunk) => {
      bodyLength += chunk.length;
      if (bodyLength > TASK_NOTIFICATION_BODY_LIMIT) {
        bodyTooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!bodyTooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (bodyTooLarge) {
        sendTaskNotificationResponse(response, 413, { ok: false, error: 'body_too_large' });
        return;
      }
      let payload;
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch (error) {
        sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_json' });
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_payload' });
        return;
      }
      const result = enqueueTaskNotification(normalizeTaskNotification(payload, source));
      sendTaskNotificationResponse(response, 202, { ok: true, result });
    });
    request.on('error', () => {
      if (!response.headersSent) sendTaskNotificationResponse(response, 400, { ok: false });
    });
  });
  notificationServer = server;

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.once('listening', () => {
    if (notificationServer !== server) return;
    notificationServerAvailable = true;
    refreshTrayMenu();
  });
  server.on('error', (error) => {
    if (notificationServer === server) notificationServer = null;
    notificationServerAvailable = false;
    refreshTrayMenu();
    console.warn(`Task notification server unavailable: ${error.message}`);
  });
  server.listen(TASK_NOTIFICATION_PORT, TASK_NOTIFICATION_HOST);
}

function stopTaskNotificationServer() {
  const server = notificationServer;
  notificationServer = null;
  notificationServerAvailable = false;
  if (server) server.close();
}

ipcMain.on('task-notification:hover', (event, paused) => {
  if (
    notificationWindow &&
    !notificationWindow.isDestroyed() &&
    event.sender === notificationWindow.webContents
  ) {
    setTaskNotificationPaused(paused === true);
  }
});

ipcMain.on('task-notification:dismissed', (event, eventId) => {
  if (
    notificationWindow &&
    !notificationWindow.isDestroyed() &&
    event.sender === notificationWindow.webContents &&
    typeof eventId === 'string'
  ) {
    finishTaskNotification(eventId);
  }
});

function createWindow() {
  const initial = getCenteredBounds(COLLAPSED_WIDTH, getCollapsedHeight(getTargetDisplay()));

  mainWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    // 必须显式给透明底色：只写 transparent 时 BrowserWindow 仍保留不透明的默认底色，
    // 展开瞬间 setBounds 放大后，新暴露的区域会先用它画一两帧，
    // 在菜单栏带上表现为一次黑块闪烁（通知窗口一直是这么写的）。
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: true,
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Escape 在到达页面前会被 Chromium 浏览器层吞掉（实测 document keydown 收不到），
  // 用 before-input-event 在分发前拦截并转发给渲染层处理（退出输入 / 收起面板）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      if (panelPlacement?.cancel()) { event.preventDefault(); return; }
      mainWindow.webContents.send('key:escape');
    }
  });

  // 失焦时让渲染层走完整退场动画，再由渲染层请求缩小原生窗口。
  mainWindow.on('blur', () => {
    if (mediaPermissionRequests > 0 || transientSystemInteractionRequests > 0) {
      cameraBlurDeferred = true;
      return;
    }
    requestRendererCollapse();
  });

  mainWindow.on('focus', () => {
    cameraBlurDeferred = false;
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    applyMode('collapsed');
    let openedAtLogin = false;
    try { openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin === true; } catch {}
    if (shouldShowOnLaunch({ packaged:app.isPackaged, testRuntime:IS_TEST_RUNTIME, openedAtLogin })) {
      openRendererPanel('launcher:open', { kind:'resume' });
    }
  });

  mainWindow.on('closed', () => {
    cancelCollapseWatchdog();
    hideWhenCollapsed = false;
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideWindowAfterCollapse();
  });
}

function toggleVisibility() {
  openRendererPanel('shortcut:toggle-panel');
}

function isAutoLaunchEnabled() {
  if (process.platform !== 'darwin') return false;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
}

function setAutoLaunch(enabled) {
  if (process.platform !== 'darwin') return false;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
    return isAutoLaunchEnabled() === enabled;
  } catch (e) {
    return false;
  }
}

const DEFAULT_FEATURES = {
  home: true,
  inbox: true,
  mail: true,
  todo: true,
  notes: true,
  links: true,
  recordings: true,
  credentials: true,
  clip: false,
};

function getJsonSettingsPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJsonFile(filePath, fallback = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
    return false;
  }
}

function readAppSettings() {
  const stored = readJsonFile(getJsonSettingsPath(APP_SETTINGS_FILE));
  return {
    features: { ...DEFAULT_FEATURES, ...(stored.features || {}), home: true },
    shortcut: stored.shortcutV2 ? normalizePanelShortcut(stored.shortcut) : MODIFIER_SHORTCUT,
    shortcutV2: true,
    fallbackShortcut: normalizePanelShortcut(stored.fallbackShortcut || (stored.shortcut !== MODIFIER_SHORTCUT ? stored.shortcut : DEFAULT_PANEL_SHORTCUT)),
  };
}

function publicAppSettings() {
  return { ...readAppSettings(), autoLaunch: isAutoLaunchEnabled(), shortcutError: shortcutRegistrationError, activeShortcut: configuredShortcut };
}

function saveAppSettings(settings) {
  return writeJsonFile(getJsonSettingsPath(APP_SETTINGS_FILE), settings);
}

function workspaceRoot() {
  const settings = readJsonFile(getJsonSettingsPath(WORKSPACE_SETTINGS_FILE));
  const configured = String(settings.path || '').trim();
  return configured && path.isAbsolute(configured) ? configured : app.getPath('userData');
}

function workspacePath(name) {
  return path.join(workspaceRoot(), name);
}

function emitAiRunChanged(run) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('ai:run-changed', publicAiRun(run));
}

function createAiRuntime() {
  const initialConfig = resolveLlmConfig();
  const request = createOpenAiCompatibleRequest({
    getConfig: resolveLlmConfig,
    validateEndpoint: validatePublicHttpUrl,
    fetchImpl: fetch,
  });
  const service = new AiService({
    adapter: createModelAdapter({ request, model: initialConfig.model, timeoutMs: 12000 }),
    runStore: new AiRunStore({ filePath: workspacePath(AI_RUNS_FILE) }),
    // 模型只生成建议；三种写操作都必须经过用户确认，再由受信任的渲染页执行确定性本地写入。
    toolRegistry: new ToolRegistry({
      create_todo: (fields, context) => aiToolBridge.execute('create_todo', fields, context),
      save_note: (fields, context) => aiToolBridge.execute('save_note', fields, context),
      save_link: (fields, context) => aiToolBridge.execute('save_link', fields, context),
    }),
    logger: (entry) => console.info('[ai-run]', JSON.stringify(entry)),
    onRunChanged: emitAiRunChanged,
  });
  service.recoverInterruptedRuns();
  return service;
}

function getAiService() {
  if (!aiRuntime) aiRuntime = createAiRuntime();
  return aiRuntime;
}

function resetAiService() {
  if (aiRuntime) aiRuntime.cancelAll();
  aiRuntime = null;
}

registerAiIpc({
  ipcMain,
  getService: getAiService,
  isTrustedSender: isTrustedMainRenderer,
});

function copyWorkspaceAssets(sourceRoot, targetRoot) {
  if (!sourceRoot || !targetRoot || path.resolve(sourceRoot) === path.resolve(targetRoot)) return;
  for (const directory of [RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME, MIRROR_IMAGES_DIR_NAME]) {
    const source = path.join(sourceRoot, directory);
    const target = path.join(targetRoot, directory);
    try {
      if (!fs.existsSync(source) || !fs.lstatSync(source).isDirectory()) continue;
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
    } catch (error) {}
  }
  for (const filename of [WORKSPACE_DATA_FILE, AI_RUNS_FILE, MIRROR_GALLERY_FILE, MIRROR_LEGACY_IMAGE_FILE]) {
    const source = path.join(sourceRoot, filename);
    const target = path.join(targetRoot, filename);
    try {
      if (fs.existsSync(source) && fs.lstatSync(source).isFile() && !fs.existsSync(target)) {
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      }
    } catch (error) {}
  }
}

async function chooseWorkspaceFolder() {
  const result = await showPanelOpenDialog({ title: '选择Handy数据文件夹', properties: ['openDirectory', 'createDirectory'] });
  const selected = !result.canceled && result.filePaths && result.filePaths[0];
  if (!selected) return false;
  const previousRoot = workspaceRoot();
  resetAiService();
  copyWorkspaceAssets(previousRoot, selected);
  if (!writeJsonFile(getJsonSettingsPath(WORKSPACE_SETTINGS_FILE), { path: selected })) return false;
  for (const directory of [RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME, MIRROR_IMAGES_DIR_NAME]) {
    try { fs.mkdirSync(path.join(selected, directory), { recursive: true }); } catch (error) {}
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:changed', { path: selected });
  refreshTrayMenu();
  return true;
}

function applyFeatureServices(features) {
  if (features.mail === false) mailRuntime?.cancel();
  const policy = clipboardServicePolicy(features);
  quickClipboard?.enable(policy.registerGlobalShortcut);
  if (policy.recordHistory && !quickClipboard?.snapshot().paused) startClipboardPolling();
  else stopClipboardPolling();
}

function setPanelShortcut(shortcut) {
  if (!isSafePanelShortcut(shortcut)) return false;
  const previousShortcut = configuredShortcut;
  modifierShortcut.stop();
  if (configuredShortcut && configuredShortcut !== MODIFIER_SHORTCUT && globalShortcut.isRegistered(configuredShortcut)) {
    globalShortcut.unregister(configuredShortcut);
  }
  let registered = false;
  try {
    registered = shortcut === MODIFIER_SHORTCUT ? modifierShortcut.start() : globalShortcut.register(shortcut, handlePanelShortcutInvocation);
  } catch (error) {}
  if (registered) {
    shortcutRegistrationError = '';
    configuredShortcut = shortcut;
    return true;
  }
  configuredShortcut = '';
  shortcutRegistrationError = shortcut === MODIFIER_SHORTCUT ? modifierShortcut.error : 'occupied';
  if (previousShortcut && isSafePanelShortcut(previousShortcut)) {
    try {
      if (previousShortcut === MODIFIER_SHORTCUT ? modifierShortcut.start() : globalShortcut.register(previousShortcut, handlePanelShortcutInvocation)) configuredShortcut = previousShortcut;
    } catch (error) {}
  }
  return false;
}

function showMainWindowForShortcut() {
  quickClipboard?.capture();
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  hideWhenCollapsed = false;
  if (!mainWindow.isVisible()) {
    // 先透明显示，等待渲染层请求 expanded 后再由 applyMode 恢复不透明，
    // 避免 macOS 强制下移的折叠黑条在应用内容区闪现一帧。
    mainWindow.setOpacity(0);
    mainWindow.show();
  }
  mainWindow.setFocusable(true);
  mainWindow.focus();
  return true;
}

function handlePanelShortcutInvocation() {
  if (!showMainWindowForShortcut()) return;
  if (pendingShortcutTest && configuredShortcut === pendingShortcutTest.candidate) {
    pendingShortcutTest.triggered = true;
    if (pendingShortcutTest.timer) {
      clearTimeout(pendingShortcutTest.timer);
      pendingShortcutTest.timer = null;
    }
    mainWindow.webContents.send('shortcut:test-triggered', {
      shortcut: pendingShortcutTest.candidate,
    });
    if (currentMode === 'collapsed') mainWindow.webContents.send('shortcut:toggle-panel');
    return;
  }
  mainWindow.webContents.send('shortcut:toggle-panel');
}

function restoreShortcutAfterTest(reason = 'cancelled') {
  if (!pendingShortcutTest) return false;
  const previous = pendingShortcutTest.previous;
  if (pendingShortcutTest.timer) clearTimeout(pendingShortcutTest.timer);
  pendingShortcutTest = null;
  setPanelShortcut(previous || DEFAULT_PANEL_SHORTCUT);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shortcut:test-ended', { reason });
  }
  return true;
}

function expireShortcutTest() {
  if (!pendingShortcutTest || pendingShortcutTest.triggered) return;
  restoreShortcutAfterTest('expired');
  if (!showMainWindowForShortcut()) return;
  if (currentMode === 'collapsed') mainWindow.webContents.send('shortcut:toggle-panel');
}

function applyAppSettings() {
  const settings = readAppSettings();
  const stored = readJsonFile(getJsonSettingsPath(APP_SETTINGS_FILE));
  if (stored.shortcut !== settings.shortcut) saveAppSettings(settings);
  applyFeatureServices(settings.features);
  if (!setPanelShortcut(settings.shortcut)) {
    // Keep the requested choice visible. A fallback is an entry point, not a silent replacement.
    const reason = shortcutRegistrationError;
    if (!configuredShortcut) setPanelShortcut(settings.fallbackShortcut === MODIFIER_SHORTCUT ? DEFAULT_PANEL_SHORTCUT : settings.fallbackShortcut);
    shortcutRegistrationError = reason;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', publicAppSettings());
}

function openRendererPanel(channel, payload, capture = true) {
  if (capture && !mainWindow?.isFocused()) quickClipboard?.capture();
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  hideWhenCollapsed = false;
  repositionWindow(getTargetDisplay());
  mainWindow.setFocusable(true);
  if (!mainWindow.isVisible()) {
    mainWindow.setOpacity(0);
    mainWindow.show();
  }
  mainWindow.focus();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  if (mainWindow.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

function mirrorImagesDirectory() {
  return workspacePath(MIRROR_IMAGES_DIR_NAME);
}

function mirrorGalleryManifestPath() {
  return workspacePath(MIRROR_GALLERY_FILE);
}

function ensureMirrorImagesDirectory() {
  try {
    fs.mkdirSync(mirrorImagesDirectory(), { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
}

function mirrorGalleryItemPath(item) {
  return path.join(mirrorImagesDirectory(), item.fileName);
}

function writeMirrorGallery(gallery) {
  return writeJsonFile(mirrorGalleryManifestPath(), normalizeMirrorGallery(gallery));
}

function readMirrorGallery() {
  ensureMirrorImagesDirectory();
  let gallery = normalizeMirrorGallery(readJsonFile(mirrorGalleryManifestPath(), {}));
  const existingItems = gallery.items.filter((item) => {
    try { return fs.lstatSync(mirrorGalleryItemPath(item)).isFile(); } catch (error) { return false; }
  });
  if (existingItems.length !== gallery.items.length) {
    gallery = normalizeMirrorGallery({ ...gallery, items: existingItems });
    writeMirrorGallery(gallery);
  }

  // 旧版本只允许一张用户图片。它不是默认素材，升级时应迁移而不是删除用户数据。
  const legacyPath = workspacePath(MIRROR_LEGACY_IMAGE_FILE);
  if (!gallery.items.length && fs.existsSync(legacyPath)) {
    const id = crypto.randomUUID();
    const item = { id, fileName: `mirror-${id}.jpg`, createdAt: Date.now() };
    try {
      fs.renameSync(legacyPath, mirrorGalleryItemPath(item));
      gallery = normalizeMirrorGallery({ version: 1, activeId: id, items: [item] });
      writeMirrorGallery(gallery);
    } catch (error) {}
  }
  return gallery;
}

function publicMirrorGallery(gallery = readMirrorGallery()) {
  const normalized = normalizeMirrorGallery(gallery);
  return {
    version: 1,
    activeId: normalized.activeId,
    items: normalized.items.map((item) => ({ id: item.id, createdAt: item.createdAt })),
    maxItems: MIRROR_GALLERY_MAX_ITEMS,
  };
}

function mirrorImageDataUrl(imageId = '') {
  const gallery = readMirrorGallery();
  const requestedId = String(imageId || gallery.activeId).trim().toLowerCase();
  const item = gallery.items.find((entry) => entry.id === requestedId);
  if (!item) return null;
  try {
    const image = nativeImage.createFromPath(mirrorGalleryItemPath(item));
    if (image.isEmpty()) return null;
    return image.toDataURL();
  } catch (error) {
    return null;
  }
}

function emitMirrorGalleryChanged(gallery) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('mirror:gallery-changed', publicMirrorGallery(gallery));
}

function prepareMirrorImage(selectedPath) {
  const stat = fs.lstatSync(selectedPath);
  if (!stat.isFile() || stat.size > 30 * 1024 * 1024) throw new Error('image_too_large');
  const source = nativeImage.createFromPath(selectedPath);
  if (source.isEmpty()) throw new Error('invalid_image');
  const size = source.getSize();
  if (!size.width || !size.height || size.width * size.height > 60_000_000) throw new Error('image_too_large');
  const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
  const image = scale < 1
    ? source.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' })
    : source;
  return image.toJPEG(88);
}

async function chooseMirrorImages() {
  const current = readMirrorGallery();
  if (current.items.length >= MIRROR_GALLERY_MAX_ITEMS) {
    return { ok: false, error: 'gallery_full', gallery: publicMirrorGallery(current) };
  }
  const result = await showPanelOpenDialog({
    title: '添加图片到首页画廊',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] }],
  });
  const selectedPaths = !result.canceled && Array.isArray(result.filePaths) ? result.filePaths : [];
  if (!selectedPaths.length) return { ok: true, canceled: true, gallery: publicMirrorGallery(current) };
  if (!ensureMirrorImagesDirectory()) return { ok: false, error: 'gallery_unavailable' };
  const remaining = MIRROR_GALLERY_MAX_ITEMS - current.items.length;
  const addedItems = [];
  const writtenPaths = [];
  let skippedCount = Math.max(0, selectedPaths.length - remaining);
  for (const selectedPath of selectedPaths.slice(0, remaining)) {
    try {
      const id = crypto.randomUUID();
      const item = { id, fileName: `mirror-${id}.jpg`, createdAt: Date.now() };
      const targetPath = mirrorGalleryItemPath(item);
      fs.writeFileSync(targetPath, prepareMirrorImage(selectedPath), { mode: 0o600, flag: 'wx' });
      writtenPaths.push(targetPath);
      addedItems.push(item);
    } catch (error) {
      skippedCount += 1;
    }
  }
  if (!addedItems.length) return { ok: false, error: 'invalid_images', skippedCount };
  const gallery = normalizeMirrorGallery({
    version: 1,
    activeId: addedItems[0].id,
    items: [...current.items, ...addedItems],
  });
  if (!writeMirrorGallery(gallery)) {
    writtenPaths.forEach((filePath) => { try { fs.unlinkSync(filePath); } catch (error) {} });
    return { ok: false, error: 'gallery_save_failed' };
  }
  emitMirrorGalleryChanged(gallery);
  return { ok: true, canceled: false, addedCount: addedItems.length, skippedCount, gallery: publicMirrorGallery(gallery) };
}

async function replaceMirrorImage(imageId) {
  const gallery = readMirrorGallery();
  const id = String(imageId || '').trim().toLowerCase();
  const item = gallery.items.find((entry) => entry.id === id);
  if (!item) return { ok: false, error: 'image_not_found' };
  const result = await showPanelOpenDialog({
    title: '更换当前图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] }],
  });
  const selectedPath = !result.canceled && Array.isArray(result.filePaths) ? result.filePaths[0] : '';
  if (!selectedPath) return { ok: true, canceled: true, gallery: publicMirrorGallery(gallery) };
  if (!ensureMirrorImagesDirectory()) return { ok: false, error: 'gallery_unavailable' };
  const temporaryPath = path.join(mirrorImagesDirectory(), `.mirror-replace-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, prepareMirrorImage(selectedPath), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, mirrorGalleryItemPath(item));
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (cleanupError) {}
    return { ok: false, error: 'invalid_image' };
  }
  emitMirrorGalleryChanged(gallery);
  return { ok: true, canceled: false, gallery: publicMirrorGallery(gallery) };
}

function selectMirrorImage(imageId) {
  const gallery = readMirrorGallery();
  const id = String(imageId || '').trim().toLowerCase();
  if (!gallery.items.some((item) => item.id === id)) return { ok: false, error: 'image_not_found' };
  const next = normalizeMirrorGallery({ ...gallery, activeId: id });
  if (!writeMirrorGallery(next)) return { ok: false, error: 'gallery_save_failed' };
  emitMirrorGalleryChanged(next);
  return { ok: true, gallery: publicMirrorGallery(next) };
}

async function removeMirrorImage(imageId) {
  const gallery = readMirrorGallery();
  const id = String(imageId || '').trim().toLowerCase();
  const index = gallery.items.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, error: 'image_not_found' };
  const confirmation = await showPanelMessageBox({
    type: 'warning',
    title: '移除这张图片？',
    message: '图片会移到系统废纸篓，可以从废纸篓恢复。',
    buttons: ['取消', '移到废纸篓'],
    defaultId: 0,
    cancelId: 0,
  });
  if (!confirmation || confirmation.response !== 1) return { ok: true, canceled: true, gallery: publicMirrorGallery(gallery) };
  try {
    await shell.trashItem(mirrorGalleryItemPath(gallery.items[index]));
  } catch (error) {
    return { ok: false, error: 'image_remove_failed' };
  }
  const items = gallery.items.filter((item) => item.id !== id);
  const fallback = items[Math.min(index, Math.max(0, items.length - 1))]?.id || '';
  const next = normalizeMirrorGallery({ ...gallery, activeId: gallery.activeId === id ? fallback : gallery.activeId, items });
  if (!writeMirrorGallery(next)) return { ok: false, error: 'gallery_save_failed' };
  emitMirrorGalleryChanged(next);
  return { ok: true, canceled: false, gallery: publicMirrorGallery(next) };
}

function refreshTrayMenu() {
  if (!tray) return;
  const autoLaunch = isAutoLaunchEnabled();
  const settings = readAppSettings();
  const featureLabels = { inbox: '待确认', mail: '邮件', todo: '待办', notes: '笔记', links: '链接', recordings: '录制', credentials: '密钥', clip: '剪贴板' };
  const menu = Menu.buildFromTemplate([
    {
      label: '打开Handy',
      click: toggleVisibility,
    },
    { type: 'separator' },
    {
      label: 'API 配置…',
      click: () => openRendererPanel('app:open-api-settings'),
    },
    {
      label: '添加首页图片…',
      click: chooseMirrorImages,
    },
    {
      label: '显示功能',
      submenu: Object.entries(featureLabels).map(([id, label]) => ({
        label,
        type: 'checkbox',
        checked: settings.features[id] !== false,
        click: (item) => {
          const next = readAppSettings();
          next.features[id] = item.checked;
          saveAppSettings(next);
          applyAppSettings();
          refreshTrayMenu();
        },
      })),
    },
    {
      label: `设置快捷键…  当前：${settings.shortcut}`,
      click: () => openRendererPanel('app:record-shortcut'),
    },
    {
      label: '数据文件夹',
      submenu: [
        { label: '在访达中打开', click: () => shell.openPath(workspaceRoot()) },
        { label: '更换文件夹…', click: chooseWorkspaceFolder },
      ],
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: autoLaunch,
      click: (item) => {
        setAutoLaunch(item.checked);
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '关于',
      click: () => {
        showPanelMessageBox({
          type: 'info',
          title: '关于Handy',
          message: 'Handy',
          detail:
            `版本 ${app.getVersion()}\n\n一个开源、常驻 macOS 屏幕顶部的本地工作台。工作区数据默认保存在本机；账号密码与 API Key 由 macOS 安全存储加密。\n\nMIT License`,
          buttons: ['查看 GitHub', '好'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }).then(({ response }) => {
          if (response === 0) shell.openExternal('https://github.com/xiaopu-ai/TO-DO-Panel');
        });
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      accelerator: 'Cmd+Q',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(createNotchTrayIcon());
  tray.setToolTip('Handy · 点击打开菜单');
  refreshTrayMenu();
}

ipcMain.handle('window:set-mode', async (event, mode) => {
  if (mode === 'expanded') quickClipboard?.capture();
  applyMode(mode === 'expanded' ? 'expanded' : 'collapsed');
});

ipcMain.handle('window:begin-collapse', () => {
  beginNativeCollapse();
});

ipcMain.handle('settings:get', () => publicAppSettings());
ipcMain.handle('settings:set-feature', (event, payload) => {
  const current = readAppSettings();
  const features = updateFeaturePreference(current.features, payload && payload.featureId, payload && payload.enabled);
  if (!features) return { ok: false, error: 'invalid_feature' };
  const next = { ...current, features };
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  applyAppSettings();
  refreshTrayMenu();
  return { ok: true, settings: publicAppSettings() };
});
ipcMain.handle('settings:set-auto-launch', (event, enabled) => {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'invalid' };
  if (!setAutoLaunch(enabled)) return { ok: false, error: 'save_failed', autoLaunch: isAutoLaunchEnabled() };
  const settings = publicAppSettings();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  return { ok: true, autoLaunch: settings.autoLaunch };
});
ipcMain.handle('settings:set-shortcut', (event, accelerator) => {
  if (!isTrustedMainRenderer(event)) return { ok:false,error:'forbidden' };
  if (!isSafePanelShortcut(accelerator)) return { ok: false, error: 'invalid' };
  const previous = readAppSettings().shortcut;
  if (!setPanelShortcut(accelerator)) return { ok: false, error: shortcutRegistrationError || 'occupied' };
  const next = readAppSettings();
  next.shortcut = accelerator;
  if (!saveAppSettings(next)) {
    setPanelShortcut(previous);
    return { ok: false, error: 'save_failed' };
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', publicAppSettings());
  refreshTrayMenu();
  return { ok: true, shortcut: accelerator };
});
ipcMain.handle('settings:begin-shortcut-test', (event, accelerator) => {
  if (!isTrustedMainRenderer(event)) return { ok:false,error:'forbidden' };
  if (!isSafePanelShortcut(accelerator)) return { ok: false, error: 'invalid' };
  if (pendingShortcutTest) restoreShortcutAfterTest('replaced');
  const previous = readAppSettings().shortcut;
  if (!setPanelShortcut(accelerator)) return { ok: false, error: shortcutRegistrationError || 'occupied' };
  pendingShortcutTest = {
    candidate: accelerator,
    previous,
    triggered: false,
    timer: setTimeout(expireShortcutTest, 15000),
  };
  return { ok: true, shortcut: accelerator, timeoutMs: 15000 };
});
ipcMain.handle('settings:confirm-shortcut-test', (event, accelerator) => {
  if (!isTrustedMainRenderer(event)) return { ok:false,error:'forbidden' };
  if (!pendingShortcutTest || !pendingShortcutTest.triggered || pendingShortcutTest.candidate !== accelerator) {
    return { ok: false, error: 'test_required' };
  }
  const next = readAppSettings();
  next.shortcut = accelerator;
  if (!saveAppSettings(next)) {
    restoreShortcutAfterTest('save_failed');
    return { ok: false, error: 'save_failed' };
  }
  if (pendingShortcutTest.timer) clearTimeout(pendingShortcutTest.timer);
  pendingShortcutTest = null;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', publicAppSettings());
  refreshTrayMenu();
  return { ok: true, shortcut: accelerator };
});
ipcMain.handle('settings:cancel-shortcut-test', () => ({ ok: restoreShortcutAfterTest('cancelled') }));
ipcMain.handle('workspace:get', () => ({ path: workspaceRoot(), portable: workspaceRoot() !== app.getPath('userData') }));
ipcMain.handle('workspace:load-data', () => {
  const payload = readJsonFile(workspacePath(WORKSPACE_DATA_FILE), {});
  return payload && payload.localStorage && typeof payload.localStorage === 'object'
    ? payload.localStorage
    : {};
});

function normalizePortableStorage(storage) {
  const portable = { ...storage };
  const normalizers = [
    ['notch-recordings', 'audioPath', RECORDINGS_DIR_NAME],
    ['notch-clip-history', 'imagePath', CLIP_IMAGES_DIR_NAME],
  ];
  for (const [storageKey, property, directory] of normalizers) {
    try {
      const rows = JSON.parse(portable[storageKey]);
      if (!Array.isArray(rows)) continue;
      portable[storageKey] = JSON.stringify(rows.map((row) => {
        if (!row || typeof row !== 'object' || !row[property]) return row;
        const basename = path.basename(String(row[property]));
        return { ...row, [property]: path.join(directory, basename) };
      }));
    } catch (error) {}
  }
  return portable;
}

ipcMain.handle('workspace:save-data', (event, storage) => {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return false;
  const portableStorage = normalizePortableStorage(storage);
  const serialized = JSON.stringify(portableStorage);
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) return false;
  return writeJsonFile(workspacePath(WORKSPACE_DATA_FILE), {
    version: 1,
    updatedAt: Date.now(),
    localStorage: portableStorage,
  });
});
ipcMain.handle('workspace:open', () => shell.openPath(workspaceRoot()));
ipcMain.handle('workspace:choose', () => chooseWorkspaceFolder());

function getLayoutMetrics(display) {
  const d = display || getWindowDisplay();
  return {
    stripHeight: getCollapsedHeight(d), // 折叠黑条总高（= 菜单栏高 = 物理刘海高，不含唇边）
    menuBarHeight: getMenuBarHeight(d), // 折叠态菜单栏带高（折叠条上半部分被其拦截）
    chromeY: EXPANDED_CHROME_Y,
    tabSizes: TAB_SIZES,
  };
}

ipcMain.handle('window:metrics', () => {
  return getLayoutMetrics();
});
ipcMain.handle('launcher:layout', (event, mode) => {
  if (!isTrustedMainRenderer(event) || event.senderFrame !== event.sender.mainFrame) return {ok:false,error:'forbidden'};
  if (!['home','tool',...launcherModel.tools.map(t=>t.id)].includes(mode)) return {ok:false,error:'invalid_layout'};
  launcherLayout = mode;
  if (currentMode === 'expanded') repositionWindow();
  return {ok:true};
});

// Tab 仅改变内容；固定展开尺寸下不再触发原生窗口 resize。
ipcMain.handle('window:set-tab', (event, tab) => {
  currentTab = Object.prototype.hasOwnProperty.call(TAB_SIZES, tab) ? tab : 'home';
});

// macOS 渲染层 getUserMedia 不会自动弹 TCC 授权，必须由主进程申请摄像头权限
ipcMain.handle('media:camera', async () => {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('camera') === 'granted') return true;
  mediaPermissionRequests++;
  try {
    return await systemPreferences.askForMediaAccess('camera');
  } finally {
    mediaPermissionRequests = Math.max(0, mediaPermissionRequests - 1);
    if (mediaPermissionRequests === 0 && cameraBlurDeferred) {
      cameraBlurDeferred = false;
      const targetWindow = mainWindow;
      setTimeout(() => {
        if (
          mainWindow === targetWindow &&
          targetWindow &&
          !targetWindow.isDestroyed() &&
          !targetWindow.isFocused()
        ) {
          requestRendererCollapse();
        }
      }, 200);
    }
  }
});

ipcMain.handle('media:microphone', async () => {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
  mediaPermissionRequests++;
  try {
    return await systemPreferences.askForMediaAccess('microphone');
  } finally {
    mediaPermissionRequests = Math.max(0, mediaPermissionRequests - 1);
    if (mediaPermissionRequests === 0 && cameraBlurDeferred) {
      cameraBlurDeferred = false;
    }
  }
});

ipcMain.handle('tasks:recent', () => taskCompletionHistory);

// 快捷链接：URL 走外部浏览器（仅 http/https），本地路径走系统打开（仅绝对路径）
ipcMain.handle('shell:openExternal', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url);
  }
});

ipcMain.handle('shell:openPath', (event, p) => {
  if (typeof p === 'string' && path.isAbsolute(p)) {
    return shell.openPath(p);
  }
});

// 只放行固定的几个隐私面板，渲染层传来的值只能当作枚举的键来查，
// 绝不能拼进 URL：x-apple.systempreferences: 能打开任意设置面板。
const PRIVACY_SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
};

async function openPrivacySettings(pane) {
  const target = PRIVACY_SETTINGS_PANES[String(pane || '')];
  if (typeof target !== 'string') return false;
  try { await shell.openExternal(target); return true; } catch { return false; }
}

ipcMain.handle('shell:open-privacy-settings', (event, pane) => {
  if (!isTrustedMainRenderer(event) || event.senderFrame !== event.sender.mainFrame) return false;
  return openPrivacySettings(pane);
});

const requestSystemPermission = createPermissionRequest(systemPreferences, openPrivacySettings);
ipcMain.handle('permissions:request', async (event, kind) => {
  if (!isTrustedMainRenderer(event) || event.senderFrame !== event.sender.mainFrame) return { ok:false, error:'forbidden' };
  mediaPermissionRequests++;
  try { return await requestSystemPermission(kind); }
  finally { mediaPermissionRequests = Math.max(0, mediaPermissionRequests - 1); cameraBlurDeferred = false; }
});

ipcMain.handle('app:reveal-current', (event) => {
  if (!isTrustedMainRenderer(event) || event.senderFrame !== event.sender.mainFrame) return false;
  const { bundlePath } = applicationLocation(app);
  if (!bundlePath) return false;
  try { shell.showItemInFolder(bundlePath); return true; } catch { return false; }
});

async function getPermissionStatusSnapshot() {
  const snapshot = readPermissionSnapshot(systemPreferences);
  return {
    ...snapshot,
    message: permissionMessage(snapshot),
    appVersion: app.getVersion(),
    executable: process.execPath,
    packaged: app.isPackaged,
    ...applicationLocation(app),
  };
}

ipcMain.handle('permissions:get-status', () => getPermissionStatusSnapshot());

const requestPermissionRelaunch = createPermissionRelaunch(app);
ipcMain.handle('app:relaunch', (event) => {
  if (!isTrustedMainRenderer(event)) return false;
  return requestPermissionRelaunch();
});

// Permission inspection must never start screen capture or display startup prompts.
// The OS snapshot is not proof that an operation succeeded; report operation errors separately.

async function validatePublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    return null;
  }
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) return null;
  return url;
}

async function readResponseText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LINK_FETCH_MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchFaviconDataUrl(pageUrl, html) {
  let candidate;
  try {
    const href = extractFaviconHref(html) || '/favicon.ico';
    candidate = await validatePublicHttpUrl(new URL(href, pageUrl).toString());
  } catch (error) {
    candidate = null;
  }
  if (!candidate) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(candidate, { signal: controller.signal, redirect: 'error' });
    const type = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    if (!response.ok || !type.startsWith('image/')) return '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 160 * 1024) return '';
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch (error) {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichLinkMetadata(url, title) {
  const config = resolveLlmConfig();
  if (!config.apiKey || !config.model) return { title, category: '' };
  const endpoint = config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const safeEndpoint = await validatePublicHttpUrl(endpoint);
  if (!safeEndpoint) return { title, category: '' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safeEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DynamicPanel/0.3 (+local bookmark organizer)',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        ...(config.baseUrl.includes('deepseek.com') ? { thinking: { type: 'disabled' } } : {}),
        messages: [
          {
            role: 'system',
            content: '你是网址收藏夹整理器。只返回 JSON：{"title":"简洁中文名称","category":"短分类"}。分类应稳定、可复用，不超过 14 个字。',
          },
          { role: 'user', content: `URL: ${url}\n网页标题: ${title}` },
        ],
      }),
    });
    if (!response.ok) return { title, category: '' };
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    const parsed = parseSmartLinkMetadata(content);
    if (!parsed) return { title, category: '' };
    return { title: parsed.title || title, category: parsed.category };
  } catch (error) {
    return { title, category: '' };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectLink(rawUrl) {
  let current = await validatePublicHttpUrl(rawUrl);
  if (!current) return { ok: false, error: 'invalid_or_private_url' };
  for (let redirectCount = 0; redirectCount <= LINK_FETCH_MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
          'User-Agent': 'DynamicPanel/0.3 (+local bookmark metadata)',
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      // URL 已经过公网与协议校验；正文不可读不应阻止收藏，仍尝试抓站点根图标。
      const icon = await fetchFaviconDataUrl(current.toString(), '');
      return {
        ok: true,
        url: current.toString(),
        title: '未命名',
        category: '',
        icon,
        warning: error && error.name === 'AbortError' ? 'timeout' : 'fetch_failed',
      };
    }
    clearTimeout(timeout);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount >= LINK_FETCH_MAX_REDIRECTS) {
        return { ok: false, error: 'too_many_redirects' };
      }
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      if (!current) return { ok: false, error: 'unsafe_redirect' };
      continue;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const fallback = current.hostname.replace(/^www\./, '');
    if (!response.ok || (!contentType.includes('text/html') && !contentType.includes('xhtml'))) {
      const [smart, icon] = await Promise.all([
        enrichLinkMetadata(current.toString(), fallback),
        fetchFaviconDataUrl(current.toString(), ''),
      ]);
      return { ok: true, url: current.toString(), title: smart.title || '未命名', category: smart.category, icon };
    }
    const html = await readResponseText(response);
    const pageTitle = extractPageTitle(html, fallback);
    const [smart, icon] = await Promise.all([
      enrichLinkMetadata(current.toString(), pageTitle),
      fetchFaviconDataUrl(current.toString(), html),
    ]);
    return { ok: true, url: current.toString(), title: smart.title, category: smart.category, icon };
  }
  return { ok: false, error: 'too_many_redirects' };
}

const linkContent=require('./main-link-content').createLinkContent({directory:()=>workspacePath('link-previews'),nativeImage});
let linkAI=null,linkAIEpoch=0;const linkRequests=new Map();
function linkAllowed(event){return event.senderFrame===event.sender.mainFrame&&(isTrustedMainRenderer(event)||floatingRuntime?.linkSender(event));}
function linkSettings(){try{const value=JSON.parse(fs.readFileSync(workspacePath('link-settings-v1.json'),'utf8'));if(typeof value.aiEnabled!=='boolean'||typeof value.thumbnails!=='boolean')throw Error();return {ok:true,...value};}catch(e){return e.code==='ENOENT'?{ok:true,aiEnabled:false,thumbnails:true}:{ok:false,error:'settings_unavailable'};}}
ipcMain.handle('links:settings',(event,changes)=>{if(!linkAllowed(event))return {ok:false,error:'forbidden'};const old=linkSettings();if(!old.ok||!changes)return old;try{const next={aiEnabled:old.aiEnabled,thumbnails:old.thumbnails};for(const key of Object.keys(changes)){if(!['aiEnabled','thumbnails'].includes(key)||typeof changes[key]!=='boolean')throw Error();next[key]=changes[key];}const file=workspacePath('link-settings-v1.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,file);if(!next.aiEnabled){linkAIEpoch++;linkAI?.dispose();}return {ok:true,...next};}catch{return {ok:false,error:'save_failed'};}});
ipcMain.handle('links:inspect', (event, url) => linkAllowed(event)&&typeof url==='string'&&url.length<=4000?linkContent.inspect(url):{ok:false,error:'forbidden'});
ipcMain.handle('links:image',(event,ref)=>linkAllowed(event)?linkContent.image(ref):null);
ipcMain.handle('links:cancel',event=>{if(linkAllowed(event)){linkRequests.delete(event.sender.id);linkAI?.cancel(event.sender.id);}return {ok:true};});
ipcMain.handle('links:ai',async(event,input)=>{
  if(!linkAllowed(event))return {ok:false,error:'forbidden'};if(!linkSettings().aiEnabled)return {ok:false,error:'ai_disabled'};
  if(!input||!['analyze','recommend'].includes(input.mode))return {ok:false,error:'invalid_input'};const epoch=linkAIEpoch,owner=event.sender.id,token=Symbol();if(linkRequests.has(owner))return {ok:false,error:'busy'};linkRequests.set(owner,token);
  try{
  const snapshot=await floatingRuntime?.linkSnapshot();if(!snapshot?.ok)return {ok:false,error:'host_unavailable'};let context;
  if(input.mode==='analyze'){
    const item=snapshot.groups.flatMap(g=>g.links||[]).find(r=>r.id===input.id);if(!item)return {ok:false,error:'not_found'};
    const content=await linkContent.inspect(item.url);if(!content.ok)return content;
    context={mode:'analyze',title:item.title,url:item.url,note:String(item.note||'').slice(0,2000),description:content.description,text:content.text,source:content.source,warning:content.warning};
  }else{if(typeof input.query!=='string'||!input.query.trim()||input.query.length>2000)return {ok:false,error:'invalid_input'};const rows=snapshot.groups.flatMap(g=>(g.links||[]).map(r=>({id:r.id,title:r.title,group:g.name,note:String(r.note||'').slice(0,600),summary:String(r.analysis?.summary||'').slice(0,500),tags:r.tags||[]})));context={mode:'recommend',query:input.query,items:rows.slice(-100),total:rows.length};}
  if(linkRequests.get(owner)!==token)return {ok:false,error:'cancelled'};if(epoch!==linkAIEpoch||!linkSettings().aiEnabled)return {ok:false,error:'ai_disabled'};
  linkAI ||= require('./ai/link-library').createLinkAI({getConfig:resolveLlmConfig,validateEndpoint:validatePublicHttpUrl,fetchImpl:fetch});
  const result=await linkAI.generate(event.sender.id,context);if(linkRequests.get(owner)!==token)return {ok:false,error:'cancelled'};if(epoch!==linkAIEpoch||!linkSettings().aiEnabled)return {ok:false,error:'ai_disabled'};
  return {...result,revision:snapshot.revision,source:context.source,warning:context.warning,coverage:context.items?`${context.items.length}/${context.total}`:undefined};
  }catch{return {ok:false,error:'unavailable'};}finally{if(linkRequests.get(owner)===token)linkRequests.delete(owner);}
});

ipcMain.handle('smart:organize-material', async (event, payload) => {
  const config = resolveLlmConfig();
  const kind = payload && payload.kind === 'note' ? 'note' : 'material';
  const transcript = String(payload && payload.text || '').trim().slice(0, 8000);
  if (!transcript) return { ok: false, error: 'empty_text' };
  if (!config.apiKey || !config.model) return { ok: false, error: 'not_configured' };
  const endpoint = config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const safeEndpoint = await validatePublicHttpUrl(endpoint);
  if (!safeEndpoint) return { ok: false, error: 'invalid_endpoint' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(safeEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        ...(config.baseUrl.includes('deepseek.com') ? { thinking: { type: 'disabled' } } : {}),
        messages: [
          {
            role: 'system',
            content: kind === 'note'
              ? '你是中文笔记命名助手。理解整篇笔记后概括主题，禁止把正文首句直接当标题。只返回 JSON：{"title":"8到18字的具体标题","category":"2到8字的稳定分类"}。'
              : '你是中文个人资料库整理器。根据内容概括，不要照抄首句。只返回 JSON：{"title":"8到18字的具体名称","category":"2到8字的稳定分类"}。',
          },
          { role: 'user', content: kind === 'note' ? `请为以下笔记命名：\n\n${transcript}` : transcript },
        ],
      }),
    });
    if (!response.ok) return { ok: false, error: `http_${response.status}` };
    const result = await response.json();
    const content = result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
    const metadata = parseSmartMaterialMetadata(content);
    return metadata && metadata.title ? { ok: true, ...metadata } : { ok: false, error: 'invalid_response' };
  } catch (error) {
    return { ok: false, error: error && error.name === 'AbortError' ? 'timeout' : 'request_failed' };
  } finally {
    clearTimeout(timeout);
  }
});

const WINDOWS_LIST_JXA = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run() {
  const rows = [];
  let candidates = 0;
  let titled = 0;
  const options = $.kCGWindowListOptionAll | $.kCGWindowListExcludeDesktopElements;
  const windowList = ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)
  );
  const appPaths = {};
  for (let index = 0; index < Number(windowList.count); index++) {
    const info = windowList.objectAtIndex(index);
    const get = (key) => ObjC.unwrap(info.objectForKey($(key)));
    const layer = Number(get('kCGWindowLayer'));
    const pid = Number(get('kCGWindowOwnerPID'));
    const appName = String(get('kCGWindowOwnerName') || '').trim();
    const title = String(get('kCGWindowName') || '').replace(/\\s+/g, ' ').trim();
    const windowNumber = Number(get('kCGWindowNumber'));
    // 没有「屏幕录制」权限时 CGWindowList 仍会返回别的应用的窗口，只是 kCGWindowName
    // 一律为空，系统不报任何错。于是下面这句会把所有行丢掉、列表看起来像「真的没窗口」。
    // 统计候选数与其中有标题的条数，好让主进程区分这两种情况。
    if (layer === 0 && pid && appName && windowNumber) {
      candidates += 1;
      if (title) titled += 1;
    }
    if (layer !== 0 || !pid || !appName || !title || !windowNumber) continue;
    if (!Object.prototype.hasOwnProperty.call(appPaths, pid)) {
      const meta = { appPath: '', policy: -1 };
      try {
        const runningApp = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
        if (runningApp && !runningApp.isNil()) {
          meta.policy = Number(runningApp.activationPolicy);
          if (runningApp.bundleURL && !runningApp.bundleURL.isNil()) {
            meta.appPath = String(ObjC.unwrap(runningApp.bundleURL.path) || '');
          }
        }
      } catch (error) {}
      appPaths[pid] = meta;
    }
    const appMeta = appPaths[pid];
    // activationPolicy 2 = NSApplicationActivationPolicyProhibited：XPC 与系统辅助进程
    // （如 AuthenticationServicesHelper，bundle 是 .xpc 不是 .app）。它们在系统层面就
    // 不能被激活，列出来点了也不会有任何反应，属于纯粹的假窗口。
    // 注意不能用 kCGWindowIsOnscreen 过滤：真实窗口在其他 Space 或被遮挡时该字段也是
    // nil，实测微信 / Arc / Chrome / 飞书都会被误删。
    if (appMeta.policy === 2) continue;
    rows.push({ pid, appName, appPath: appMeta.appPath, title, windowIndex: index, windowNumber });
  }
  // candidates 是本可列出的窗口数，titled 是其中拿到标题的数量。
  // candidates > 0 而 titled === 0 时几乎一定是缺「屏幕录制」权限，不是真的没窗口。
  return JSON.stringify({ rows: rows, candidates: candidates, titled: titled });
}`;

const WINDOW_FOCUS_JXA = `
function run(argv) {
  const pid = Number(argv[0]);
  const wantedTitle = String(argv[1] || '');
  const se = Application('System Events');
  const matches = se.applicationProcesses.whose({ unixId: pid })();
  if (!matches.length) return 'false';
  const process = matches[0];
  const windows = process.windows();
  let target = null;
  let matching = 0;
  for (let i = 0; i < windows.length; i++) {
    try {
      if (String(windows[i].name()) === wantedTitle) { target = windows[i]; matching += 1; }
    } catch (error) {}
  }
  if (!target || matching !== 1) return 'false';
  try { target.attributes.byName('AXMinimized').value = false; } catch (error) {}
  process.frontmost = true;
  delay(0.08);
  let raised = false;
  try { target.actions.byName('AXRaise').perform(); raised = true; } catch (error) {}
  try {
    const menuBarItems = process.menuBars[0].menuBarItems();
    let windowMenu = null;
    for (let i = 0; i < menuBarItems.length; i++) {
      const name = String(menuBarItems[i].name());
      if (name === 'Window' || name === '窗口') { windowMenu = menuBarItems[i]; break; }
    }
    if (windowMenu) {
      const items = windowMenu.menus[0].menuItems();
      for (let i = 0; i < items.length; i++) {
        if (String(items[i].name()) === wantedTitle) {
          items[i].click();
          raised = true;
          break;
        }
      }
    }
  } catch (error) {}
  return raised ? 'true' : 'false';
}`;

function runJxa(script, args = []) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script, '--', ...args.map(String)],
      { timeout: 6000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(String(stdout || '').trim())
    );
  });
}

async function scanCurrentWindows() {
  if(!windowScanPending)windowScanPending=scanCurrentWindowsNow().finally(()=>{windowScanPending=null;});
  return windowScanPending;
}
async function scanCurrentWindowsNow() {
  if (process.platform !== 'darwin') {windowScanError='unsupported';return { items: [], error: windowScanError };}
  try {
    const raw = await runJxa(WINDOWS_LIST_JXA);
    const parsed = JSON.parse(raw || '{}');
    // 兼容旧格式（裸数组），新格式是 { rows, candidates, titled }。
    const payload = Array.isArray(parsed)
      ? { rows: parsed, candidates: parsed.length, titled: parsed.length }
      : parsed;
    const rows = normalizeWindowRows(payload.rows || [],{preserveDuplicates:true}).filter((item) => item.pid !== process.pid);
    // 有候选窗口却一个标题都读不到 = 缺「屏幕录制」权限。macOS 10.15 起读取其他应用的
    // 窗口标题需要该权限，系统不会报错也不会弹提示，只是静默返回空标题，
    // 结果界面上只剩一句「没有读取到可切换窗口」，把权限问题伪装成了「真的没窗口」。
    if (rows.length === 0 && Number(payload.candidates) > 0 && Number(payload.titled) === 0) {
      windowScanCache = new Map();
      const status = readPermissionSnapshot(systemPreferences)['screen-recording'];
      windowScanError=status === 'denied' ? 'screen_recording_permission_required' : 'window_titles_unavailable';
      return { items: [], error: windowScanError };
    }
    const appPaths = [...new Set(rows.map((item) => item.appPath).filter(Boolean))];
    await Promise.all(appPaths.map(async (appPath) => {
      if (windowIconCache.has(appPath)) return;
      const icon = await withTimeout(readWindowAppIcon(appPath), 3500, null);
      windowIconCache.set(appPath, icon);
    }));
    rows.forEach((item) => {
      item.icon = item.appPath ? windowIconCache.get(item.appPath) || null : null;
    });
    windowScanCache = new Map(rows.map((item) => [item.id, item]));
    windowScanError=null;
    return { items: rows, error: null };
  } catch (error) {
    windowScanCache = new Map();
    windowScanError=windowScanFailure(error, readPermissionSnapshot(systemPreferences).accessibility);
    return { items: [], error: windowScanError };
  }
}

function windowAccess(event){return event.senderFrame===event.sender.mainFrame&&(isTrustedMainRenderer(event)||floatingRuntime?.windowToolsSender(event));}
ipcMain.handle('window-groups:get',event=>windowAccess(event)?windowGroups.snapshot():{ok:false,error:'forbidden'});
ipcMain.handle('window-groups:command',(event,c)=>windowAccess(event)?windowGroups.command(c):{ok:false,error:'forbidden'});
ipcMain.handle('windows:list', async (event) => {
  if(event.senderFrame!==event.sender.mainFrame||(!isTrustedMainRenderer(event)&&!floatingRuntime?.windowToolsSender(event)))return {items:[],error:'forbidden'};
  return scanCurrentWindows();
});

ipcMain.handle('windows:focus', async (event, windowId) => {
  if(event.senderFrame!==event.sender.mainFrame||(!isTrustedMainRenderer(event)&&!floatingRuntime?.windowToolsSender(event)))return false;
  const target = windowScanCache.get(windowId);
  if (!target || process.platform !== 'darwin') return false;
  try {
    return (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.title, target.windowIndex])) === 'true';
  } catch (error) {
    return false;
  }
});

function taskWindowMatchScore(notification, target) {
  const project = String(notification && notification.project || '').trim().toLocaleLowerCase();
  const title = String(target && target.title || '').trim().toLocaleLowerCase();
  const appName = String(target && target.appName || '').trim().toLocaleLowerCase();
  if (!project || !title) return 0;
  if (title === project) return 100;
  if (title.startsWith(`${project} `) || title.startsWith(`${project} —`) || title.startsWith(`${project} -`)) return 90;
  if (title.includes(project)) return 75;
  if (project.includes(appName) && appName) return 25;
  return 0;
}

async function activateActiveTaskNotification(eventId = null) {
  const notification = activeTaskNotification;
  if(notification?.source==='planner'&&(!eventId||eventId===notification.eventId)){
    openRendererPanel('planner:open');return true;
  }
  if (!notification || (eventId && notification.eventId !== eventId) || notification.source === 'todo') return false;
  const result = await scanCurrentWindows();
  const target = (result.items || [])
    .map((item) => ({ item, score: taskWindowMatchScore(notification, item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
  if (!target) return false;
  try {
    const focused = (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.title, target.windowIndex])) === 'true';
    if (focused) beginTaskNotificationDismiss();
    return focused;
  } catch (error) {
    return false;
  }
}

ipcMain.handle('task-notification:activate', async (event, eventId) => {
  if (!notificationWindow || notificationWindow.isDestroyed() || event.sender !== notificationWindow.webContents) return false;
  return activateActiveTaskNotification(eventId);
});

// 当前窗口模块仍需要安全读取本机应用图标。
// 优先直接从 .icns 提取内嵌 PNG；失败时通过独立 JXA 进程向 NSWorkspace 取系统图标。
// 不直接调用 app.getFileIcon：它曾在部分 .app 上触发 Electron 内部 FATAL Check，
// 独立进程即使失败也不会带崩主进程。
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// icns 内 PNG 块按"贴近 48px 网格展示"优先：128 → 256 → 64@2x …
const ICNS_PREF = ['ic07', 'ic12', 'ic08', 'ic11', 'ic13', 'ic09', 'ic14', 'ic05', 'ic04'];

function extractPngFromIcns(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'icns') return null;
  const candidates = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const type = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32BE(off + 4);
    if (len < 8 || off + len > buf.length) break;
    const data = buf.subarray(off + 8, off + len);
    if (data.length > 8 && data.subarray(0, 4).equals(PNG_SIG)) {
      candidates.push({ type, data });
    }
    off += len;
  }
  if (!candidates.length) return null; // 老式 RLE 图标 → 交给渲染层首字母兜底
  candidates.sort((a, b) => {
    const ia = ICNS_PREF.indexOf(a.type);
    const ib = ICNS_PREF.indexOf(b.type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return candidates[0].data;
}

async function readEmbeddedAppIcon(appPath) {
  try {
    const resDir = path.join(appPath, 'Contents', 'Resources');
    const files = await fs.promises.readdir(resDir);
    const icns = files.filter((f) => f.toLowerCase().endsWith('.icns'));
    if (!icns.length) return null;
    // 优先 AppIcon.icns，其次名字含 app/icon 的，避免选中文档类型图标
    const score = (n) => {
      const s = n.toLowerCase();
      if (s === 'appicon.icns') return 0;
      if (s.includes('app')) return 1;
      if (s.includes('icon')) return 2;
      return 3;
    };
    icns.sort((a, b) => score(a) - score(b) || a.length - b.length);
    const buf = await fs.promises.readFile(path.join(resDir, icns[0]));
    const png = extractPngFromIcns(buf);
    return png ? `data:image/png;base64,${png.toString('base64')}` : null;
  } catch (e) {
    return null; // 单个应用读不到图标不影响整体
  }
}

const SYSTEM_ICON_JXA = `
ObjC.import('AppKit');
function run(argv) {
  const size = 96;
  const source = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
  image.lockFocus;
  source.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, size, size),
    $.NSZeroRect,
    $.NSCompositingOperationSourceOver,
    1
  );
  image.unlockFocus;
  const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  return ObjC.unwrap(data.base64EncodedStringWithOptions(0));
}`;

function readSystemAppIconNow(appPath) {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', SYSTEM_ICON_JXA, appPath],
      { timeout: 4000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        const base64 = typeof stdout === 'string' ? stdout.trim() : '';
        if (error || !base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
          resolve(null);
          return;
        }
        resolve(`data:image/png;base64,${base64}`);
      }
    );
  });
}

const SYSTEM_ICON_CONCURRENCY = 2;
const SYSTEM_ICON_QUEUE_TIMEOUT_MS = 10000;
let systemIconActive = 0;
const systemIconQueue = [];

function pumpSystemIconQueue() {
  while (systemIconActive < SYSTEM_ICON_CONCURRENCY && systemIconQueue.length) {
    const job = systemIconQueue.shift();
    if (job.cancelled) continue;
    systemIconActive++;
    readSystemAppIconNow(job.appPath)
      .then(job.finish, () => job.finish(null))
      .finally(() => {
        systemIconActive--;
        pumpSystemIconQueue();
      });
  }
}

function readSystemAppIcon(appPath) {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    const job = {
      appPath,
      cancelled: false,
      settled: false,
      timer: null,
      finish(value) {
        if (job.settled) return;
        job.settled = true;
        if (job.timer) clearTimeout(job.timer);
        resolve(value);
      },
    };
    job.timer = setTimeout(() => {
      job.cancelled = true;
      job.finish(null);
    }, SYSTEM_ICON_QUEUE_TIMEOUT_MS);
    systemIconQueue.push(job);
    pumpSystemIconQueue();
  });
}

async function readWindowAppIcon(appPath) {
  const systemIcon = await withTimeout(readSystemAppIcon(appPath), 2800, null);
  return systemIcon || readEmbeddedAppIcon(appPath);
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const FRONTMOST_APP_JXA = `
ObjC.import('AppKit');
function run() {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!app) return '{}';
  return JSON.stringify({
    name: ObjC.unwrap(app.localizedName) || '',
    bundleId: ObjC.unwrap(app.bundleIdentifier) || '',
    path: app.bundleURL ? (ObjC.unwrap(app.bundleURL.path) || '') : ''
  });
}`;

function readFrontmostApp() {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRONTMOST_APP_JXA], { timeout: 2200 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const value = JSON.parse(String(stdout || '').trim());
        resolve(value && value.path ? value : null);
      } catch (parseError) {
        resolve(null);
      }
    });
  });
}

ipcMain.handle('mirror:get-gallery', () => publicMirrorGallery());
ipcMain.handle('mirror:get-image', (event, imageId) => mirrorImageDataUrl(imageId));
ipcMain.handle('mirror:add-images', () => chooseMirrorImages());
ipcMain.handle('mirror:replace-image', (event, imageId) => replaceMirrorImage(imageId));
ipcMain.handle('mirror:select-image', (event, imageId) => selectMirrorImage(imageId));
ipcMain.handle('mirror:remove-image', (event, imageId) => removeMirrorImage(imageId));

const referenceSender=e=>isTrustedMainRenderer(e)&&e.senderFrame===e.sender.mainFrame||floatingRuntime?.moduleSender(e,'gallery');
ipcMain.handle('reference:get',e=>referenceSender(e)?{ok:true,...publicMirrorGallery()}:{ok:false,error:'forbidden'});
ipcMain.handle('reference:image',(e,id)=>referenceSender(e)?mirrorImageDataUrl(id):null);
ipcMain.handle('reference:choose',e=>referenceSender(e)?chooseMirrorImages():{ok:false,error:'forbidden'});
ipcMain.handle('reference:import',(e,data)=>{
  if(!referenceSender(e))return {ok:false,error:'forbidden'};
  if(typeof data!=='string'||data.length>14000000||!/^data:image\/(png|jpeg|webp);base64,/.test(data))return {ok:false,error:'invalid_image'};
  try{
    const current=readMirrorGallery();if(current.items.length>=MIRROR_GALLERY_MAX_ITEMS)return {ok:false,error:'gallery_full'};
    const image=nativeImage.createFromDataURL(data),size=image.getSize();if(image.isEmpty()||size.width*size.height>60000000)throw Error();
    if(!ensureMirrorImagesDirectory())throw Error();const scale=Math.min(1,1600/Math.max(size.width,size.height));
    const bytes=(scale<1?image.resize({width:Math.round(size.width*scale),height:Math.round(size.height*scale)}):image).toJPEG(88);
    const id=crypto.randomUUID(),item={id,fileName:`mirror-${id}.jpg`,createdAt:Date.now()},target=mirrorGalleryItemPath(item);fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
    const gallery={version:1,activeId:id,items:[...current.items,item]};if(!writeMirrorGallery(gallery)){try{fs.unlinkSync(target);}catch{}return {ok:false,error:'save_failed'};}
    emitMirrorGalleryChanged(gallery);return {ok:true,...publicMirrorGallery(gallery)};
  }catch{return {ok:false,error:'invalid_image'};}
});

function getCredentialsVaultPath() {
  return path.join(app.getPath('userData'), CREDENTIALS_VAULT_FILE);
}

let credentialVaultError='';
const credentialClipboardHashes=new Set();
function credentialRevision(){try{return crypto.createHash('sha256').update(fs.readFileSync(getCredentialsVaultPath())).digest('hex');}catch{return 'empty';}}
const credentialSender=e=>isTrustedMainRenderer(e)&&e.senderFrame===e.sender.mainFrame||floatingRuntime?.moduleSender(e,'credentials');
function readCredentialsVault() {
  credentialVaultError='';
  if (!safeStorage.isEncryptionAvailable()) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(getCredentialsVaultPath(), 'utf8'));
    const decoded = safeStorage.decryptString(Buffer.from(String(envelope.payload || ''), 'base64'));
    const rows = JSON.parse(decoded);
    if(!Array.isArray(rows))throw Error('invalid_vault');
    const normalized=rows.map(item=>normalizeCredentialInput(item,item?.id,item?.createdAt));if(normalized.some(v=>!v))throw Error('invalid_vault');for(const item of normalized)credentialClipboardHashes.add(clipboardContentKey('text',item.password));return normalized;
  } catch (error) {
    if(error.code!=='ENOENT')credentialVaultError='vault_unreadable';
    return [];
  }
}

function writeCredentialsVault(rows) {
  if (!safeStorage.isEncryptionAvailable()||credentialVaultError) return false;
  const payload = safeStorage.encryptString(JSON.stringify(rows)).toString('base64');
  const vaultPath = getCredentialsVaultPath();
  const temporaryPath = `${vaultPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, payload }), { mode: 0o600 });
    fs.renameSync(temporaryPath, vaultPath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
    return false;
  }
}

function publicCredential(item) {
  return {
    id: item.id,
    service: item.service,
    account: item.account,
    website: item.website||'',
    note: item.note||'',
    passwordMask: '**********',
    createdAt: item.createdAt,
  };
}

ipcMain.handle('credentials:list', event => {
  if(!credentialSender(event))return {ok:false,error:'forbidden'};
  const items=readCredentialsVault().map(publicCredential);
  return {ok:safeStorage.isEncryptionAvailable()&&!credentialVaultError,secureStorage:safeStorage.isEncryptionAvailable(),error:credentialVaultError,revision:credentialRevision(),items};
});

ipcMain.handle('credentials:get', (event, id) => {
  if(!credentialSender(event))return {ok:false,error:'forbidden'};
  const item = readCredentialsVault().find((row) => row.id === String(id || ''));
  return item ? { ok: true, item: { ...item },revision:credentialRevision() } : { ok: false, error: 'not_found' };
});

ipcMain.handle('credentials:save', (event, payload) => {
  if(!credentialSender(event))return {ok:false,error:'forbidden'};
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'secure_storage_unavailable' };
  const rows = readCredentialsVault();
  if(credentialVaultError)return {ok:false,error:credentialVaultError};
  if(payload?.revision!==undefined&&payload.revision!==credentialRevision())return {ok:false,error:'conflict'};
  const existing = payload && payload.id ? rows.find((item) => item.id === payload.id) : null;
  if(payload?.id&&!existing)return {ok:false,error:'not_found'};
  const normalized = normalizeCredentialInput(
    existing && !String(payload && payload.password || '') ? { ...payload, password: existing.password } : payload,
    existing ? existing.id : crypto.randomUUID(),
    existing ? existing.createdAt : Date.now()
  );
  if (!normalized) return { ok: false, error: 'invalid_credential' };
  const next = existing
    ? rows.map((item) => item.id === existing.id ? normalized : item)
    : [normalized, ...rows];
  return writeCredentialsVault(next)
    ? { ok: true, item: publicCredential(normalized) }
    : { ok: false, error: 'save_failed' };
});

ipcMain.handle('credentials:delete-many', (event, ids) => {
  if(!credentialSender(event))return {ok:false,error:'forbidden'};
  if(ids&&!Array.isArray(ids)){if(ids.revision!==credentialRevision())return {ok:false,error:'conflict'};ids=ids.ids;}
  const targets = new Set(Array.isArray(ids) ? ids.map(String) : []);
  if (!targets.size) return { ok: true, deleted: 0 };
  const rows = readCredentialsVault();
  const next = rows.filter((item) => !targets.has(item.id));
  if (!writeCredentialsVault(next)) return { ok: false, error: 'save_failed' };
  return { ok: true, deleted: rows.length - next.length };
});

ipcMain.handle('credentials:copy', (event, payload) => {
  if(!credentialSender(event))return false;
  const id = String(payload && payload.id || '');
  const field = payload && payload.field === 'password' ? 'password' : payload && payload.field === 'account' ? 'account' : '';
  if (!id || !field) return false;
  const item = readCredentialsVault().find((row) => row.id === id);
  if (!item) return false;
  const value = item[field];
  if(field==='password')credentialClipboardHashes.add(clipboardContentKey('text',value));
  clipboard.writeText(value);
  if (field === 'password') {
    setTimeout(() => {
      if (clipboard.readText() === value) clipboard.clear();
    }, 60_000).unref?.();
  }
  return true;
});

ipcMain.handle('credentials:open',async(event,id)=>{
  if(!credentialSender(event))return {ok:false,error:'forbidden'};
  const item=readCredentialsVault().find(v=>v.id===id);if(!item?.website)return {ok:false,error:'not_found'};
  try{await shell.openExternal(item.website);return {ok:true};}catch{return {ok:false,error:'open_failed'};}
});

function sodaMusicRunning() {
  try { return Promise.resolve(getSodaMusicBridge()?.running() === true); } catch { return Promise.resolve(false); }
}

function getSodaMusicBridge() {
  if (process.platform !== 'darwin') return null;
  if (!sodaMusicBridge) sodaMusicBridge = require('./native/.build/music-bridge.node');
  return sodaMusicBridge;
}

function openSodaMusic(background = false) {
  return new Promise((resolve) => {
    const cleanEnvironment = { ...process.env };
    delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
    cleanEnvironment.XPC_SERVICE_NAME = '0';
    execFile(
      '/usr/bin/open',
      background ? ['-g', '-j', SODA_MUSIC_APP] : [SODA_MUSIC_APP],
      { timeout: 4000, env: cleanEnvironment },
      (error) => resolve(!error)
    );
  });
}

async function sendSodaShortcut(action) {
  if (process.platform !== 'darwin') return { ok: false, error: 'unsupported' };
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    return { ok: false, error: 'accessibility_permission_required' };
  }
  const shortcut = sodaShortcutSpec(action);
  if (!shortcut) return { ok: false, error: 'invalid_action' };
  try {
    const result = getSodaMusicBridge()?.send(action);
    return result === 'sent' ? { ok: true } : { ok: false, error: result || 'music_control_unavailable' };
  } catch (error) {
    console.warn('[music] failed to send Soda Music shortcut', error && error.message || error);
    return { ok: false, error: 'music_control_unavailable' };
  }
}

ipcMain.handle('music:status', async (event) => {
  if (!isTrustedMainRenderer(event) || event.senderFrame !== event.sender.mainFrame) return { ok:false,error:'forbidden' };
  const installed = fs.existsSync(SODA_MUSIC_APP);
  const running = installed ? await sodaMusicRunning() : false;
  return {
    ok: true,
    installed,
    running,
    sessionActive: running,
    playing: running ? null : false,
    metadataAvailable: false,
    title: '',
    artist: '',
    icon: null,
  };
});

ipcMain.handle('music:control', async (event, action) => {
  if (!isTrustedMainRenderer(event) || event.senderFrame !== event.sender.mainFrame) return { ok:false,error:'forbidden' };
  if (!['open','toggle','play','pause','next','previous'].includes(action)) return {ok:false,error:'invalid_action'};
  if (!fs.existsSync(SODA_MUSIC_APP)) return { ok: false, error: 'not_installed' };
  if (sodaMusicBusy) return {ok:false,error:'music_busy'};
  sodaMusicBusy = true;
  try {
    if (action === 'open') return await openSodaMusic() ? {ok:true} : {ok:false,error:'launch_failed'};
    if (!systemPreferences.isTrustedAccessibilityClient(false)) return {ok:false,error:'accessibility_permission_required'};
    try { if (!getSodaMusicBridge()) return {ok:false,error:'music_control_unavailable'}; }
    catch { return {ok:false,error:'music_control_unavailable'}; }
    return await controlSodaMusic(action, {
    isRunning: sodaMusicRunning,
    launch: () => openSodaMusic(true),
    sendShortcut: sendSodaShortcut,
    });
  } finally { sodaMusicBusy = false; }
});

// ============ 百炼实时语音转写 ============
function getTranscriptionSettingsPath() {
  return path.join(app.getPath('userData'), TRANSCRIPTION_SETTINGS_FILE);
}

function readStoredTranscriptionSettings() {
  const currentPath = getTranscriptionSettingsPath();
  const legacyPath = path.join(app.getPath('appData'), 'notch-todo', TRANSCRIPTION_SETTINGS_FILE);
  const readSettings = (settingsPath) => {
    try {
      const value = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  };
  const current = readSettings(currentPath);
  const legacy = currentPath === legacyPath ? {} : readSettings(legacyPath);
  const selected = selectTranscriptionSettings(current, legacy);
  if (!Object.keys(current).length && Object.keys(selected).length && currentPath !== legacyPath) {
    try {
      fs.mkdirSync(path.dirname(currentPath), { recursive: true });
      fs.writeFileSync(currentPath, JSON.stringify(selected), { mode: 0o600 });
    } catch (error) {
      // 迁移失败时仍从旧目录读取，避免已有密钥突然失效。
    }
  }
  return selected;
}

function decryptStoredApiKey(settings) {
  const environmentKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  if (environmentKey) return environmentKey;
  return decryptStoredSecret(settings.encryptedApiKey).trim();
}

function decryptStoredSecret(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
  } catch (error) {
    return '';
  }
}

function resolveLlmConfig() {
  const settings = readStoredTranscriptionSettings();
  return {
    apiKey: String(process.env.NOTCH_LLM_API_KEY || decryptStoredSecret(settings.encryptedLlmApiKey)).trim(),
    baseUrl: String(settings.llmBaseUrl || 'https://api.deepseek.com').trim(),
    model: String(settings.llmModel || 'deepseek-v4-flash').trim(),
  };
}

function resolveTranscriptionConfig() {
  const settings = readStoredTranscriptionSettings();
  const environmentWorkspace = String(process.env.DASHSCOPE_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE || '').trim();
  const environmentRegion = String(process.env.DASHSCOPE_REGION || '').trim().toLowerCase();
  const region = ['beijing', 'singapore'].includes(environmentRegion)
    ? environmentRegion
    : ['beijing', 'singapore'].includes(settings.region) ? settings.region : 'beijing';
  const workspaceId = (environmentWorkspace || String(settings.workspaceId || '').trim()).slice(0, 128);
  return {
    apiKey: decryptStoredApiKey(settings),
    workspaceId: /^[A-Za-z0-9_-]{0,128}$/.test(workspaceId) ? workspaceId : '',
    region,
  };
}

function publicTranscriptionConfig() {
  const config = resolveTranscriptionConfig();
  const llmConfig = resolveLlmConfig();
  const settings = readStoredTranscriptionSettings();
  return {
    configured: Boolean(config.apiKey),
    asrNeedsReentry: Boolean(settings.encryptedApiKey && !config.apiKey),
    workspaceId: config.workspaceId,
    region: config.region,
    provider: 'qwen3-asr-flash-realtime',
    secureStorage: safeStorage.isEncryptionAvailable(),
    llmConfigured: Boolean(llmConfig.apiKey),
    llmNeedsReentry: Boolean(settings.encryptedLlmApiKey && !llmConfig.apiKey),
    llmBaseUrl: String(settings.llmBaseUrl || 'https://api.deepseek.com'),
    llmModel: String(settings.llmModel || 'deepseek-v4-flash'),
  };
}

function transcriptionUrl(config) {
  const host = config.workspaceId
    ? config.region === 'singapore'
      ? `${config.workspaceId}.ap-southeast-1.maas.aliyuncs.com`
      : `${config.workspaceId}.cn-beijing.maas.aliyuncs.com`
    : config.region === 'singapore'
      ? 'dashscope-intl.aliyuncs.com'
      : 'dashscope.aliyuncs.com';
  return `wss://${host}/api-ws/v1/realtime?model=${TRANSCRIPTION_MODEL}&heartbeat=true`;
}

function transcriptionEventId() {
  return `event_${crypto.randomUUID().replace(/-/g, '')}`;
}

function emitTranscription(session, payload) {
  if (session.sender && !session.sender.isDestroyed()) {
    session.sender.send('transcription:event', payload);
  }
}

function sessionTranscript(session) {
  return [...session.finalSegments, session.interim].filter(Boolean).join(' ').trim();
}

function closeTranscriptionSession(session, result = {}) {
  if (!session || session.closed) return;
  session.closed = true;
  clearTimeout(session.connectTimer);
  clearTimeout(session.finishTimer);
  transcriptionSessions.delete(session.senderId);
  try { session.socket.close(); } catch (error) {}
  if (session.finishResolve) {
    session.finishResolve({
      ok: result.ok !== false,
      transcript: sessionTranscript(session),
      error: result.error || null,
    });
    session.finishResolve = null;
  }
}

function handleTranscriptionMessage(session, raw) {
  let message;
  try { message = JSON.parse(String(raw)); } catch (error) { return; }
  if (message.type === 'session.created' || message.type === 'session.updated') {
    emitTranscription(session, { type: 'status', status: 'connected' });
    return;
  }
  if (message.type === 'conversation.item.input_audio_transcription.text') {
    session.interim = `${String(message.text || '').trim()}${String(message.stash || '').trim()}`;
    emitTranscription(session, {
      type: 'transcript',
      final: session.finalSegments.join(' ').trim(),
      interim: session.interim,
    });
    return;
  }
  if (message.type === 'conversation.item.input_audio_transcription.completed') {
    const transcript = String(message.transcript || '').trim();
    if (transcript && session.finalSegments[session.finalSegments.length - 1] !== transcript) {
      session.finalSegments.push(transcript);
    }
    session.interim = '';
    emitTranscription(session, {
      type: 'transcript',
      final: session.finalSegments.join(' ').trim(),
      interim: '',
    });
    return;
  }
  if (message.type === 'error' || message.type === 'conversation.item.input_audio_transcription.failed') {
    const details = message.error && message.error.message || '实时转写服务返回错误';
    emitTranscription(session, { type: 'error', message: details });
    session.lastError = details;
    return;
  }
  if (message.type === 'session.finished') {
    closeTranscriptionSession(session, { ok: !session.lastError, error: session.lastError });
  }
}

ipcMain.handle('transcription:get-config', () => publicTranscriptionConfig());

ipcMain.handle('transcription:set-config', (event, payload) => {
  const previous = readStoredTranscriptionSettings();
  const region = payload && payload.region === 'singapore' ? 'singapore' : 'beijing';
  const workspaceId = String(payload && payload.workspaceId || '').trim();
  const apiKey = String(payload && payload.apiKey || '').trim();
  const llmApiKey = String(payload && payload.llmApiKey || '').trim();
  const llmBaseUrl = String(payload && payload.llmBaseUrl || previous.llmBaseUrl || 'https://api.deepseek.com').trim();
  const llmModel = String(payload && payload.llmModel || previous.llmModel || 'deepseek-v4-flash').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (workspaceId && !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) {
    return { ok: false, error: 'invalid_workspace' };
  }
  let parsedLlmUrl;
  try { parsedLlmUrl = new URL(llmBaseUrl); } catch (error) { parsedLlmUrl = null; }
  if (!parsedLlmUrl || parsedLlmUrl.protocol !== 'https:' || parsedLlmUrl.username || parsedLlmUrl.password) {
    return { ok: false, error: 'invalid_llm_url' };
  }
  if ((apiKey || llmApiKey) && !safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'secure_storage_unavailable' };
  }
  let encryptedApiKey = String(previous.encryptedApiKey || '');
  let encryptedLlmApiKey = String(previous.encryptedLlmApiKey || '');
  try {
    if (apiKey) encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64');
    if (llmApiKey) encryptedLlmApiKey = safeStorage.encryptString(llmApiKey).toString('base64');
  } catch (error) {
    return { ok: false, error: 'secure_storage_failed' };
  }
  const next = {
    region,
    workspaceId,
    encryptedApiKey,
    llmBaseUrl: parsedLlmUrl.toString().replace(/\/$/, ''),
    llmModel,
    encryptedLlmApiKey,
  };
  const settingsPath = getTranscriptionSettingsPath();
  if (!writeJsonFile(settingsPath, next)) {
    return { ok: false, error: 'save_failed' };
  }
  const publicConfig = publicTranscriptionConfig();
  if ((apiKey && !publicConfig.configured) || (llmApiKey && !publicConfig.llmConfigured)) {
    writeJsonFile(settingsPath, previous);
    return { ok: false, error: 'secure_storage_verify_failed' };
  }
  resetAiService();
  return { ok: true, ...publicConfig };
});

ipcMain.handle('transcription:start', (event) => {
  const config = resolveTranscriptionConfig();
  if (!config.apiKey) return { ok: false, error: 'not_configured' };
  const existing = transcriptionSessions.get(event.sender.id);
  if (existing) closeTranscriptionSession(existing, { ok: false, error: 'replaced' });
  return new Promise((resolve) => {
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
      'User-Agent': 'DynamicPanel/0.3',
    };
    if (config.workspaceId) headers['X-DashScope-WorkSpace'] = config.workspaceId;
    const socket = new WebSocket(transcriptionUrl(config), { headers });
    const session = {
      sender: event.sender,
      senderId: event.sender.id,
      socket,
      finalSegments: [],
      interim: '',
      ready: false,
      closed: false,
      startSettled: false,
      finishResolve: null,
      connectTimer: null,
      finishTimer: null,
      lastError: '',
    };
    transcriptionSessions.set(event.sender.id, session);
    const settleStart = (result) => {
      if (session.startSettled) return;
      session.startSettled = true;
      clearTimeout(session.connectTimer);
      resolve(result);
    };
    session.connectTimer = setTimeout(() => {
      settleStart({ ok: false, error: 'connect_timeout' });
      closeTranscriptionSession(session, { ok: false, error: 'connect_timeout' });
    }, 8000);
    socket.on('open', () => {
      session.ready = true;
      socket.send(JSON.stringify({
        event_id: transcriptionEventId(),
        type: 'session.update',
        session: {
          input_audio_format: 'pcm',
          sample_rate: TRANSCRIPTION_SAMPLE_RATE,
          input_audio_transcription: { language: 'zh' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0,
            silence_duration_ms: 400,
          },
        },
      }));
      settleStart({ ok: true });
    });
    socket.on('message', (data) => handleTranscriptionMessage(session, data));
    socket.on('error', (error) => {
      const message = String(error && error.message || 'connection_failed');
      emitTranscription(session, { type: 'error', message });
      settleStart({ ok: false, error: 'connection_failed' });
      closeTranscriptionSession(session, { ok: false, error: message });
    });
    socket.on('close', () => {
      settleStart({ ok: false, error: 'connection_closed' });
      closeTranscriptionSession(session, { ok: !session.lastError, error: session.lastError || null });
    });
  });
});

ipcMain.on('transcription:audio', (event, bytes) => {
  const session = transcriptionSessions.get(event.sender.id);
  if (!session || !session.ready || session.closed || session.socket.readyState !== WebSocket.OPEN) return;
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
  if (!buffer.length || buffer.length > 512 * 1024) return;
  session.socket.send(JSON.stringify({
    event_id: transcriptionEventId(),
    type: 'input_audio_buffer.append',
    audio: buffer.toString('base64'),
  }));
});

ipcMain.handle('transcription:finish', (event) => {
  const session = transcriptionSessions.get(event.sender.id);
  if (!session || session.closed) return { ok: false, error: 'not_active', transcript: '' };
  if (session.finishResolve) return { ok: false, error: 'already_finishing', transcript: sessionTranscript(session) };
  return new Promise((resolve) => {
    session.finishResolve = resolve;
    session.finishTimer = setTimeout(() => {
      closeTranscriptionSession(session, { ok: false, error: 'finish_timeout' });
    }, TRANSCRIPTION_FINISH_TIMEOUT_MS);
    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ event_id: transcriptionEventId(), type: 'session.finish' }));
    } else {
      closeTranscriptionSession(session, { ok: false, error: 'connection_closed' });
    }
  });
});

function closeAllTranscriptionSessions() {
  for (const session of transcriptionSessions.values()) {
    closeTranscriptionSession(session, { ok: false, error: 'app_quit' });
  }
}

// ============ 录音资料库 ============
function getRecordingsDir() {
  return workspacePath(RECORDINGS_DIR_NAME);
}

function ensureRecordingsDir() {
  try {
    fs.mkdirSync(getRecordingsDir(), { recursive: true });
  } catch (error) {
    // 目录不可用时由保存 IPC 返回失败。
  }
}

function getSafeRecordingPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const directory = path.resolve(getRecordingsDir());
  const resolvedPath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceRoot(), value);
  if (path.dirname(resolvedPath) !== directory) return null;
  if (!/^recording-[a-z0-9-]+\.(webm|m4a|ogg|wav)$/i.test(path.basename(resolvedPath))) {
    return null;
  }
  try {
    const directoryStat = fs.lstatSync(directory);
    const fileStat = fs.lstatSync(resolvedPath);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return null;
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
    return resolvedPath;
  } catch (error) {
    return null;
  }
}

ipcMain.handle('recordings:save', async (event, payload) => {
  if(!isTrustedMainRenderer(event)||event.senderFrame!==event.sender.mainFrame)return {ok:false,error:'forbidden'};
  if (!payload || !payload.bytes) return { ok: false, error: 'empty_audio' };
  let buffer;
  try {
    buffer = Buffer.from(payload.bytes);
  } catch (error) {
    return { ok: false, error: 'invalid_audio' };
  }
  if (!buffer.length || buffer.length > RECORDING_MAX_BYTES) {
    return { ok: false, error: buffer.length ? 'audio_too_large' : 'empty_audio' };
  }
  ensureRecordingsDir();
  const mimeType = String(payload.mimeType || 'audio/webm').slice(0, 80);
  const extension = recordingExtension(mimeType);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const audioPath = path.join(getRecordingsDir(), `recording-${id}.${extension}`);
  try {
    const directoryStat=await fs.promises.lstat(getRecordingsDir());
    if(directoryStat.isSymbolicLink()||!directoryStat.isDirectory())return {ok:false,error:'write_failed'};
    await fs.promises.writeFile(audioPath, buffer, { flag: 'wx',mode:0o600 });
    const relative=path.join(RECORDINGS_DIR_NAME,path.basename(audioPath));
    let backup=false;
    if(payload.metadata&&/^recording-[\w-]{1,160}$/.test(payload.metadata.id||'')){
      const m=payload.metadata,v=voiceMemoModel.normalize(m.voice);
      try{await fs.promises.writeFile(audioPath+'.json',JSON.stringify({id:m.id,createdAt:Number(m.createdAt)||Date.now(),durationMs:Math.max(0,Number(m.durationMs)||0),audioPath:relative,mimeType,transcript:v.rawTranscript,voice:{...v,status:'idle',cleaned:'',summary:[]}}),{flag:'wx',mode:0o600});backup=true;}catch{}
    }
    return { ok: true, audioPath: relative, mimeType,backup };
  } catch (error) {
    return { ok: false, error: 'write_failed' };
  }
});

ipcMain.handle('recordings:recover',async(event)=>{
  if(!isTrustedMainRenderer(event)||event.senderFrame!==event.sender.mainFrame)return {ok:false,error:'forbidden'};
  try{
    ensureRecordingsDir();const recovered=[];
    for(const name of (await fs.promises.readdir(getRecordingsDir())).filter(n=>/^recording-[\w-]+\.(webm|m4a|mp4|ogg|wav)\.json$/.test(n)).slice(-500)){
      const file=path.join(getRecordingsDir(),name),audio=getSafeRecordingPath(path.join(RECORDINGS_DIR_NAME,name.slice(0,-5)));
      const stat=await fs.promises.lstat(file);if(!audio||stat.isSymbolicLink()||!stat.isFile()||stat.size>400000)continue;
      try{const m=JSON.parse(await fs.promises.readFile(file,'utf8'));if(!/^recording-[\w-]{1,160}$/.test(m.id||''))continue;
        recovered.push({...m,audioPath:path.join(RECORDINGS_DIR_NAME,path.basename(audio)),voice:voiceMemoModel.normalize(m.voice)});
      }catch{}
    }
    return {ok:true,recordings:recovered};
  }catch{return {ok:false,error:'read_failed'};}
});
ipcMain.handle('voice:organize',async(event,payload)=>{
  if(!isTrustedMainRenderer(event)||event.senderFrame!==event.sender.mainFrame)return {ok:false,error:'forbidden'};
  voiceOrganizer ||= createVoiceOrganizer({getConfig:resolveLlmConfig,validateEndpoint:validatePublicHttpUrl,fetchImpl:fetch});
  return voiceOrganizer.generate(payload?.id,payload);
});
ipcMain.handle('voice:cancel',(event,id)=>{
  if(!isTrustedMainRenderer(event)||event.senderFrame!==event.sender.mainFrame)return {ok:false};
  voiceOrganizer?.cancel(id);return {ok:true};
});

function plannerAllowed(event){return event.senderFrame===event.sender.mainFrame&&(isTrustedMainRenderer(event)||floatingRuntime?.plannerSender(event));}
function timerAllowed(event){return event.senderFrame===event.sender.mainFrame&&(isTrustedMainRenderer(event)||floatingRuntime?.timerSender(event));}
ipcMain.handle('timer:get',event=>timerAllowed(event)?timerStore.snapshot():{ok:false,error:'forbidden'});
ipcMain.handle('timer:command',async(event,c)=>{
  if(!timerAllowed(event))return {ok:false,error:'forbidden'};
  if(!c||JSON.stringify(c).length>3000)return {ok:false,error:'invalid_request'};
  const safe={action:c.action,revision:c.revision,id:c.id,mode:c.mode,seconds:c.seconds,title:c.title};
  if(c.action==='start'&&c.stopRecording){
    if(c.mode!=='countdown')return {ok:false,error:'invalid_recording'};
    const r=await floatingRuntime?.recorderCommand('get');
    if(!r?.ok||!['recording','paused'].includes(r.status)||!r.recordingId)return {ok:false,error:'no_recording'};
    safe.recordingId=r.recordingId;
  }
  return timerStore.command(safe);
});
ipcMain.handle('timer:plan',async(event,id)=>{
  if(!timerAllowed(event))return {ok:false,error:'forbidden'};
  const plan=plannerStore.snapshot().state?.items.find(r=>r.id===id&&!r.archived);
  if(!plan)return {ok:false,error:'not_found'};
  const snapshot=timerStore.snapshot();if(!snapshot.ok)return snapshot;
  const result=timerStore.command({action:'start',revision:snapshot.revision,mode:plan.scheduled===false?'countup':'countdown',seconds:plan.scheduled===false?1800:Math.max(1,Math.ceil((plan.end-plan.start)/1000)),title:plan.title,planId:plan.id});
  if(result.ok)await floatingRuntime?.open({kind:'module',id:'pomodoro'});return result;
});
async function tickSimpleTimer(){
  if(isQuitting||timerTickBusy)return;timerTickBusy=true;
  try{const result=timerStore.tick();if(result.due){const s=result.due;let suffix='可继续计时或结束，不会自动完成待办。';
    if(s.recordingId){const stopped=await floatingRuntime?.recorderCommand('timer-stop',s.recordingId);suffix=stopped?.ok?'已请求结束关联录音，音频按原流程保存。':'关联录音已变化或无法结束，请查看录音状态。';}
    enqueueTaskNotification({eventId:`timer-${s.id}`,taskId:`timer-${s.id}`,source:'pomodoro',project:'计时',title:s.title||'计时到点',body:suffix,detail:suffix,completedAt:Date.now()});
  }}finally{timerTickBusy=false;}
}
if(IS_TEST_RUNTIME)module.exports.simpleTimer={store:timerStore,tick:tickSimpleTimer};
ipcMain.handle('planner:get',event=>plannerAllowed(event)?plannerStore.snapshot():{ok:false,error:'forbidden'});
ipcMain.handle('planner:legacy',event=>plannerAllowed(event)?floatingRuntime?.plannerLegacy():{ok:false,error:'forbidden'});
ipcMain.handle('planner:command',(event,c)=>{
  if(!plannerAllowed(event))return {ok:false,error:'forbidden'};
  try{if(JSON.stringify(c).length>1024*1024)return {ok:false,error:'invalid_request'};}catch{return {ok:false,error:'invalid_request'};}
  if(c?.aiProposal&&plannerStore.snapshot().state?.aiEnabled!==true)return {ok:false,error:'ai_disabled'};
  const result=plannerStore.command(c);
  if(result.ok&&c.action==='settings'&&c.aiEnabled===false)plannerAI?.dispose();
  return result;
});
ipcMain.handle('planner:suggest',async(event,input)=>{
  if(!plannerAllowed(event))return {ok:false,error:'forbidden'};
  const snap=plannerStore.snapshot();if(!snap.ok)return snap;
  if(snap.state.aiEnabled!==true)return {ok:false,error:'ai_disabled'};
  let context;
  try{if(JSON.stringify(input).length>50000)throw Error();context=require('./ai/planner').buildContext(snap.state,input,await floatingRuntime?.plannerLegacy()||{});}catch{return {ok:false,error:'invalid_input'};}
  if(plannerStore.snapshot().state?.aiEnabled!==true)return {ok:false,error:'ai_disabled'};
  plannerAI ||= createPlannerAI({getConfig:resolveLlmConfig,validateEndpoint:validatePublicHttpUrl,fetchImpl:fetch});
  const result=await plannerAI.generate(event.sender.id,context);
  if(!result.ok)return result;
  if(plannerStore.snapshot().state?.aiEnabled!==true)return {ok:false,error:'ai_disabled'};
  try{
    const changes=result.changes;
    if(changes.length)plannerModel.apply(snap.state,changes);
    return {ok:true,revision:snap.state.revision,changes,notes:result.notes,reply:result.reply,coverage:context.coverage};
  }catch{return {ok:false,error:'invalid_response'};}
});
ipcMain.handle('planner:cancel',event=>{if(plannerAllowed(event))plannerAI?.cancel(event.sender.id);return {ok:true};});
ipcMain.handle('planner:voice',async(event,action)=>{
  if(!plannerAllowed(event)||!['get','start','stop','text','retry-save'].includes(action))return {ok:false,error:'forbidden'};
  return floatingRuntime?.recorderCommand(action==='text'?'planner-text':action==='start'?'planner-start':action)||{ok:false,error:'host_unavailable'};
});
function tickPlannerReminders(){
  if(plannerLocked||isQuitting)return;
  const items=plannerStore.claim();if(!items.length)return;
  const first=items[0];
  enqueueTaskNotification({eventId:`planner-${first.key}`,source:'planner',taskId:first.id,title:items.length>1?`${items.length} 项安排到点，请查看`:first.title,
    project:'今日安排',detail:first.phase==='end'?'本时段已结束，请确认进展或调整时间':'本时段开始了，点击查看安排',completedAt:Date.now()});
}
if(IS_TEST_RUNTIME)module.exports.planner={store:plannerStore,tick:tickPlannerReminders};

ipcMain.handle('recordings:read', async (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return null;
  try {
    const bytes = await fs.promises.readFile(safePath);
    const extension = path.extname(safePath).slice(1).toLowerCase();
    const mimeType = extension === 'm4a' ? 'audio/mp4' : `audio/${extension || 'webm'}`;
    return { bytes, mimeType };
  } catch (error) {
    return null;
  }
});

ipcMain.handle('recordings:delete', async (event, audioPath) => {
  if(!isTrustedMainRenderer(event)||event.senderFrame!==event.sender.mainFrame)return false;
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return false;
  try {
    try{const stat=await fs.promises.lstat(safePath+'.json');if(stat.isFile()&&!stat.isSymbolicLink())await fs.promises.unlink(safePath+'.json');}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.promises.unlink(safePath);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('recordings:reveal', (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return false;
  shell.showItemInFolder(safePath);
  return true;
});

// ============ 剪贴板历史 ============

function getClipImagesDir() {
  return workspacePath(CLIP_IMAGES_DIR_NAME);
}

// 图片记录使用扁平目录和固定文件名。拒绝子目录、符号链接和非普通文件，
// 避免 localStorage 被篡改后通过 ../ 或 symlink 读写目录外文件。
function getSafeClipImagePath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  const dir = path.resolve(getClipImagesDir());
  const resolvedPath = path.isAbsolute(p)
    ? path.resolve(p)
    : path.resolve(workspaceRoot(), p);
  if (path.dirname(resolvedPath) !== dir) return null;
  if (!/^clip-[a-z0-9]+\.png$/i.test(path.basename(resolvedPath))) return null;
  try {
    const dirStat = fs.lstatSync(dir);
    const fileStat = fs.lstatSync(resolvedPath);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return null;
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
    return resolvedPath;
  } catch (e) {
    return null;
  }
}

function ensureClipImagesDir() {
  try {
    fs.mkdirSync(getClipImagesDir(), { recursive: true });
  } catch (e) {
    // 目录已存在或无权限，静默
  }
}

function clipboardContentKey(type, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value == null ? '' : value));
  return `${type}:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

// 返回 { fingerprint, pngBuf } 或 null
function readClipboardImage() {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const pngBuf = image.toPNG();
    const contentKey = clipboardContentKey('image', pngBuf);
    const fingerprint = `${size.width}x${size.height}:${contentKey}`;
    return { fingerprint, contentKey, pngBuf };
  } catch (e) {
    return null;
  }
}

async function pollClipboard(options = {}) {
  if (!mainWindow) return;
  if (!quickClipboard?.snapshot().enabled || quickClipboard.snapshot().paused || plannerLocked) return;
  if (clipPolling) return;
  const force = Boolean(options && options.force);
  clipPolling = true;
  try {
    // 密码管理器写入的敏感内容：跳过不记录、不更新指纹
    const formats = clipboard.availableFormats();
    if (formats.includes('org.nspasteboard.ConcealedType')) return;

    const files = quickClipboard?.fileEntry();
    if (files) {
      if (!files.blocked && files.contentKey !== lastClipFileFingerprint) {
        lastClipFileFingerprint = files.contentKey;
        lastClipTextFingerprint = lastClipImageFingerprint = null;
        mainWindow.webContents.send('clipboard:new-entry', files);
      }
      return;
    }
    lastClipFileFingerprint = null;

    // 优先读文字
    const text = clipboard.readText();
    if (text.length > 100000) return;
    const textContentKey = text ? clipboardContentKey('text', text) : null;
    if(textContentKey&&credentialClipboardHashes.has(textContentKey))return;
    if (pendingClipboardSelfWrite && pendingClipboardSelfWrite.expiresAt <= Date.now()) {
      pendingClipboardSelfWrite = null;
    }
    if (text && force && pendingClipboardSelfWrite?.type === 'text'
      && pendingClipboardSelfWrite.text === text) {
      pendingClipboardSelfWrite = null;
      lastClipTextFingerprint = textContentKey;
      lastClipImageFingerprint = null;
      return;
    }
    if (text && (force || textContentKey !== lastClipTextFingerprint)) {
      lastClipTextFingerprint = textContentKey;
      lastClipImageFingerprint = null;
      const type = /^https?:\/\//i.test(text.trim()) ? 'url' : 'text';
      mainWindow.webContents.send('clipboard:new-entry', {
        type,
        text,
        imagePath: null,
        contentKey: textContentKey,
      });
      return;
    }

    // 文字为空再读图片
    if (!text) {
      const now = Date.now();
      if (!force && now - lastClipImageProbeAt < CLIP_IMAGE_POLL_INTERVAL_MS) return;
      lastClipImageProbeAt = now;
      const result = readClipboardImage();
      if (result && force && pendingClipboardSelfWrite?.type === 'image'
        && pendingClipboardSelfWrite.fingerprint === result.fingerprint) {
        pendingClipboardSelfWrite = null;
        lastClipImageFingerprint = result.fingerprint;
        lastClipTextFingerprint = null;
        return;
      }
      if (result && (force || result.fingerprint !== lastClipImageFingerprint)) {
        const { fingerprint, contentKey, pngBuf } = result;
        lastClipImageFingerprint = fingerprint;
        lastClipTextFingerprint = null;
        ensureClipImagesDir();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const fileName = 'clip-' + id + '.png';
        const imagePath = path.join(getClipImagesDir(), fileName);
        try {
          await fs.promises.writeFile(imagePath, pngBuf);
        } catch (e) {
          return; // 写盘失败不记录
        }
        if (!quickClipboard?.snapshot().enabled || quickClipboard.snapshot().paused || plannerLocked) {
          try { await fs.promises.unlink(imagePath); } catch {}
          return;
        }
        mainWindow.webContents.send('clipboard:new-entry', {
          type: 'image',
          text: null,
          imagePath,
          contentKey,
        });
      }
    }
  } catch (e) {
    // 轮询任何异常不能崩主进程，静默
  } finally {
    clipPolling = false;
  }
}

function startClipboardPolling() {
  // Electron 没有 NSPasteboard.changeCount，只能内容轮询：文本与图片都用 SHA-256
  // 指纹去重。图片探测另行降频，避免静止大图每半秒反复 toPNG 抢 CPU。
  if (clipPollTimer) return;
  clipPollTimer = setInterval(pollClipboard, CLIP_POLL_INTERVAL_MS);
}

function stopClipboardPolling() {
  if (clipPollTimer) {
    clearInterval(clipPollTimer);
    clipPollTimer = null;
  }
}

// 渲染层请求把图片文件读成 dataURL 回显（contextIsolation 下 file:// 受限，走 IPC 读盘）
ipcMain.handle('clipboard:readImage', async (event, imagePath) => {
  const safePath = getSafeClipImagePath(imagePath);
  if (!safePath) return null; // 只允许读自己的图片目录
  try {
    const buf = await fs.promises.readFile(safePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
});

// 为旧历史补上精确内容指纹。图片只从本应用的剪贴板目录读取，
// 渲染层仅拿到哈希，不会把图片 dataURL 写入 LocalStorage。
ipcMain.handle('clipboard:normalize-history', async (event, entries) => {
  const source = Array.isArray(entries) ? entries.slice(0, CLIP_MAX_ITEMS) : [];
  const normalized = [];
  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = { ...raw };
    if (entry.type === 'image') {
      const safePath = getSafeClipImagePath(entry.imagePath);
      if (!safePath) continue;
      try {
        const bytes = await fs.promises.readFile(safePath);
        entry.contentKey = clipboardContentKey('image', bytes);
      } catch (error) {
        continue;
      }
    } else if (entry.type === 'file') {
      if (!quickClipboard?.hasFile(entry.fileId)) continue;
      entry.contentKey = 'file:' + entry.fileId;
    } else if (typeof entry.text === 'string') {
      entry.contentKey = clipboardContentKey('text', entry.text);
    } else {
      continue;
    }
    normalized.push(entry);
  }
  return normalized;
});

// FIFO 淘汰 / 删除 / 清空时，连带删除本地图片文件（文件 I/O 归主进程）
ipcMain.handle('clipboard:deleteImages', async (event, paths) => {
  if (!Array.isArray(paths)) return;
  for (const p of paths) {
    const safePath = getSafeClipImagePath(p);
    if (safePath) {
      try {
        await fs.promises.unlink(safePath);
      } catch (e) {
        // 文件已不存在等，静默
      }
    }
  }
});

function writeClipboardEntry(entry) {
  if (!entry) return false;
  try {
    if (entry.type === 'file') {
      if (!quickClipboard?.writeFiles(entry)) return false;
      lastClipFileFingerprint = 'file:' + entry.fileId;
      lastClipTextFingerprint = lastClipImageFingerprint = null;
      return true;
    }
    const safeImagePath =
      entry.type === 'image' ? getSafeClipImagePath(entry.imagePath) : null;
    if (safeImagePath) {
      const buf = fs.readFileSync(safeImagePath);
      const image = nativeImage.createFromBuffer(buf);
      clipboard.writeImage(image);
      const r = readClipboardImage(); // 写回后更新指纹，避免下轮轮询把自己写的再记一遍
      if (r) {
        lastClipImageFingerprint = r.fingerprint;
        pendingClipboardSelfWrite = {
          type: 'image',
          fingerprint: r.fingerprint,
          expiresAt: Date.now() + 1500,
        };
      }
      lastClipTextFingerprint = null;
    } else if (entry.text) {
      clipboard.writeText(entry.text);
      lastClipTextFingerprint = clipboardContentKey('text', entry.text);
      lastClipImageFingerprint = null;
      pendingClipboardSelfWrite = {
        type: 'text',
        text: entry.text,
        expiresAt: Date.now() + 1500,
      };
    } else {
      return false;
    }
    return true;
  } catch (e) {
    pendingClipboardSelfWrite = null;
    return false;
  }
}

function waitForCollapsedPanel(timeoutMs = 950) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (currentMode !== 'expanded' || Date.now() >= deadline) return resolve(currentMode !== 'expanded');
      setTimeout(check, 32);
    };
    check();
  });
}

ipcMain.handle('clipboard:write', (event, entry) => isTrustedMainRenderer(event) && writeClipboardEntry(entry));

// 点击历史项后先收起灵动岛，再回到打开面板前的应用执行粘贴。
// 若系统尚未授予辅助功能权限，内容仍保留在系统剪贴板作为可靠降级。
ipcMain.handle('clipboard:paste', async (event, entry) => {
  if (!isTrustedMainRenderer(event)) return { ok:false,error:'forbidden' };
  return quickClipboard?.pasteEntry(entry) || {ok:false,error:'unavailable'};
});

function ensureFirstRunAutoLaunch() {
  // 首次运行时默认开启开机自启；之后尊重用户在托盘菜单的选择
  if (process.platform !== 'darwin') return;
  const marker = path.join(app.getPath('userData'), '.first-run-done');
  if (fs.existsSync(marker)) return;
  try {
    setAutoLaunch(true);
    fs.writeFileSync(marker, String(Date.now()));
  } catch (e) {
    // ignore
  }
}

function watchDisplayChanges() {
  // 接/拔外接屏、改变屏幕排列、改分辨率 → 自动重新定位到当前活跃屏顶部居中
  // 加 100ms 防抖：插拔屏时系统会连续触发多次事件
  let timer = null;
  const reposition = () => {
    panelPlacement?.cancel();
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!mainWindow) return;
      repositionWindow();
      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('window:metrics-changed', getLayoutMetrics());
      }
      if (notificationWindow && !notificationWindow.isDestroyed() && notificationWindow.isVisible()) {
        notificationWindow.setBounds(getTaskNotificationBounds());
      }
    }, 100);
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  if (!IS_TEST_RUNTIME) ensureFirstRunAutoLaunch();
  createWindow();
  quickClipboard = createClipboardRuntime({getMain:()=>mainWindow,read:readJsonFile,write:writeJsonFile,
    openInline:()=>{openRendererPanel('launcher:open',{kind:'module',id:'clip'},false);return {ok:true};},
    file:name=>getJsonSettingsPath(name),writeEntry:writeClipboardEntry,test:IS_TEST_RUNTIME,
    matchesClipboard:entry=>entry.type==='file'?quickClipboard.fileEntry()?.fileId===entry.fileId:
      entry.type==='image'?readClipboardImage()?.contentKey===entry.contentKey:clipboard.readText()===entry.text,
    collapse:async()=>{if(currentMode!=='expanded')return true;requestRendererCollapse();return waitForCollapsedPanel();},
    onPolicy:()=>applyFeatureServices(readAppSettings().features)});
  panelPlacement = createPanelPlacement({
    disabled:true,
    getMain: () => mainWindow, file: () => workspacePath('panel-placement-v1.json'), size: getExpandedSize,
    expanded: () => currentMode === 'expanded', collapse: requestRendererCollapse, reposition: repositionWindow,
    reveal: () => { if(currentMode === 'collapsed')openRendererPanel('shortcut:toggle-panel'); },
  });
  floatingRuntime = createFloatingRuntime({
    openInline:payload=>{openRendererPanel('launcher:open',payload);return {ok:true,inline:true};},
    getMain: () => mainWindow,
    combinationFile:()=>workspacePath('tool-combinations-v1.json'),
    timerActive:()=>timerStore.snapshot()?.active?.running===true,
    activityChanged:text=>{if(tray&&!tray.isDestroyed()){tray.setTitle(text);tray.setToolTip(text?`Handy · ${text}（展开工具可继续操作）`:'Handy');}},
    positionFile: () => workspacePath('floating-positions-v1.json'),
    prep: createMeetingPrep({ getConfig: resolveLlmConfig, validateEndpoint: validatePublicHttpUrl, fetchImpl: fetch }),
    publicConfig: publicTranscriptionConfig,
    openDialog: showPanelOpenDialog,
    openSettings: () => openRendererPanel('app:open-api-settings'),
  });
  materialPacks = require('./main-material-packs').createPackRuntime({
    file:workspacePath('material-packs-v1.json'),test:IS_TEST_RUNTIME,
    allowed:e=>isTrustedMainRenderer(e)&&e.senderFrame===e.sender.mainFrame||floatingRuntime?.moduleSender(e,'commands'),
    open:()=>floatingRuntime.open({kind:'module',id:'commands'}),
    capture:()=>quickClipboard?.capture(),
    notify:text=>{if(tray&&!tray.isDestroyed())tray.setToolTip(`Handy · ${text}`);},
    copy:(text,paste)=>paste?quickClipboard.pasteEntry({type:'text',text}):{ok:writeClipboardEntry({type:'text',text}),pasted:false},
    getConfig:resolveLlmConfig,validateEndpoint:validatePublicHttpUrl,fetchImpl:fetch,
  });
  if(IS_TEST_RUNTIME)module.exports.materialPacks={store:materialPacks.store,isProtected:text=>credentialClipboardHashes.has(clipboardContentKey('text',text))};
  mailRuntime = require('./main-mail').createMailRuntime({
    file: workspacePath('mail-accounts-v1.enc'),
    allowed: e => isTrustedMainRenderer(e) && e.senderFrame === e.sender.mainFrame && readAppSettings().features.mail !== false,
  });
  if (!IS_TEST_RUNTIME) createTray();
  powerMonitor.on('lock-screen',()=>{plannerLocked=true;quickClipboard?.invalidate();});
  powerMonitor.on('suspend',()=>{plannerLocked=true;quickClipboard?.invalidate();});
  powerMonitor.on('unlock-screen',()=>{plannerLocked=false;tickPlannerReminders();});
  powerMonitor.on('resume',()=>{plannerLocked=false;tickPlannerReminders();});
  if(!IS_TEST_RUNTIME){plannerTimer=setInterval(tickPlannerReminders,15000);plannerTimer.unref();}
  if(!IS_TEST_RUNTIME){simpleTimerInterval=setInterval(()=>void tickSimpleTimer(),500);simpleTimerInterval.unref();powerMonitor.on('resume',()=>void tickSimpleTimer());}
  watchDisplayChanges();
  ensureClipImagesDir();
  ensureRecordingsDir();
  if (!IS_TEST_RUNTIME) applyAppSettings();
  getAiService();
  if (!IS_TEST_RUNTIME) {
    startTaskNotificationServer();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
    if (currentMode === 'collapsed') openRendererPanel('launcher:open', { kind:'resume' });
  });
});

// 常驻菜单栏应用：所有窗口暂时关闭时仍保持后台运行。
app.on('window-all-closed', () => {});

app.on('before-quit', (event) => {
  if (quickClipboard && !quickClipboard.beginQuit(() => app.quit())) { event.preventDefault(); return; }
  if (floatingRuntime && !floatingRuntime.beginQuit(() => app.quit())) { event.preventDefault(); return; }
  isQuitting = true;
  timerStore.pauseForExit();
  floatingRuntime?.dispose();
  quickClipboard?.dispose();
  hideWhenCollapsed = false;
});

app.on('will-quit', () => {
  materialPacks?.dispose();
  mailRuntime?.dispose();
  clearInterval(plannerTimer);plannerAI?.dispose();
  clearInterval(simpleTimerInterval);
  voiceOrganizer?.dispose();
  modifierShortcut.stop();
  panelPlacement?.dispose();
  cancelCollapseWatchdog();
  clearTodoReminderTimer();
  clearTaskNotificationTimers();
  stopTaskNotificationServer();
  closeAllTranscriptionSessions();
  resetAiService();
  aiToolBridge.dispose();
  globalShortcut.unregisterAll();
  stopClipboardPolling();
});
