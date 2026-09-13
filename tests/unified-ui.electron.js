const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-a-ui-'));
const captures=fs.mkdtempSync(path.join(os.tmpdir(),'handy-a-captures-'));console.log('CAPTURES',captures);
let focused;
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{focused=w.id;};w.webContents.setBackgroundThrottling(false);});
const main=require('../main'),{createAssistantEntry}=require('../ai/assistant-entry');
let answer={kind:'plan',changes:[{mode:'add',title:'产品讨论',scheduled:false,date:'2026-09-11'},{mode:'add',title:'完成 PRD',start:'2026-09-11T14:00',end:'2026-09-11T15:00'},{mode:'add',title:'写读后感',scheduled:false,date:'2026-09-12'}]};
main.assistant.setService(createAssistantEntry({request:async()=>({content:answer})}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){const v=await fn();if(v)return v;await delay(30);}throw Error('timeout');}
const js=(w,s)=>w.webContents.executeJavaScript(s).catch(e=>{throw Error(e.message+' SCRIPT: '+s.slice(0,240));});
const floats=()=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/floating.html'));
async function capture(w,name){await delay(130);fs.writeFileSync(path.join(captures,name+'.png'),(await w.webContents.capturePage({},{stayHidden:true})).toPNG());}
async function run(){
 await app.whenReady();const host=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')&&!w.webContents.isLoadingMainFrame()));
 await until(()=>js(host,'!!window.ToolLauncher?.entry'));
 await js(host,`setMode(true);void 0;`);await delay(220);
 await capture(host,'entry');
 const submit=text=>js(host,`(async()=>{const e=document.getElementById('entry-input');e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input'));await ToolLauncher.entry.submit('command');})()`);
 await js(host,`(async()=>{const s=await notchAPI.plannerGet();await notchAPI.plannerCommand({action:'settings',revision:s.state.revision,requestId:'enable-a',aiEnabled:true});await ToolLauncher.entry.refreshSettings();})()`);
 await submit('帮我梳理接下来三件事情');
 assert.equal(await js(host,`document.querySelectorAll('.entry-plan-item').length`),3,await js(host,`document.getElementById('entry-status').textContent`));
 assert.equal(await js(host,`document.querySelectorAll('.entry-plan-item[open]').length`),0);
 assert.equal(await js(host,`getComputedStyle(document.getElementById('entry-input')).display`),'none');
 assert.equal((await js(host,'notchAPI.plannerGet()')).state.items.length,0);
 await capture(host,'plan');
 await js(host,`document.querySelector('.entry-plan-item').open=true;const e=document.querySelector('.entry-plan-row input');e.value='修改后的讨论';e.dispatchEvent(new Event('input'));`);
 assert.match(await js(host,`document.querySelector('.entry-plan-summary').textContent`),/修改后的讨论/);
 await js(host,`document.getElementById('entry-confirm').click()`);await until(async()=> (await js(host,'notchAPI.plannerGet()')).state.items.length===3);
 await js(host,`ToolLauncher.entry.newConversation()`);
 assert.equal(await js(host,`getComputedStyle(document.getElementById('entry-input')).display`),'block');
 await submit('计时十五分钟');
 let timer=await until(async()=>{for(const w of floats())if(!w.webContents.isLoadingMainFrame()&&await js(w,`!!document.querySelector('.simple-timer')`))return w;});
 await until(()=>js(timer,`document.querySelector('.timer-head').textContent.includes('剩余时间')`));
 assert.match(await js(timer,`document.querySelector('.timer-digits output').textContent`),/1[45]:\d\d/);
 await capture(timer,'timer');
 const old=(await js(host,'notchAPI.timerGet()')).active.id;
 await js(timer,`document.getElementById('float-dock').click()`);await until(()=>timer.isDestroyed());
 assert.equal((await js(host,'notchAPI.timerGet()')).active.running,true);
 await js(host,`ToolLauncher.open('pomodoro')`);
 timer=await until(async()=>{for(const w of floats())if(!w.webContents.isLoadingMainFrame()&&await js(w,`!!document.querySelector('.simple-timer')`))return w;});
 assert.equal((await js(host,'notchAPI.timerGet()')).active.id,old);
 assert.equal(await js(host,'ToolLauncher.entry.pending'),null,'manual tool choice clears stale reply into history');
 await submit('计时五分钟');
 assert.deepEqual(await js(host,`[...document.querySelectorAll('.entry-result-actions button')].map(b=>b.textContent)`),['保留','替换']);
 await capture(host,'timer-conflict');
 await js(host,`ToolLauncher.entry.newConversation()`);
 const a=await js(host,`ToolLauncher.open('notes',{create:'plain'})`),b=await js(host,`ToolLauncher.open('meeting')`);
 assert.notEqual(a.noteId,b.noteId);
 const notes=await until(async()=>{const found=[];for(const w of floats())if(!w.webContents.isLoadingMainFrame()&&await js(w,`!!document.querySelector('.nb-editor textarea')`))found.push(w);return found.length===2?found:null;});
 for(let i=0;i<notes.length;i++){
  const w=notes[i];await js(w,`(()=>{const e=document.querySelector('textarea');e.value=${JSON.stringify('产品讨论\n1. 先记录想法。\n2. 整理后再核对。\n3. 确定下一步。')};e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();})()`);
  await capture(w,i?'meeting':'note');
  assert.equal(await js(w,`document.documentElement.scrollWidth<=innerWidth`),true);
  assert.equal(await js(w,`getComputedStyle(document.querySelector('textarea')).outlineOffset`),'-2px');
  w.setSize(360,400);await delay(100);await capture(w,i?'meeting-small':'note-small');
  assert.equal(await js(w,`document.documentElement.scrollWidth<=innerWidth`),true);
 }
 // Host pages and satellite tool families all use the same final token layer.
 const errors=[];
 for(const tool of ['quick','todo','links','clip','gallery','mirror','commands','credentials','mail','inbox','windows','music','settings']){
  const r=await js(host,`ToolLauncher.open('${tool}',{inline:true})`);
  if(!r.ok){errors.push(tool+': '+r.error);continue;}
  await delay(120);await capture(host,'tool-'+tool);
  const overflow=await js(host,`document.documentElement.scrollWidth>innerWidth`);if(overflow)errors.push(tool+': page overflow');
 }
 assert.deepEqual(errors,[]);
 await js(host,`PanelAppearance.setTheme('obsidian');void 0;`);await delay(100);await capture(notes[1],'meeting-dark');await capture(timer,'timer-dark');
 assert.ok(BrowserWindow.getAllWindows().every(w=>!w.isVisible()));
 console.log('S63 PASS: plan scan/edit/confirm, fresh input, timer auto float/hide/reopen same ID, contextual conflict, independent editors, shared focus, 13 host tools, small windows and dark captures. Mock AI; no live microphone or music.');
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
