const {contextBridge,ipcRenderer}=require('electron');
const on=(channel,cb)=>{const fn=(_e,value)=>cb(value);ipcRenderer.on(channel,fn);return()=>ipcRenderer.removeListener(channel,fn);};
contextBridge.exposeInMainWorld('clipAPI',{
  request:value=>ipcRenderer.invoke('quick-clip:request',value),
  image:path=>ipcRenderer.invoke('clipboard:readImage',path),
  onChanged:cb=>on('quick-clip:changed',cb),onFocus:cb=>on('quick-clip:focus',cb),onClose:cb=>on('quick-clip:close-request',cb),onDisabled:cb=>on('quick-clip:disabled',cb),
  onQuit:cb=>on('quick-clip:quit-request',cb),
});
