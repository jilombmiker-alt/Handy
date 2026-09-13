'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
process.env.PANEL_TEST_MODE='1';
process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'handy-settings-entry-'));
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);});
require('../main');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<180;i++){if(await fn())return;await delay(40);}throw Error('timeout');}
async function run(){
 await app.whenReady();let w;
 await until(()=>{w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')&&!w.webContents.isLoadingMainFrame());return w;});
 const js=s=>w.webContents.executeJavaScript(s);await until(()=>js('!!window.ToolLauncher?.entry'));
 const errors=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m);});
 const captures=fs.mkdtempSync(path.join(os.tmpdir(),'handy-settings-captures-'));
 for(const [theme,width] of [['pure-white',720],['obsidian',420]]){
  await js(`ToolLauncher.open(null)`);await js(`PanelAppearance.setTheme('${theme}');void 0;`);
  w.setSize(width,280);await delay(180);
  const g=await js(`(()=>{const b=document.getElementById('launcher-settings'),r=b.getBoundingClientRect(),s=getComputedStyle(b),m=document.getElementById('launcher-menu-toggle').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,region:s.getPropertyValue('-webkit-app-region'),font:s.fontSize,menuWidth:m.width,menuHeight:m.height,duplicate:[...document.querySelectorAll('.handy-menu button')].some(b=>b.textContent==='设置'),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert.ok(g.width>=68&&g.height>=36,JSON.stringify(g));assert.equal(g.region,'no-drag');assert.equal(g.font,'14px');assert.ok(g.menuWidth>=36&&g.menuHeight>=36);assert.equal(g.duplicate,false);assert.equal(g.overflow,false);
  fs.writeFileSync(path.join(captures,theme+'.png'),(await w.webContents.capturePage({},{stayHidden:true})).toPNG());
  // Pointer events hit the whole visible rectangle, including padding, not only text.
  for(const [fx,fy] of [[.5,.5],[.08,.18],[.92,.82]]){
   const r=await js(`(()=>{const r=document.getElementById('launcher-settings').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
   const x=Math.round(r.x+r.w*fx),y=Math.round(r.y+r.h*fy);
   assert.equal(await js(`document.elementFromPoint(${x},${y})?.closest('button')?.id`),'launcher-settings');
   w.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});w.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
   await until(()=>js(`ToolLauncher.current==='settings'`));
   assert.equal(await js(`document.getElementById('launcher-settings').getAttribute('aria-current')`),'page');
   await js(`document.querySelector('.launcher-back').click()`);await until(()=>js(`ToolLauncher.current===null`));w.setSize(width,280);await delay(100);
  }
  await js(`ToolLauncher.open(null)`);w.webContents.focus();
  await js(`document.getElementById('launcher-settings').focus()`);
  assert.equal(await js(`document.activeElement.id`),'launcher-settings');
  w.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});w.webContents.sendInputEvent({type:'char',keyCode:'\r'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await until(()=>js(`ToolLauncher.current==='settings'`));
  await js(`ToolLauncher.open(null)`);await js(`document.getElementById('launcher-menu-toggle').click()`);
  assert.equal(await js(`document.querySelector('.handy-menu:popover-open')!==null`),true);
  await js(`document.querySelector('.handy-menu:popover-open').hidePopover()`);
 }
 assert.deepEqual(errors,[]);console.log('PASS: visible settings, full pointer hit area, no-drag, keyboard, return, menu, light/dark narrow. Captures: '+captures);app.exit(0);
}
run().catch(e=>{console.error(e);app.exit(1);});
