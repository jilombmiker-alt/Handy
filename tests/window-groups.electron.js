'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow,ipcMain}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-external-groups-'));
BrowserWindow.prototype.show=function(){};const runtime=require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,c)=>w.webContents.executeJavaScript(c,true);
async function wait(fn){for(let i=0;i<180;i++){try{const r=await fn();if(r)return r;}catch{}await pause(30);}throw Error('external groups timeout');}
async function main(){await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));await wait(()=>run(host,'!!WindowToolsHome&&!!Notebook'));
 host.hide();host.focus=()=>{};host.isVisible=()=>true;const errors=[];host.webContents.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m);});
 const names=['浏览器','GPT','地图','笔记'],paths=['/Applications/Safari.app','/Applications/ChatGPT.app','/System/Applications/Maps.app','/System/Applications/Notes.app'];
 const initial=await Promise.all(names.map(async(appName,i)=>({id:'fixture-'+i,pid:100+i,windowNumber:1000+i,appName,appPath:paths[i],title:['学习资料 · 浏览器','学习问答 · GPT','出行路线 · 地图','课程要点 · 笔记'][i],icon:await runtime.windowGroups.icon(paths[i])})));
 initial.push({...initial[0],id:'fixture-4',title:'工作资料 · 浏览器'},{...initial[3],id:'fixture-5',title:'临时想法 · 笔记'});
 let source={items:initial,error:null},focused=[];
 ipcMain.removeHandler('windows:list');ipcMain.handle('windows:list',()=>{runtime.windowGroups.setScan(source);return source;});
 ipcMain.removeHandler('windows:focus');ipcMain.handle('windows:focus',(_e,id)=>{focused.push(id);return source.items.some(v=>v.id===id);});
 const get=()=>run(host,'notchAPI.windowGroupsGet()'),cmd=c=>run(host,`notchAPI.windowGroupsCommand(${JSON.stringify(c)})`);
 await run(host,'setMode(true);WindowToolsHome.refresh()');assert.equal(await run(host,'document.querySelectorAll(".wt-window").length'),6);assert.equal(await run(host,'document.querySelector(".wt-search").hidden'),true);
 await run(host,`document.querySelector('.ws-create').click();document.querySelector('.ws-edit input').value='学习';[...document.querySelectorAll('.ws-choice input')].slice(0,4).forEach(c=>{c.checked=true;c.dispatchEvent(new Event('change'));});document.querySelector('.ws-edit').requestSubmit()`);
 await wait(async()=>(await get()).groups.length===1);await wait(()=>run(host,'document.querySelectorAll(".ws-group").length===1'));
 const group=(await get()).groups[0];assert.equal(group.members.length,4);assert.equal(await run(host,'document.querySelectorAll(".wt-window").length'),4);
 await run(host,`document.querySelector('[data-window-id="fixture-1"]').click()`);await pause(70);assert.deepEqual(focused,['fixture-1']);
 source={items:initial.filter(v=>v.id!=='fixture-1'),error:null};await run(host,'WindowToolsHome.refresh()');assert.equal((await get()).groups[0].members[1].status,'closed');assert.ok((await run(host,'document.querySelector(".wt-results").textContent')).includes('未打开'));
 source={items:[],error:'window_scan_timeout'};await run(host,'WindowToolsHome.refresh()');assert.ok((await get()).groups[0].members.every(m=>m.status==='unknown'));assert.ok(!(await run(host,'document.querySelector(".wt-results").textContent')).includes('未打开'));
 source={items:[...initial.filter(v=>v.id!=='fixture-1'),{...initial[1],id:'fixture-new-gpt',title:'新的学习问答'}],error:null};await run(host,'WindowToolsHome.refresh()');
 await run(host,`document.querySelector('.ws-rebind').click();const c=document.querySelector('[data-choice="window:fixture-new-gpt"]');c.checked=true;c.dispatchEvent(new Event('change'));document.querySelector('.ws-edit').requestSubmit()`);
 await wait(async()=>(await get()).revision===2);assert.equal((await get()).groups[0].members.length,4);assert.ok((await get()).groups[0].members.some(m=>m.id==='fixture-new-gpt'));
 await wait(()=>run(host,'!document.querySelector(".ws-editing")'));await run(host,`document.querySelector('.ws-manage').click();document.querySelector('.ws-edit input').value='保留我的草稿'`);
 const s=await get();await cmd({action:'save',id:group.id,revision:s.revision,name:'别处修改',members:s.groups[0].members.map(m=>({refId:m.refId}))});
 await run(host,`document.querySelector('.ws-edit').requestSubmit()`);await pause(100);assert.equal(await run(host,'document.querySelector(".ws-edit input").value'),'保留我的草稿');assert.ok((await run(host,'document.querySelector(".ws-status").textContent')).includes('别处修改'));
 assert.equal(await run(host,`WindowToolsHome.flush().then(()=>false,()=>true)`),true);
 await run(host,`document.querySelector('.ws-edit-actions button:nth-child(2)').click()`);await pause(100);
 const updated=await get();await cmd({action:'save',id:group.id,revision:updated.revision,name:'学习',members:updated.groups[0].members.map(m=>({refId:m.refId}))});
 await cmd({action:'save',revision:(await get()).revision,name:'写作',members:[{windowId:'fixture-4'},{windowId:'fixture-5'}]});await run(host,'WindowToolsHome.refresh()');
 // Search is optional; IME confirmation must not switch windows.
 await run(host,`document.querySelector('.ws-toolbar button').click();const i=document.querySelector('.wt-search input');i.value='新的学习';i.dispatchEvent(new Event('input'));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true}));`);assert.equal(focused.length,1);
 await run(host,`document.querySelector('.wt-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`);await pause(50);assert.equal(focused.at(-1),'fixture-new-gpt');
 await run(host,`document.querySelector('.ws-toolbar button').click()`);
 const dir=process.env.PANEL_WINDOW_GROUPS_CAPTURE_DIR;if(dir)fs.mkdirSync(dir,{recursive:true});
 for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}');setMode(true)`);await pause(500);assert.equal(await run(host,'document.querySelectorAll(".wt-window").length'),4);
  assert.equal(await run(host,`(()=>{const r=document.querySelector('.wt-results').getBoundingClientRect();return [...document.querySelectorAll('.wt-window')].every(b=>b.getBoundingClientRect().bottom<=r.bottom);})()`),true,await run(host,`JSON.stringify({list:document.querySelector('.wt-results').getBoundingClientRect().toJSON(),buttons:[...document.querySelectorAll('.wt-window')].map(b=>b.getBoundingClientRect().toJSON())})`));
  if(dir){const rect=await run(host,`(()=>{const r=document.querySelector('.home-windows').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);fs.writeFileSync(path.join(dir,theme+'-home.png'),(await host.capturePage(rect)).toPNG());}
 }
 await run(host,`Notebook.detach('module','windows')`);const win=await wait(async()=>{for(const w of BrowserWindow.getAllWindows()){if(w===host||!w.webContents.getURL().endsWith('/renderer/floating.html'))continue;if((await run(w,'floatingAPI.request({action:"identity"})')).id==='windows')return w;}});
 await wait(()=>run(win,'!!document.querySelector(".ws-group")'));await run(win,`document.querySelector('.ws-group').click()`);win.setSize(400,500);await pause(120);
 assert.equal(await run(win,'document.documentElement.scrollWidth<=innerWidth'),true);assert.equal(await run(win,'document.querySelectorAll(".wt-window").length'),4);
 if(dir)fs.writeFileSync(path.join(dir,'group-float.png'),(await win.capturePage()).toPNG());
 const foreign=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../renderer/floating-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});await foreign.loadFile(path.join(__dirname,'../renderer/float-dock.html'));
 assert.equal((await run(foreign,'floatingAPI.windowGroupsGet()')).error,'forbidden');assert.equal((await run(foreign,'floatingAPI.windowGroupsCommand({action:"delete",revision:0,id:"x"})')).error,'forbidden');foreign.destroy();
 assert.deepEqual(errors,[]);console.log('PASS external window groups: real scoped IPC with synthetic OS scan; icon grid, create/select/rebind, closed vs unknown, preserved conflict draft, IME, main/float sync, both themes. No external window activation, microphone or installation.');app.exit(0);
}
main().catch(e=>{console.error(e);app.exit(1);});
