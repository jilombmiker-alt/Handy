const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-idea-plan-'));
delete process.env.DASHSCOPE_API_KEY;delete process.env.NOTCH_LLM_API_KEY;require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,s)=>w.webContents.executeJavaScript(s,true).catch(e=>{throw Error(`${e.message}: ${s.slice(0,140)}`);});
async function wait(fn){for(let i=0;i<300;i++){const v=await fn();if(v)return v;await pause(30);}throw Error('wait_timeout');}
async function main(){
  await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));await wait(()=>run(host,'!!window.IdeaPlans&&!!window.Notebook'));
  host.hide();host.webContents.setBackgroundThrottling(false);const errors=[];host.webContents.on('console-message',(_e,level,text)=>{if(level===3)errors.push(text);});
  const id=await run(host,`(()=>{const r=QuickRecords.snapshot().note;QuickRecords.command({action:'save',recordId:r.recordId,revision:r.revision,title:'把学习内容做成卡片',content:'先从最近学到的三个知识点开始。每张只写一个问题和自己的回答，不追求完整。'});return r.recordId;})()`);
  await run(host,'Notebook.openQuick()');const quick=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/floating.html')));await wait(()=>run(quick,`!!document.querySelector('.qr-plan-entry')`));
  const getPlan=()=>run(host,'notchAPI.plannerGet()');
  const click=async(action)=>{await run(quick,`(()=>{if('${action}'==='plan'&&!document.querySelector('.qr-writing').hidden)document.querySelector('.qr-actions details').open=true;const b=[...document.querySelectorAll('[data-qr="${action}"]')].find(b=>b.getClientRects().length);if(!b)throw Error('visible button missing: ${action}');b.click();})()`);await pause(180);};
  await click('plan');assert.equal((await getPlan()).state.items.length,0);assert.equal(await run(quick,`document.querySelector('[data-plan-field="title"]').value`),'把学习内容做成卡片');
  await run(quick,`document.getElementById('float-dock').click()`);await pause(180);assert.equal(quick.isDestroyed(),false);assert.match(await run(quick,`document.querySelector('.qr-status').textContent`),/确认/);
  await click('plan-cancel');assert.equal((await getPlan()).state.items.length,0);
  await click('plan');await run(quick,`document.querySelector('[data-plan-field="title"]').value='周末先做三张学习卡片';document.querySelector('[data-plan-field="date"]').value='2026-09-12'`);
  const dir=process.env.PANEL_IDEA_CAPTURE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'idea-plan-evidence-'));fs.mkdirSync(dir,{recursive:true});quick.setSize(440,580);quick.show();
  for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}')`);await pause(120);fs.writeFileSync(path.join(dir,`idea-draft-${theme}.png`),(await quick.webContents.capturePage()).toPNG());}
  quick.setSize(320,440);quick.webContents.setZoomFactor(1.2);await pause(120);assert.equal(await run(quick,'document.documentElement.scrollWidth>innerWidth'),false);
  // Keyboard-visible submit remains reachable in the smallest view, without recording or AI.
  await run(quick,`document.querySelector('.qr-plan button[type="submit"]').focus()`);assert.equal(await run(quick,`document.activeElement.type`),'submit');
  assert.equal(await run(quick,`document.activeElement.getBoundingClientRect().bottom<=document.querySelector('.qr-plan').getBoundingClientRect().bottom+1`),true);
  fs.writeFileSync(path.join(dir,'idea-draft-narrow.png'),(await quick.webContents.capturePage()).toPNG());quick.webContents.setZoomFactor(1);quick.setSize(440,580);
  // A real planner write failure in the isolated fixture keeps the form and permits retry.
  const rename=fs.renameSync;fs.renameSync=function(from,to){if(String(to).startsWith(process.env.PANEL_TEST_USER_DATA_PATH)&&String(to).endsWith('planner-v1.json'))throw Object.assign(Error('synthetic ENOSPC'),{code:'ENOSPC'});return rename.apply(this,arguments);};
  try{await run(quick,`document.querySelector('.qr-plan').requestSubmit()`);await wait(()=>run(quick,`document.querySelector('.qr-status').classList.contains('error')`));assert.equal((await getPlan()).state.items.length,0);assert.equal(await run(quick,`document.querySelector('[data-plan-field="title"]').value`),'周末先做三张学习卡片');}
  finally{fs.renameSync=rename;}
  await click('retry');await wait(()=>run(quick,`!!document.querySelector('[data-qr="plan-open"]')`));assert.equal((await getPlan()).state.items.length,1);
  const item=(await getPlan()).state.items[0];assert.equal(item.sourceIdea.id,id);assert.equal(item.date,'2026-09-12');assert.equal(item.scheduled,false);assert.match(item.body,/三个知识点/);
  fs.writeFileSync(path.join(dir,'idea-saved.png'),(await quick.webContents.capturePage()).toPNG());
  await click('plan-cancel');await click('plan');await wait(()=>run(quick,`!!document.querySelector('[data-qr="plan-open"]')`));assert.equal((await getPlan()).state.items.length,1);
  await click('plan-open');await wait(()=>run(host,`document.querySelector('.planner-form [name="title"]').value==='周末先做三张学习卡片'`));
  assert.ok(await run(host,`[...document.querySelectorAll('.planner-row button')].some(b=>b.textContent==='查看来源想法')`));
  await run(host,`document.querySelector('.planner-row-more').open=true;[...document.querySelectorAll('.planner-row button')].find(b=>b.textContent==='查看来源想法').click()`);await wait(()=>run(quick,`!document.querySelector('.qr-plan')&&document.querySelector('.qr-writing').hidden===false`));
  // Prepare a second idea, then simulate a concurrent edit; confirmation must not silently adopt the new source.
  await click('new');assert.notEqual(await run(host,'QuickRecords.snapshot().state.activeId'),id,'new idea must be independent');
  await run(quick,`const body=document.querySelector('[data-field="content"]');body.value='想写一次周末散步记录';body.dispatchEvent(new Event('input',{bubbles:true}));`);
  await wait(()=>run(host,`QuickRecords.snapshot().note.content==='想写一次周末散步记录'`));await click('plan');
  assert.equal(await run(quick,`!!document.querySelector('[data-plan-field="title"]')`),true,JSON.stringify(await run(host,'QuickRecords.snapshot().state')));
  await run(host,`(()=>{const r=QuickRecords.snapshot().note;QuickRecords.command({action:'save',recordId:r.recordId,revision:r.revision,title:r.title,content:r.content+'，地点还没确定'});})()`);
  await run(quick,`document.querySelector('.qr-plan').requestSubmit()`);await pause(250);
  assert.match(await run(quick,`document.querySelector('.qr-status').textContent`),/已有更新/,JSON.stringify(await run(quick,`[...document.querySelectorAll('[data-plan-field]')].map(n=>[n.dataset.planField,n.value,n.validationMessage])`)));assert.equal((await getPlan()).state.items.length,1);
  await click('plan-cancel');
  assert.match(await run(quick,`document.querySelector('[data-field="content"]').value`),/地点还没确定/);
  // The source is still an independent quick record; no note or weekly confirmation was automatically changed.
  assert.equal(await run(host,`QuickRecords.snapshot().state.records.find(r=>r.id===${JSON.stringify(id)}).confirmedAt`),0);
  assert.deepEqual(errors,[]);console.log(`PASS idea → planner Electron: preview/cancel, unsaved close guard, form editing, atomic failure/retry, duplicate reuse, source roundtrip, concurrent source rejection, themes and keyboard/narrow layout. Synthetic evidence: ${dir}`);app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
