const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const testData=fs.mkdtempSync(path.join(os.tmpdir(),'handy-entry-'));
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=testData;
// Keep the user's existing Handy (which may be recording) untouched and show no second window.
app.on('browser-window-created',(_event,win)=>{win.show=()=>{};win.showInactive=()=>{};win.focus=()=>{};win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)console.error('Renderer:',message);});});
const main=require('../main');
const {createAssistantEntry}=require('../ai/assistant-entry');
let calls=0,lastInput=null,answer={kind:'meeting',text:'目标：明确新入口\n议题：储存与指令如何区分\n待确认：先验证哪些场景'},mode='success';
main.assistant.setService(createAssistantEntry({timeoutMs:40,request:async payload=>{calls++;lastInput=JSON.parse(payload.prompt.user);if(mode==='timeout')return new Promise(()=>{});if(mode==='failure')throw Error('network');return {content:answer};}}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
  await app.whenReady();let win;
  for(let i=0;i<160;i++){win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html'));if(win&&!win.webContents.isLoadingMainFrame())break;await delay(50);}
  assert.ok(win);win.webContents.setBackgroundThrottling(false);
  const js=async s=>{try{return await win.webContents.executeJavaScript(s);}catch(e){console.error('Failed expression:',s);throw e;}};
  for(let i=0;i<120;i++){if(await js('!!window.ToolLauncher?.entry'))break;await delay(50);}
  assert.equal(await js('!!window.ToolLauncher?.entry'),true);
  await js('ToolLauncher.open(null)');
  const errors=[];win.webContents.on('console-message',(_e,level,msg)=>{if(level>=3)errors.push(msg);});
  const input=async text=>js(`(()=>{const el=document.getElementById('entry-input');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const submit=mode=>js(`ToolLauncher.entry.submit(${JSON.stringify(mode)})`);
  const speakTest=text=>js(`(async()=>{fakeVoice.text=${JSON.stringify(text)};await ToolLauncher.entry.hotkey('short');await ToolLauncher.entry.hotkey('short');})()`);
  const capture=async name=>{await delay(350);fs.writeFileSync(path.join(__dirname,'../docs/screenshots',name.replace(/^stage\d+-/,'stage54-regression-')),(await win.webContents.capturePage({},{stayHidden:true})).toPNG());};
  assert.equal(await js('document.querySelector(".launcher-tool-drawer").hidden'),true);
  assert.equal(await js('PanelRecording.snapshot().status'),'idle');assert.equal(win.isVisible(),false);
  assert.equal(await js('getComputedStyle(document.getElementById("entry-input")).resize'),'none');
  assert.ok(Number.parseFloat(await js('getComputedStyle(document.getElementById("entry-input")).outlineOffset'))<=0);
  assert.equal(await js('document.querySelector(".entry-options").open'),false);
  await capture('stage52-entry-white.png');
  await input('只是储存：明天删除全部旧文件（不可执行）');await submit('store');assert.equal(calls,0);
  assert.match(await js('document.getElementById("entry-status").textContent'),/已储存/);
  assert.equal(await js('QuickRecords.snapshot().state.records.filter(r=>r.content.includes("不可执行")).length'),1);
  await input('https://example.com\n设计参考');await submit('store');
  assert.equal(await js('LinkLibraryHost.snapshot().groups.flatMap(g=>g.links||[]).find(l=>l.url==="https://example.com/").note'),'设计参考');
  await input('https://example.com\n不同备注');await submit('store');assert.match(await js('document.getElementById("entry-status").textContent'),/已经收藏/);
  assert.equal(await js('LinkLibraryHost.snapshot().groups.flatMap(g=>g.links||[]).length'),1);
  await input('保存失败时不能消失');
  const failure=await js(`(async()=>{const original=QuickRecords.command;QuickRecords.command=()=>({ok:false,error:'storage_failed'});await ToolLauncher.entry.submit('store');QuickRecords.command=original;return document.getElementById('entry-input').value;})()`);assert.equal(failure,'保存失败时不能消失');
  await input('记一下，我想减少选择工具的步骤');await submit('command');assert.equal(calls,0);
  await input('等会讨论新交互，帮我整理重点');await submit('command');assert.equal(calls,0);assert.match(await js('document.getElementById("entry-status").textContent'),/AI 协助未开启/);
  await js(`(async()=>{const s=await notchAPI.plannerGet();await notchAPI.plannerCommand({action:'settings',aiEnabled:true,revision:s.state.revision,requestId:'test-enable'});await ToolLauncher.entry.refreshSettings();})()`);
  await submit('command');assert.equal(calls,1);assert.equal(lastInput.references.length,0);assert.equal(lastInput.items.length,0);
  assert.equal(await js('ToolLauncher.entry.pending.proposal.kind'),'meeting');
  assert.equal(await js('ToolLauncher.current'),'meeting');await js('ToolLauncher.open(null)');
  await js(`(()=>{const e=document.querySelector('.entry-result textarea');e.value+='\\n我的补充：先做第一版';e.dispatchEvent(new Event('input'));})()`);
  await capture('stage52-entry-draft.png');
  await js(`document.getElementById('entry-confirm').click()`);await delay(100);
  assert.equal(await js('Notebook.references().notes.some(n=>Notebook.get(n.id).meeting?.freeText.includes("明确新入口"))'),true);await js('ToolLauncher.open(null)');
  answer={kind:'plan',reply:'先推进一件事。',changes:[{mode:'add',title:'验证新入口',scheduled:false,date:'2026-09-10'}]};
  await input('明天要验证新入口');await submit('command');assert.equal((await js('notchAPI.plannerGet()')).state.items.length,0);
  await js(`(()=>{const e=document.querySelector('.entry-plan-row input');e.value='先验证储存';e.dispatchEvent(new Event('input'));})()`);
  await js(`document.getElementById('entry-confirm').click()`);await delay(100);assert.equal((await js('notchAPI.plannerGet()')).state.items[0].title,'先验证储存');
  await js(`document.getElementById('entry-confirm')?.click()`);assert.equal((await js('notchAPI.plannerGet()')).state.items.length,1);
  mode='timeout';await input('这条请求超时也不丢失');await submit('command');assert.match(await js('document.getElementById("entry-status").textContent'),/超时/);assert.equal(await js('document.getElementById("entry-input").value'),'这条请求超时也不丢失');
  await submit('store');assert.equal(await js('QuickRecords.snapshot().state.records.some(r=>r.content==="这条请求超时也不丢失")'),true);
  await js(`document.querySelector('.entry-nav button').click()`);await delay(100);assert.ok(await js('document.querySelectorAll(".entry-record").length')>0);
  await js(`document.querySelector('.entry-nav button').click()`);
  await input('输入 N、T 不应跳转工具');await js(`document.getElementById('entry-input').dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',bubbles:true}))`);assert.equal(await js('ToolLauncher.current'),null);
  await js(`ToolLauncher.open('links')`);await js(`ToolLauncher.open(null)`);assert.equal(await js('document.getElementById("entry-input").value'),'输入 N、T 不应跳转工具');
  await input('');await js(`document.querySelector('[data-theme-choice="obsidian"]').click()`);await capture('stage52-entry-obsidian.png');
  win.setSize(420,480);await delay(80);assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);await capture('stage52-entry-narrow.png');
  // Real recorder rejects stale ownership; fake transport tests only speech lifecycle,
  // not microphone permission, provider latency or real-world ASR accuracy.
  assert.equal((await js('PanelRecording.command("assistant-stop","another-recording")')).error,'recording_changed');
  await js(`window.realRecorder=PanelRecording;window.fakeVoice={id:0,finished:false,text:'记一下，短按直接保存的测试想法',calls:[],status:'idle'};
    window.PanelRecording={snapshot:()=>({status:fakeVoice.status}),command:async(action,id)=>{
      fakeVoice.calls.push([action,id]);
      if(action==='assistant-start'||action==='assistant-record'){fakeVoice.id++;fakeVoice.finished=false;fakeVoice.status='recording';await new Promise(r=>setTimeout(r,50));return {ok:true,recordingId:'voice-'+fakeVoice.id};}
      if(action==='assistant-stop'){fakeVoice.finished=true;fakeVoice.status='idle';return {ok:true};}
      if(action==='assistant-status')return {ok:true,recordingId:'voice-'+fakeVoice.id,finished:fakeVoice.finished,status:fakeVoice.status,savedText:fakeVoice.text,transcriptionComplete:fakeVoice.complete!==false};
      return {ok:false};}};true;`);
  await js(`Promise.all([ToolLauncher.openPayload({kind:'voice',gesture:'short'}),ToolLauncher.entry.hotkey('short')])`);
  // The window navigation queue may finish before or after the simultaneous call;
  // a direct starting-state double invocation must still produce only one start.
  if(await js('fakeVoice.finished')){await delay(500);}
  else {await js(`ToolLauncher.entry.hotkey('short')`);await delay(500);}
  assert.equal(await js('QuickRecords.snapshot().state.records.some(r=>r.content.includes("短按直接保存的测试想法"))'),true);
  const starts=await js('fakeVoice.calls.filter(c=>c[0]==="assistant-start").length');assert.equal(starts,1);
  mode='success';answer={kind:'meeting',text:'自动保存的讨论稿'};
  await speakTest('准备下午讨论，先确定方向');await delay(650);
  assert.equal(await js('Notebook.references().notes.some(n=>Notebook.get(n.id).meeting?.freeText.includes("自动保存的讨论稿"))'),true);await js('ToolLauncher.open(null)');
  const callsBeforeLong=calls;
  await js(`(async()=>{fakeVoice.text='删除所有安排';await ToolLauncher.entry.hotkey('long');await ToolLauncher.entry.hotkey('short');})()`);await delay(550);
  assert.equal(calls,callsBeforeLong);assert.equal(await js('fakeVoice.calls.some(c=>c[0]==="assistant-record")'),true);
  await js(`(async()=>{fakeVoice.text='仅作储存，不得执行';await ToolLauncher.entry.hotkey('short');document.getElementById('entry-store').click();await ToolLauncher.entry.hotkey('short');})()`);await delay(550);
  assert.equal(calls,callsBeforeLong);assert.equal(await js('QuickRecords.snapshot().state.records.some(r=>r.content==="仅作储存，不得执行")'),true);
  answer={kind:'plan',reply:'请确认',changes:[{mode:'add',title:'语音确认事项',scheduled:false,date:'2026-09-12'}]};
  await speakTest('安排周六的一件事');await delay(650);
  assert.equal((await js('notchAPI.plannerGet()')).state.items.length,1);
  await speakTest('确认安排');await delay(650);
  assert.equal((await js('notchAPI.plannerGet()')).state.items.length,2);
  mode='failure';await speakTest('帮我准备一个失败恢复测试');await delay(650);
  assert.equal(await js('document.getElementById("entry-input").value'),'帮我准备一个失败恢复测试');
  const beforeCancelCalls=calls,beforeCancelNotes=await js('QuickRecords.snapshot().state.records.length');
  await js(`ToolLauncher.entry.hotkey('short')`);
  assert.equal(await js('document.getElementById("entry-input").value'),'');assert.equal(await js('ToolLauncher.entry.pending'),null);
  await js(`document.getElementById('entry-cancel').click()`);await delay(600);
  assert.equal(calls,beforeCancelCalls);assert.equal(await js('QuickRecords.snapshot().state.records.length'),beforeCancelNotes);
  assert.equal(await js('document.getElementById("entry-input").value'),'');
  await js('fakeVoice.complete=false');await speakTest('不完整转写不应执行');await delay(600);
  assert.equal(calls,beforeCancelCalls);assert.equal(await js('document.getElementById("entry-input").value'),'不完整转写不应执行');
  assert.equal(await js('ToolLauncher.entry.pending'),null);
  await js('window.PanelRecording=realRecorder;true');
  mode='success';
  answer={kind:'action',action:'open_tool',tool:'notes'};
  await input('我想接着写上次那篇内容，带我去对应工具');await submit('command');assert.equal(await js('ToolLauncher.current'),'notes');await js('ToolLauncher.open(null)');
  await input('帮我打开我的笔记功能。');await submit('command');assert.equal(await js('ToolLauncher.current'),'notes');
  await js('ToolLauncher.open(null)');await input('打开剪贴板');await submit('command');assert.equal(await js('ToolLauncher.current'),'clip');
  assert.equal(await js('document.getElementById("tab-clip").inert'),false);
  assert.equal((await js('notchAPI.getAppSettings()')).features.clip,false);
  assert.equal(await js('document.getElementById("launcher-enable-clipboard").parentElement.hidden'),false);
  for(const tool of ['quick','notes','meeting','todo','recorder','links','pomodoro','music','windows','gallery','mirror','commands','credentials','mail','inbox','settings']){
    const r=await js(`ToolLauncher.open(${JSON.stringify(tool)})`);assert.equal(r.ok,true,tool);
    assert.equal(await js('ToolLauncher.current'),tool,tool);
  }
  await js('ToolLauncher.open(null)');await input('我想查看明天的计划');await submit('command');
  const queryText=await js('ToolLauncher.entry.pending.proposal.text');assert.ok(queryText.includes('本机待办')||queryText.includes('验证'));assert.ok(!queryText.includes('无法直接读取'));
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);const tomorrowDay=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
  answer={kind:'plan',changes:[{mode:'add',title:'明天可查询的已保存事项',scheduled:false,date:tomorrowDay}]};
  await input('请制定一个明天的安排');await submit('command');await js(`document.getElementById('entry-confirm').click()`);await delay(100);
  const queryCalls=calls;await input('嗯，我想查看一下明天的计划。');await submit('command');assert.equal(calls,queryCalls);
  assert.ok((await js('ToolLauncher.entry.pending.proposal.text')).includes('明天可查询的已保存事项'));
  await capture('stage53-plan-query.png');
  await input('你有哪些功能');await submit('command');assert.ok((await js('ToolLauncher.entry.pending.proposal.text')).includes('会前五分钟'));
  await js(`[...document.querySelectorAll('.entry-result-actions button')].find(b=>b.textContent==='存为图片').click()`);await delay(150);
  assert.equal((await js('notchAPI.referenceGet()')).items.length,1);
  await js(`document.getElementById('entry-cancel').click()`);assert.equal(await js('document.getElementById("entry-input").value'),'');
  assert.equal(await js('ToolLauncher.entry.pending'),null);
  assert.ok((await js('JSON.parse(localStorage.getItem("handy-entry-history-v1"))')).length>0);
  await js(`document.querySelector('.entry-nav button:last-child').click()`);
  assert.equal(await js('!!document.querySelector("[data-launcher-tool=settings]")'),false);
  await js(`document.querySelector('.launcher-more').click()`);
  await capture('stage53-entry-clean.png');
  assert.equal(BrowserWindow.getAllWindows().length,1);assert.equal(await js('PanelRecording.snapshot().status'),'idle');assert.deepEqual(errors,[]);
  console.log('Assistant entry Electron PASS: real IPC/storage, note/link, duplicate protection, failure recovery, AI opt-in, simulated discussion/plan, confirmation, local search, themes and narrow window. No real AI or microphone sampled. Data: '+testData);
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
