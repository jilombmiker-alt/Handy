const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,screen}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-edge-test-'));
delete process.env.NOTCH_LLM_API_KEY;delete process.env.DASHSCOPE_API_KEY;
require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,code)=>w.webContents.executeJavaScript(code,true);
async function wait(fn,label='wait_timeout'){for(let i=0;i<250;i++){const v=await fn();if(v)return v;await pause(30);}throw Error(label);}
async function main(){
 await app.whenReady();
 const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
 await wait(()=>run(host,'!!window.PanelPlacement'));
 const cancelOnBlur=host.listeners('blur').find(fn=>fn.name==='cancel');assert.ok(cancelOnBlur);
 host.hide();host.setIgnoreMouseEvents(true);host.removeAllListeners('blur');host.webContents.setBackgroundThrottling(false);
 host.show=()=>{};host.showInactive=()=>{};host.focus=()=>{};host.isVisible=()=>true;
 const originalCursor=screen.getCursorScreenPoint,area=screen.getPrimaryDisplay().workArea;
 let cursor={x:area.x+400,y:area.y+200};screen.getCursorScreenPoint=()=>cursor;
 const settled=()=>wait(()=>run(host,'!modeBusy && pendingMode===null'),'mode settled');
 const expanded=async()=>{await settled();await run(host,'setMode(true)');await settled();await wait(()=>host.getBounds().height>400,'native expanded');};
 await expanded();
 assert.equal((await run(host,`notchAPI.panelPosition('get')`)).placement,null);
 const before=host.getBounds();
 const start=await run(host,`notchAPI.panelDrag('start')`);assert.equal(start.ok,true);
 assert.equal((await run(host,`notchAPI.panelDrag('end',{token:'wrong'})`)).error,'invalid_session');
 cursor={x:cursor.x+40,y:cursor.y+90};await pause(60);
 assert.notDeepEqual(host.getBounds(),before);
 const moved=await run(host,`notchAPI.panelDrag('end',{token:'${start.token}'})`);assert.equal(moved.ok,true);assert.equal(moved.placement.edge,null);
 const free=host.getBounds();await run(host,'setMode(false)');await pause(250);await expanded();assert.deepEqual(host.getBounds(),free);
 const cancel=await run(host,`notchAPI.panelDrag('start')`);cursor={x:cursor.x-20,y:cursor.y+40};await pause(50);cancelOnBlur.call(host);await pause(50);assert.deepEqual(host.getBounds(),free);
 assert.equal((await run(host,`notchAPI.panelDrag('end',{token:'${cancel.token}'})`)).error,'invalid_session');
 const edgeWindow=()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/edge-handle.html'));
 for(const edge of ['left','right','top']){
   await expanded();assert.equal((await run(host,`notchAPI.panelPosition('${edge}')`)).ok,true);
   const w=await wait(edgeWindow);w.setIgnoreMouseEvents(true);await wait(()=>w.isVisible(),'edge visible');
   assert.equal(await run(host,'isExpanded'),false);assert.equal(host.getOpacity(),0);
   const bounds=w.getBounds();assert.ok(bounds.width<=80&&bounds.height<=80);
   assert.equal(await run(w,'typeof window.notchAPI'),'undefined');assert.equal(await run(w,'typeof require'),'undefined');
   await run(w,'edgeAPI.reveal()');await wait(()=>run(host,'isExpanded'),'edge reveal');await settled();await wait(()=>host.getBounds().height>400,'native revealed');await wait(()=>!w.isVisible());
   const b=host.getBounds();assert.ok(b.x>=area.x&&b.y>=area.y);
   assert.equal(await run(host,'document.documentElement.dataset.panelEdge'),edge,'Reveal uses the saved edge');
 }
 // Cursor-based snap uses the same path as real OS dragging, with deterministic coordinates.
 await expanded();const snap=await run(host,`notchAPI.panelDrag('start')`);cursor={x:area.x+3,y:area.y+350};await pause(60);
 assert.equal((await run(host,`notchAPI.panelDrag('end',{token:'${snap.token}'})`)).placement.edge,'left');
 await wait(()=>run(host,'!isExpanded'));await expanded();
 await run(host,`document.getElementById('panel-move-handle').click()`);
 assert.equal(await run(host,`document.getElementById('panel-position-menu').hidden`),false);
 if(process.env.PANEL_MODULE_CAPTURE_DIR){fs.mkdirSync(process.env.PANEL_MODULE_CAPTURE_DIR,{recursive:true});for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}')`);await pause(120);fs.writeFileSync(path.join(process.env.PANEL_MODULE_CAPTURE_DIR,`${theme}-position-menu.png`),(await host.webContents.capturePage()).toPNG());}}
 host.webContents.send('key:escape');await pause(60);
 assert.equal(await run(host,`document.getElementById('panel-position-menu').hidden`),true);assert.equal(await run(host,'isExpanded'),true);
 await run(host,`notchAPI.panelPosition('reset')`);assert.equal((await run(host,`notchAPI.panelPosition('get')`)).placement,null);assert.equal(edgeWindow().isVisible(),false);
 // End must apply the last cursor position even when no timer tick has happened.
 await expanded();cursor={x:area.x+400,y:area.y+200};
 const quick=await run(host,`notchAPI.panelDrag('start')`),quickBefore=host.getBounds();
 cursor={x:cursor.x+10,y:cursor.y+20};
 await run(host,`notchAPI.panelDrag('end',{token:'${quick.token}'})`);
 assert.notDeepEqual(host.getBounds(),quickBefore);
 await run(host,`notchAPI.panelPosition('reset')`);
 const saved=fs.readFileSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,'panel-placement-v1.json'),'utf8');assert.equal(saved,'null');
 screen.getCursorScreenPoint=originalCursor;
 console.log('PASS edge placement: free movement/restoration, session scope, blur cancel, three edge handles/reveal, cursor snap, keyboard menu escape, reset and disk persistence. Cursor is a fixture, not physical cross-screen acceptance.');
 app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
