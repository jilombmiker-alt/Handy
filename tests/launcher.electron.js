const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {app,BrowserWindow,screen}=require('electron');
const testData=fs.mkdtempSync(path.join(os.tmpdir(),'todo-launcher-'));
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=testData;
require('../main');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
  await app.whenReady();let win;
  for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html'));if(win&&!win.webContents.isLoadingMainFrame())break;await delay(40);}
  assert.ok(win);const errors=[];
  // Test-only: OS focus changes must not suspend the harness's awaited animation frames.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  const js=s=>win.webContents.executeJavaScript(s);
  for(let i=0;i<200;i++){if(await js('!!window.ToolLauncher'))break;await delay(40);}
  assert.equal(await js('!!window.ToolLauncher'),true);
  win.show();win.focus();
  await js('ToolLauncher.open(null)');await delay(450);
  const b=win.getBounds(),area=screen.getDisplayMatching(b).workArea;
  assert.ok(Math.abs(b.y+b.height/2-(area.y+area.height/2))<=1);
  assert.equal(await js('document.querySelectorAll(".launcher-tile").length'),8);
  const screenshot=async name=>{await js('dismissStatusToast(false)');await delay(220);fs.writeFileSync(path.join(__dirname,'../docs/screenshots',name),(await win.webContents.capturePage()).toPNG());};
  await screenshot('stage39-launcher.png');
  const saved=await js(`(async()=>{
    await ToolLauncher.open('quick');
    const input=document.querySelector('.launcher-quick [data-field="content"]');
    input.value='启动器隔离测试：想法 123，切换后继续。';input.dispatchEvent(new Event('input',{bubbles:true}));
    await ToolLauncher.open('todo');await ToolLauncher.open('quick');
    return {text:document.querySelector('.launcher-quick [data-field="content"]').value,saved:QuickRecords.snapshot().note.content};
  })()`);
  assert.equal(saved.text,saved.saved);assert.match(saved.text,/隔离测试/);
  const failed=await js(`(async()=>{
    const original=QuickRecords.command;QuickRecords.command=()=>({ok:false,error:'storage_failed'});
    const input=document.querySelector('.launcher-quick [data-field="content"]');input.value+='失败时仍保留';input.dispatchEvent(new Event('input',{bubbles:true}));
    const result=await ToolLauncher.open('todo');const route=ToolLauncher.current;
    QuickRecords.command=original;await ToolLauncher.flush();return {ok:result.ok,route,text:input.value};
  })()`);
  assert.equal(failed.ok,false);assert.equal(failed.route,'quick');assert.match(failed.text,/失败时仍保留/);
  await js(`document.querySelector('.launcher-quick [data-field="content"]').dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',bubbles:true}))`);
  assert.equal(await js('ToolLauncher.current'),'quick');
  await screenshot('stage39-quick.png');
  for(const id of ['todo','recorder','links','pomodoro','music','commands','windows','gallery','mirror','credentials','mail','inbox','settings']){
    assert.equal((await js(`ToolLauncher.open(${JSON.stringify(id)})`)).ok,true,id);
    assert.equal(await js('ToolLauncher.current'),id,id);
    assert.equal(BrowserWindow.getAllWindows().length,1,`no extra window: ${id}`);
    if(['todo','recorder','music','pomodoro'].includes(id))await screenshot('stage39-'+id+'.png');
    if(id==='music')assert.equal(await js(`document.querySelector('.music-controls').getBoundingClientRect().bottom < innerHeight`),true);
    if(id==='pomodoro')assert.equal(await js(`document.querySelector('.timer-actions').getBoundingClientRect().bottom < innerHeight`),true);
  }
  const disabled=await js(`ToolLauncher.open('clip')`);assert.equal(disabled.error,'feature_disabled');
  const oldRoute=await js(`notchAPI.openFloat({kind:'quick'})`);assert.equal(oldRoute.inline,true);await delay(250);
  assert.equal(await js('ToolLauncher.current'),'quick');assert.equal(BrowserWindow.getAllWindows().length,1);
  assert.equal((await js(`notchAPI.launcherLayout('bogus')`)).error,'invalid_layout');
  assert.equal((await js(`notchAPI.detachDrag('start',{kind:'quick'})`)).error,'launcher_fixed');
  await js('setMode(false)');await delay(450);assert.equal(win.isVisible(),false);
  win.show();await js('setMode(true)');await delay(400);assert.equal(await js('ToolLauncher.current'),'quick');
  assert.equal(await js('PanelRecording.snapshot().status'),'idle');
  const timer=await js(`(async()=>{let s=await notchAPI.timerGet();await notchAPI.timerCommand({action:'start',mode:'countup',revision:s.revision});await setMode(false);return notchAPI.timerGet();})()`);
  assert.equal(timer.active.running,true);await delay(300);win.show();await js('setMode(true)');
  await js(`(async()=>{const s=await notchAPI.timerGet();return notchAPI.timerCommand({action:'finish',revision:s.revision,id:s.active.id});})()`);
  await js(`ToolLauncher.open(null)`);await js(`document.querySelector('[data-theme-choice="obsidian"]').click()`);
  await screenshot('stage39-launcher-obsidian.png');
  assert.deepEqual(errors,[]);
  await js(`document.querySelector('[data-theme-choice="white"]').click()`);
  if(process.argv.includes('--interactive')){console.log('Interactive isolated launcher ready for 120 seconds');await delay(120000);}
  console.log('Launcher Electron PASS: real main/preload, bottom bounds, 8 entries, 13 routes, shared draft, legacy route, no extra windows, disabled clipboard, collapse/resume, themes. Data: '+testData);
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
