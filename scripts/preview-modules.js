// Independent, explicitly labelled preview. Never reads the installed application's data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
process.env.PANEL_TEST_MODE = '1';
process.env.PANEL_TEST_USER_DATA_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-modules-preview-'));
delete process.env.NOTCH_LLM_API_KEY;
delete process.env.DASHSCOPE_API_KEY;
require('../main');
let tray;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let host;
  for (let i = 0; i < 200; i++) {
    host = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html'));
    if (host && await host.webContents.executeJavaScript('!!window.PanelModules').catch(() => false)) break;
    await pause(40);
  }
  if (!host) throw Error('preview_start_failed');
  const run = code => host.webContents.executeJavaScript(code);
  const show = async () => { host.show(); host.focus(); await run('setMode(true)'); };
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('悬浮预览');
  tray.setToolTip('TO-DO Panel · 隔离功能预览（非正式数据）');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开灵动岛预览', click: () => void show() },
    { label: '退出此次预览', click: () => app.quit() },
  ]));
  app.on('activate', () => void show());
  app.once('will-quit', () => tray?.destroy());
  await run(String.raw`(async()=>{
    await PanelModules.request('todo',{action:'command',operation:'add',values:{text:'试一试：在小窗完成这条演示待办',priority:'P0'}});
    await PanelModules.request('commands',{action:'command',operation:'add',values:{text:'把今天最重要的一件事写下来。'}});
    document.getElementById('home-note').value='这是隔离预览，不读取正式笔记或密钥。\n\n移动整个灵动岛：拖左上角名称。\n只拖出一个板块：悬停 3 秒，使用上方居中的拖出把手。\n点击左上角名称，也能直接选择悬浮板块。\n收起后可从菜单栏「悬浮预览」再次打开。';
    document.getElementById('home-note').dispatchEvent(new Event('input',{bubbles:true}));
    await Notebook.detach('module','todo');
    await Notebook.detach('module','commands');
    await setActiveTab('home');
  })()`);
  const area = screen.getPrimaryDisplay().workArea;
  const floats = BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('/renderer/floating.html'));
  floats.forEach((w, i) => { w.setTitle('TO-DO Panel · 隔离模块预览'); w.setPosition(area.x + 30 + i * 460, area.y + 70); });
  host.setTitle('TO-DO Panel · 边缘移动与悬浮预览');
  await app.dock?.show();
  console.log(`Module preview ready. Isolated data: ${process.env.PANEL_TEST_USER_DATA_PATH}`);
}).catch(error => { console.error(error.message); app.exit(1); });
