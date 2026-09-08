const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('quickReviewAPI',{
  onContent:cb=>ipcRenderer.on('quick-review:content',(_e,value)=>cb(value)),
  onError:cb=>ipcRenderer.on('quick-review:error',()=>cb()),
  action:value=>ipcRenderer.send('quick-review:action',value),
});
