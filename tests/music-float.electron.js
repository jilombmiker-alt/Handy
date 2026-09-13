'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'panel-music-fixture-')));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win,commands=[],closes=0,error=null,settings=0;
let snapshot={ok:true,theme:'white',installed:true,running:true,playing:null,title:'汽水音乐',artist:'',detail:'已连接 · 播放状态未提供'};
ipcMain.handle('floats:request',async(_event,payload)=>{
  if(payload.action==='identity')return {ok:true,kind:'module',id:'music'};
  if(payload.action==='get')return snapshot;
  if(payload.action==='music-layout'){win.setSize(win.getSize()[0],payload.expanded?(payload.form==='cover'?224:180):(payload.form==='cover'?164:100));return {ok:true};}
  if(payload.action==='settings'){settings++;return {ok:true};}
  if(payload.action==='command'){commands.push(payload.operation);await pause(100);return error?{ok:false,error}:snapshot;}
  return {ok:false};
});
ipcMain.handle('meeting:cancel',()=>({ok:true}));
ipcMain.handle('floats:dock',()=>{closes++;return {ok:true};});
const run=code=>win.webContents.executeJavaScript(code,true);
async function wait(fn){for(let i=0;i<120;i++){if(await fn())return;await pause(25);}throw Error('music fixture timeout');}
async function main(){
  await app.whenReady();
  // Hidden, isolated renderer. Never opens another visible application or controls a player.
  win=new BrowserWindow({width:400,height:140,frame:false,show:false,transparent:true,webPreferences:{preload:path.join(__dirname,'../renderer/floating-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(path.join(__dirname,'../renderer/floating.html'));
  await wait(()=>run(`!!document.querySelector('.music-float')`));
  assert.equal(win.isVisible(),false);assert.equal(commands.length,0);
  assert.equal(await run(`getComputedStyle(document.getElementById('float-handle')).fontSize`),'0px','Legacy drag label does not leak into the compact header');
  assert.equal(await run(`document.querySelector('.music-float-status').textContent`),snapshot.detail);
  assert.equal(await run(`document.querySelector('.music-float-copy span').textContent`),'歌曲信息暂不可用');
  const click=operation=>run(`document.querySelector('[data-music-operation="${operation}"]').click()`);
  await pause(100);assert.equal(win.getSize()[1],100);
  assert.equal(await run(`!!document.querySelector('.music-form-toggle')`),false);
  assert.equal(await run(`document.body.dataset.musicForm`),'bar');
  assert.equal(await run(`document.querySelector('.music-float-actions').hidden`),true,'Secondary controls start collapsed');
  await run(`document.querySelector('.music-float-more').click()`);
  assert.equal(await run(`document.querySelector('.music-float-more').getAttribute('aria-expanded')`),'true');
  assert.equal(await run(`document.querySelector('.music-float-row').hidden`),true,'Options replace the row instead of covering it');
  await run(`document.querySelector('[data-music-operation="refresh"]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await run(`document.activeElement.classList.contains('music-float-more')`),true);
  assert.equal(await run(`document.querySelector('.music-float-actions').hidden`),true);
  await click('toggle');await click('next');await pause(140);assert.deepEqual(commands,['toggle'],'Double clicks cannot enqueue another operation');
  assert.match(await run(`document.querySelector('.music-float-status').textContent`),/控制已发送/);
  error='accessibility_permission_required';await click('next');await pause(140);
  assert.match(await run(`document.querySelector('.music-float-status').textContent`),/辅助功能权限/);
  await pause(3200);assert.equal(await run(`document.body.classList.contains('music-idle')`),false,'Errors stay visible');
  await run(`document.querySelector('.music-float-more').click()`);
  await click('settings');await pause(30);assert.equal(settings,1);
  error=null;await click('refresh');await pause(140);assert.equal(await run(`document.querySelector('.music-float-status').classList.contains('error')`),false);
  await run(`document.querySelector('.music-float-more').click()`);
  await run(`document.activeElement.blur();document.body.dispatchEvent(new Event('pointerleave'))`);await pause(3200);
  assert.equal(await run(`document.body.classList.contains('music-idle')`),true,'Idle fades without pointer or keyboard focus');
  await run(`document.body.dispatchEvent(new Event('pointerenter'))`);assert.equal(await run(`document.body.classList.contains('music-idle')`),false);
  const dir=process.env.PANEL_MUSIC_CAPTURE_DIR;
  if(dir)fs.mkdirSync(dir,{recursive:true});
  snapshot={...snapshot,title:'测试歌曲',artist:'测试歌手',metadataAvailable:true,elapsed:65,duration:240,playing:true};
  await click('refresh');await pause(150);
  assert.equal(await run(`document.querySelector('.music-float-time').textContent`),'1:05 / 4:00');
  assert.equal(await run(`document.querySelector('.music-float-progress').value`),65);
  snapshot={...snapshot,elapsed:68};await pause(1200);
  assert.equal(await run(`document.querySelector('.music-float-progress').value`),68,'passive polling updates actual progress');
  for(const theme of ['white','obsidian'])for(const musicForm of ['bar','cover']){
    snapshot={...snapshot,theme,musicForm};await click('refresh');await pause(400);
    assert.equal(await run(`document.body.dataset.musicForm`),'bar','Float ignores legacy shared cover preference');
    assert.equal(win.getSize()[1],100);
    assert.equal(await run(`document.documentElement.dataset.theme`),theme);
    assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`),true);
    assert.equal(await run(`document.querySelector('.music-float').scrollHeight<=document.querySelector('.music-float').clientHeight`),true,'No internal overflow at normal size');
    if(dir)fs.writeFileSync(path.join(dir,`${theme}-${musicForm}-music.png`),(await win.webContents.capturePage()).toPNG());
  }
  win.setSize(380,100);snapshot={...snapshot,title:'一个很长的歌曲标题，确认不会挤掉播放控制和关闭入口',artist:'一位名字比较长的音乐人'};await click('refresh');await pause(400);
  assert.equal(await run(`document.documentElement.scrollWidth<=innerWidth`),true);
  if(dir)fs.writeFileSync(path.join(dir,'narrow-music.png'),(await win.webContents.capturePage()).toPNG());
  error='music_control_unavailable';await click('next');await pause(400);
  assert.equal(await run(`document.querySelector('.music-float').scrollHeight<=document.querySelector('.music-float').clientHeight`),true,'Long recovery message fits the compact window');
  if(dir)fs.writeFileSync(path.join(dir,'error-music.png'),(await win.webContents.capturePage()).toPNG());
  error=null;await click('refresh');await pause(140);
  snapshot={...snapshot,installed:false,running:false,metadataAvailable:false,elapsed:null,duration:null};await click('refresh');await pause(140);
  assert.equal(await run(`document.querySelector('.music-float-progress').hidden`),true,'old progress clears when player disconnects');
  assert.equal(await run(`document.querySelector('[data-music-operation="toggle"]').disabled`),true,'Missing client remains disabled after refresh completes');
  snapshot={...snapshot,title:'未安装汽水音乐',artist:'',detail:'需要本地客户端'};
  await click('refresh');await pause(400);
  if(dir)fs.writeFileSync(path.join(dir,'disconnected-music.png'),(await win.webContents.capturePage()).toPNG());
  await run(`document.querySelector('.music-float-more').click()`);
  await pause(200);
  if(dir)fs.writeFileSync(path.join(dir,'options-music.png'),(await win.webContents.capturePage()).toPNG());
  assert.equal(await run(`document.querySelector('.music-float').scrollHeight<=document.querySelector('.music-float').clientHeight`),true,'Options fit without a nested scrollbar');
  // Passive refresh must preserve a focused button instead of replacing it.
  await run(`document.querySelector('[data-music-operation="refresh"]').focus()`);await pause(2600);
  assert.equal(await run(`document.activeElement.dataset.musicOperation`),'refresh');
  const before=commands.length;await run(`document.getElementById('float-dock').click()`);await wait(async()=>closes===1);assert.equal(commands.length,before,'Closing does not pause music');
  win.destroy();console.log('PASS music float: hidden fixture, no autoplay, command serialization, honest metadata, errors/recovery, idle/focus, themes, compact/narrow layout, close without pause. Real client NOT exercised.');app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
