const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('edgeAPI',{reveal:()=>ipcRenderer.invoke('edge:reveal'),onState:cb=>ipcRenderer.on('edge:state',(_e,value)=>cb(value))});
