(() => {
  'use strict';
  const M=window.QuickRecordModel, legacy='notch-home-note';
  let state=null, error='';
  function read(){
    if(state)return state;
    try{
      const raw=localStorage.getItem(M.KEY);
      const next=raw===null?M.initial(localStorage.getItem(legacy)||'',NotebookModel.uid(),Date.now()):M.parse(raw);
      if(raw===null)localStorage.setItem(M.KEY,JSON.stringify(next));
      state=next;error='';return state;
    }catch{error='storage_failed';throw Error(error);}
  }
  function mirror(){
    const r=M.active(state);
    // Legacy key is a compatibility mirror, never the authoritative record collection.
    try{localStorage.setItem(legacy,r.content);localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);}catch{}
    if(noteInput){if(noteInput.value!==r.content)noteInput.value=r.content;renderNotePreview();}
  }
  function snapshot(){const s=read(),r=M.active(s);return {ok:true,state:structuredClone(s),note:{...r,id:'quick',recordId:r.id},theme:document.documentElement.dataset.theme};}
  function command(command){
    try{
      const next=M.change(read(),command,Date.now(),NotebookModel.uid());
      localStorage.setItem(M.KEY,JSON.stringify(next)); // Commit before changing any UI or active identity.
      state=next;error='';mirror();
      if(command.action==='capture')window.notchAPI?.broadcastFloat?.({kind:'quick',refresh:true});
      return snapshot();
    }catch(e){error=e.message==='invalid_store'?'storage_failed':e.message;return {ok:false,error};}
  }
  function saveHome(){
    if(!noteInput||noteInput.readOnly)return;
    let s;try{s=read();}catch{throw Error('storage_failed');}
    const r=M.active(s),result=command({action:'save',recordId:r.id,revision:r.revision,content:noteInput.value,title:r.title});
    if(!result.ok)throw Error(result.error);
  }
  try{read();mirror();}catch{showStatusToast('随手记读取失败，原数据未重置。请先备份本机数据后重试。');}
  noteInput?.addEventListener('input',()=>{try{saveHome();}catch{showStatusToast('随手记未能保存，请复制输入备份后重试，不要退出。');}});
  window.QuickRecords={snapshot,command,saveHome,get error(){return error;}};
})();
