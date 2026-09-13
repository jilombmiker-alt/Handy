const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-desktop-ui-'));
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);});
const main=require('../main'),{createAssistantEntry}=require('../ai/assistant-entry');
let calls=[],modelCalls=0,release,stall=false,choose=false;
main.assistant.setService(createAssistantEntry({request:async()=>{modelCalls++;return {content:{kind:'reply',text:'未支持。'}};}}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await delay(30);}throw Error('timeout');}
async function run(){
 await app.whenReady();const host=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')&&!w.webContents.isLoadingMainFrame()));
 const js=s=>host.webContents.executeJavaScript(s);await until(()=>js('!!ToolLauncher.entry'));
 ipcMain.removeHandler('desktop:action');ipcMain.handle('desktop:action',async(e,p)=>{
   calls.push(p);e.sender.send('desktop:progress',{requestId:p.requestId,text:'正在执行测试步骤…'});
   if(stall)await new Promise(r=>release=r);
   if(choose&&!p.action.appId)return {ok:false,error:'choose_app',choices:[{id:'a'.repeat(24),name:'测试软件 A'},{id:'b'.repeat(24),name:'测试软件 B'}]};
   return {ok:true,text:'已执行测试动作：'+p.action.action,verified:p.action.action!=='web_search'};
 });
 const submit=text=>js(`(async()=>{const e=document.getElementById('entry-input');e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input'));await ToolLauncher.entry.submit('command');})()`);
 const reset=()=>js('ToolLauncher.entry.newConversation()');
 await js(`(async()=>{const s=await notchAPI.plannerGet();await notchAPI.plannerCommand({action:'settings',aiEnabled:false,revision:s.state.revision,requestId:crypto.randomUUID()});await ToolLauncher.entry.refreshSettings();})()`);
 for(const [text,action] of [['打开计算器','open_app'],['在Google搜索 AI 技术','web_search'],['播放一首薛之谦的歌','play_music'],['查看Gmail未读邮件','search_mail']]){
   await reset();await submit(text);assert.equal(calls.at(-1).action.action,action);assert.equal(await js('ToolLauncher.entry.busy'),false);assert.match(await js('document.querySelector(".entry-result").textContent'),/已执行测试动作/);
 }
 assert.equal(modelCalls,0);
 await reset();choose=true;await submit('打开测试软件');assert.equal(await js('document.querySelectorAll(".entry-library button").length'),2);
 await js('document.querySelector(".entry-library button").click()');await until(()=>js('!ToolLauncher.entry.busy'));assert.equal(calls.at(-1).action.appId,'a'.repeat(24));choose=false;
 await reset();stall=true;const notes=await js('Notebook.references().notes.length');
 const pending=submit('打开计算器，然后新建一个笔记');await until(()=>release);
 assert.equal(await js('document.querySelector("#entry-cancel").hidden'),false);
 assert.equal(await js('getComputedStyle(document.querySelector("#entry-status")).position'),'static');
 await reset();release();await pending;stall=false;
 assert.equal(await js('Notebook.references().notes.length'),notes,'cancel must prevent next step');
 assert.equal(await js('document.getElementById("entry-input").value'),'');assert.equal(await js('ToolLauncher.entry.pending'),null,'late result cannot contaminate new round');
 await submit('计时五分钟');assert.equal((await js('notchAPI.timerGet()')).active.plannedMs,300000);
 console.log('PASS desktop entry: four action routes, zero text model calls, choice, visible progress, cancellation, stale result isolation, existing timer; external operations mocked, isolated data.');
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
