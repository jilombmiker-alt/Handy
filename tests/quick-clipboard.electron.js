'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow,ipcMain,globalShortcut,clipboard}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-clipboard-test-'));
delete process.env.NOTCH_LLM_API_KEY;delete process.env.DASHSCOPE_API_KEY;
// No system clipboard reads/writes or real global hotkeys in this isolated fixture.
let copied='',registered=new Map();
clipboard.readText=()=>copied;clipboard.writeText=v=>{copied=v;};clipboard.availableFormats=()=>[];
globalShortcut.isRegistered=k=>registered.has(k);globalShortcut.register=(k,fn)=>{if(registered.has(k))return false;registered.set(k,fn);return true;};globalShortcut.unregister=k=>registered.delete(k);globalShortcut.unregisterAll=()=>registered.clear();
require('../main-modifier-shortcut').createModifierShortcut=()=>({start:()=>true,stop(){},error:''});
require('../main');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,code)=>w.webContents.executeJavaScript(code,true).catch(e=>{console.error('Fixture failed:',code.slice(0,250));throw e;});
async function wait(fn,label='timeout'){for(let i=0;i<160;i++){try{const v=await fn();if(v)return v;}catch{}await delay(40);}throw Error(label);}
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
async function main(){
  await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(()=>run(host,'!!window.QuickClipboard'));host.hide();host.webContents.setBackgroundThrottling(false);host.removeAllListeners('blur');
  const errors=[];host.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  const req=(w,p)=>run(w,`${w===host?'notchAPI.quickClipboard':'clipAPI.request'}(${JSON.stringify(p)})`);
  check((await run(host,'notchAPI.openQuickClipboard()')).error==='feature_disabled','Default is off');check(!registered.has('Alt+V'),'Default key unregistered');
  // Avoid native panel shortcut registration side effects; main modifier monitor is off in test mode.
  check((await run(host,`notchAPI.setFeature('clip',true)`)).ok,'Enable feature');check(registered.has('Alt+V'),'Opt-in global key');
  await run(host,`addClipEntry({type:'text',text:'最新的一条想法'});addClipEntry({type:'url',text:'https://example.com/design'});addClipEntry({type:'text',text:${JSON.stringify('  客服回复\n\n第一步：确认需求\n第二步：给出方案\n  ')}})`);
  check((await run(host,'notchAPI.openQuickClipboard()')).ok,'Open independent picker');const picker=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/quick-clipboard.html')));
  await wait(()=>run(picker,'!!document.querySelectorAll(".qc-row").length'));
  check(await run(picker,'document.activeElement===quickClipboardView.search'),'Focus starts in search');
  const find=await req(picker,{action:'get'});check(find.history.length===3,'Shared history');
  const first=await run(picker,'quickClipboardView.selected');
  await run(picker,`quickClipboardView.search.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));`);
  check(await run(picker,`quickClipboardView.selected!==${JSON.stringify(first)}`),'Down selects next row');
  await run(picker,`quickClipboardView.search.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));`);
  check(await run(picker,`quickClipboardView.selected===${JSON.stringify(first)}`),'Up returns to first row');
  check((await run(host,'notchAPI.openQuickClipboard()')).ok,'Reopen succeeds');check(BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/quick-clipboard.html')).length===1,'Picker is a singleton');
  await run(picker,`quickClipboardView.search.value='客服';quickClipboardView.search.dispatchEvent(new Event('input'));`);
  check(await run(picker,`document.querySelectorAll('.qc-row').length===1`),'Search narrows immediately');
  await run(picker,`quickClipboardView.search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));`);await delay(30);check(copied==='','IME Enter does not paste');
  await run(picker,`quickClipboardView.search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  await wait(()=>copied.includes('客服'));check(copied===find.history[0].text,'Whole text preserved');check(await run(picker,`document.querySelector('.qc-status').textContent.includes('无法确认')`),'Copy-only fallback visible without native target');
  const entry=find.history[0];
  await run(picker,`quickClipboardView.edit(quickClipboardView.rows()[0]);quickClipboardView.name.value='客服 SOP';quickClipboardView.name.dispatchEvent(new Event('input'));quickClipboardView.editor.requestSubmit();`);
  await wait(async()=>(await req(picker,{action:'get'})).snippets.length===1);checks++;
  const after=await req(picker,{action:'get'});check(after.snippets[0].text===entry.text,'Saved snippet not rewritten');
  check(await run(host,`JSON.parse(localStorage.getItem('notch-clip-snippets-v1')).length===1`),'Snippet committed to local storage');
  // Storage failures retain the editor and original data.
  await run(host,`window.originalClipSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='notch-clip-snippets-v1')throw Error('quota');return originalClipSet.call(this,k,v);};void 0;`);
  await run(picker,`quickClipboardView.edit(null);quickClipboardView.name.value='失败草稿';quickClipboardView.text.value='必须保留';quickClipboardView.text.dispatchEvent(new Event('input'));quickClipboardView.editor.requestSubmit();`);
  await wait(()=>run(picker,`quickClipboardView.status.textContent.includes('保存失败')`));check(await run(picker,`quickClipboardView.dirty&&quickClipboardView.text.value==='必须保留'`),'Failed save preserves draft');
  await run(host,`Storage.prototype.setItem=originalClipSet;void 0;`);await run(picker,`quickClipboardView.endEditor()`);
  const snippet=after.snippets[0];check((await req(picker,{action:'saveSnippet',key:'s:'+snippet.id,values:{name:'stale',text:'bad',revision:0}})).error==='conflict','Reject stale edit');
  check((await req(picker,{action:'clearHistory',values:{ids:after.history.map(v=>v.id)}})).error==='confirmation_required','Clear requires confirmation');
  await run(host,`addClipEntry({type:'text',text:'清空确认期间的新记录'})`);
  check((await req(picker,{action:'clearHistory',values:{confirmed:true,ids:after.history.map(v=>v.id)}})).ok,'Clear exact snapshot');
  const cleared=await req(picker,{action:'get'});check(cleared.history.length===1&&cleared.snippets.length===1,'New capture and snippets survive clear');
  registered.set('Alt+Q',()=>{});check((await req(picker,{action:'settings',changes:{shortcut:'Alt+Q'}})).error==='occupied','Real IPC conflict reports error');check(registered.has('Alt+V'),'Old key retained');
  await run(picker,`quickClipboardView.settings.open=true;quickClipboardView.keyInput.dispatchEvent(new KeyboardEvent('keydown',{key:'j',code:'KeyJ',altKey:true,bubbles:true}));`);
  check(await run(picker,`quickClipboardView.pendingKey==='Alt+J'`),'UI records new chord');
  check((await req(picker,{action:'settings',changes:{shortcut:'Alt+J'}})).ok,'Save custom chord');check(!registered.has('Alt+V')&&registered.has('Alt+J'),'Only replacement active');
  check((await req(picker,{action:'settings',changes:{shortcut:'Alt+V'}})).ok,'Restore default');
  await req(picker,{action:'settings',changes:{paused:true}});check((await req(picker,{action:'get'})).settings.paused,'Pause persisted');
  await req(picker,{action:'settings',changes:{paused:false}});
  // Explicit transfer, mocked link inspection never visits the network.
  ipcMain.removeHandler('links:inspect');ipcMain.handle('links:inspect',()=>({ok:false}));
  check((await req(picker,{action:'note',key:'s:'+snippet.id})).ok,'Transfer whole text to local note');
  await run(host,`addClipEntry({type:'url',text:'https://example.com/design'})`);const url=(await req(picker,{action:'get'})).history[0];
  check((await req(picker,{action:'link',key:'h:'+url.id})).ok,'Explicit link collection');
  // Seed visible fictional content for real Electron captures, never personal data.
  await run(host,`addClipEntry({type:'text',text:'今天先把登录页的交互梳理清楚，再补错误提示。'});addClipEntry({type:'text',text:'设计参考：圆角柔和一点，保留黑色细线，重点放在内容。'});addClipEntry({type:'file',fileId:'fixture-reference',fileNames:['项目交接清单.docx','界面说明.pdf']});`);
  await run(picker,`quickClipboardView.settings.open=false;quickClipboardView.actions.open=false;quickClipboardView.search.value='';quickClipboardView.selected='';quickClipboardView.say('');quickClipboardView.refresh()`);await delay(150);
  const dir=process.env.PANEL_CLIP_CAPTURE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'clip-evidence-'));fs.mkdirSync(dir,{recursive:true});
  for(const theme of ['white','obsidian']){await run(picker,`document.documentElement.dataset.theme='${theme}'`);await delay(80);fs.writeFileSync(path.join(dir,theme+'.png'),(await picker.webContents.capturePage()).toPNG());}
  picker.setSize(380,420);await run(picker,`document.documentElement.dataset.theme='white'`);await delay(100);fs.writeFileSync(path.join(dir,'narrow.png'),(await picker.webContents.capturePage()).toPNG());
  check(await run(picker,'document.documentElement.scrollWidth<=innerWidth'),'No horizontal overflow');
  const foreign=new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'../clipboard-preload.js'),contextIsolation:true,sandbox:true}});await foreign.loadURL('about:blank');check((await run(foreign,`clipAPI.request({action:'get'})`)).error==='forbidden','Foreign renderer cannot read clipboard');foreign.destroy();
  check((await run(host,`notchAPI.setFeature('clip',false)`)).ok,'Disable feature');check(!registered.has('Alt+V'),'Disable unregisters hotkey');check(!picker.isVisible(),'Disable hides picker');
  check(errors.length===0,errors.join('\n'));console.log(JSON.stringify({ok:true,checks,evidence:dir,physicalPaste:'not tested; native disabled in fixture'}));
  for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(0);
}
main().catch(error=>{console.error(error);for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(1);});
