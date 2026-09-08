const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-quick-records-'));
delete process.env.DASHSCOPE_API_KEY;delete process.env.NOTCH_LLM_API_KEY;
require('../main');
const run=(w,s)=>w.webContents.executeJavaScript(s,true).catch(e=>{console.error('Failed fixture:',s.slice(0,180));throw e;}),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<250;i++){const v=await fn();if(v)return v;await pause(30);}throw Error('wait_timeout');}
async function main(){
  await app.whenReady();
  const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(()=>run(host,'!!window.QuickRecords&&!!window.Notebook'));
  const failures=[];host.webContents.on('console-message',(_e,level,message)=>{if(level===3)failures.push(message);});
  host.hide();host.webContents.setBackgroundThrottling(false);
  // Migration fixture in isolated test data only. Never touches the installed userData.
  await run(host,`document.getElementById('home-note').value='旧随手记 · 演示';localStorage.removeItem(QuickRecordModel.KEY);localStorage.setItem('notch-home-note','旧随手记 · 演示');`);
  host.reload();await wait(()=>run(host,`!!window.QuickRecords&&QuickRecords.snapshot().note.content==='旧随手记 · 演示'`).catch(()=>false));
  const first=await run(host,'QuickRecords.snapshot().state.activeId');
  const openedQuick=await run(host,`Notebook.detach('quick')`);assert.equal(openedQuick?.ok,true,JSON.stringify(openedQuick));
  let quick=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/floating.html')));
  await wait(()=>run(quick,`!!document.querySelector('.qr-editor')`));
  const click=async(action)=>{await run(quick,`document.querySelector('[data-qr="${action}"]').click()`);await pause(180);};
  const input=async(text)=>{await run(quick,`(()=>{const t=document.querySelector('[data-field="content"]');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
  const state=()=>run(host,'QuickRecords.snapshot().state');
  await input('诚信 · 课堂记录\n1. 真实表达\n2. 言行一致');await click('new');
  const second=(await state()).activeId;assert.notEqual(first,second);assert.equal((await state()).records.find(r=>r.id===first).content.includes('言行一致'),true);
  await input('突然想到：把学习心得录成一段短音频。');await click('back');
  assert.equal((await state()).activeId,first);
  assert.match(await run(quick,`document.querySelector('[data-field="content"]').value`),/言行一致/);
  await click('finish');assert.equal(await run(quick,`document.querySelector('.qr-finish').hidden`),false);
  await click('later');assert.equal((await state()).records.find(r=>r.id===first).confirmedAt,0);
  await click('finish');await click('confirm');assert.ok((await state()).records.find(r=>r.id===first).confirmedAt);
  await input('诚信 · 课堂记录\n1. 真实表达\n2. 言行一致\n3. 追加一个自己的例子');
  await wait(async()=>!(await state()).records.find(r=>r.id===first).confirmedAt);
  await click('pin');assert.equal((await state()).records.find(r=>r.id===first).pinned,true);
  // Failed local write must block navigation and close while retaining the editor text.
  await run(host,`window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===QuickRecordModel.KEY)throw Error('quota');return window.__setItem.call(this,k,v);};void 0;`);
  await input('失败时保留的输入');await click('new');assert.equal((await state()).activeId,first);
  assert.equal(await run(quick,`document.querySelector('[data-field="content"]').value`),'失败时保留的输入');
  assert.equal(await run(quick,`document.querySelector('.qr-status').classList.contains('error')`),true);
  await run(quick,`document.getElementById('float-dock').click()`);await pause(200);assert.equal(quick.isDestroyed(),false);
  await run(host,'Storage.prototype.setItem=window.__setItem;void 0');await click('retry');assert.equal((await state()).records.find(r=>r.id===first).content,'失败时保留的输入');
  await input('诚信 · 课堂记录\n1. 真实表达\n2. 言行一致\n3. 追加一个自己的例子');await click('finish');
  const dir=process.env.PANEL_QUICK_CAPTURE_DIR;
  if(dir){fs.mkdirSync(dir,{recursive:true});
    for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}')`);await pause(100);fs.writeFileSync(path.join(dir,`quick-${theme}.png`),(await quick.webContents.capturePage()).toPNG());}
    quick.setSize(320,440);await pause(120);assert.equal(await run(quick,'document.documentElement.scrollWidth>innerWidth'),false);
    assert.equal(await run(quick,`document.querySelector('.qr-footer').getBoundingClientRect().bottom<=innerHeight`),true,'footer must remain visible');
    fs.writeFileSync(path.join(dir,'quick-narrow.png'),(await quick.webContents.capturePage()).toPNG());quick.setSize(440,580);
  }
  await click('later');await click('library');
  await run(quick,`const search=document.querySelector('[data-qr-search]');search.value='短音频';search.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await run(quick,`document.querySelectorAll('.qr-row').length`),1);
  await run(quick,`document.querySelector('.qr-row').click()`);await pause(160);assert.equal((await state()).activeId,second);
  await click('trash');assert.ok((await state()).records.find(r=>r.id===second).trashedAt);
  assert.equal((await run(quick,`floatingAPI.request({action:'records',command:{action:'restore',recordId:'${second}'}})`)).ok,true);
  await run(quick,`document.getElementById('float-dock').click()`);await wait(()=>quick.isDestroyed());
  const persisted=await state();host.reload();await wait(()=>run(host,'!!window.QuickRecords&&!!window.Notebook').catch(()=>false));assert.deepEqual(await state(),persisted);
  await run(host,`Notebook.detach('quick')`);quick=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/floating.html')));
  await wait(()=>run(quick,`!!document.querySelector('.qr-editor')`));await run(quick,`document.getElementById('float-dock').click()`);await wait(()=>quick.isDestroyed());
  // Native non-focus reminder, using a deterministic clock/context rather than altering the Mac clock.
  const M=require('../renderer/quick-record-model'),{createQuickReview}=require('../main-quick-review');
  const now=new Date(2026,8,5,20,30).getTime();let fixture=M.initial('测试提醒','fixture',now),ctx={idleSeconds:10},recording=false,opened=0;
  const request=async p=>{if(p.action==='review-state')return {ok:true,state:fixture,recording,theme:'white'};fixture=M.change(fixture,p.command,now);return {ok:true,state:fixture};};
  const review=createQuickReview({request,open:async()=>{opened++;},enabled:false,clock:()=>now,context:()=>ctx});
  for(const c of [{idleSeconds:0},{idleSeconds:300},{idleSeconds:10,locked:true},{idleSeconds:10,fullscreen:true},{idleSeconds:10,suspended:true}]){ctx=c;assert.equal(await review.tick(),false);}
  ctx={idleSeconds:10};recording=true;assert.equal(await review.tick(),false);recording=false;
  const focused=BrowserWindow.getFocusedWindow();assert.equal(await review.tick(),true);assert.equal(BrowserWindow.getFocusedWindow(),focused);
  const reminder=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/quick-review.html'));assert.equal(reminder.isFocusable(),false);
  assert.match(await run(reminder,`document.getElementById('review-title').textContent`),/1 条/);
  // On this Mac, Chromium capturePage returns a blank frame for the transparent
  // inactive window. Verify its actual pixels with scripts/preview-quick-review.js
  // and the native desktop capture; don't save a misleading blank evidence image.
  await run(reminder,`document.querySelector('[data-action="open"]').click()`);await wait(()=>opened===1);assert.equal(await review.tick(),false);review.dispose();
  assert.deepEqual(failures,[]);
  console.log('PASS quick records Electron: legacy migration, independent drafts, append/confirm, local save failure blocks new/close, retry, search, pin/trash/restore, reload persistence, narrow layout, native non-focus reminder and deterministic suppression fixtures. No real recording or clock changes.');
  app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
