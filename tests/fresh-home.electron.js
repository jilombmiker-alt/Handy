const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,screen}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-fresh-home-'));
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);});
require('../main');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<180;i++){const r=await fn();if(r)return r;await delay(30);}throw Error('timeout');}
async function run(){
 await app.whenReady();const w=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')&&!w.webContents.isLoadingMainFrame()));
 const js=s=>w.webContents.executeJavaScript(s);await until(()=>js('!!window.ToolLauncher?.entry'));
 const captures=fs.mkdtempSync(path.join(os.tmpdir(),'handy-fresh-captures-'));console.log(captures);
 await js('ToolLauncher.open(null)');
 const dirty=()=>js(`(()=>{const e=document.getElementById('entry-input');e.value='未提交的想法，需要保留';e.dispatchEvent(new Event('input'));ToolLauncher.entry.showHistory();})()`);
 const clean=async()=>{assert.deepEqual(await js(`({text:document.getElementById('entry-input').value,history:document.querySelector('.entry-library').hidden,result:document.querySelector('.entry-result').hidden,mode:document.getElementById('entry-send').getAttribute('aria-label')})`),{text:'',history:true,result:true,mode:'发送'});await until(()=>w.getBounds().height===Math.min(280,screen.getDisplayMatching(w.getBounds()).workArea.height-24));};
 await dirty();await js(`ToolLauncher.open('settings')`);await js(`document.querySelector('.launcher-back').click()`);await until(()=>js('ToolLauncher.current===null'));await clean();
 assert.equal(await js(`JSON.parse(localStorage.getItem('handy-entry-history-v1')).some(r=>r.input==='未提交的想法，需要保留')`),true);
 await dirty();await js(`setMode(false)`);await js(`setMode(true)`);await clean();
 await dirty();await js(`ToolLauncher.openPayload({kind:'resume'})`);await clean();
 // A dedicated history visit still works; only the next return resets it.
 await js(`ToolLauncher.entry.showHistory()`);assert.equal(await js(`document.querySelector('.entry-library').hidden`),false);
 await js(`ToolLauncher.open(null)`);await clean();
 await until(()=>js(`innerHeight===${Math.min(280,screen.getDisplayMatching(w.getBounds()).workArea.height-24)}`));
 await js(`document.getElementById('entry-input').focus()`);
 const geometry=await js(`(()=>{const e=document.getElementById('entry-input'),b=document.getElementById('entry-send').getBoundingClientRect(),s=getComputedStyle(e);return {bottom:innerHeight-b.bottom,outline:s.outlineWidth,shadow:s.boxShadow,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
 assert.ok(geometry.bottom>=12&&geometry.bottom<=35,JSON.stringify(geometry));assert.equal(geometry.overflow,false);
 // Hidden Electron windows do not reliably receive native :focus. Check the
 // matching authored focus rule here; inspect real focus after installation.
 assert.match(await js(`Array.from(document.styleSheets).flatMap(s=>Array.from(s.cssRules||[])).find(r=>r.selectorText==='body.launcher-enabled #entry-input:focus').style.getPropertyValue('outline')`),/^1px solid/);
 for(const [theme,width,height,name] of [['pure-white',720,280,'white'],['obsidian',390,280,'dark-narrow']]){await js(`PanelAppearance.setTheme('${theme}');void 0;`);w.setSize(width,height);await delay(180);fs.writeFileSync(path.join(captures,name+'.png'),(await w.webContents.capturePage({},{stayHidden:true})).toPNG());assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth`),true);}
 // Reset does not stop or lose an active voice session; the second press still stops once.
 await js(`window.__commands=[];window.PanelRecording={command:async(action)=>{__commands.push(action);return action==='assistant-start'?{ok:true,recordingId:'test-voice'}:{ok:true,status:'recording'};}};void 0;`);
 await js(`ToolLauncher.entry.hotkey('short')`);assert.equal(await js(`ToolLauncher.entry.resetHome()`),false);
 await js(`ToolLauncher.openPayload({kind:'voice',gesture:'short'})`);
 assert.equal(await js(`__commands.filter(x=>x==='assistant-stop').length`),1);
 console.log('S64 PASS: back, reopen, resume clear home; history preserved and explicitly accessible; compact/focus/white/dark/narrow; active voice kept and second press stops once. No real microphone.');app.exit(0);
}
run().catch(e=>{console.error(e);app.exit(1);});
