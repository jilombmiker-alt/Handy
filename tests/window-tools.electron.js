'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-window-tools-'));
const show=BrowserWindow.prototype.show;BrowserWindow.prototype.show=function(){};
const runtime=require('../main');const pause=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,c)=>w.webContents.executeJavaScript(c,true);
async function wait(fn){for(let i=0;i<180;i++){try{const r=await fn();if(r)return r;}catch{}await pause(30);}throw Error('window-tools timeout');}
const floats=()=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/floating.html'));
async function main(){await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));await wait(()=>run(host,'!!window.WindowToolsHome&&!!window.Notebook'));
 host.hide();host.focus=()=>{};host.isVisible=()=>true;
 const errors=[];host.webContents.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m);});
 let scan={items:Array.from({length:22},(_,i)=>({id:'window-'+i,title:i===20?'写作资料 · 第二章':'讨论资料 '+i,appName:i%2?'浏览器':'文档'}))},focused=[];
 ipcMain.removeHandler('windows:list');ipcMain.handle('windows:list',()=>scan);
 ipcMain.removeHandler('windows:focus');ipcMain.handle('windows:focus',(_e,id)=>{focused.push(id);return id!=='closed';});
 await run(host,'setMode(true);WindowToolsHome.refresh()');assert.equal(await run(host,'document.querySelectorAll(".wt-window").length'),22);
 await run(host,`(()=>{const i=document.querySelector('.wt-search input');i.value='第二章';i.dispatchEvent(new Event('input'));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true}));})()`);assert.equal(focused.length,0);
 await run(host,`document.querySelector('.wt-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`);await pause(60);assert.deepEqual(focused,['window-20']);assert.equal(await run(host,'document.querySelectorAll(".wt-window").length'),1);
 scan={items:[],error:'window_scan_timeout'};await run(host,'WindowToolsHome.refresh()');assert.ok((await run(host,'document.querySelector(".wt-results").textContent')).includes('不必重新授权'));
 scan={items:[{id:'closed',title:'写作方案（测试资料）',appName:'文档'},{id:'fixture2',title:'讨论提纲（测试资料）',appName:'浏览器'}]};await run(host,`document.querySelector('.wt-search input').value='';WindowToolsHome.refresh()`);await run(host,'document.querySelector(".wt-window").click()');await pause(80);assert.ok((await run(host,'document.querySelector(".wt-status").textContent')).includes('未能切换'));
 const cmd=c=>run(host,`notchAPI.toolGroupsCommand(${JSON.stringify(c)})`),get=()=>run(host,'notchAPI.toolGroupsGet()');
 await run(host,`document.getElementById('home-note').value='组合展开前的草稿';`);
 assert.equal((await cmd({action:'open',id:'discussion',revision:0})).ok,true);assert.equal(floats().length,3);
 assert.equal(await run(host,`localStorage.getItem('notch-home-note')`),'组合展开前的草稿');
 await cmd({action:'open',id:'discussion',revision:0});assert.equal(floats().length,3,'No duplicate floats');assert.equal(runtime.simpleTimer.store.snapshot().active,null,'Opening does not start timer');
 let recorder;for(const w of floats()){const id=await run(w,'floatingAPI.request({action:"identity"})');if(id.kind==='recorder')recorder=w;}
 assert.equal((await run(recorder,'floatingAPI.toolGroupsCommand({action:"delete",id:"daily",revision:0})')).error,'forbidden','Recorder cannot manage combinations');
 assert.equal((await run(recorder,'floatingAPI.request({action:"pin",pinned:false})')).pinned,false);assert.equal(recorder.isAlwaysOnTop(),false);
 assert.equal((await run(recorder,'floatingAPI.request({action:"pin",pinned:true})')).pinned,true);
 const t=runtime.simpleTimer.store.snapshot();runtime.simpleTimer.store.command({action:'start',revision:t.revision,mode:'countup',title:'隔离测试'});
 await cmd({action:'hide',id:'discussion',revision:0});assert.equal(floats().length,3);assert.equal(runtime.simpleTimer.store.snapshot().active.running,true);assert.ok((await get()).activity.includes('计时中'));
 await cmd({action:'open',id:'writing',revision:0});assert.equal(floats().length,4,'Shared quick note reused');
 assert.equal((await run(host,`Notebook.detach('module','windows')`)).ok,true);const win=await wait(async()=>{for(const w of floats()){if((await run(w,'floatingAPI.request({action:"identity"})')).id==='windows')return w;}});await wait(()=>run(win,'!!document.querySelector(".window-tools")'));
 await run(win,`document.querySelector('.wt-combinations').open=true`);await pause(100);await run(win,`document.querySelector('.wt-group button:nth-child(2)').click()`);await pause(70);
 await run(win,`document.querySelector('.wt-editor input[type=text]').value='我的临时讨论'`);
 assert.equal((await cmd({action:'save',id:'discussion',revision:0,name:'其他窗口已修改',tools:['quick']})).ok,true);
 await run(win,`document.querySelector('.wt-editor form').requestSubmit()`);await pause(100);assert.equal(await run(win,`document.querySelector('.wt-editor input[type=text]').value`),'我的临时讨论');assert.ok((await run(win,'document.querySelector(".wt-combinations .wt-status").textContent')).includes('别处修改'));
 await run(win,`document.querySelector('.wt-editor .wt-recovery button:last-child').click()`);await pause(80);
 await cmd({action:'save',id:'discussion',revision:1,name:'临时讨论',tools:['quick','recorder','module:pomodoro']});
 await run(host,`WindowToolsHome.refresh();document.querySelector('.wt-combinations').open=true`);await pause(100);
 assert.equal(await run(host,`(()=>{const d=document.querySelector('.wt-combinations').getBoundingClientRect();return [...document.querySelectorAll('.wt-preset')].every(b=>b.getBoundingClientRect().bottom<=d.bottom);})()`),true,'Compact preset buttons remain fully visible');
 const dir=process.env.PANEL_WINDOWS_CAPTURE_DIR;if(dir)fs.mkdirSync(dir,{recursive:true});
 for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}');setMode(true)`);await pause(500);if(dir){const rect=await run(host,`(()=>{const r=document.querySelector('.home-windows').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);fs.writeFileSync(path.join(dir,theme+'-home.png'),(await host.capturePage(rect)).toPNG());}}
 win.setSize(440,620);await run(win,`document.querySelector('.wt-combinations').open=true`);await pause(200);if(dir)fs.writeFileSync(path.join(dir,'window-float.png'),(await win.capturePage()).toPNG());
 assert.equal(await run(win,'document.documentElement.scrollWidth<=innerWidth'),true,'No horizontal overflow');
 assert.deepEqual(errors,[]);BrowserWindow.prototype.show=show;console.log('PASS window tools: hidden Electron search/IME/empty/error/stale focus, combination reuse/custom/conflict, scoped IPC, pin state, hide keeps timer, both themes. External windows are fixtures; no microphone.');app.exit(0);
}
main().catch(e=>{console.error(e);app.exit(1);});
