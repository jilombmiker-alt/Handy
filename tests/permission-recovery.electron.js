const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, systemPreferences, desktopCapturer, shell } = require('electron');
process.env.PANEL_TEST_MODE = '1';
process.env.PANEL_TEST_USER_DATA_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-permission-test-'));
delete process.env.NOTCH_LLM_API_KEY; delete process.env.DASHSCOPE_API_KEY;
const originals = { media:systemPreferences.getMediaAccessStatus, ax:systemPreferences.isTrustedAccessibilityClient, capture:desktopCapturer.getSources, relaunch:app.relaunch, quit:app.quit };
let captureCalls = 0, relaunchCalls = 0, quitCalls = 0;
const statuses = { screen:'granted', microphone:'granted', camera:'not-determined' };
systemPreferences.getMediaAccessStatus = (type) => statuses[type];
systemPreferences.isTrustedAccessibilityClient = (prompt) => { assert.equal(prompt, false); return true; };
desktopCapturer.getSources = async () => { captureCalls++; throw Error('unexpected_capture'); };
require('../main');
// Install the scan stub before the renderer starts its initial scan. Replacing an
// IPC handler later does not cancel an already-running native enumeration.
let windowError = 'window_scan_timeout';
ipcMain.removeHandler('windows:list');
ipcMain.handle('windows:list',()=>({items:[],error:windowError}));
const run = (host, code) => host.webContents.executeJavaScript(code, true);
const pause = (ms) => new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check) { for (let i=0;i<150;i++) { const value=await check(); if(value)return value; await pause(40); } throw Error('wait_timeout'); }

async function main() {
  await app.whenReady();
  const host = await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(()=>run(host,'!!window.Notebook'));
  host.hide(); host.webContents.setBackgroundThrottling(false);
  const snapshot = await run(host,'notchAPI.getPermissionStatuses()');
  assert.equal(snapshot.camera,'not-determined'); assert.equal(snapshot.microphone,'granted');
  assert.doesNotMatch(snapshot.message,/重启/); assert.equal(captureCalls,0);
  await run(host,`document.getElementById('settings-permission-refresh').click()`);
  await wait(()=>run(host,`document.getElementById('settings-permission-note').textContent.includes('不用的功能无需授权')`));
  assert.equal(await run(host,`document.getElementById('settings-permission-note').classList.contains('error')`),false);

  await wait(()=>run(host,'!!window.ToolLauncher'));
  app.emit('activate');app.emit('activate');
  await wait(()=>run(host,`document.getElementById('app').classList.contains('expanded')`));
  await pause(300);
  assert.equal(host.isVisible(),true,'duplicate launch signals must not toggle the panel closed');
  await run(host,`ToolLauncher.open(null)`);
  assert.equal(await run(host,`document.querySelector('.launcher-welcome').hidden`),false);
  await run(host,`document.getElementById('launcher-permission-help').click()`);
  await wait(()=>run(host,`ToolLauncher.current === 'settings'`));
  assert.equal(await run(host,`document.getElementById('settings-reveal-app').disabled`),true,'development shell is not an install candidate');
  await run(host,`ToolLauncher.open(null)`);
  await run(host,`document.getElementById('launcher-welcome-dismiss').click()`);
  assert.equal(await run(host,`localStorage.getItem('handy-welcome-dismissed-v1')`),'true');
  let asks=0;
  const oldAsk=systemPreferences.askForMediaAccess;
  systemPreferences.askForMediaAccess=async kind=>{assert.equal(kind,'camera');asks++;statuses.camera='granted';return true;};
  await run(host,`document.querySelector('[data-permission-request="camera"]').click()`);
  await wait(()=>run(host,`document.querySelector('[data-permission-status="camera"]').textContent === '已授权'`));
  assert.equal(asks,1);assert.equal(captureCalls,0);
  systemPreferences.askForMediaAccess=oldAsk;
  const oldOpen=shell.openExternal;shell.openExternal=async()=>{throw Error('test-only-open-failed');};
  await run(host,`document.querySelector('[data-permission-pane="microphone"]').click()`);
  await wait(()=>run(host,`document.getElementById('settings-permission-note').textContent.includes('未能打开设置')`));
  assert.equal(await run(host,`notchAPI.openPrivacySettings('__proto__')`),false);
  shell.openExternal=oldOpen;
  await run(host,`ToolLauncher.open('settings')`);
  await run(host,`document.querySelector('.settings-column-secondary').scrollTop=0`);
  await pause(250);
  fs.writeFileSync(path.join(__dirname,'../docs/screenshots/stage46-permissions.png'),(await host.webContents.capturePage()).toPNG());
  await run(host,`document.querySelector('[data-theme-choice="obsidian"]').click()`);
  await pause(250);
  assert.equal(await run(host,`document.documentElement.dataset.theme`),'obsidian');
  fs.writeFileSync(path.join(__dirname,'../docs/screenshots/stage46-permissions-obsidian.png'),(await host.webContents.capturePage()).toPNG());
  await run(host,`document.querySelector('[data-theme-choice="white"]').click()`);
  if (process.argv.includes('--interactive')) { console.log('Isolated permission UI ready; system APIs are mocked.'); host.show(); host.focus(); await pause(60000); }

  await run(host,`ToolLauncher.open('windows')`);
  await run(host,'NotchWorkspace.refreshWindows(true)');
  await wait(()=>run(host,`document.querySelector('.wt-empty')?.textContent.includes('窗口读取超时')`));
  assert.equal(await run(host,`document.querySelectorAll('.wt-recovery button').length`),1);
  windowError='automation_permission_required';
  await run(host,'NotchWorkspace.refreshWindows(true)');
  await wait(()=>run(host,`document.querySelector('.wt-empty')?.textContent === '需要自动化许可'`));
  assert.equal(await run(host,`document.querySelector('.wt-empty').textContent`),'需要自动化许可');

  app.relaunch=()=>{relaunchCalls++;}; app.quit=()=>{quitCalls++;};
  let resolveMicrophone;
  ipcMain.removeHandler('media:microphone');
  ipcMain.handle('media:microphone',()=>new Promise(resolve=>{resolveMicrophone=resolve;}));
  await run(host,`window.pendingStart=PanelRecording.command('start');void 0;`);
  await wait(()=>resolveMicrophone);
  await run(host,`document.getElementById('settings-permission-relaunch').click()`);
  await pause(150); assert.equal(relaunchCalls,0,'Do not restart during a pending microphone request');
  resolveMicrophone(false); await run(host,'window.pendingStart');
  await run(host,`window.realFlush=Notebook.flushForExit;Notebook.flushForExit=async()=>{throw Error('save_failed');};document.getElementById('settings-permission-relaunch').click();`);
  await pause(150); assert.equal(relaunchCalls,0); assert.equal(quitCalls,0);
  await run(host,`Notebook.flushForExit=window.realFlush;document.getElementById('home-note').value='重启前必须保留';document.getElementById('settings-permission-relaunch').click();document.getElementById('settings-permission-relaunch').click();`);
  await wait(()=>quitCalls===1);
  assert.equal(relaunchCalls,1);
  assert.equal(await run(host,`localStorage.getItem('notch-home-note')`),'重启前必须保留');
  assert.equal(captureCalls,0);
  console.log('PASS permission recovery: passive production IPC, optional permission messaging, scan error UI, pending microphone and failed-save block restart, saved draft and one graceful quit. OS grants/signing remain unverified.');
}
main().then(()=>{
  systemPreferences.getMediaAccessStatus=originals.media;systemPreferences.isTrustedAccessibilityClient=originals.ax;desktopCapturer.getSources=originals.capture;
  app.relaunch=originals.relaunch;app.quit=originals.quit;app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
