const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-parallel-'));
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);});
require('../main');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),js=(w,s)=>w.webContents.executeJavaScript(s).catch(e=>{throw Error(e.message+' in '+s.slice(0,180));});
async function wait(fn){for(let i=0;i<240;i++){const r=await fn();if(r)return r;await delay(40);}throw Error('wait_timeout');}
const floats=()=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/floating.html'));
async function run(){
 await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')&&!w.webContents.isLoadingMainFrame()));
 await wait(()=>js(host,'!!window.ToolLauncher'));
 const errors=[];app.on('web-contents-created',(_e,w)=>w.on('console-message',(_ev,l,m)=>{if(l>=3)errors.push(m);}));
 async function open(tool,p={}){const r=await js(host,`ToolLauncher.open(${JSON.stringify(tool)},${JSON.stringify(p)})`);assert.equal(r.ok,true,JSON.stringify(r));const w=await wait(async()=>{for(const x of floats()){if(!x.webContents.isLoadingMainFrame()&&await js(x,`!!document.querySelector('#float-pin')`)){const ident=await js(x,`floatingAPI.request({action:'identity'})`);if(r.key===ident.key)return x;}}});await wait(()=>js(w,`!!document.querySelector('.nb-editor,.float-recorder,.module-float,.music-float,.timer-root,.material-packs') || !document.getElementById('floating-root').textContent.includes('正在读取')`));return {r,w};}
 const a=await open('notes',{create:'plain'}),b=await open('meeting');assert.notEqual(a.r.noteId,b.r.noteId);assert.equal(floats().length,2);assert.equal(await js(host,'ToolLauncher.current'),null);
 const edit=(w,field,text)=>js(w,`(()=>{const e=document.querySelector('[data-field="${field}"]');e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await edit(a.w,'content','学习想法，保留第一篇');await edit(b.w,'meeting.freeText','讨论要点 1、2、3');
 await wait(async()=> (await js(host,`Notebook.get('${a.r.noteId}').content`)).includes('第一篇'));
 await wait(async()=> (await js(host,`Notebook.get('${b.r.noteId}').content`)).includes('讨论要点'));
 assert.equal(a.w.isAlwaysOnTop(),true);assert.equal(b.w.isAlwaysOnTop(),true);
 await js(a.w,`document.getElementById('float-pin').click()`);await wait(()=>!a.w.isAlwaysOnTop());assert.equal(b.w.isAlwaysOnTop(),true);
 const again=await open('notes',{kind:'note',id:a.r.noteId});assert.equal(again.w.id,a.w.id);assert.equal(floats().length,2);
 const recording=await open('recorder'),timer=await open('pomodoro');assert.equal(floats().length,4);assert.equal(await js(host,'PanelRecording.snapshot().status'),'idle');
 await js(host,`ToolLauncher.open(null)`);assert.equal(floats().length,4);
 await js(host,`ToolLauncher.open('notes',{inline:true})`);assert.equal(await js(host,'ToolLauncher.current'),'notes');assert.equal(floats().length,4);
 await js(host,`ToolLauncher.open(null)`);
 const shot=async(w,name)=>{await delay(120);fs.writeFileSync(path.join(__dirname,'../docs/screenshots',name),(await w.webContents.capturePage({},{stayHidden:true})).toPNG());};
 await shot(a.w,'stage59-note-white.png');await shot(b.w,'stage59-meeting-white.png');
 await js(host,`PanelAppearance.setTheme('obsidian')`);await delay(100);await shot(b.w,'stage59-meeting-obsidian.png');
 // Closing must wait for acknowledged saving and must not discard a failed edit.
 await js(host,`window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='notch-note-archive-v1')throw Error('fixture disk failure');return originalSet.call(this,k,v);};void 0;`);
 await edit(a.w,'content','保存失败时也不能丢掉');await js(a.w,`document.getElementById('float-dock').click()`);
 await wait(()=>js(a.w,`document.querySelector('.nb-status').classList.contains('error')`));assert.equal(a.w.isDestroyed(),false);
 await js(host,`Storage.prototype.setItem=originalSet;void 0;`);await js(a.w,`document.getElementById('float-dock').click()`);await wait(()=>a.w.isDestroyed());
 assert.equal(await js(host,`Notebook.get('${a.r.noteId}').content`),'保存失败时也不能丢掉');assert.equal(b.w.isDestroyed(),false);
 const reopened=await open('notes',{kind:'note',id:a.r.noteId});assert.equal(reopened.w.isAlwaysOnTop(),false);assert.equal(await js(reopened.w,`document.querySelector('[data-field="content"]').value`),'保存失败时也不能丢掉');
 // Window identity prevents a satellite from addressing another note.
 const evil=await js(b.w,`floatingAPI.request({action:'save',id:'${a.r.noteId}',note:{id:'${a.r.noteId}',content:'wrong'},revision:0})`);assert.equal(evil.ok,false);
 for(const w of floats())await js(w,`document.getElementById('float-dock').click()`);await wait(()=>floats().length===0);
 assert.ok(BrowserWindow.getAllWindows().every(w=>!w.isVisible()));assert.deepEqual(errors,[]);
 console.log('S59 PASS: 4 independent windows, separate note/meeting persistence, ID reuse, pin isolation + reopen preference, central dialog/library retained, close-save and failed-close recovery, scoped IPC. No live mic, AI, or music playback.');
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
