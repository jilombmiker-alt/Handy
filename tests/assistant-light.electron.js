const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-light-ui-'));
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{};});
const main=require('../main'),{createAssistantEntry}=require('../ai/assistant-entry');
let answer={kind:'reply',text:'测试回答'},calls=0,focused='',summaryFails=false;
main.assistant.setService(createAssistantEntry({request:async()=>{calls++;return {content:answer};}}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await app.whenReady();let win;
 for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html'));if(win&&!win.webContents.isLoadingMainFrame())break;await delay(40);}
 assert.ok(win);win.webContents.setBackgroundThrottling(false);const js=s=>win.webContents.executeJavaScript(s);
 for(let i=0;i<150;i++){if(await js('!!window.ToolLauncher?.entry'))break;await delay(40);}
 const errors=[];win.webContents.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m);});
 const input=t=>js(`(()=>{const e=document.getElementById('entry-input');e.value=${JSON.stringify(t)};e.dispatchEvent(new Event('input'));})()`);
 const submit=()=>js(`ToolLauncher.entry.submit('command')`);
 const click=s=>js(`document.querySelector(${JSON.stringify(s)}).click()`);
 const shot=async name=>{await delay(180);fs.writeFileSync(path.join(__dirname,'../docs/screenshots',name),(await win.webContents.capturePage({},{stayHidden:true})).toPNG());};
 ipcMain.removeHandler('meeting:prepare');ipcMain.handle('meeting:prepare',(_e,p)=>{assert.equal(p.mode,'review');return summaryFails?{ok:false,error:'request_failed'}:{ok:true,summary:'1. 先验证轻量笔记。\n2. 会后再核对观点；截止时间尚未确定。'};});
 ipcMain.removeHandler('windows:list');ipcMain.handle('windows:list',()=>({items:[{id:'test-window',appName:'WeChat',title:'微信测试窗口'}],error:null}));
 ipcMain.removeHandler('windows:focus');ipcMain.handle('windows:focus',(_e,id)=>{focused=id;return id==='test-window';});
 await js(`(async()=>{await ToolLauncher.open(null);const s=await notchAPI.plannerGet();await notchAPI.plannerCommand({action:'settings',aiEnabled:true,revision:s.state.revision,requestId:'light-ai'});await ToolLauncher.entry.refreshSettings();})()`);
 await input('打开一个笔记');await submit();assert.equal(await js('ToolLauncher.current'),'notes');assert.equal(await js('document.activeElement.id'),'notes-editor');
 await js(`ToolLauncher.open('meeting')`);
 const id=await js('selectedNoteId');assert.equal(await js('Notebook.get(selectedNoteId).meeting.stage'),'live');
 assert.equal(await js(`document.querySelectorAll('.launcher-note-hub button').length`),3);
 assert.equal(await js(`document.querySelector('.notes-page').classList.contains('directory-collapsed')`),true);
 const raw='1. 先验证轻量笔记\n2. 会后再核对观点\n3. 截止时间没定';
 await js(`(()=>{const e=document.querySelector('[data-field="meeting.freeText"]');e.value=${JSON.stringify(raw)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await delay(250);await js('Notebook.flush()');assert.equal(await js(`Notebook.get(${JSON.stringify(id)}).meeting.freeText`),raw);
 assert.doesNotMatch(await js(`document.querySelector('.nb-status').textContent`),/其他位置|失败/);
 await shot('stage55-meeting-live.png');
 assert.equal(await js(`(()=>{const r=document.querySelector('[data-nb="finish-recording"]').getBoundingClientRect();return r.bottom<innerHeight&&r.height>=24;})()`),true);
 await click('[data-nb="finish-recording"]');await delay(300);assert.equal(await js('Notebook.get(selectedNoteId).meeting.freeText'),raw);assert.match(await js('Notebook.get(selectedNoteId).meeting.summary'),/截止时间尚未确定/);
 await click('[data-nb="confirm-light"]');await delay(220);assert.ok(await js('Notebook.get(selectedNoteId).meeting.confirmedAt'));
 await shot('stage55-meeting-review.png');
 summaryFails=true;await click('[data-nb="summarize"]');await delay(220);assert.equal(await js('Notebook.get(selectedNoteId).meeting.freeText'),raw);assert.match(await js(`document.querySelector('.nb-status').textContent`),/无法连接/);
 await click('[data-stage="live"]');await click('#notes-directory-toggle');await shot('stage55-meeting-directory.png');
 assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth`),true);
 await js('ToolLauncher.open(null)');answer={kind:'action',action:'find_note',query:'轻量笔记'};
 await input('打开之前讲轻量笔记的那一篇');await submit();assert.equal(await js('selectedNoteId'),id);assert.equal(await js('ToolLauncher.current'),'notes');
 await js('ToolLauncher.open(null)');await input('切回微信页面');await submit();assert.equal(focused,'test-window');
 // A completed tool starts a clean voice task; known ASR hints and fillers never execute.
 await js(`window.fakeLight={text:'嗯嗯。',finished:false};window.PanelRecording={command:async action=>{if(action==='assistant-start'){fakeLight.finished=false;return {ok:true,recordingId:'voice-light'};}if(action==='assistant-stop'){fakeLight.finished=true;return {ok:true};}return {ok:true,finished:fakeLight.finished,recordingId:'voice-light',savedText:fakeLight.text,transcriptionComplete:true};}};true`);
 const before=calls;await js(`ToolLauncher.entry.hotkey('short')`);assert.equal(await js(`document.querySelector('.launcher-task-bar').hidden`),true);assert.equal(await js(`document.querySelector('.entry-task-line').hidden`),true);
 await js(`ToolLauncher.entry.hotkey('short')`);await delay(600);assert.equal(calls,before);assert.match(await js(`document.getElementById('entry-status').textContent`),/没有识别到有效指令/);
 await js(`fakeLight.text='Handy 桌面助手。术语：笔记、AI';ToolLauncher.entry.hotkey('short')`);await js(`ToolLauncher.entry.hotkey('short')`);await delay(600);assert.equal(calls,before);assert.equal(await js(`document.getElementById('entry-input').value`),'');
 // A cancelled in-flight operation may not repopulate a new task's receipt bar.
 let release;ipcMain.removeHandler('music:control');ipcMain.handle('music:control',()=>new Promise(r=>{release=()=>r({ok:true});}));
 answer={kind:'actions',actions:[{kind:'action',action:'open_music'},{kind:'action',action:'new_note',format:'plain'}]};await input('打开音乐然后新建笔记');const count=await js('Notebook.references().notes.length');const pending=submit();
 for(let i=0;i<100&&!release;i++)await delay(20);assert.ok(release);await click('#entry-cancel');release();await pending;assert.equal(await js('Notebook.references().notes.length'),count);assert.equal(await js(`document.querySelector('.launcher-task-bar').hidden`),true);
 await js(`ToolLauncher.open('notes',{kind:'note',id:${JSON.stringify(id)}})`);await click('#notes-directory-toggle');await js(`document.querySelector('[data-theme-choice="obsidian"]').click()`);win.setSize(680,600);await shot('stage55-meeting-obsidian.png');assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
 assert.equal(win.isVisible(),false);assert.deepEqual(errors,[]);console.log('S55 PASS: actual note autosave, no self-conflict, merged meeting, free text to summary/review with originals retained, recoverable failure, collapsed library, note retrieval, window dispatch, silent/filler/corpus guard, clean new task and cancelled callbacks. AI/voice/window responses mocked; local editor/storage/IPC real.');
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
