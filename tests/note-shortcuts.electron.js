'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain,globalShortcut,clipboard}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-note-shortcuts-'));
delete process.env.NOTCH_LLM_API_KEY;delete process.env.DASHSCOPE_API_KEY;
clipboard.availableFormats=()=>[];clipboard.readText=()=>'';clipboard.writeText=()=>{};
const keys=new Map();globalShortcut.register=(k,fn)=>{keys.set(k,fn);return true;};globalShortcut.unregister=k=>keys.delete(k);globalShortcut.unregisterAll=()=>keys.clear();globalShortcut.isRegistered=k=>keys.has(k);
require('../main-modifier-shortcut').createModifierShortcut=()=>({start:()=>true,stop(){},error:''});require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,s)=>w.webContents.executeJavaScript(s,true);
async function wait(fn){for(let i=0;i<250;i++){try{const v=await fn();if(v)return v;}catch{}await pause(30);}throw Error('wait_timeout');}
async function main(){
  await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(()=>run(host,'!!window.QuickClipboard&&!!window.Notebook'));host.hide();host.webContents.setBackgroundThrottling(false);
  const errors=[];host.webContents.on('console-message',(_e,level,text)=>{if(level>=3)errors.push(text);});
  let opened='';ipcMain.removeHandler('shell:openExternal');ipcMain.handle('shell:openExternal',(_e,url)=>{opened=url;});ipcMain.removeHandler('links:inspect');ipcMain.handle('links:inspect',()=>({ok:false}));
  const req=p=>run(host,`notchAPI.quickClipboard(${JSON.stringify(p)})`),archive=()=>run(host,`JSON.parse(localStorage.getItem('notch-note-archive-v1')||'[]')`);
  await run(host,`notchAPI.setFeature('clip',true)`);await req({action:'saveSnippet',values:{name:'设计思路',text:'  做一个干净的阅读界面。\n保留一点黑色细线。  '}});
  const snippet=(await req({action:'get'})).snippets[0],key='s:'+snippet.id;
  const results=await Promise.all([req({action:'note',key}),req({action:'note',key})]);assert.ok(results.every(r=>r.ok));assert.equal(results[0].noteId,results[1].noteId);assert.equal((await archive()).length,1);
  const noteId=results[0].noteId;assert.equal((await archive())[0].content,snippet.text);
  await run(host,`(()=>{const n=Notebook.get(${JSON.stringify(noteId)});return Notebook.save({...n,content:'用户修改的正文'},NotebookModel.version(n));})()`);
  assert.equal((await req({action:'note',key})).noteId,noteId);assert.equal((await archive())[0].content,'用户修改的正文');
  host.reload();await wait(()=>run(host,'!!window.QuickClipboard&&!!window.Notebook'));assert.equal((await req({action:'note',key})).noteId,noteId);assert.equal((await archive()).length,1);
  await req({action:'saveSnippet',key,values:{name:'设计思路',text:'改过的片段版本',revision:snippet.timestamp}});
  await run(host,`window.savedSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='notch-note-archive-v1')throw Error('synthetic quota');return savedSet.call(this,k,v);};void 0`);
  assert.equal((await req({action:'note',key})).ok,false);assert.equal((await archive()).length,1);
  await run(host,'Storage.prototype.setItem=savedSet;void 0');const updated=await req({action:'note',key});assert.ok(updated.ok);assert.notEqual(updated.noteId,noteId);assert.equal((await archive()).length,2);
  await run(host,'notchAPI.openQuickClipboard()');const picker=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/quick-clipboard.html')));await wait(()=>run(picker,'typeof quickClipboardView!=="undefined"'));
  await run(picker,`quickClipboardView.refresh()`);await run(picker,`quickClipboardView.selected=${JSON.stringify(key)};quickClipboardView.draw();quickClipboardView.use('note')`);
  assert.equal(await run(picker,'quickClipboardView.noteOpen.hidden'),false);assert.match(await run(picker,'quickClipboardView.status.textContent'),/没有重复/);
  await run(picker,'quickClipboardView.noteOpen.click()');const note=await wait(async()=>{for(const w of BrowserWindow.getAllWindows())if(w!==host&&w!==picker&&w.webContents.getURL().endsWith('/renderer/floating.html')&&await run(w,`document.querySelector('[data-field="content"]')?.value==='改过的片段版本'`))return w;});
  await req({action:'openNote',values:{noteId:updated.noteId}});assert.equal(BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/floating.html')).length,1);
  const linked=await run(host,`LinkLibraryHost.add('https://example.com/reference')`);assert.ok(linked.id);
  const patch=changes=>run(host,`LinkLibraryHost.command({action:'patch',id:${JSON.stringify(linked.id)},revision:LinkLibraryHost.snapshot().revision,changes:${JSON.stringify(changes)}})`);
  await patch({title:'阅读界面参考',note:'留白和细线可参考。',noteIds:[updated.noteId]});await wait(()=>run(note,`document.querySelector('.nb-linked-list')?.textContent.includes('阅读界面参考')`));
  assert.equal(await run(note,`document.querySelector('[data-field="content"]').value`),'改过的片段版本');
  await run(note,`document.querySelector('[data-link-id]').click()`);await wait(()=>opened==='https://example.com/reference');
  const foreign=await run(host,`LinkLibraryHost.add('https://example.com/unrelated')`);
  assert.equal((await run(note,`floatingAPI.request({action:'open-resource',linkId:${JSON.stringify(foreign.id)}})`)).error,'not_found');
  // An unsaved body and caret survive resource refresh, even while persistence fails.
  await run(host,`Storage.prototype.setItem=function(k,v){if(k==='notch-note-archive-v1')throw Error('synthetic quota');return savedSet.call(this,k,v);};void 0`);
  await run(note,`const t=document.querySelector('[data-field="content"]');t.value='正在输入，不能被资料更新覆盖';t.focus();t.setSelectionRange(3,3);t.dispatchEvent(new Event('input',{bubbles:true}));`);
  await patch({note:'更新后的参考备注'});await wait(()=>run(note,`document.querySelector('.nb-linked-list').textContent.includes('更新后的参考备注')`));
  assert.equal(await run(note,`document.querySelector('[data-field="content"]').value`),'正在输入，不能被资料更新覆盖');assert.equal(await run(note,`document.querySelector('[data-field="content"]').selectionStart`),3);
  await pause(220);await run(host,'Storage.prototype.setItem=savedSet;void 0');await run(note,`document.querySelector('[data-nb="save"]').click()`);await wait(async()=>(await archive()).some(n=>n.id===updated.noteId&&n.content==='正在输入，不能被资料更新覆盖'));
  await run(host,`window.savedSnapshot=LinkLibraryHost.snapshot;LinkLibraryHost.snapshot=()=>{throw Error('synthetic unavailable');};notchAPI.broadcastFloat({kind:'note',linksChanged:true});void 0`);
  await wait(()=>run(note,`document.querySelector('.nb-linked').textContent.includes('重新读取')`));await run(host,'LinkLibraryHost.snapshot=savedSnapshot;void 0');await run(note,`document.querySelector('.nb-linked-list button').click()`);await wait(()=>run(note,`!!document.querySelector('[data-link-id]')`));
  const dir=process.env.PANEL_NOTE_SHORTCUTS_CAPTURE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'note-shortcuts-evidence-'));fs.mkdirSync(dir,{recursive:true});note.show();
  for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}')`);await pause(100);fs.writeFileSync(path.join(dir,`note-links-${theme}.png`),(await note.webContents.capturePage()).toPNG());}
  note.setSize(340,420);note.webContents.setZoomFactor(1.2);await run(note,`document.querySelector('[data-link-id]').focus()`);assert.equal(await run(note,'document.documentElement.scrollWidth<=innerWidth'),true);assert.equal(await run(note,`document.activeElement.getBoundingClientRect().bottom<=innerHeight`),true);fs.writeFileSync(path.join(dir,'note-links-narrow.png'),(await note.webContents.capturePage()).toPNG());
  picker.show();picker.setSize(400,520);await run(picker,'quickClipboardView.actions.open=false');fs.writeFileSync(path.join(dir,'clip-saved.png'),(await picker.webContents.capturePage()).toPNG());
  await patch({noteIds:[]});await wait(()=>run(note,`document.querySelector('.nb-linked').hidden`));assert.equal((await run(note,`floatingAPI.request({action:'open-resource',linkId:${JSON.stringify(linked.id)}})`)).error,'not_found');
  // Removing a transferred note does not resurrect it on Open. Explicit transfer may recreate it.
  await run(host,`localStorage.setItem('notch-note-archive-v1',JSON.stringify(JSON.parse(localStorage.getItem('notch-note-archive-v1')).filter(n=>n.id!==${JSON.stringify(updated.noteId)})))`);
  assert.equal((await req({action:'openNote',values:{noteId:updated.noteId}})).error,'not_found');assert.equal((await archive()).length,1);assert.ok((await req({action:'note',key})).ok);assert.equal((await archive()).length,2);
  assert.deepEqual(errors,[]);console.log(`PASS note shortcuts: durable dedupe, concurrent/reload retry, edit preservation, quota recovery, open singleton, live references, caret, scoped links, failure retry, detach and deletion. Synthetic evidence: ${dir}`);
  for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(0);
}
main().catch(e=>{console.error(e);for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(1);});
