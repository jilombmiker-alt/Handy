const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain,screen}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-modules-test-'));
delete process.env.NOTCH_LLM_API_KEY;delete process.env.DASHSCOPE_API_KEY;
require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,code)=>w.webContents.executeJavaScript(code,true);
async function wait(fn,label='wait_timeout'){for(let i=0;i<250;i++){const v=await fn();if(v)return v;await pause(30);}throw Error(label);}
const floats=()=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/floating.html'));
async function main(){
 await app.whenReady();
 const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
 await wait(()=>run(host,'!!window.PanelModules'));
 host.hide();host.setIgnoreMouseEvents(true);host.removeAllListeners('blur');host.webContents.setBackgroundThrottling(false);
 host.show=()=>{};host.showInactive=()=>{};host.focus=()=>{};host.isVisible=()=>true;
 const originalShow=BrowserWindow.prototype.show;
 BrowserWindow.prototype.show=function(){this.setIgnoreMouseEvents(true);};
 const errors=[];app.on('web-contents-created',(_e,w)=>w.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);}));
 // No external music app, clipboard writes, AI calls or real vault access in this fixture.
 let copied=[],musicCalls=[],vault=[];
 function mock(channel,handler){ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);}
 mock('links:inspect',()=>({ok:false}));
 mock('credentials:list',()=>({ok:true,items:vault.map(({password,...v})=>v)}));
 mock('credentials:save',(_e,v)=>{vault.push({...v,id:'vault-test'});return {ok:true};});
 mock('credentials:copy',(_e,v)=>{copied.push(v);return true;});
 mock('credentials:delete-many',()=>{vault=[];return {ok:true};});
 mock('music:control',(_e,v)=>{musicCalls.push(v);return {ok:true,playing:v==='play'};});
 mock('music:status',()=>({ok:true,installed:true,running:true,playing:null,title:'',artist:''}));
 mock('windows:list',()=>({items:[{id:'window-test',title:'设计稿',appName:'测试应用'}]}));
 const opened={};
 async function open(id){const r=await run(host,`Notebook.detach('module',${JSON.stringify(id)})`);assert.equal(r.ok,true,JSON.stringify(r));
   const w=await wait(async()=>{for(const v of floats()){try{if((await run(v,`floatingAPI.request({action:'identity'})`)).id===id)return v;}catch{}}});
   await wait(()=>run(w,`!!document.querySelector('.module-float,.material-packs,.reference-view')`),'module '+id);w.setIgnoreMouseEvents(true);opened[id]=w;return w;}
 const request=(w,operation,values={})=>run(w,`floatingAPI.request(${JSON.stringify({action:'command',operation,values})})`);
 const snapshot=w=>run(w,`floatingAPI.request({action:'get'})`);
 await run(host,'setMode(true)');await pause(200);
 assert.equal(await run(host,`Object.values(PanelModuleCatalog).every(v=>!!document.querySelector(v.selector+' > .panel-detach-handle'))`),true,'Every module has a handle');
 assert.equal((await run(host,`Notebook.detach('module','clip')`)).error,'feature_disabled');
 for(const id of ['todo','commands','links','pomodoro','music','gallery','windows','credentials'])await open(id);
 assert.equal(floats().length,8);await open('todo');assert.equal(floats().length,8);
 assert.equal(musicCalls.length,0,'Opening music never starts playback');
 await pause(300);
 assert.equal(opened.music.getBounds().height,100,'Music opens compact instead of retaining a tall module window');
 assert.equal((await run(opened.todo,`floatingAPI.request({action:'music-layout',form:'bar',expanded:false})`)).ok,false,'Other modules cannot use music layout');
 assert.equal((await run(opened.music,`floatingAPI.request({action:'music-layout',form:'unknown',expanded:false})`)).ok,false);
 await run(opened.music,`floatingAPI.drag('start')`);await run(opened.music,`floatingAPI.drag('cancel')`);
 assert.equal(opened.music.getBounds().height,100,'Drag completion preserves compact height');
 screen.emit('display-metrics-changed',{},screen.getPrimaryDisplay(),['workArea']);
 assert.equal(opened.music.getBounds().height,100,'Display recovery preserves compact height');
 assert.equal((await run(opened.music,`floatingAPI.request({action:'music-layout',form:'cover',expanded:false})`)).ok,false,'Float cannot become a cover player');
 assert.equal(await run(opened.music,`document.body.dataset.musicForm`),'bar');
 assert.equal(await run(host,`document.getElementById('home-music').dataset.musicForm`),'cover','Home and float intentionally have different forms');
 await run(opened.music,`floatingAPI.drag('start')`);await run(opened.music,`floatingAPI.drag('cancel')`);
 screen.emit('display-metrics-changed',{},screen.getPrimaryDisplay(),['workArea']);
 assert.equal(opened.music.getBounds().height,100,'Compact bar survives drag and display recovery');
 const {fitBounds}=require('../main-floats');
 assert.equal(fitBounds({width:400,height:100},{x:0,y:0,width:1000,height:800}).height,180,'Other tools keep the original lower bound');
 assert.equal(await run(opened.music,`document.body.classList.contains('music-floating')`),true);
 assert.equal(await run(opened.todo,'typeof window.notchAPI'),'undefined');
 assert.equal((await run(opened.music,`floatingAPI.request({action:'command',kind:'module',id:'credentials',operation:'add',values:{service:'escape'}})`)).ok,false,'Scope cannot be spoofed');
 assert.equal((await run(opened.music,`floatingAPI.prepare({background:'not allowed'})`)).error,'forbidden');
 // Submit through the actual form, then read shared master state.
 await run(opened.todo,`(()=>{Array.from(document.querySelectorAll('.planner-more button')).find(b=>b.textContent==='以前的分类清单').click();const f=document.querySelector('.module-float form');f.elements.text.value='浮窗中的待办';f.elements.text.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();})()`);
 await wait(async()=>((await snapshot(opened.todo)).items||[]).some(v=>v.text==='浮窗中的待办'));
 let item=(await snapshot(opened.todo)).items.find(v=>v.text==='浮窗中的待办');
 assert.ok(await run(host,`JSON.parse(localStorage.getItem('notch-todo-data')).P0.some(v=>v.text==='浮窗中的待办')`));
 assert.equal((await request(opened.todo,'toggle',{id:item.id,priority:'P0'})).ok,true);
 assert.equal((await snapshot(opened.todo)).items.find(v=>v.id===item.id).done,true);
 assert.equal((await request(opened.todo,'edit',{id:item.id,priority:'P0',text:'已修改的待办'})).ok,true);
 assert.equal((await request(opened.commands,'add',{text:'帮我梳理今天最重要的一件事'})).ok,true);
 assert.equal((await request(opened.links,'add',{text:'https://example.com/'})).ok,true);
 assert.equal((await request(opened.links,'add',{text:'https://example.com/'})).error,'invalid_or_duplicate_link');
 assert.equal((await request(opened.links,'add',{text:'http://127.0.0.1/'})).ok,false);
 const timerSnap=await run(opened.pomodoro,'floatingAPI.timerGet()');
 assert.equal((await run(opened.pomodoro,`floatingAPI.timerCommand({action:'start',mode:'countdown',seconds:10,revision:${timerSnap.revision}})`)).ok,true);await pause(1200);
 const activeTimer=await run(opened.pomodoro,'floatingAPI.timerGet()');assert.equal(activeTimer.active.running,true);assert.ok(activeTimer.active.currentMs>=1000);
 await run(opened.pomodoro,`floatingAPI.timerCommand(${JSON.stringify({action:'finish',revision:activeTimer.revision,id:activeTimer.active.id})})`);
 await request(opened.music,'play');assert.equal(musicCalls.length,1);
 await request(opened.credentials,'add',{service:'测试服务',account:'test-user',password:'fixture-only-secret'});
 const credentials=await snapshot(opened.credentials);assert.equal(credentials.items.length,1);assert.ok(!JSON.stringify(credentials).includes('fixture-only-secret'));
 await request(opened.credentials,'copy',{id:'vault-test',field:'password'});assert.equal(copied.length,1);
 assert.equal((await run(opened.windows,'floatingAPI.listWindows()')).items[0].id,'window-test');
 assert.equal((await snapshot(opened.gallery)).count,0);
 mock('settings:get',()=>({features:{clip:true}}));mock('clipboard:write',(_e,value)=>{copied.push(value);return true;});
 await run(host,`clipHistory=[{id:'clip-test',type:'text',text:'仅限测试的剪贴记录',timestamp:Date.now()}];void 0;`);
 await open('clip');assert.equal((await snapshot(opened.clip)).items.length,1);
 await request(opened.clip,'copy',{id:'clip-test'});assert.equal(copied.at(-1).text,'仅限测试的剪贴记录');
 await request(opened.clip,'delete',{id:'clip-test'});assert.equal((await snapshot(opened.clip)).items.length,0);
 // Replacing an image preserves its id; the change event must invalidate the image cache.
 let galleryImage='data:image/png;base64,first';
 mock('mirror:get-gallery',()=>({activeId:'image-test',items:[{id:'image-test'}]}));mock('mirror:get-image',()=>galleryImage);
 assert.equal((await snapshot(opened.gallery)).image,galleryImage);galleryImage='data:image/png;base64,second';host.webContents.send('mirror:gallery-changed',{activeId:'image-test',items:[{id:'image-test'}]});await pause(40);
 assert.equal((await snapshot(opened.gallery)).image,galleryImage);
 mock('mirror:get-gallery',()=>({activeId:null,items:[]}));host.webContents.send('mirror:gallery-changed',{activeId:null,items:[]});
 // Failed saves do not clear the form, and docking protects unsubmitted text.
 await wait(()=>run(opened.commands,`floatingAPI.packsGet().then(s=>String(s.revision)===document.querySelector('.material-packs').dataset.revision)`),'wait for shared material revision');
 await run(opened.commands,`[...document.querySelectorAll('button')].find(b=>b.textContent==='新增').click();document.querySelector('[name=name]').value='草稿测试';const input=document.querySelector('[name=text]');input.value='未保存的草稿';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('float-dock').click();`);
 await wait(()=>run(opened.commands,`document.querySelector('.mp-status').textContent.includes('保存')`));assert.equal(opened.commands.isDestroyed(),false);
 const originalRename=fs.renameSync;fs.renameSync=(a,b)=>{if(b.endsWith('material-packs-v1.json'))throw Error('disk failure');return originalRename(a,b);};
 await run(opened.commands,`document.querySelector('form').requestSubmit()`);
 await wait(()=>run(opened.commands,`document.querySelector('.mp-status').classList.contains('error')`));
 assert.equal(await run(opened.commands,`document.querySelector('[name=text]').value`),'未保存的草稿');
 fs.renameSync=originalRename;
 await run(opened.commands,`document.querySelector('form').requestSubmit()`);
 await wait(()=>run(opened.commands,`!document.querySelector('[name=text]')`));
 // Clear data survives hostile text; no rendered markup injection.
 await request(opened.commands,'add',{text:'<img src=x onerror=alert(1)>'});await pause(1100);
 assert.equal(await run(opened.commands,`document.querySelectorAll('.mp-list img').length`),0);
 for(const id of ['todo','credentials']){const w=opened[id],b=w.getBounds();w.setSize(320,360);await pause(80);assert.equal(await run(w,`document.documentElement.scrollWidth<=innerWidth`),true);assert.equal(await run(w,`getComputedStyle(document.querySelector('.module-float,.material-packs')).overflowY`),'auto');w.setBounds(b);}
 const captureDir=process.env.PANEL_MODULE_CAPTURE_DIR;
 if(captureDir){fs.mkdirSync(captureDir,{recursive:true});for(const theme of ['white','obsidian']){
   await run(host,`PanelAppearance.setTheme('${theme}')`);await pause(1200);
   for(const id of ['todo','commands','pomodoro'])fs.writeFileSync(path.join(captureDir,`${theme}-${id}.png`),(await opened[id].webContents.capturePage()).toPNG());
 }}
 for(const w of floats())await run(w,`document.getElementById('float-dock').click()`);
 await wait(()=>floats().length===0);
 BrowserWindow.prototype.show=originalShow;
 assert.deepEqual(errors.filter(v=>!v.includes('Autofill')&&!v.includes('ERR_INVALID_URL')),[]);
 console.log('PASS module floats: 9 concurrent real windows, shared CRUD, timer, scoped IPC, key privacy, clipboard opt-in/copy/delete, gallery cache invalidation, dirty/failed-save protection, narrow scrolling and themes. External services are fixtures.');
 app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
