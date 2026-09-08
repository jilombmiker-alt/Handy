const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-weekly-ideas-'));
delete process.env.DASHSCOPE_API_KEY;delete process.env.NOTCH_LLM_API_KEY;
require('../main');
const run=(w,s)=>w.webContents.executeJavaScript(s,true).catch(e=>{throw Error(`${e.message} Fixture: ${s.slice(0,200)}`);}),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<250;i++){const v=await fn();if(v)return v;await pause(30);}throw Error('wait_timeout');}
async function main(){
  await app.whenReady();
  const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(()=>run(host,'!!window.QuickRecords&&!!window.Notebook'));
  host.hide();host.webContents.setBackgroundThrottling(false);
  const errors=[];host.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
  const fixture={id:'recording-fixture',createdAt:Date.now(),transcript:'想做一个学习卡片的小工具。先让自己用起来，再决定要不要继续。',voice:{rawTranscript:'嗯，想做一个学习卡片的小工具。',status:'done',cleaned:'想做一个学习卡片的小工具。先让自己用起来，再决定要不要继续。'},quickCapture:true};
  await run(host,`localStorage.setItem('notch-recordings',${JSON.stringify(JSON.stringify([fixture]))})`);
  host.reload();await wait(()=>run(host,'!!window.QuickRecords&&!!window.Notebook').catch(()=>false));
  const state=()=>run(host,'QuickRecords.snapshot().state');
  await wait(async()=>(await state()).records.some(r=>r.sourceRecordingId===fixture.id));
  let captured=(await state()).records.find(r=>r.sourceRecordingId===fixture.id);assert.equal(captured.content,fixture.voice.cleaned);
  const count=(await state()).records.length;host.reload();await wait(()=>run(host,'!!window.QuickRecords&&!!window.Notebook').catch(()=>false));assert.equal((await state()).records.length,count,'restart deduplicates');
  await run(host,`Notebook.openQuick({recordId:${JSON.stringify(captured.id)}})`);
  const quick=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/floating.html')));
  await wait(()=>run(quick,`document.querySelector('[data-field="content"]')?.value.includes('学习卡片')`));
  assert.match(await run(quick,`document.querySelector('[data-qr-weekly]').parentElement.textContent`),/周五 14:00/);
  // Wait for the actual async handler, not an arbitrary 150ms IPC delay.
  await run(quick,`(()=>{const click=QuickRecordEditor.prototype.click;QuickRecordEditor.prototype.click=function(button){return window.lastQuickClick=click.call(this,button);};})()`);
  const click=async(action)=>{await run(quick,`document.querySelector('[data-qr="${action}"]').click();void 0`);await run(quick,'window.lastQuickClick');};
  await click('finish');await click('confirm');assert.ok((await state()).records.find(r=>r.id===captured.id).confirmedAt);
  await click('archive');await click('archive');
  const archive=await run(host,`JSON.parse(localStorage.getItem('notch-note-archive-v1'))`);assert.equal(archive.length,1);assert.equal(archive[0].sourceQuickRecordId,captured.id);assert.equal(archive[0].sourceRecordingId,fixture.id);
  // Weekly review must include already-confirmed and archived ideas, with no forced todo form.
  await run(host,'Notebook.openQuick()');await wait(()=>run(quick,`!!document.querySelector('.qr-idea')`));
  assert.match(await run(quick,`document.querySelector('.qr-idea').textContent`),/已记完/);
  const plannerBefore=await run(host,'notchAPI.plannerGet()');
  await run(quick,`document.querySelector('[data-choice="weekend"]').click()`);await wait(async()=>(await state()).records.find(r=>r.id===captured.id).reviewChoice==='weekend');
  assert.deepEqual(await run(host,'notchAPI.plannerGet()'),plannerBefore,'an intention is not an automatic todo');
  // Save failure shows recovery and preserves the previous decision.
  await run(host,`window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===QuickRecordModel.KEY)throw Error('quota');return originalSet.call(this,k,v);};void 0`);
  await run(quick,`document.querySelector('[data-choice="next-week"]').click()`);await pause(200);
  assert.equal((await state()).records.find(r=>r.id===captured.id).reviewChoice,'weekend');assert.equal(await run(quick,`document.querySelector('.qr-status').classList.contains('error')`),true);
  await run(host,'Storage.prototype.setItem=originalSet;void 0');await run(quick,`document.querySelector('[data-choice="next-week"]').click()`);await wait(async()=>(await state()).records.find(r=>r.id===captured.id).reviewChoice==='next-week');
  await run(host,`QuickRecords.command({action:'capture',recordingId:'unfinished-fixture',content:${JSON.stringify('周末试着写一篇：怎样把零散学习变成自己的知识？\n还没想好结构，先留住这个方向。')}})`);
  await wait(()=>run(quick,`document.querySelectorAll('.qr-idea').length===2`));
  const dir=process.env.PANEL_WEEKLY_CAPTURE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'weekly-evidence-'));fs.mkdirSync(dir,{recursive:true});
  quick.setSize(440,580);quick.show();
  for(const theme of ['white','obsidian']){
    await run(host,`PanelAppearance.setTheme('${theme}')`);await pause(150);
    assert.equal(await run(quick,'document.documentElement.scrollWidth>innerWidth'),false);
    fs.writeFileSync(path.join(dir,`weekly-${theme}.png`),(await quick.webContents.capturePage()).toPNG());
  }
  quick.webContents.setZoomFactor(1.2);quick.setSize(320,440);await pause(150);
  assert.equal(await run(quick,'document.documentElement.scrollWidth>innerWidth'),false);
  assert.equal(await run(quick,`document.querySelector('.qr-footer').getBoundingClientRect().bottom<=innerHeight`),true);
  assert.ok(await run(quick,`document.querySelector('.qr-library').getBoundingClientRect().height>150`),'reading area remains usable at 120% zoom');
  fs.writeFileSync(path.join(dir,'weekly-narrow.png'),(await quick.webContents.capturePage()).toPNG());quick.webContents.setZoomFactor(1);quick.setSize(440,580);
  // Source navigation and archived-note backlink use actual saved identities.
  await run(host,`Notebook.openQuick({recordId:${JSON.stringify(captured.id)}})`);await wait(()=>run(quick,`document.querySelector('.qr-writing').hidden===false`));
  await click('source');assert.equal(await run(host,`document.querySelector('#recording-detail .voice-memo')!==null`),true);
  await run(quick,`document.querySelector('.qr-actions details').open=true;document.querySelector('[data-qr-weekly]').checked=false`);await click('settings');assert.equal((await state()).settings.weeklyEnabled,false);
  await run(quick,`document.querySelector('[data-qr-weekly]').checked=true`);await click('settings');assert.equal((await state()).settings.weeklyEnabled,true);
  await run(host,`setActiveTab('notes');selectedNoteId=${JSON.stringify(archive[0].id)};renderNotesLibrary()`);
  assert.ok(await run(host,`[...document.querySelectorAll('.notes-detail-actions button')].some(b=>b.textContent==='来源随手记')`));
  // Main and detached planner both expose the weekly idea step.
  await run(host,`setActiveTab('todo');const scope=document.querySelector('#daily-planner .planner-scope');scope.value='week';scope.dispatchEvent(new Event('change'));`);
  assert.equal(await run(host,`document.querySelector('#daily-planner .planner-week-review').hidden`),false);
  await run(host,`Notebook.detach('module','todo')`);
  const todo=await wait(async()=>{for(const w of BrowserWindow.getAllWindows())if(w!==quick&&w!==host&&w.webContents.getURL().endsWith('/renderer/floating.html')&&await run(w,`!!document.querySelector('.planner')`))return w;});
  await run(todo,`floatingAPI.request({action:'command',operation:'review-ideas'})`);await wait(()=>run(quick,`!!document.querySelector('.qr-idea')`));
  // Dedicated reminder clock; never changes the system clock, records real audio or uses AI.
  const M=require('../renderer/quick-record-model'),{createQuickReview}=require('../main-quick-review');
  const now=new Date(2026,8,11,14).getTime();let s=M.initial('还没想完整','fixture',now),mode='';
  const review=createQuickReview({enabled:false,clock:()=>now,context:()=>({idleSeconds:10}),request:async p=>{if(p.action==='review-state')return {ok:true,state:s,recording:false};s=M.change(s,p.command,now);return {ok:true,state:s};},open:async value=>{mode=value;}});
  assert.equal(await review.tick(),true);const reminder=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/quick-review.html'));
  assert.match(await run(reminder,`document.getElementById('review-title').textContent`),/本周有 1 个想法/);assert.equal(reminder.isFocusable(),false);
  await run(reminder,`document.querySelector('[data-action="open"]').click()`);await wait(()=>mode==='weekly');assert.equal(await review.tick(),false);review.dispose();
  assert.deepEqual(errors,[]);console.log(`PASS weekly ideas Electron: recovery, dedupe, source, conversion, confirmed/unfinished review, choices, quota recovery, both planner entries and native weekly reminder. Synthetic evidence: ${dir}`);
  app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
