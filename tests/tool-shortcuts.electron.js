const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-key-test-'));
delete process.env.DASHSCOPE_API_KEY;delete process.env.NOTCH_LLM_API_KEY;
require('../main');
const run=(w,code)=>w.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<200;i++){const v=await fn();if(v)return v;await pause(30);}throw Error('wait_timeout');}
async function main(){
 await app.whenReady();
 const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
 await wait(()=>run(host,'!!window.ToolShortcutModel && !!window.Notebook'));
 const native=require('../native/.build/modifier-shortcut.node');assert.equal(typeof native.start,'function');assert.equal(native.poll(),0);native.stop();
 host.hide();host.removeAllListeners('blur');host.setIgnoreMouseEvents(true);host.webContents.setBackgroundThrottling(false);
 host.show=()=>{};host.focus=()=>{};host.isVisible=()=>true;
 const originalShow=BrowserWindow.prototype.show;BrowserWindow.prototype.show=function(){this.setIgnoreMouseEvents(true);};
 await run(host,`window.__hasFocus=true;document.hasFocus=()=>window.__hasFocus;window.__opens=[];const originalDetach=Notebook.detach;Notebook.detach=async(...args)=>{window.__opens.push(args);return originalDetach(...args);};setMode(true)`);await pause(450);
 const key=async(letter,target='document',extra='')=>{await run(host,`${target}.dispatchEvent(new KeyboardEvent('keydown',{key:'${letter}',code:'Key${letter.toUpperCase()}',bubbles:true,cancelable:true,${extra}}))`);await pause(160);};
 const count=()=>run(host,'window.__opens.length');
 for(const extra of ['repeat:true','isComposing:true'])await key('n','document',extra);
 await key('n',`document.getElementById('home-note')`);assert.equal(await count(),0,'Typing cannot open tools');
 await run(host,'window.__hasFocus=false');await key('n');assert.equal(await count(),0);await run(host,'window.__hasFocus=true');
 await key('n');await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/floating.html')));
 const floats=()=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/floating.html'));
 assert.equal(floats().length,1);const first=floats()[0];await key('n');assert.equal(floats().length,1);assert.equal(first.isDestroyed(),false,'Repeat locates, never docks');
 await run(host,`setActiveTab('settings');document.querySelector('.tool-shortcut-settings').open=true;document.querySelector('#tool-shortcut-fields .tool-shortcut-row button').click()`);
 await key('k',`document.querySelector('#tool-shortcut-fields .tool-shortcut-row button')`);
 await run(host,`document.getElementById('tool-shortcut-form').requestSubmit()`);
 assert.equal(await run(host,`JSON.parse(localStorage.getItem('notch-tool-shortcuts-v1')).quick`),'K');
 const before=await count();await key('n');assert.equal(await count(),before);await key('k');assert.equal(await count(),before+1);
 await run(host,`document.querySelector('#tool-shortcut-fields .tool-shortcut-row button').click()`);await key('r',`document.querySelector('#tool-shortcut-fields .tool-shortcut-row button')`);
 await run(host,`document.getElementById('tool-shortcut-form').requestSubmit()`);
 assert.equal(await run(host,`document.getElementById('tool-shortcut-status').textContent.includes('重复')`),true);
 assert.equal(await run(host,`JSON.parse(localStorage.getItem('notch-tool-shortcuts-v1')).quick`),'K');
 if(process.env.PANEL_KEY_CAPTURE_DIR){fs.mkdirSync(process.env.PANEL_KEY_CAPTURE_DIR,{recursive:true});for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}')`);await pause(200);fs.writeFileSync(path.join(process.env.PANEL_KEY_CAPTURE_DIR,`${theme}-shortcuts.png`),(await host.webContents.capturePage()).toPNG());}}
 await run(host,'setMode(false)');await pause(450);const hidden=await count();await key('k');assert.equal(await count(),hidden);
 BrowserWindow.prototype.show=originalShow;
 console.log('PASS shortcut Electron integration: native addon ABI, input/IME/repeat/focus guards, actual float deduplication without docking, configurable mapping persistence, conflict rejection and collapsed guard. Keyboard events are fixtures.');
 app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
