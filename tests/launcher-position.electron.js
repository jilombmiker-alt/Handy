const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,screen}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-position-'));
let showCalls=0;
app.on('browser-window-created',(_e,w)=>{w.show=()=>{showCalls++;};w.showInactive=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);});
require('../main');const M=require('../renderer/launcher-model');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await delay(30);}throw Error('timeout');}
async function run(){
 await app.whenReady();const w=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')&&!w.webContents.isLoadingMainFrame()));
 const js=s=>w.webContents.executeJavaScript(s);await until(()=>js('!!ToolLauncher.entry'));await js('ToolLauncher.open(null)');
 const area=screen.getDisplayMatching(w.getBounds()).workArea;
 assert.deepEqual(w.getBounds(),M.bounds(area,'home'));assert.equal(w.isMovable(),true);
 assert.equal(await js('getComputedStyle(document.querySelector(".launcher-header")).getPropertyValue("-webkit-app-region")'),'drag');
 assert.equal(await js('getComputedStyle(document.getElementById("launcher-menu-toggle")).getPropertyValue("-webkit-app-region")'),'no-drag');
 const manual={...w.getBounds(),x:area.x+50,y:area.y+50};
 // Native event simulation, not a claim that a physical mouse drag was observed.
 w.emit('will-move',{},manual);w.setBounds(manual);
 await js('notchAPI.launcherLayout("home-reply")');assert.deepEqual(w.getBounds(),M.placedBounds(area,'home-reply',manual));
 await js('ToolLauncher.open("settings")');assert.deepEqual(w.getBounds(),M.placedBounds(area,'settings',manual));
 await js('ToolLauncher.open(null)');assert.deepEqual(w.getBounds(),M.placedBounds(area,'home',manual));
 assert.equal(await js('(async()=>{const r=await notchAPI.launcherPosition("right");return r.ok;})()'),true);
 assert.equal(w.getBounds().x,area.x+area.width-w.getBounds().width-12);
 await js('notchAPI.launcherPosition("center")');assert.deepEqual(w.getBounds(),M.bounds(area,'home'));
 assert.equal(await js('(async()=>{const r=await notchAPI.launcherPosition("invalid");return r.ok;})()'),false);
 await js('notchAPI.launcherPosition("left")');await js('setMode(false)');await js('setMode(true)');
 assert.deepEqual(w.getBounds(),M.bounds(area,'home'));
 assert.equal(await js('document.querySelector(".entry-library").hidden'),true);
 const before=showCalls;
 await js('window.savedRAF=requestAnimationFrame;window.requestAnimationFrame=()=>999999;void 0;');
 await js('setMode(false)');await js('setMode(true)');
 assert.ok(showCalls>before,'queued expansion must show a window hidden by preceding collapse');
 assert.equal(await js('document.getElementById("app").classList.contains("expanded")'),true,'dropped animation frames cannot stall reopening');
 await js('window.requestAnimationFrame=savedRAF;void 0;');
 console.log('PASS launcher position: centered recall, native drag region, no-drag buttons, manual anchor across reply/settings/back, edge bounds, menu reset, invalid action, fresh reopen. Native drag event simulated; isolated data.');
}
run().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
