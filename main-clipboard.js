'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const M=require('./renderer/clipboard-model');

// Register the replacement first: a conflict must never remove the working shortcut.
function createShortcutController({registry,read,write,invoke}){
  const stored=read();let state={shortcut:M.shortcut(stored.shortcut)||M.DEFAULT_SHORTCUT,paused:stored.paused===true},enabled=false,active='',error='';
  const register=key=>{try{return !registry.isRegistered(key)&&registry.register(key,invoke);}catch{return false;}};
  const snapshot=()=>({...state,enabled,active,error});
  function enable(value){enabled=value===true;if(!enabled&&active){registry.unregister(active);active='';}if(enabled&&!active){if(register(state.shortcut)){active=state.shortcut;error='';}else error='occupied';}return snapshot();}
  function configure(input){
    const key=input.shortcut===undefined?state.shortcut:M.shortcut(input.shortcut);
    if(!key)return {...snapshot(),ok:false,error:'invalid_shortcut'};
    const next={shortcut:key,paused:input.paused===undefined?state.paused:input.paused===true};
    let acquired=false;
    if(enabled&&key!==active&&input.shortcut!==undefined){if(!register(key))return {...snapshot(),ok:false,error:'occupied'};acquired=true;}
    if(!write(next)){if(acquired)registry.unregister(key);return {...snapshot(),ok:false,error:'save_failed'};}
    if(acquired){if(active)registry.unregister(active);active=key;}
    state=next;error='';return {ok:true,...snapshot()};
  }
  return {snapshot,enable,configure,dispose(){if(active)registry.unregister(active);active='';}};
}

// Keystroke dispatch is deliberately distinct from confirmed insertion in the target app.
async function safePaste({native,write,hide,unchanged=()=>true,delay=ms=>new Promise(r=>setTimeout(r,ms)),valid=()=>true}){
  if(!write())return {ok:false,error:'copy_failed'};
  const copied={ok:true,pasted:false};
  if(!native||!valid()||(native.ready&&!native.ready()))return {...copied,reason:'target_unavailable'};
  if(!await hide()||!valid()||!native.activate())return {...copied,reason:'target_changed'};
  await delay(120);
  if(!valid()||!unchanged()||!native.paste())return {...copied,reason:'target_changed'};
  return {ok:true,pasted:true};
}

function createClipboardRuntime(options){
  const {BrowserWindow,ipcMain,screen,shell,globalShortcut}=require('electron');
  const {getMain,read,write,file,writeEntry,collapse,test=false}=options;
  let native=null;if(!test)try{native=require('./native/.build/clipboard-bridge.node');}catch{}
  let picker=null,generation=0,busy=false,ready=null,quitAllowed=false,quitResume=null;
  const pending=new Map(),configFile=file('clipboard-quick-v1.json'),filesFile=file('clipboard-files-v1.json');
  let refs=read(filesFile,{});if(!refs||Array.isArray(refs))refs={};
  const mainSender=e=>!!getMain()&&e.sender===getMain().webContents&&e.senderFrame===getMain().webContents.mainFrame;
  const pickerSender=e=>!!picker&&!picker.isDestroyed()&&e.sender===picker.webContents&&e.senderFrame===picker.webContents.mainFrame;
  const send=(w,channel,value)=>{if(w&&!w.isDestroyed()&&!w.webContents.isDestroyed())w.webContents.send(channel,value);};
  function broadcast(){send(picker,'quick-clip:changed');send(getMain(),'quick-clip:changed');}
  function invalidate(){generation++;native?.invalidate();}
  function capture(){generation++;if(!controller.snapshot().enabled){native?.invalidate();return false;}return native?.capture()===true;}
  const controller=createShortcutController({registry:globalShortcut,read:()=>read(configFile,{}),write:v=>write(configFile,v),invoke:()=>{void open();}});
  function forward(payload){
    return new Promise(resolve=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);resolve({ok:false,error:'host_unavailable'});},3500);pending.set(requestId,{resolve,timer});send(getMain(),'quick-clip:host-request',{requestId,...payload});});
  }
  ipcMain.on('quick-clip:host-result',(e,p)=>{if(!mainSender(e))return;const item=pending.get(p?.requestId);if(!item)return;clearTimeout(item.timer);pending.delete(p.requestId);item.resolve(p.result);});
  ipcMain.on('quick-clip:changed',e=>{if(mainSender(e))broadcast();});
  async function open(){
    if(!controller.snapshot().enabled)return {ok:false,error:'feature_disabled'};
    if(busy)return {ok:false,error:'busy'};
    capture();
    if(options.openInline)return options.openInline();
    if(!picker||picker.isDestroyed()){
      const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const width=Math.min(660,area.width-32),height=Math.min(520,area.height-32);
      picker=new BrowserWindow({width,height,x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+Math.min(100,(area.height-height)/2)),show:false,frame:false,resizable:true,minWidth:360,minHeight:340,alwaysOnTop:true,skipTaskbar:true,roundedCorners:true,webPreferences:{preload:path.join(__dirname,'clipboard-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      picker.webContents.setWindowOpenHandler(()=>({action:'deny'}));picker.webContents.on('will-navigate',e=>e.preventDefault());
      picker.on('close',e=>{e.preventDefault();send(picker,'quick-clip:close-request');});
      ready=picker.loadFile(path.join(__dirname,'renderer/quick-clipboard.html'));
    }
    try{await ready;}catch{return {ok:false,error:'window_failed'};}
    if(!controller.snapshot().enabled)return {ok:false,error:'feature_disabled'};
    picker.show();picker.focus();send(picker,'quick-clip:focus');return {ok:true};
  }
  function fileEntry(){
    const paths=native?.files()||[];if(!paths.length)return null;
    const id=crypto.createHash('sha256').update(JSON.stringify(paths)).digest('hex');
    if(!refs[id]){if(Object.keys(refs).length>=2000)return {blocked:true};const next={...refs,[id]:paths};if(!write(filesFile,next))return {blocked:true};refs=next;}
    return {type:'file',fileId:id,fileNames:paths.map(p=>path.basename(p)),text:null,contentKey:'file:'+id};
  }
  function pathsFor(id){const paths=typeof id==='string'&&Object.hasOwn(refs,id)?refs[id]:null;return Array.isArray(paths)&&paths.length>0&&paths.length<=20&&paths.every(p=>typeof p==='string'&&path.isAbsolute(p)&&fs.existsSync(p))?paths:null;}
  const writeFiles=entry=>{const paths=pathsFor(entry?.fileId);return !!paths&&native?.writeFiles(paths)===true;};
  async function pasteEntry(entry,isPicker=false){
    if(busy)return {ok:false,error:'busy'};busy=true;const epoch=generation;
    try{const result=await safePaste({native,write:()=>writeEntry(entry),valid:()=>epoch===generation&&controller.snapshot().enabled,
      unchanged:()=>options.matchesClipboard(entry),hide:async()=>{const collapsed=await collapse();if(!collapsed)return false;if(isPicker)picker?.hide();return true;}});
      if(isPicker&&!result.pasted&&epoch===generation&&controller.snapshot().enabled)picker?.showInactive();return result;
    }finally{busy=false;}
  }
  ipcMain.handle('quick-clip:open',e=>mainSender(e)?open():{ok:false,error:'forbidden'});
  ipcMain.handle('quick-clip:request',async(e,input={})=>{
    if(!mainSender(e)&&!pickerSender(e))return {ok:false,error:'forbidden'};
    const action=input.action;
    if(action==='close'){invalidate();picker?.hide();return {ok:true};}
    if(action==='permissions'){await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');return {ok:true};}
    if(action==='quit-ready'&&pickerSender(e)&&quitResume){quitAllowed=true;const resume=quitResume;quitResume=null;setImmediate(resume);return {ok:true};}
    if(action==='settings'){
      const result=input.changes?controller.configure(input.changes):{ok:true,...controller.snapshot()};options.onPolicy?.();broadcast();return result;
    }
    if(!controller.snapshot().enabled)return {ok:false,error:'feature_disabled'};
    if(action==='get'){const result=await forward({action:'get'});return {...result,settings:controller.snapshot()};}
    if(['copy','paste','openFile'].includes(action)){
      const result=await forward({action:'resolve',key:input.key});if(!result?.ok)return result;
      if(action==='copy')return {ok:writeEntry(result.entry),pasted:false};
      if(action==='paste')return pasteEntry(result.entry,pickerSender(e));
      const paths=pathsFor(result.entry.fileId);if(!paths)return {ok:false,error:'missing_file'};
      // Reveal rather than execute a file; opening applications/scripts must remain an explicit Finder action.
      shell.showItemInFolder(paths[0]);return {ok:true,revealed:true};
    }
    if(['saveSnippet','deleteSnippet','deleteHistory','clearHistory','note','link','openNote'].includes(action))return forward({action,key:input.key,values:input.values});
    return {ok:false,error:'invalid_action'};
  });
  return {capture,invalidate,open,pasteEntry,fileEntry,writeFiles,hasFile:id=>!!pathsFor(id),snapshot:controller.snapshot,
    beginQuit(resume){if(quitAllowed){quitAllowed=false;return true;}if(!picker||picker.isDestroyed())return true;quitResume=resume;send(picker,'quick-clip:quit-request');picker.show();return false;},
    enable(value){controller.enable(value);if(!value){invalidate();send(picker,'quick-clip:disabled');picker?.hide();}broadcast();},
    dispose(){controller.dispose();invalidate();picker?.destroy();for(const p of pending.values()){clearTimeout(p.timer);p.resolve({ok:false,error:'host_unavailable'});}pending.clear();}};
}
module.exports={createShortcutController,safePaste,createClipboardRuntime};
