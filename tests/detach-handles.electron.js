const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
process.env.PANEL_TEST_MODE = '1';
process.env.PANEL_TEST_USER_DATA_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-detach-test-'));
delete process.env.NOTCH_LLM_API_KEY; delete process.env.DASHSCOPE_API_KEY;
require('../main');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const run = (win, code) => win.webContents.executeJavaScript(code, true);
const wait = async (check) => { for (let i=0;i<200;i++) { const value=await check(); if (value) return value; await sleep(30); } throw Error('wait_timeout'); };
const floats = () => BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/renderer/floating.html'));
const ghost = () => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/detach-preview.html'));
async function main() {
  await app.whenReady();
  const host = await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(()=>run(host,'!!window.Notebook'));
  // Native mouse movement must not race the injected fixture while the user works.
  host.setIgnoreMouseEvents(true);
  host.removeAllListeners('blur'); // Keep the fixture stable while the user switches apps; hide cancellation is tested below.
  host.hide(); host.webContents.setBackgroundThrottling(false);
  // Render off-screen so real desktop input cannot race these deterministic event fixtures.
  host.show = () => {}; host.showInactive = () => {}; host.focus = () => {}; host.isVisible = () => true;
  // Deterministic DOM pointer/capture fixture; actual OS dragging is a separate acceptance step.
  await run(host,`Element.prototype.setPointerCapture=function(){window.__captured=this;};Element.prototype.hasPointerCapture=function(){return window.__captured===this;};Element.prototype.releasePointerCapture=function(){if(window.__captured===this)window.__captured=null;};void 0;`);
  const nativeCursor = screen.getCursorScreenPoint;
  let cursor = {x:200,y:200};
  // Controlled OS-coordinate fixture; this suite does not claim a physical desktop drag.
  screen.getCursorScreenPoint = () => cursor;
  const showHome = async()=> {
    await run(host,`setMode(true)`); host.show(); host.focus(); host.webContents.focus();
    await run(host,`setActiveTab('home')`); await sleep(450);
    host.setIgnoreMouseEvents(true);
    await run(host,`document.activeElement.blur();document.querySelectorAll('.detach-surface').forEach(el=>el.dispatchEvent(new PointerEvent('pointerleave')));window.__hoverSurface=null;void 0;`);
  };
  const center = async(selector)=>run(host,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  const input=(type,p,extra={})=>run(host,`(()=>{
    const target=window.__captured||document.elementFromPoint(${p.x},${p.y});if(!target)return;
    const surface=target.closest('.detach-surface');
    if('${type}'==='mouseMove'&&surface!==window.__hoverSurface){window.__hoverSurface?.dispatchEvent(new PointerEvent('pointerleave'));surface?.dispatchEvent(new PointerEvent('pointerenter'));window.__hoverSurface=surface;}
    const eventType=({mouseMove:'pointermove',mouseDown:'pointerdown',mouseUp:'pointerup'})['${type}'];
    target.dispatchEvent(new PointerEvent(eventType,{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:${type==='mouseDown'||extra.button&&type==='mouseMove'?1:0},clientX:${p.x},clientY:${p.y}}));
    if('${type}'==='mouseUp')target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  })()`);
  const begin = async(selector)=> {
    await run(host,`window.__dragTrace=[];if(!window.__tracing){window.__tracing=true;for(const t of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(t,e=>{window.__dragTrace.push({type:t,buttons:e.buttons,x:e.screenX,y:e.screenY,target:e.target.className});},true);}`);
    const p=await center(selector), b=host.getBounds(); cursor={x:b.x+p.x,y:b.y+p.y};
    await input('mouseMove',await center('.home-mirror'));
    await input('mouseMove',p); await sleep(1300);
    input('mouseDown',p,{button:'left',clickCount:1}); await sleep(40);
    input('mouseMove',{x:p.x+24,y:p.y},{button:'left',modifiers:['leftButtonDown']});
    let preview;
    try { preview=await wait(ghost); } catch(error) {
      console.log('Drag diagnostic',await run(host,`({events:window.__dragTrace.filter(e=>e.buttons||e.type!=='pointermove').slice(-16),visible:!document.hidden,expanded:isExpanded,handle:getComputedStyle(document.querySelector('${selector}')).opacity,toast:document.querySelector('.status-toast')?.textContent})`));
      throw error;
    }
    await wait(()=>preview.isVisible());
    return {p,preview,b};
  };
  const capture=async(name)=> {
    if (!process.env.PANEL_DETACH_CAPTURE_DIR) return;
    fs.mkdirSync(process.env.PANEL_DETACH_CAPTURE_DIR,{recursive:true});
    fs.writeFileSync(path.join(process.env.PANEL_DETACH_CAPTURE_DIR,name+'.png'),(await host.webContents.capturePage()).toPNG());
  };
  try {
    await showHome();
    const selector='.home-note > .panel-detach-handle';
    input('mouseMove',await center('.home-mirror')); await sleep(200);
    assert.equal(await run(host,`getComputedStyle(document.querySelector('${selector}')).opacity`),'0');
    const p=await center(selector);
    await input('mouseMove',p); await sleep(750);
    assert.equal(await run(host,`document.querySelector('.home-note').classList.contains('detach-hover')`),false);
    await sleep(550);
    assert.equal(await run(host,`getComputedStyle(document.querySelector('${selector}')).opacity`),'1');
    assert.equal(await run(host,`(()=>{const a=document.querySelector('.home-note').getBoundingClientRect(),b=document.querySelector('${selector}').getBoundingClientRect();return Math.abs((b.x+b.width/2)-(a.x+a.width/2))<2&&b.top-a.top<12;})()`),true);
    for(const theme of ['white','obsidian']) {
      await run(host,`PanelAppearance.setTheme('${theme}')`); await sleep(80); await capture(theme+'-center-handle');
    }
    await sleep(3050);
    assert.equal(await run(host,`getComputedStyle(document.querySelector('${selector}')).opacity`),'0');
    await input('mouseMove',{x:p.x+4,y:p.y+40}); await sleep(3250);
    assert.equal(await run(host,`document.querySelector('.home-note').classList.contains('detach-hover')`),false,'Motion inside must not re-arm a dismissed handle');
    await input('mouseMove',await center('.home-mirror'));
    await input('mouseMove',p); await sleep(1300);
    assert.equal(await run(host,`getComputedStyle(document.querySelector('${selector}')).opacity`),'1','Re-entry reveals after one second');
    await input('mouseDown',p); await sleep(3250);
    assert.equal(await run(host,`getComputedStyle(document.querySelector('${selector}')).opacity`),'1','Holding the handle must pause dismissal');
    await run(host,'PanelDetachHandles.cancelActive()');
    await input('mouseUp',p); await sleep(200);
    assert.equal(floats().length,0);
    await run(host,`document.activeElement.blur()`);
    input('mouseMove',await center('.home-mirror')); await sleep(200);
    assert.equal(await run(host,`getComputedStyle(document.querySelector('${selector}')).pointerEvents`),'none',await run(host,`document.querySelector('.home-note').className`));
    await run(host,`document.querySelector('${selector}').focus()`);await sleep(200);
    assert.equal(await run(host,`document.activeElement===document.querySelector('${selector}')`),true);
    await run(host,`document.activeElement.blur(); document.getElementById('home-note').value='必须保留的草稿'; document.getElementById('home-note').dispatchEvent(new Event('input',{bubbles:true}));`);
    assert.equal(await run(host,`document.querySelector('.home-note').classList.contains('detach-hover')`),false);
    await input('mouseMove',p);
    await run(host,`document.getElementById('home-note').dispatchEvent(new Event('input',{bubbles:true}));`);
    await sleep(3250);
    assert.equal(await run(host,`document.querySelector('.home-note').classList.contains('detach-hover')`),false,'Typing does not re-arm until pointer re-entry');

    // DOM pointer fixture + production IPC/native preview, with controlled screen coordinates.
    let state=await begin(selector);
    assert.deepEqual(host.getBounds(),state.b);
    assert.equal(floats().length,0);
    assert.equal(await run(state.preview,'typeof window.notchAPI'),'undefined');
    assert.equal(await run(state.preview,'typeof window.require'),'undefined');
    const startedAgain=await run(host,`notchAPI.detachDrag('start',{kind:'quick'})`);
    assert.equal(startedAgain.error,'drag_busy');
    assert.equal((await run(host,`notchAPI.detachDrag('end',{token:'wrong'})`)).error,'invalid_drag_session');
    cursor={x:state.b.x+160,y:state.b.y+state.b.height+35};
    await wait(()=>run(state.preview,`document.getElementById('hint').textContent.startsWith('松手悬浮')`));
    input('mouseUp',{x:state.p.x+24,y:state.p.y},{button:'left',clickCount:1});
    await wait(()=>floats().length===1); await wait(()=>!ghost());
    assert.equal(await run(host,`localStorage.getItem('notch-home-note')`),'必须保留的草稿');
    await run(host,`notchAPI.dockFloat('quick')`); await wait(()=>floats().length===0);

    await showHome(); state=await begin(selector);
    input('mouseUp',{x:state.p.x+24,y:state.p.y},{button:'left',clickCount:1});
    await wait(()=>!ghost()); await sleep(200); assert.equal(floats().length,0);
    state=await begin(selector);
    host.webContents.send('key:escape');
    await wait(()=>!ghost());
    assert.equal(host.isVisible(),true);
    input('mouseUp',{x:state.p.x+24,y:state.p.y},{button:'left',clickCount:1});
    await sleep(200); assert.equal(floats().length,0);

    // The size control retains its action and does not detach anything.
    const sizeBefore=await run(host,`document.querySelector('.home-note').dataset.widgetSize`);
    await run(host,`document.querySelector('.home-note [data-widget-size-cycle]').click()`);
    assert.notEqual(await run(host,`document.querySelector('.home-note').dataset.widgetSize`),sizeBefore);
    assert.equal(floats().length,0); assert.equal(ghost(),undefined);
    await run(host,`PanelAppearance.setLayout('calm')`);await sleep(100);

    // Focusable native button alternative; merely floating recording never starts it.
    await run(host,`document.querySelector('#home-recorder > .panel-detach-handle').focus();document.querySelector('#home-recorder > .panel-detach-handle').click()`);
    await wait(()=>floats().length===1);
    assert.equal((await run(host,`PanelRecording.snapshot()`)).status,'idle');
    await run(host,`notchAPI.dockFloat('recorder')`);await wait(()=>floats().length===0);

    await showHome();
    const ids=await run(host,`(async()=>{const a=await Notebook.create('note','普通笔记');const b=await Notebook.create('meeting');return [a.note.id,b.note.id];})()`);
    await run(host,`setActiveTab('notes')`);await sleep(350);
    assert.equal(await run(host,`document.querySelectorAll('#notes-detail > .panel-detach-handle').length`),1);
    await run(host,`document.querySelector('#notes-list [data-note-id="${ids[0]}"]').click()`);await sleep(250);
    assert.equal(await run(host,`document.querySelectorAll('#notes-detail > .panel-detach-handle').length`),1);
    await run(host,`document.getElementById('notes-editor').value='刚输入尚未等待自动保存';document.getElementById('notes-editor').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#notes-detail > .panel-detach-handle').click()`);
    await wait(()=>floats().length===1);
    assert.equal((await run(host,`Notebook.get('${ids[0]}')`)).content,'刚输入尚未等待自动保存');
    await run(host,`Notebook.detach('note','${ids[0]}')`);assert.equal(floats().length,1);
    await run(host,`notchAPI.dockFloat('note:${ids[0]}')`); await wait(()=>floats().length===0);
    await showHome();state=await begin(selector);
    host.emit('hide');await wait(()=>!ghost());assert.equal(floats().length,0);
    console.log('PASS upper-center detach: 1s hover, 3s dismissal, re-entry only, hold visible, typing hides, focus, both themes, native preview, external drop, inside/Escape/hide cancel, scoped IPC, size unchanged, saved notes, dedupe, recorder idle. Pointer/cursor are fixtures, not physical cross-app acceptance.');
  } finally { screen.getCursorScreenPoint=nativeCursor; }
  app.quit();
}
main().catch(error=>{console.error(error);app.exit(1);});
