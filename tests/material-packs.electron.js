'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow,ipcMain,clipboard,safeStorage,dialog,nativeImage}=require('electron');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'panel-materials-ui-'));
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=directory;
delete process.env.NOTCH_LLM_API_KEY;global.fetch=async()=>{throw Error('no_network_in_test');};
BrowserWindow.prototype.show=function(){};
let copied='';clipboard.writeText=t=>{copied=t;};clipboard.readText=()=>copied;clipboard.clear=()=>{copied='';};
// Synthetic encryption only in isolated tests, never the real vault or system keychain.
safeStorage.isEncryptionAvailable=()=>true;safeStorage.encryptString=t=>Buffer.from(t);safeStorage.decryptString=b=>b.toString();
const runtime=require('../main'),run=(w,c)=>w.webContents.executeJavaScript(c,true).catch(e=>{console.error('UI expression failed:',c.slice(0,260));throw e;}),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let n=0;n<220;n++){try{const r=await fn();if(r)return r;}catch{}await pause(30);}throw Error('materials UI timeout');}
async function click(w,text){return run(w,`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}&&b.getClientRects().length)?.click()`);}
async function main(){
 await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));await wait(()=>run(host,'!!window.MaterialPacksHome&&!!window.CredentialCardsHome'));host.hide();host.isVisible=()=>true;host.focus=()=>{};
 const errors=[];host.webContents.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m);});await run(host,'setMode(true)');
 const old=await run(host,'localStorage.getItem("notch-home-commands")');assert.equal((await run(host,'notchAPI.packsGet()')).migrated,true);
 await run(host,`notchAPI.packsSelect('')`);const win=await wait(async()=>{for(const w of BrowserWindow.getAllWindows())if(w!==host&&w.webContents.getURL().endsWith('/renderer/floating.html')&&(await run(w,'floatingAPI.request({action:"identity"})')).id==='commands')return w;});
 await wait(()=>run(win,'!!document.querySelector(".material-packs")'));win.setSize(520,650);if(!await run(win,'!!document.querySelector(".mp-form")'))await click(win,'新增');
 await run(win,`document.querySelector('input[name=name]').value='文章润色';document.querySelector('textarea[name=text]').value='请以 {{风格}} 润色：{{原文}}';document.querySelector('textarea[name=steps]').value='检查原意\\n输出正文';document.querySelector('.mp-form').requestSubmit()`);
 await wait(async()=>(await run(host,'notchAPI.packsGet()')).items.length===1);await wait(()=>run(win,'!!document.querySelector(".mp-open")'));assert.equal(await run(host,'localStorage.getItem("notch-home-commands")'),old);
 const item=(await run(host,'notchAPI.packsGet()')).items[0];await click(win,'文章润色');await wait(()=>run(win,'!!document.querySelector("textarea[name=原文]")'));
 await run(win,`document.querySelector('textarea[name=风格]').value='自然';document.querySelector('textarea[name=原文]').value='这是我的草稿';document.querySelector('textarea[name=原文]').dispatchEvent(new Event('input'))`);await click(win,'复制');await wait(()=>copied.includes('这是我的草稿'));assert.ok(copied.includes('固定步骤'));
 const before=await run(win,'floatingAPI.packsGet()');assert.equal(before.items[0].text,item.text);
 await click(win,'放弃本次输入');await click(win,'编辑');await run(win,`document.querySelector('input[name=name]').value='保留草稿';document.querySelector('input[name=name]').dispatchEvent(new Event('input'))`);
 await run(host,`notchAPI.packsCommand({action:'save',revision:${before.revision},id:${JSON.stringify(item.id)},name:'其他窗口修改',text:'原稿',steps:'',shortcut:'',documentIds:[]})`);await run(win,`document.querySelector('.mp-form').requestSubmit()`);await pause(100);assert.equal(await run(win,'document.querySelector("input[name=name]").value'),'保留草稿');assert.ok((await run(win,'document.querySelector(".mp-status").textContent')).includes('另一处'));
 await click(win,'放弃编辑');await wait(()=>run(win,'!!document.querySelector(".mp-open")'));await click(win,'其他窗口修改');
 ipcMain.removeHandler('packs:generate');let calls=0,fail=false;ipcMain.handle('packs:generate',(_e,p)=>{calls++;assert.equal(p.confirmed,true);return fail?{ok:false,error:'generation_failed'}:{ok:true,text:'模拟生成的正文',model:'fixture-model'};});
 await run(win,`[...document.querySelectorAll('summary')].find(e=>e.textContent==='使用 AI 生成').parentElement.open=true`);
 await click(win,'生成');assert.equal(calls,0);await run(win,`document.querySelector('.mp-check input').checked=true`);await click(win,'生成');await wait(()=>run(win,'document.querySelector("textarea[name=output]").value.includes("模拟")'));fail=true;await click(win,'生成');await pause(70);assert.equal(await run(win,'document.querySelector("textarea[name=output]").value'),'模拟生成的正文');
 const capture=path.join(__dirname,'../docs/evidence/stage31');fs.mkdirSync(capture,{recursive:true});
 for(const theme of ['white','obsidian']){await run(win,`document.documentElement.dataset.theme='${theme}'`);await pause(80);assert.equal(await run(win,'document.documentElement.scrollWidth<=innerWidth'),true);fs.writeFileSync(path.join(capture,theme+'-materials.png'),(await win.capturePage()).toPNG());}
 await click(win,'放弃本次输入');win.destroy();
 const textFile=path.join(directory,'fixture.txt');fs.writeFileSync(textFile,'选定文档内容');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[textFile]});const imported=await run(host,'notchAPI.packsImport()');assert.equal(imported.ok,true);assert.equal(imported.files[0].text,'选定文档内容');assert.equal(imported.files[0].source,undefined);
 await run(host,`setActiveTab('credentials')`);await click(host,'新增');await run(host,`const r=document.querySelector('.credential-cards-root');r.querySelector('input[name=service]').value='测试 API';r.querySelector('input[name=password]').value='fixture-secret';r.querySelector('input[name=website]').value='https://example.com';r.querySelector('form').requestSubmit()`);
 await wait(async()=>(await run(host,'notchAPI.listCredentials()')).items.length===1);const credential=(await run(host,'notchAPI.listCredentials()')).items[0];assert.equal(credential.password,undefined);
 await click(host,'复制密钥');await wait(()=>copied==='fixture-secret');assert.equal(runtime.materialPacks.isProtected(copied),true);
 await click(host,'查看 / 编辑');await wait(()=>run(host,'!document.querySelector(".credential-cards-root form").hidden'));assert.equal(await run(host,'document.querySelector(".credential-cards-root input[name=password]").type'),'password');
 await click(host,'查看已保存密钥');await wait(()=>run(host,'document.querySelector(".credential-cards-root input[name=password]").type==="text"'));await run(host,'window.dispatchEvent(new Event("blur"))');assert.equal(await run(host,'document.querySelector(".credential-cards-root input[name=password]").value'),'');await click(host,'放弃编辑');
 await run(host,'PanelAppearance.setTheme("white");setActiveTab("credentials")');await pause(900);
 assert.equal(await run(host,`(()=>{const r=document.querySelector('.credential-cards-root').getBoundingClientRect();return r.top>50&&r.bottom<=innerHeight&&r.height>300;})()`),true,'Credential page must be visible inside the panel, not below it');
 fs.writeFileSync(path.join(capture,'credentials.png'),(await host.capturePage()).toPNG());
 fs.writeFileSync(path.join(directory,'credentials.vault.json'),'broken');assert.equal((await run(host,'notchAPI.listCredentials()')).error,'vault_unreadable');assert.equal((await run(host,`notchAPI.saveCredential({service:'another',password:'fixture'})`)).ok,false);assert.equal(fs.readFileSync(path.join(directory,'credentials.vault.json'),'utf8'),'broken');
 for(const color of [[230,225,210,255],[70,90,110,255]]){const buffer=Buffer.alloc(64*64*4);for(let i=0;i<buffer.length;i+=4)color.forEach((v,k)=>buffer[i+k]=v);const source=nativeImage.createFromBitmap(buffer,{width:64,height:64}).toDataURL();assert.equal((await run(host,`notchAPI.referenceImport(${JSON.stringify(source)})`)).ok,true);}
 await run(host,`Notebook.detach('module','gallery')`);const gallery=await wait(async()=>{for(const w of BrowserWindow.getAllWindows())if(w!==host&&w.webContents.getURL().endsWith('/renderer/floating.html')&&(await run(w,'floatingAPI.request({action:"identity"})')).id==='gallery')return w;});await wait(()=>run(gallery,'!!document.querySelector(".ref-stage img[src]")'));gallery.setSize(640,500);await click(gallery,'双图对照');await wait(()=>run(gallery,'document.querySelectorAll(".ref-stage img[src]").length===2'));
 await run(gallery,`const z=document.querySelector('input[type=range]');z.value='3';z.dispatchEvent(new Event('input'))`);assert.equal(await run(gallery,'document.querySelector(".ref-stage img").style.width'),'300%');await pause(80);fs.writeFileSync(path.join(capture,'reference-compare.png'),(await gallery.capturePage()).toPNG());assert.equal(await run(gallery,'document.documentElement.scrollWidth<=innerWidth'),true);
 const foreign=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../renderer/floating-preload.js'),sandbox:true,contextIsolation:true}});await foreign.loadFile(path.join(__dirname,'../renderer/float-dock.html'));for(const expr of ['floatingAPI.packsGet()','floatingAPI.listCredentials()','floatingAPI.referenceGet()'])assert.equal((await run(foreign,expr)).error,'forbidden');foreign.destroy();gallery.destroy();
 assert.deepEqual(errors,[]);console.log('PASS stage31 isolated Electron: material save/use/conflict/AI consent and failed output retention; import; secret masking and corrupt-vault guard; dual reference zoom; scoped IPC. AI, keychain, clipboard and image data are synthetic.');app.exit(0);
}
main().catch(e=>{console.error(e);app.exit(1);});
