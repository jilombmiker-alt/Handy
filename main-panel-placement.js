'use strict';
const { BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizePlacement, fitPanel, placementBounds, edgeAt, placementFromBounds, handleBounds } = require('./panel-placement-model');

function createPanelPlacement(options) {
  if(options.disabled){
    const result=()=>({ok:false,error:'launcher_fixed'});
    ipcMain.handle('panel:position',result);ipcMain.handle('panel:drag',result);
    return {syncHandle(){},cancel(){return false;},dispose(){},bounds(){return null;}};
  }
  let placement = null, drag = null, edgeWindow = null, edgeReady = Promise.resolve(), disposed = false, handleGeneration = 0;
  try { placement = normalizePlacement(JSON.parse(fs.readFileSync(options.file(),'utf8'))); } catch {}
  const main = options.getMain;
  const trusted = e => main() && !main().isDestroyed() && e.sender === main().webContents && e.senderFrame === e.sender.mainFrame;
  const display = fallback => screen.getAllDisplays().find(d=>d.id===placement?.displayId) || (placement ? screen.getPrimaryDisplay() : fallback) || screen.getPrimaryDisplay();
  const notify = (extra={}) => { if(main()&&!main().isDestroyed())main().webContents.send('panel:placement',{placement,...extra}); };
  function store(value) {
    try { const file=options.file(),temp=`${file}.tmp`;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);placement=value;return true; } catch { return false; }
  }
  function cancel() {
    if(!drag)return false;
    const session=drag;drag=null;clearInterval(session.timer);
    if(main()&&!main().isDestroyed())main().setBounds(session.bounds);
    notify({cancelled:true});return true;
  }
  async function syncHandle(expanded) {
    const generation=++handleGeneration;
    if(expanded||!placement?.edge||disposed) { edgeWindow?.hide();return; }
    if(!edgeWindow||edgeWindow.isDestroyed()) {
      const win=edgeWindow=new BrowserWindow({width:16,height:80,show:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,movable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,hasShadow:false,
        webPreferences:{preload:path.join(__dirname,'renderer/edge-handle-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'panel-edge-handle'}});
      win.setAlwaysOnTop(true,'floating');win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
      win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
      win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
      edgeReady=win.loadFile(path.join(__dirname,'renderer/edge-handle.html'));
      await edgeReady;
      if(disposed||win.isDestroyed())return;
    }
    await edgeReady;
    if(disposed||!edgeWindow||edgeWindow.isDestroyed()||generation!==handleGeneration||options.expanded()||!placement?.edge)return;
    edgeWindow.setBounds(handleBounds(placement,display()));
    edgeWindow.webContents.send('edge:state',{edge:placement.edge});edgeWindow.showInactive();
  }
  function settle(edge, d, bounds) {
    const next=placementFromBounds(bounds,d,edge);
    if(!store(next))return {ok:false,error:'save_failed'};
    notify();
    if(edge)options.collapse();else main().setBounds(placementBounds(next,d,options.size(d)));
    return {ok:true,placement};
  }
  ipcMain.handle('panel:position', (event,action) => {
    if(!trusted(event))return {ok:false,error:'forbidden'};
    if(action==='get')return {ok:true,placement};
    if(!['left','right','top','reset'].includes(action))return {ok:false,error:'invalid_action'};
    cancel();
    if(action==='reset') {
      if(!store(null))return {ok:false,error:'save_failed'};
      void syncHandle(true);options.reposition(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));notify();return {ok:true,placement};
    }
    const d=screen.getDisplayMatching(main().getBounds());
    return settle(action,d,main().getBounds());
  });
  ipcMain.handle('panel:drag',(event,phase,payload={})=>{
    if(!trusted(event))return {ok:false,error:'forbidden'};
    if(phase==='start') {
      if(drag||!options.expanded()||!main().isVisible())return {ok:false,error:'unavailable'};
      const session=drag={token:crypto.randomUUID(),cursor:screen.getCursorScreenPoint(),bounds:main().getBounds(),started:Date.now()};
      session.timer=setInterval(()=>{
        if(Date.now()-session.started>30000||!main()||main().isDestroyed()||!main().isVisible()){cancel();return;}
        const cursor=screen.getCursorScreenPoint(),d=screen.getDisplayNearestPoint(cursor);
        const bounds=fitPanel({...session.bounds,x:session.bounds.x+cursor.x-session.cursor.x,y:session.bounds.y+cursor.y-session.cursor.y},d.workArea);
        main().setBounds(bounds);
        const edge=edgeAt(cursor,d.workArea);if(edge!==session.edge){session.edge=edge;notify({dragEdge:edge});}
      },16);
      return {ok:true,token:session.token};
    }
    if(!drag||payload.token!==drag.token||!['end','cancel'].includes(phase))return {ok:false,error:'invalid_session'};
    if(phase==='cancel'){cancel();return {ok:true,cancelled:true};}
    const session=drag,cursor=screen.getCursorScreenPoint(),d=screen.getDisplayNearestPoint(cursor);
    clearInterval(session.timer);drag=null;
    // A fast release can arrive before the 16ms timer. Always apply the final OS point.
    const finalBounds=fitPanel({...session.bounds,x:session.bounds.x+cursor.x-session.cursor.x,y:session.bounds.y+cursor.y-session.cursor.y},d.workArea);
    const result=settle(edgeAt(cursor,d.workArea),d,finalBounds);
    if(!result.ok)main().setBounds(session.bounds);
    notify({dragEdge:null});return result;
  });
  ipcMain.handle('edge:reveal',(event)=>{
    if(!edgeWindow||event.sender!==edgeWindow.webContents||event.senderFrame!==event.sender.mainFrame)return false;
    edgeWindow.hide();options.reveal();return true;
  });
  main()?.on('blur',cancel);main()?.on('hide',cancel);
  main()?.webContents.on('render-process-gone',cancel);
  return {
    bounds(fallback,size){if(!placement)return null;const d=display(fallback);return placementBounds(placement,d,size(d));},
    syncHandle:expanded=>void syncHandle(expanded).catch(()=>{}), cancel,
    get dragging(){return !!drag;},
    dispose(){disposed=true;cancel();edgeWindow?.destroy();},
  };
}
module.exports={createPanelPlacement};
