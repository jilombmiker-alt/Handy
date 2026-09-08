const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIRROR_GALLERY_MAX_ITEMS,
  normalizeMirrorGallery,
  isPrivateAddress,
  extractPageTitle,
  extractFaviconHref,
  recordingExtension,
  normalizeWindowRows,
  todoReminderState,
  taskNotificationIdentity,
  normalizeCredentialInput,
  parseSmartLinkMetadata,
  parseSmartMaterialMetadata,
  clipboardServicePolicy,
  updateFeaturePreference,
  DEFAULT_PANEL_SHORTCUT,
  panelShortcutIdentity,
  isReservedPanelShortcut,
  isSafePanelShortcut,
  normalizePanelShortcut,
  controlSodaMusic,
  sodaShortcutSpec,
  selectTranscriptionSettings,
} = require('../main-services');

test('mirror gallery keeps only bounded UUID-backed JPEG entries and repairs its active item', () => {
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const gallery = normalizeMirrorGallery({
    version: 99,
    activeId: 'missing',
    items: [
      { id: firstId, fileName: `mirror-${firstId}.jpg`, createdAt: 20 },
      { id: firstId, fileName: `mirror-${firstId}.jpg`, createdAt: 30 },
      { id: secondId, fileName: '../outside.jpg', createdAt: 40 },
      { id: secondId, fileName: `mirror-${secondId}.jpg`, createdAt: -1 },
      { id: 'not-a-uuid', fileName: 'mirror-not-a-uuid.jpg', createdAt: 50 },
    ],
  });

  assert.deepEqual(gallery, {
    version: 1,
    activeId: firstId,
    items: [
      { id: firstId, fileName: `mirror-${firstId}.jpg`, createdAt: 20 },
      { id: secondId, fileName: `mirror-${secondId}.jpg`, createdAt: 0 },
    ],
  });
});

test('mirror gallery applies the twelve-image limit', () => {
  const items = Array.from({ length: MIRROR_GALLERY_MAX_ITEMS + 4 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, '0');
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
    return { id, fileName: `mirror-${id}.jpg`, createdAt: index };
  });
  assert.equal(normalizeMirrorGallery({ items }).items.length, MIRROR_GALLERY_MAX_ITEMS);
});

test('isPrivateAddress blocks loopback, private, link-local and unique-local ranges', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.16.2.3', '192.168.1.9', '169.254.1.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('extractPageTitle prefers og:title and decodes HTML entities', () => {
  const html = '<html><head><title>Fallback</title><meta property="og:title" content="OpenAI &amp; Friends"></head></html>';
  assert.equal(extractPageTitle(html, 'example.com'), 'OpenAI & Friends');
  assert.equal(extractPageTitle('<title>  Docs &mdash; Home  </title>', 'example.com'), 'Docs — Home');
  assert.equal(extractPageTitle('<html></html>', 'example.com'), 'example.com');
});

test('favicon and smart material metadata are normalized safely', () => {
  assert.equal(extractFaviconHref('<link rel="icon" href="/assets/icon.png">'), '/assets/icon.png');
  assert.equal(extractFaviconHref('<link rel="stylesheet" href="app.css">'), '');
  assert.deepEqual(parseSmartMaterialMetadata('```json\n{"title":" 周会决策与行动项 ","category":"会议"}\n```'), {
    title: '周会决策与行动项',
    category: '会议',
  });
});

test('transcription settings fall back to the legacy app directory only when current settings are absent', () => {
  const legacy = { encryptedApiKey: 'legacy-asr', encryptedLlmApiKey: 'legacy-llm' };
  assert.deepEqual(selectTranscriptionSettings({}, legacy), legacy);
  assert.deepEqual(selectTranscriptionSettings({ region: 'beijing' }, legacy), { region: 'beijing' });
  assert.deepEqual(selectTranscriptionSettings(null, null), {});
});

test('recordingExtension only returns known audio file extensions', () => {
  assert.equal(recordingExtension('audio/webm;codecs=opus'), 'webm');
  assert.equal(recordingExtension('audio/mp4'), 'm4a');
  assert.equal(recordingExtension('audio/ogg'), 'ogg');
  assert.equal(recordingExtension('application/octet-stream'), 'webm');
});

test('normalizeWindowRows preserves separate windows and filters empty titles', () => {
  const rows = normalizeWindowRows([
    { pid: 10, appName: 'Code', title: 'alpha — Visual Studio Code', windowIndex: 0, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: 'beta — Visual Studio Code', windowIndex: 1 },
    { pid: 11, appName: 'Finder', title: '', windowIndex: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].appPath, '/Applications/Visual Studio Code.app');
  assert.equal(rows[1].title, 'beta — Visual Studio Code');
});

test('normalizeWindowRows collapses same-process duplicates of one window title', () => {
  // 实测：微信只开了一个窗口，CGWindowList 却返回两条同名记录（窗口号 53696 与 85），
  // 界面上就成了两个「微信」。聚焦按标题匹配，重复条目指向同一个窗口，必须只留最前那条。
  const rows = normalizeWindowRows([
    { pid: 650, appName: '微信', title: '微信', windowNumber: 53696, appPath: '/Applications/微信.app' },
    { pid: 650, appName: '微信', title: '微信', windowNumber: 85, appPath: '/Applications/微信.app' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'window-650-53696');

  // 同应用的不同窗口（标题不同）必须全部保留，多工作区的 VS Code 不能被误删。
  const editors = normalizeWindowRows([
    { pid: 26497, appName: 'Code', title: '灵动岛', windowNumber: 1, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 26497, appName: 'Code', title: 'Vlog制作工坊', windowNumber: 2, appPath: '/Applications/Visual Studio Code.app' },
  ]);
  assert.equal(editors.length, 2);

  // 同名窗口分属不同进程时是两个真实应用，不能合并。
  const distinct = normalizeWindowRows([
    { pid: 1, appName: '备忘录', title: '备忘录', windowNumber: 10 },
    { pid: 2, appName: '备忘录', title: '备忘录', windowNumber: 11 },
  ]);
  assert.equal(distinct.length, 2);
});

test('normalizeWindowRows keeps all named CGWindow entries with stable window ids', () => {
  const rows = normalizeWindowRows([
    { pid: 10, appName: 'Code', title: '灵动岛', windowNumber: 501, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: 'Lollipop-Test', windowNumber: 502, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: 'AI PM 备课坊', windowNumber: 503, appPath: '/Applications/Visual Studio Code.app' },
    { pid: 10, appName: 'Code', title: '', windowNumber: 504, appPath: '/Applications/Visual Studio Code.app' },
  ]);
  assert.deepEqual(rows.map((row) => row.id), [
    'window-10-501',
    'window-10-502',
    'window-10-503',
  ]);
});

test('todoReminderState fires once within the final hour and expires after the DDL', () => {
  const deadline = Date.parse('2026-08-22T10:00:00.000Z');
  const todo = { id: 't1', text: '发布新版', deadline: new Date(deadline).toISOString(), done: false, remindedAt: 0 };
  assert.deepEqual(todoReminderState(todo, deadline - 2 * 60 * 60 * 1000), {
    state: 'scheduled',
    delayMs: 60 * 60 * 1000,
  });
  assert.deepEqual(todoReminderState(todo, deadline - 30 * 60 * 1000), {
    state: 'due',
    delayMs: 0,
  });
  assert.equal(todoReminderState({ ...todo, remindedAt: deadline - 60 * 60 * 1000 }, deadline - 30 * 60 * 1000).state, 'notified');
  assert.equal(todoReminderState(todo, deadline + 1).state, 'expired');
});

test('task notification identifies the repository and concrete finished work', () => {
  assert.deepEqual(taskNotificationIdentity({
    title: '新的任务已经完成',
    cwd: '/Users/ahai/Documents/灵动岛',
    'last-assistant-message': '已完成 VS Code 工作区名称识别，并修复拖拽残留。\n测试已通过。',
  }, 'codex'), {
    project: '灵动岛',
    title: '已完成 VS Code 工作区名称识别，并修复拖拽残留。',
  });
  assert.deepEqual(taskNotificationIdentity({
    project: 'CourseKit',
    task_title: '生成课程大纲',
  }, 'gpt'), {
    project: 'CourseKit',
    title: '生成课程大纲',
  });
  assert.deepEqual(taskNotificationIdentity({
    cwd: '/Users/ahai/Documents/灵动岛',
    last_assistant_message: '## 已接好 Claude Code 的 Stop 钩子\n测试全部通过。',
  }, 'claude'), {
    project: '灵动岛',
    title: '已接好 Claude Code 的 Stop 钩子',
  });
  // 记录文件还没落盘时标题为空，各来源要退回自己的兜底文案。
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'claude').title, 'Claude 已完成任务');
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'codex').title, 'Codex 已完成任务');
  assert.equal(taskNotificationIdentity({ cwd: '/tmp/demo' }, 'todo').title, '任务已完成');
});

test('credential input trims metadata but preserves password bytes and rejects incomplete records', () => {
  assert.deepEqual(normalizeCredentialInput({
    service: '  GitHub  ',
    account: '  user@example.com  ',
    password: '  p@ss word  ',
  }, 'cred-1', 100), {
    id: 'cred-1',
    service: 'GitHub',
    account: 'user@example.com',
    password: '  p@ss word  ',
    createdAt: 100,
  });
  assert.equal(normalizeCredentialInput({ service: '', account: 'a', password: 'b' }), null);
  assert.equal(normalizeCredentialInput({ service: 'A', account: '', password: 'b' }).account, '');
  assert.equal(normalizeCredentialInput({ service: 'A', account: 'a', password: '' }), null);
});

test('smart link metadata accepts fenced JSON but restricts category and title lengths', () => {
  assert.deepEqual(parseSmartLinkMetadata('```json\n{"title":"OpenAI API 文档","category":"开发"}\n```'), {
    title: 'OpenAI API 文档',
    category: '开发',
  });
  assert.deepEqual(parseSmartLinkMetadata('{"title":"  ","category":"一个非常非常非常非常非常非常长的分类名称"}'), {
    title: '',
    category: '一个非常非常非常非常非常非常',
  });
  assert.equal(parseSmartLinkMetadata('not-json'), null);
});

test('clipboard polling and quick shortcut both follow the explicit feature switch', () => {
  // 剪贴板默认关闭，关着就不能轮询系统剪贴板：原实现恒返回 recordHistory: true，
  // 于是主进程无论开关状态都在每 500ms 读一次粘贴板，粘贴板里有大图时空转吃掉三成 CPU。
  assert.deepEqual(clipboardServicePolicy({ clip: true }), {
    recordHistory: true,
    registerGlobalShortcut: true,
  });
  assert.deepEqual(clipboardServicePolicy({ clip: false }), {
    recordHistory: false,
    registerGlobalShortcut: false,
  });
  // 缺字段或传入非对象时一律按「关闭」处理，不能默默恢复轮询。
  assert.equal(clipboardServicePolicy({}).recordHistory, false);
  assert.equal(clipboardServicePolicy(undefined).recordHistory, false);
  assert.equal(clipboardServicePolicy(true).recordHistory, false);
  // 未启用就不占用快捷键；旧 Cmd+Shift+V 不恢复。
  for (const input of [{ clip: false }, {}, undefined]) {
    assert.equal(clipboardServicePolicy(input).registerGlobalShortcut, false);
  }
});

test('feature preferences only update configurable tabs and keep permanent tabs enabled', () => {
  assert.equal(typeof updateFeaturePreference, 'function', 'updateFeaturePreference must exist');
  assert.deepEqual(updateFeaturePreference({ todo: true, clip: false }, 'clip', true), {
    todo: true,
    clip: true,
    home: true,
  });
  assert.deepEqual(updateFeaturePreference({ inbox: true }, 'inbox', false), {
    inbox: false,
    home: true,
  });
  assert.equal(updateFeaturePreference({ todo: true }, 'home', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'settings', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'unknown', false), null);
  assert.equal(updateFeaturePreference({ todo: true }, 'todo', 'false'), null);
});

test('panel shortcut requires a conflict-safe modifier and migrates legacy Space', () => {
  assert.equal(DEFAULT_PANEL_SHORTCUT, 'CommandOrControl+Shift+Space');
  assert.equal(isSafePanelShortcut('CommandOrControl+Shift+Space'), true);
  assert.equal(isSafePanelShortcut('Command+K'), true);
  assert.equal(isSafePanelShortcut('Control+Option+7'), true);
  assert.equal(isSafePanelShortcut('Space'), false);
  assert.equal(isSafePanelShortcut('Shift+Space'), false);
  assert.equal(isSafePanelShortcut('A'), false);
  assert.equal(panelShortcutIdentity('CommandOrControl+Shift+Space'), 'Command+Shift+Space');
  assert.equal(isReservedPanelShortcut('Command+Space'), true);
  assert.equal(isReservedPanelShortcut('Command+Shift+4'), true);
  assert.equal(isSafePanelShortcut('Command+Space'), false);
  assert.equal(isSafePanelShortcut('Command+W'), false);
  assert.equal(isSafePanelShortcut('Control+Space'), false);
  assert.equal(normalizePanelShortcut('Space'), DEFAULT_PANEL_SHORTCUT);
  assert.equal(normalizePanelShortcut('Command+K'), 'Command+K');
});

test('first Soda Music play launches and sends a command without inventing playback state', async () => {
  const events = [];
  let running = false;
  const result = await controlSodaMusic('play', {
    isRunning: async () => {
      events.push('running');
      return running;
    },
    launch: async () => {
      events.push('launch');
      running = true;
      return true;
    },
    sendShortcut: async (action) => {
      events.push(`shortcut:${action}`);
      return { ok: true };
    },
    sleep: async () => {},
  });

  assert.deepEqual(events, ['running', 'launch', 'running', 'shortcut:play']);
  assert.equal(result.ok, true);
  assert.equal(result.running, true);
  assert.equal(result.playing, null);
  assert.equal(result.commandSent, true);
  assert.equal(result.bootstrapped, true);
});

test('running Soda Music uses its own shortcuts because native media status can stay empty', async () => {
  const events = [];
  const result = await controlSodaMusic('play', {
    isRunning: async () => true,
    launch: async () => {
      events.push('launch');
      return true;
    },
    sendShortcut: async (action) => {
      events.push(`shortcut:${action}`);
      return { ok: true };
    },
    sleep: async () => {},
  });

  assert.deepEqual(events, ['shortcut:play']);
  assert.equal(result.ok, true);
  assert.equal(result.playing, null);
  assert.equal(result.bootstrapped, false);
});

test('Soda Music toggle and navigation do not claim to know playback state', async () => {
  const shortcuts = [];
  const dependencies = {
    isRunning: async () => true,
    launch: async () => true,
    sendShortcut: async (action) => {
      shortcuts.push(action);
      return { ok: true };
    },
    sleep: async () => {},
  };

  assert.equal((await controlSodaMusic('pause', dependencies)).playing, null);
  assert.equal((await controlSodaMusic('next', dependencies)).playing, null);
  assert.equal((await controlSodaMusic('previous', dependencies)).playing, null);
  assert.equal((await controlSodaMusic('toggle', dependencies)).commandSent, true);
  assert.deepEqual(shortcuts, ['pause', 'next', 'previous', 'toggle']);
});

test('Soda Music play uses the play/pause toggle instead of the next-track key', () => {
  // play 曾经和 next 撞成同一个键（Cmd+Right），点播放实际是切歌、歌不会开始播。
  // Space 是播放/暂停切换键，play 与 pause 共用它，next / previous 必须与之不同。
  assert.deepEqual(sodaShortcutSpec('play'), { keyCode: 49, command: false, dismissOverlays: false });
  assert.deepEqual(sodaShortcutSpec('pause'), { keyCode: 49, command: false, dismissOverlays: false });
  assert.deepEqual(sodaShortcutSpec('next'), { keyCode: 124, command: true, dismissOverlays: false });
  assert.deepEqual(sodaShortcutSpec('previous'), { keyCode: 123, command: true, dismissOverlays: false });
  assert.notDeepEqual(sodaShortcutSpec('play'), sodaShortcutSpec('next'));
  assert.equal(sodaShortcutSpec('invalid'), null);
});
