const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-once-record-'));
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{};});
const main=require('../main');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<160;i++){if(await check())return;await wait(40);}throw Error('timeout');}
async function run(){
 await app.whenReady();let w;await until(async()=>{w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html'));return w&&!w.webContents.isLoadingMainFrame();});
 const js=s=>w.webContents.executeJavaScript(s);await until(()=>js('!!window.ToolLauncher?.entry&&!!window.PanelRecording'));w.webContents.setBackgroundThrottling(false);
 await js(`window.starts=0;window.streams=[];window.audioContexts=[];window.SpeechRecognition=class{start(){}stop(){}};
 navigator.mediaDevices.getUserMedia=async()=>{starts++;const context=new AudioContext(),destination=context.createMediaStreamDestination(),osc=context.createOscillator(),gain=context.createGain();gain.gain.value=0;osc.connect(gain);gain.connect(destination);osc.start();await context.resume();streams.push(destination.stream);audioContexts.push(context);return destination.stream;};PanelRecording.command('auto-off')`);
 // Real IPC, real MediaRecorder, generated silent stream (no user's microphone).
 const start=(id,seconds=1)=>js(`notchAPI.startTimedRecording({seconds:${seconds},requestId:${JSON.stringify(id)}})`);
 const snap=()=>js('PanelRecording.snapshot()');const rows=()=>js(`JSON.parse(localStorage.getItem('notch-recordings')||'[]').filter(n=>!n.isDraft)`);
 const first=await start('one');assert.equal(first.ok,true);assert.equal((await start('one')).replayed,true);assert.equal((await start('two')).error,'recording_busy');
 await wait(1200);await main.onceRecording.tick();await until(async()=>(await snap()).status==='idle');assert.equal(await js('starts'),1);
 const saved=(await rows())[0];assert.ok(fs.existsSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,saved.audioPath)));assert.equal(await js(`streams[0].getTracks().every(t=>t.readyState==='ended')`),true);
 await wait(1600);await main.onceRecording.tick();await start('one');assert.equal(await js('starts'),1);assert.equal((await rows()).length,1);
 // Early stop and a later unrelated recorder: old deadline may not stop the later ID.
 await start('early',2);await wait(200);await js(`PanelRecording.command('stop')`);await until(async()=>(await snap()).status==='idle');
 await js(`PanelRecording.command('start')`);const later=(await snap()).recordingId;await wait(2100);await main.onceRecording.tick();assert.equal((await snap()).recordingId,later);assert.equal((await snap()).status,'recording');
 await js(`PanelRecording.command('stop')`);await until(async()=>(await snap()).status==='idle');
 // A failed disk write ends media tracks, freezes time, and retry writes same blob only.
 const write=fs.promises.writeFile;fs.promises.writeFile=async function(file,...rest){if(String(file).startsWith(path.join(process.env.PANEL_TEST_USER_DATA_PATH,'recordings')+path.sep))throw Error('test disk failure');return write.call(this,file,...rest);};
 try{
   await start('disk-failure');await wait(1200);await main.onceRecording.tick();await until(async()=>(await snap()).status==='save-failed');
   const before=await snap(),count=await js('starts');await wait(1200);assert.equal((await snap()).time,before.time);assert.equal(await js(`streams.at(-1).getTracks().every(t=>t.readyState==='ended')`),true);assert.equal(await js('starts'),count);
 }finally{fs.promises.writeFile=write;}
 const count=await js('starts');await js(`PanelRecording.command('retry-save')`);await until(async()=>(await snap()).status==='idle');assert.equal(await js('starts'),count);assert.equal((await rows()).length,4);
 // Voice intent invokes real recorder once; an ordinary timer still never records.
 await js(`ToolLauncher.open(null)`);await js(`(()=>{const i=document.getElementById('entry-input');i.value='录音1秒';i.dispatchEvent(new Event('input'));})()`);await js(`ToolLauncher.entry.submit('command')`);assert.equal(await js('ToolLauncher.current'),null);assert.ok(BrowserWindow.getAllWindows().some(x=>x.webContents.getURL().endsWith('/renderer/floating.html')));assert.match(await js(`document.querySelector('.launcher-task-bar').textContent`),/一次/);
 await wait(1200);await main.onceRecording.tick();await until(async()=>(await snap()).status==='idle');assert.equal(await js('starts'),count+1);
 const float=BrowserWindow.getAllWindows().find(x=>x.webContents.getURL().endsWith('/renderer/floating.html'));await float.webContents.executeJavaScript(`document.getElementById('float-dock').click()`);await until(()=>float.isDestroyed());
 const s=main.simpleTimer.store.snapshot();main.simpleTimer.store.command({action:'start',seconds:1,revision:s.revision});
 app.emit('before-quit',{preventDefault(){}});w.webContents.emit('will-prevent-unload',{});await wait(1100);await main.simpleTimer.tick();assert.equal(main.simpleTimer.store.snapshot().active.notified,true,'vetoed quit must not disable due timer');
 await js(`Promise.all(audioContexts.map(c=>c.close()))`);assert.equal(w.isVisible(),false);
 console.log('S57 PASS: actual generated MediaRecorder audio saved once, deadline and duplicate guard, no restart, stale ID safety, failed-save tracks stopped/time frozen/retry only writes, text intent routed, vetoed quit keeps timer alive. No real microphone or cloud ASR.');
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
