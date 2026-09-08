'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mail-ui-'));
process.env.PANEL_TEST_MODE = '1'; process.env.PANEL_TEST_USER_DATA_PATH = dir;
global.fetch = async () => { throw Error('no_network_in_fixture'); };
BrowserWindow.prototype.show = function () {};
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = v => Buffer.from(v); safeStorage.decryptString = v => v.toString();
require('../main');
const run = (w, code) => w.webContents.executeJavaScript(code, true), pause = ms => new Promise(r => setTimeout(r, ms));
async function wait(fn) { for (let n = 0; n < 160; n++) { try { if (await fn()) return; } catch {} await pause(40); } throw Error('mail UI timeout'); }
async function click(w, text) { return run(w, `[...document.querySelectorAll('#mail-root button')].find(b=>b.textContent===${JSON.stringify(text)}&&b.getClientRects().length)?.click()`); }
async function main() {
  await app.whenReady(); let host;
  await wait(() => host = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(() => run(host, '!!document.querySelector(".mail-view")'));
  host.isVisible = () => true; host.focus = () => {};
  const errors = []; host.webContents.on('console-message', (_e, l, m) => { if (l >= 3) errors.push(m); });
  const original = await run(host, 'notchAPI.mailGet()'); assert.equal(original.ok, true); assert.equal(original.accounts.length, 0);
  await run(host, 'notchAPI.setFeature("mail",false)'); assert.equal((await run(host, 'notchAPI.mailGet()')).error, 'forbidden');
  await run(host, 'notchAPI.setFeature("mail",true)'); assert.equal((await run(host, 'notchAPI.mailGet()')).ok, true);
  const foreign = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../preload.js'), sandbox: true, contextIsolation: true } });
  await foreign.loadFile(path.join(__dirname, '../renderer/float-dock.html'));
  assert.equal((await run(foreign, 'notchAPI.mailGet()')).error, 'forbidden'); foreign.destroy();
  let state = original, calls = 0, saveFail = true;
  const replace = (name, fn) => { ipcMain.removeHandler('mail:' + name); ipcMain.handle('mail:' + name, fn); };
  replace('get', () => state);
  replace('save', (_e, p) => {
    calls++; assert.equal(p.secret, 'fixture-code'); assert.equal(p.confirmed, true);
    if (saveFail) return { ok: false, error: 'auth_failed' };
    state = { ...state, revision: state.revision + 1, accounts: [{ id: 'fixture-a', provider: p.provider, email: p.email, items: [], refreshedAt: null }] }; return state;
  });
  replace('refresh', () => {
    const a = state.accounts[0]; a.refreshedAt = Date.now(); a.scanned = 80; a.items = [{ id: 'fixture-a:1:1', uid: 1, subject: '设计评审：确认下周的交付范围（模拟邮件）', from: '测试团队', date: Date.now(), part: { part: '1' } }, { id: 'fixture-a:1:2', uid: 2, subject: '<img src=x onerror=alert(1)>', from: '测试 HTML 转义', date: Date.now() - 1000 }]; return state;
  });
  replace('read', () => ({ ok: true, text: '这是隔离测试中的模拟邮件，不是真实收件。\n\n请在周五前确认首页视觉方案和交付范围。\n\n下一步：核对稿件，整理反馈，确认负责人。\n<script>window.mailInjected=true</script>' }));
  replace('remove', (_e, p) => { assert.equal(p.confirmed, true); state = { ...state, revision: state.revision + 1, accounts: [] }; return state; });
  await run(host, 'setMode(true)'); await run(host, 'setActiveTab("mail")'); await pause(700);
  await wait(() => run(host, 'document.querySelector("#tab-mail").classList.contains("active") && getComputedStyle(document.querySelector("#tab-mail")).visibility === "visible"'));
  const captures = path.join(__dirname, '../docs/evidence/stage32'); fs.mkdirSync(captures, { recursive: true });
  fs.writeFileSync(path.join(captures, 'empty.png'), (await host.capturePage()).toPNG());
  await click(host, '添加邮箱');
  await run(host, `document.querySelector('.mail-account-form input[name=email]').value='fixture@qq.com';document.querySelector('.mail-account-form input[name=secret]').value='fixture-code';document.querySelector('.mail-account-form').dispatchEvent(new Event('input'));document.querySelector('.mail-account-form').requestSubmit()`);
  await wait(() => run(host, 'document.querySelector(".mail-status").textContent.includes("拒绝")'));
  assert.equal(await run(host, 'document.querySelector("input[name=secret]").value'), 'fixture-code'); assert.equal(calls, 1);
  assert.equal(await run(host, 'document.querySelector("input[name=secret]").type'), 'password');
  saveFail = false; await run(host, 'document.querySelector(".mail-account-form").requestSubmit()');
  await wait(() => state.accounts.length === 1); await wait(() => run(host, 'document.querySelector("input[name=secret]").value===""'));
  assert.equal(await run(host, 'Object.keys(localStorage).some(k=>String(localStorage.getItem(k)).includes("fixture-code"))'), false);
  await click(host, '管理账号'); await click(host, '刷新未读'); await wait(() => run(host, 'document.querySelectorAll(".mail-message").length===2'));
  assert.equal(await run(host, 'document.querySelectorAll("#mail-root img").length'), 0);
  await run(host, 'document.querySelector(".mail-message").click()'); await wait(() => run(host, 'document.querySelector(".mail-body").textContent.includes("模拟邮件")'));
  assert.equal(await run(host, 'window.mailInjected'), undefined);
  for (const theme of ['white', 'obsidian']) {
    await run(host, `PanelAppearance.setTheme('${theme}')`); await pause(150);
    assert.equal(await run(host, '(()=>{const r=document.querySelector("#mail-root").getBoundingClientRect();return r.top>50&&r.bottom<=innerHeight&&r.height>300;})()'), true);
    assert.equal(await run(host, 'document.documentElement.scrollWidth<=innerWidth'), true);
    assert.equal(await run(host, 'document.querySelector("#tab-mail").classList.contains("active")'), true);
    fs.writeFileSync(path.join(captures, theme + '.png'), (await host.capturePage()).toPNG());
  }
  await click(host, '转笔记'); assert.equal(await run(host, 'loadNoteArchive().length'), 0); await run(host, 'document.querySelector(".mail-transfer").requestSubmit()');
  await wait(() => run(host, 'loadNoteArchive().length===1')); assert.ok((await run(host, 'loadNoteArchive()[0].content')).includes('确认负责人'));
  await click(host, '转待办'); await run(host, `document.querySelector('.mail-transfer input[name=day]').value='2026-09-11';document.querySelector('.mail-transfer').requestSubmit()`);
  await wait(async () => (await run(host, 'notchAPI.plannerGet()')).state.items.length === 1);
  const item = (await run(host, 'notchAPI.plannerGet()')).state.items[0]; assert.equal(item.date, '2026-09-11'); assert.equal(item.scheduled, false);
  host.setSize(680, 650); await pause(150); assert.equal(await run(host, 'document.documentElement.scrollWidth<=innerWidth'), true);
  await click(host, '管理账号'); await click(host, '移除连接'); assert.equal(state.accounts.length, 1); await click(host, '确认移除本机连接'); await wait(() => state.accounts.length === 0);
  assert.equal((await run(host, 'notchAPI.plannerGet()')).state.items.length, 1); assert.equal(await run(host, 'loadNoteArchive().length'), 1);
  assert.deepEqual(errors, []);
  console.log('PASS mail UI: four-provider setup, failure/input preservation, masked secrets, escaped content, manual confirmed note/todo transfer, remove guard, two themes and narrow viewport. Synthetic data only; no real mailbox authorization.');
  app.exit(0);
}
main().catch(e => { console.error(e); app.exit(1); });
