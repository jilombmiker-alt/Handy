'use strict';
const {BrowserWindow,ipcMain,powerMonitor,screen}=require('electron');
const path=require('node:path');
const M=require('./renderer/quick-record-model');

function createQuickReview({request,open,enabled=true,context,clock=Date.now}){
  let win=null,timer=null,expiry=null,inFlight=false,locked=false,suspended=false,disposed=false,reviewMode='pending';
  let presentation;try{presentation=require('./native/.build/modifier-shortcut.node').presentation;}catch{}
  const readContext=()=>context?context():{
    idleSeconds:powerMonitor.getSystemIdleTime(),locked:locked||powerMonitor.getSystemIdleState(90)==='locked',suspended,
    // If unavailable, defer instead of risking an interruption in a presentation.
    fullscreen:typeof presentation==='function'?presentation():true,
  };
  function hide(){clearTimeout(expiry);if(win&&!win.isDestroyed())win.hide();}
  async function ensureWindow(){
    if(win&&!win.isDestroyed())return;
    win=new BrowserWindow({width:360,height:132,show:false,frame:false,resizable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,
      fullscreenable:false,transparent:true,backgroundColor:'#00000000',webPreferences:{preload:path.join(__dirname,'renderer/quick-review-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'quick-review'}});
    win.setAlwaysOnTop(true,'floating');
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',e=>e.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_web,_permission,cb)=>cb(false));
    await win.loadFile(path.join(__dirname,'renderer/quick-review.html'));
  }
  async function tick(){
    if(disposed||inFlight||win?.isVisible())return false;
    inFlight=true;
    try{
      if(!M.eligible(readContext()))return false;
      let result=await request({action:'review-state',kind:'quick'});
      if(!result?.ok||!M.reminder(result.state,clock()).count||!M.eligible({...readContext(),recording:result.recording}))return false;
      await ensureWindow();
      // Loading can take time: recheck current note/recording and computer state.
      result=await request({action:'review-state',kind:'quick'});
      const reminder=result?.ok?M.reminder(result.state,clock()):{count:0};
      const {count,mode}=reminder;
      if(disposed||!count||!M.eligible({...readContext(),recording:result.recording}))return false;
      // Persist the daily claim before showing, so restarts cannot repeat it.
      const claim=await request({action:'records',kind:'quick',command:{action:mode==='weekly'?'weekly-shown':'shown'}});
      if(!claim?.ok||disposed)return false;
      const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      win.setPosition(Math.round(area.x+area.width-372),Math.round(area.y+16));
      reviewMode=mode;win.webContents.send('quick-review:content',{count,mode,theme:result.theme});
      win.showInactive();expiry=setTimeout(hide,15000);return true;
    }catch{hide();return false;}finally{inFlight=false;}
  }
  const action=async(event,value)=>{
    if(!win||win.isDestroyed()||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!win.isVisible())return;
    if(!['open','tomorrow','close'].includes(value))return;
    if(value==='tomorrow'){
      const result=await request({action:'records',kind:'quick',command:{action:'tomorrow'}});
      if(!result?.ok){win.webContents.send('quick-review:error');return;}
    }
    hide();if(value==='open')await open(reviewMode);
  };
  ipcMain.on('quick-review:action',action);
  const onLock=()=>{locked=true;hide();},onUnlock=()=>{locked=false;},onSuspend=()=>{suspended=true;hide();},onResume=()=>{suspended=false;};
  for(const [event,listener] of [['lock-screen',onLock],['unlock-screen',onUnlock],['suspend',onSuspend],['resume',onResume]])powerMonitor.on(event,listener);
  if(enabled){timer=setInterval(()=>void tick(),15000);timer.unref();}
  return {tick,hide,dispose(){disposed=true;clearInterval(timer);hide();if(win&&!win.isDestroyed())win.destroy();ipcMain.removeListener('quick-review:action',action);
    for(const [event,listener] of [['lock-screen',onLock],['unlock-screen',onUnlock],['suspend',onSuspend],['resume',onResume]])powerMonitor.removeListener(event,listener);}};
}
module.exports={createQuickReview};
