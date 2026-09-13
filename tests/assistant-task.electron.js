const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'handy-task-ui-'));
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=data;
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{};});
const main=require('../main'),{createAssistantEntry}=require('../ai/assistant-entry');
let answer={kind:'reply',text:'明天想推进哪些事？可以分几次补充。'},lastInput,calls=0,musicCalls=0,musicOk=false;
main.assistant.setService(createAssistantEntry({request:async p=>{calls++;lastInput=JSON.parse(p.prompt.user);return {content:answer};}}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 await app.whenReady();let win;
 for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html'));if(win&&!win.webContents.isLoadingMainFrame())break;await delay(40);}
 assert.ok(win);win.webContents.setBackgroundThrottling(false);
 const js=s=>win.webContents.executeJavaScript(s);
 for(let i=0;i<150;i++){if(await js('!!window.ToolLauncher?.entry'))break;await delay(40);}
 ipcMain.removeHandler('music:control');ipcMain.handle('music:control',(_e,action)=>{musicCalls++;assert.equal(action,'open_background');return musicOk?{ok:true}:{ok:false,error:'not_installed'};});
 const errors=[];win.webContents.on('console-message',(_e,level,msg)=>{if(level>=3)errors.push(msg);});
 const input=t=>js(`(()=>{const e=document.getElementById('entry-input');e.value=${JSON.stringify(t)};e.dispatchEvent(new Event('input'));})()`);
 const submit=()=>js(`ToolLauncher.entry.submit('command')`);
 const click=text=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}&&!b.closest('[hidden]'));if(!b)throw Error('button missing: '+${JSON.stringify(text)});b.click();})()`);
 const capture=async name=>{await delay(150);fs.writeFileSync(path.join(__dirname,'../docs/screenshots',name),(await win.webContents.capturePage({},{stayHidden:true})).toPNG());};
 await js(`(async()=>{await ToolLauncher.open(null);const s=await notchAPI.plannerGet();await notchAPI.plannerCommand({action:'settings',aiEnabled:true,revision:s.state.revision,requestId:'enable-task'});await ToolLauncher.entry.refreshSettings();})()`);
 await input('帮我安排明天的事情');await submit();
 answer={kind:'plan',changes:[{mode:'add',title:'处理 RAG',scheduled:false,date:'2026-09-11'}]};
 await input('上午处理 RAG');await submit();assert.ok(lastInput.conversation.some(v=>v.text.includes('明天的事情')));
 answer={kind:'plan',changes:[{mode:'add',title:'处理 RAG',scheduled:false,date:'2026-09-11'},{mode:'add',title:'准备讨论',scheduled:false,date:'2026-09-11'}]};
 await input('下午还有讨论');await submit();assert.equal(lastInput.previousProposal.changes.length,1);assert.equal(await js('ToolLauncher.entry.pending.proposal.changes.length'),2);
 assert.equal((await js('notchAPI.plannerGet()')).state.items.length,0);
 await click('继续补充');assert.equal(await js('document.getElementById("entry-input").value'),'');assert.equal(await js('ToolLauncher.entry.pending.proposal.changes.length'),2);
 await capture('stage54-plan-continuation.png');
 // Short speech is a new input inside the same task, not a reset of the task.
 await js(`window.realRecording=PanelRecording;window.fakeTaskVoice={finished:false,text:'讨论改成三点'};window.PanelRecording={command:async(action)=>{if(action==='assistant-start'){fakeTaskVoice.finished=false;return {ok:true,recordingId:'task-voice'};}if(action==='assistant-stop'){fakeTaskVoice.finished=true;return {ok:true};}return {ok:true,finished:fakeTaskVoice.finished,recordingId:'task-voice',savedText:fakeTaskVoice.text,transcriptionComplete:true};}};true`);
 await js(`ToolLauncher.entry.hotkey('short')`);assert.equal(await js('ToolLauncher.entry.pending.proposal.changes.length'),2);assert.equal(await js('document.getElementById("entry-input").value'),'');
 await js(`ToolLauncher.entry.hotkey('short')`);await delay(600);assert.ok(lastInput.conversation.some(v=>v.text.includes('下午还有讨论')));assert.equal(lastInput.previousProposal.changes.length,2);
 await input('确认');await submit();assert.equal((await js('notchAPI.plannerGet()')).state.items.length,2);
 await js('window.PanelRecording=realRecording;true');
 await input('打开笔记');await submit();assert.equal(await js('ToolLauncher.current'),'notes');
 await js(`ToolLauncher.open('notes',{create:'meeting'})`);assert.equal(await js('Notebook.get(selectedNoteId).meeting.stage'),'live');
 await js(`ToolLauncher.open(null)`);await click('新任务');
 answer={kind:'meeting',text:'目标：确定讨论方向\n议题：先验证记录，再验证执行'};
 await input('准备下午讨论，把目标和议题整理出来');await submit();assert.equal(await js('ToolLauncher.current'),'meeting');
 const meetingId=await js('selectedNoteId');assert.match(await js('Notebook.get(selectedNoteId).meeting.freeText'),/确定讨论方向/);
 await js('ToolLauncher.open(null)');answer={kind:'meeting',text:'目标：确定讨论方向\n议题：增加风险检查'};await input('加一个风险检查');await submit();assert.equal(await js('selectedNoteId'),meetingId);assert.match(await js('Notebook.get(selectedNoteId).meeting.freeText'),/风险检查/);
 await js(`(()=>{const n=Notebook.get(selectedNoteId),revision=NotebookModel.version(n);n.meeting.freeText='我的手动修改';Notebook.save(n,revision);})()`);
 await js('ToolLauncher.open(null)');await input('再补充一下');await submit();assert.match(await js('document.getElementById("entry-status").textContent'),/未覆盖/);assert.equal(await js(`Notebook.get(${JSON.stringify(meetingId)}).meeting.freeText`),'我的手动修改');
 await click('新任务');
 answer={kind:'actions',actions:[{kind:'action',action:'start_timer',seconds:900},{kind:'action',action:'open_music'},{kind:'action',action:'new_note',format:'plain'}]};
 await input('计时十五分钟，打开音乐，弹出笔记我要写');await submit();
 const timer=await js('notchAPI.timerGet()');assert.equal(timer.active.plannedMs,900000);assert.equal(timer.active.running,true);assert.equal(musicCalls,1);
 assert.equal(await js('ToolLauncher.current'),'notes');assert.equal(await js('document.activeElement.id'),'notes-editor');
 assert.match(await js('document.querySelector(".launcher-task-bar").textContent'),/未安装汽水音乐/);
 assert.match(await js('document.querySelector(".launcher-task-bar").textContent'),/新笔记已打开/);
 await capture('stage54-combined-tools.png');
 await js('ToolLauncher.open(null)');answer={kind:'reply',text:'计时仍在后台，笔记已打开；音乐未安装。'};await input('刚才哪些成功了');await submit();assert.ok(lastInput.conversation.some(v=>v.role==='tool'&&v.text.includes('倒计时')));assert.equal(musicCalls,1);assert.equal((await js('notchAPI.timerGet()')).active.id,timer.active.id);
 answer={kind:'actions',actions:[{kind:'action',action:'start_timer',seconds:300},{kind:'action',action:'open_tool',tool:'links'}]};
 await input('再计时五分钟，然后打开链接');await submit();assert.equal(await js('ToolLauncher.current'),'links');assert.equal((await js('notchAPI.timerGet()')).active.id,timer.active.id);
 await js('ToolLauncher.open(null)');await click('结束原计时并开始新计时');await delay(100);
 const replaced=await js('notchAPI.timerGet()');assert.equal(replaced.active.plannedMs,300000);assert.equal(replaced.history[0].id,timer.active.id);
 await click('新任务');answer={kind:'reply',text:'全新的任务'};await input('另一件事');await submit();assert.deepEqual(lastInput.conversation,[]);
 // Cancel while a dispatched call is pending: no following note is created.
 await click('新任务');let releaseMusic;
 ipcMain.removeHandler('music:control');ipcMain.handle('music:control',()=>new Promise(resolve=>{musicCalls++;releaseMusic=()=>resolve({ok:true});}));
 answer={kind:'actions',actions:[{kind:'action',action:'open_music'},{kind:'action',action:'new_note',format:'plain'}]};
 await input('打开音乐，再新建笔记');const noteCount=await js('Notebook.references().notes.length');const execution=submit();
 for(let i=0;i<80&&!releaseMusic;i++)await delay(20);assert.ok(releaseMusic);await js('document.getElementById("entry-cancel").click()');releaseMusic();await execution;
 assert.equal(await js('Notebook.references().notes.length'),noteCount);assert.equal(musicCalls,2);
 // Invalid later step must prevent even the first side effect.
 answer={kind:'actions',actions:[{kind:'action',action:'open_music'},{kind:'action',action:'shell'}]};await input('无效组合');await submit();assert.equal(musicCalls,2);
 await js('ToolLauncher.open(null)');await click('更多工具');assert.equal(await js('document.querySelectorAll("[data-launcher-tool=quick]").length'),0);assert.equal(await js('document.querySelectorAll("[data-launcher-tool=notes]").length'),1);await click('收起工具');
 await js(`document.getElementById('entry-cancel').click()`);await capture('stage54-entry-white.png');
 await js(`document.querySelector('[data-theme-choice="obsidian"]').click()`);win.setSize(420,550);await delay(100);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);await capture('stage54-entry-obsidian-narrow.png');
 assert.equal(win.isVisible(),false);assert.equal(BrowserWindow.getAllWindows().length,1);assert.deepEqual(errors,[]);
 console.log('S54 PASS: typed/voice continuation, plan confirmation, real timer IPC, explicit replacement, partial failure, actual note editor, meeting live mode, receipts, unified notes, narrow themes. Model/music/voice mocked. Data: '+data);
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
