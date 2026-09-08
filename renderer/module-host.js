(() => {
  'use strict';
  const catalog=window.PanelModuleCatalog,api=window.notchAPI,queues=new Map();
  let galleryCache={id:null,image:null};
  api?.onMirrorGalleryChanged?.(()=>{galleryCache={id:null,image:null};});
  const theme=()=>document.documentElement.dataset.theme;
  async function execute(kind,payload) {
    if(!Object.hasOwn(catalog,kind))return {ok:false,error:'invalid_module'};
    if(kind==='todo'&&payload.action==='command'&&payload.operation==='review-ideas')return window.Notebook.openQuick();
    if(kind==='todo'&&payload.action==='command'&&payload.operation==='open-idea-source')return window.IdeaPlanNavigation.source(payload.values?.id);
    const operation=payload.action==='get'?'get':payload.operation;
    const input=payload.values&&typeof payload.values==='object'?payload.values:{};
    if(kind==='clip') {
      const settings=await api.getAppSettings();
      if(settings?.features?.clip!==true)return {ok:false,error:'feature_disabled'};
      const item=clipHistory.find(v=>v.id===input.id);
      if(operation==='copy'&&item)return {ok:!!await api.writeClipboard(item)};
      if(operation==='delete'&&item){
        // Persist both keys before mutating the live arrays or scheduling image cleanup.
        const oldHistory=localStorage.getItem(CLIP_HISTORY_KEY),oldFavorites=localStorage.getItem(CLIP_FAV_KEY);
        try{localStorage.setItem(CLIP_HISTORY_KEY,JSON.stringify(clipHistory.filter(v=>v.id!==item.id)));localStorage.setItem(CLIP_FAV_KEY,JSON.stringify(clipFavorites.filter(id=>id!==item.id)));}
        catch(error){try{oldHistory===null?localStorage.removeItem(CLIP_HISTORY_KEY):localStorage.setItem(CLIP_HISTORY_KEY,oldHistory);oldFavorites===null?localStorage.removeItem(CLIP_FAV_KEY):localStorage.setItem(CLIP_FAV_KEY,oldFavorites);}catch{}throw error;}
        deleteClipEntry(item.id);
      }
      else if(operation!=='get')return {ok:false,error:'invalid_action'};
      return {ok:true,items:clipHistory.slice(0,100).map(v=>({id:v.id,text:v.type==='image'?'图片剪贴记录':v.text,detail:v.type})),theme:theme()};
    }
    if(kind==='todo') {
      const priority=String(input.priority||'P0');
      if(!PRIORITIES.includes(priority))return {ok:false,error:'invalid_category'};
      const item=data[priority].find(v=>v.id===input.id);
      if(operation!=='get') {
        const next=JSON.parse(JSON.stringify(data));
        if(operation==='add') {const v=NotchDomain.createTodo(String(input.text||'').slice(0,80),input.deadline||NotchDomain.defaultTodoDeadline(),crypto.randomUUID(),Date.now());if(!v)return {ok:false,error:'invalid_text'};next[priority].push(v);}
        else if(operation==='toggle'&&item)next[priority].find(v=>v.id===item.id).done=!item.done;
        else if(operation==='delete'&&item)next[priority]=next[priority].filter(v=>v.id!==item.id);
        else if(operation==='edit'&&item){const v=NotchDomain.updateTodo(item,String(input.text||'').slice(0,80),input.deadline||item.deadline);if(!v)return {ok:false,error:'invalid_text'};next[priority]=next[priority].map(row=>row.id===v.id?v:row);}
        else return {ok:false,error:'invalid_action'};
        localStorage.setItem(STORAGE_KEY,JSON.stringify(next));data=next;saveData(data);PRIORITIES.forEach(p=>{renderList(p);updateCount(p);});
      }
      return {ok:true,categories:todoCategoryNames,items:PRIORITIES.flatMap(p=>data[p].map(v=>({...v,priority:p,detail:todoCategoryNames[p]}))),theme:theme()};
    }
    if(kind==='pomodoro') {
      if(operation!=='get')return {ok:false,error:'invalid_action'};
      return {...await api.timerGet(),theme:theme()};
    }
    if(kind==='gallery') {
      let gallery=await api.getMirrorGallery();
      if(operation==='add'){const result=await api.addMirrorImages();if(!result?.ok)return result;gallery=result.gallery||gallery;}
      else if(['next','previous'].includes(operation)&&gallery.items.length){const index=gallery.items.findIndex(v=>v.id===gallery.activeId);const item=gallery.items[(index+(operation==='next'?1:-1)+gallery.items.length)%gallery.items.length];const result=await api.selectMirrorImage(item.id);if(!result?.ok)return result;gallery=result.gallery;}
      else if(operation!=='get'&&!['next','previous'].includes(operation))return {ok:false,error:'invalid_action'};
      if(gallery.activeId!==galleryCache.id)galleryCache={id:gallery.activeId,image:gallery.activeId?await api.getMirrorImage(gallery.activeId):null};
      return {ok:true,image:galleryCache.image,count:gallery.items.length,theme:theme(),detail:'图片画廊；实时摄像头仍由主面板主动开启。'};
    }
    const result=await window.WorkspaceModules.request(kind,operation,input);
    return {...result,theme:theme()};
  }
  window.PanelModules={request(kind,payload){const next=(queues.get(kind)||Promise.resolve()).catch(()=>{}).then(()=>execute(kind,payload)).catch(()=>({ok:false,error:'operation_failed'}));queues.set(kind,next);return next;}};
  const launchers=document.getElementById('panel-module-launchers');
  Object.entries(catalog).forEach(([id,value])=>{
    window.Notebook.mountHandle(document.querySelector(value.selector),'module',id);
    if(launchers){const button=document.createElement('button');button.type='button';button.textContent=`悬浮${value.label}`;button.addEventListener('click',()=>void Notebook.detach('module',id));launchers.append(button);}
  });
})();
