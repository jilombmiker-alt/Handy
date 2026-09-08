(() => {
  'use strict';
  const api=window.notchAPI,M=window.ClipboardModel;
  if(!api?.onQuickClipRequest)return;
  let snippets=[],storageError=false;
  try{
    const raw=localStorage.getItem(M.SNIPPETS_KEY);
    if(raw!==null){snippets=JSON.parse(raw);if(!Array.isArray(snippets))throw Error();}
    else{
      snippets=clipFavorites.map(id=>clipHistory.find(v=>v.id===id)).filter(v=>v&&['text','url'].includes(v.type)).map(v=>M.snippet({...v,name:(v.text||'').trim().slice(0,40)||'收藏片段'},generateId()));
      localStorage.setItem(M.SNIPPETS_KEY,JSON.stringify(snippets));
    }
  }catch{storageError=true;snippets=[];}
  function persist(next){if(storageError)throw Error('storage_failed');localStorage.setItem(M.SNIPPETS_KEY,JSON.stringify(next));snippets=next;changed();}
  function changed(){api.quickClipChanged();}
  function resolve(key){return M.rows(clipHistory,snippets).find(v=>v.key===key);}
  async function request(input){
    const {action,key,values={}}=input;
    if(action==='get')return {ok:true,history:clipHistory,snippets,storageError,theme:document.documentElement.dataset.theme};
    if(action==='openNote'){
      const note=window.Notebook.get(values.noteId);
      if(!note?.sourceClipboardKey)return {ok:false,error:'not_found'};
      return await window.Notebook.detach('note',note.id);
    }
    const entry=resolve(key);
    if(action==='resolve')return entry?{ok:true,entry}:{ok:false,error:'not_found'};
    if(action==='saveSnippet'){
      if(key&&!entry)throw Error('not_found');
      if(entry?.source==='snippet'&&values.revision!==entry.timestamp)throw Error('conflict');
      const item=M.snippet({...entry,...values,type:entry?.type||'text'},entry?.source==='snippet'?entry.id:generateId());
      if(snippets.length>=200&&entry?.source!=='snippet')throw Error('snippet_limit');
      item.timestamp=Math.max(Date.now(),(entry?.timestamp||0)+1);
      persist([item,...snippets.filter(v=>v.id!==item.id)]);return {ok:true};
    }
    if(action==='deleteSnippet'){
      if(!entry||entry.source!=='snippet')throw Error('not_found');
      if(values.confirmed!==true||values.revision!==entry.timestamp)throw Error('conflict');
      persist(snippets.filter(v=>v.id!==entry.id));return {ok:true};
    }
    if(action==='deleteHistory'||action==='clearHistory'){
      if(values.confirmed!==true)throw Error('confirmation_required');
      if(action==='deleteHistory'&&(!entry||entry.source!=='history'))throw Error('not_found');
      // Only remove the records actually shown at confirmation, not newer background captures.
      const ids=action==='clearHistory'?new Set(values.ids||[]):new Set([entry.id]);
      const removed=clipHistory.filter(v=>ids.has(v.id)),next=clipHistory.filter(v=>!ids.has(v.id));
      if(!saveClipHistory(next))throw Error('storage_failed');
      clipHistory=next;clipFavorites=clipFavorites.filter(id=>!ids.has(id));saveClipFavorites(clipFavorites);
      cleanupEvictedClipImages(removed);clipDataVersion++;renderClipList();renderClipFavs();return {ok:true};
    }
    if(!entry)throw Error('not_found');
    if(action==='note'){
      if(!entry.text||entry.text.length>60000)throw Error('unsupported');
      const bytes=new TextEncoder().encode(JSON.stringify([entry.key,entry.text]));
      const digest=await crypto.subtle.digest('SHA-256',bytes),clipboardKey=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
      const result=await window.Notebook.create('note',entry.text,{clipboardKey});
      return result?.ok?{ok:true,noteId:result.note.id,reused:!!result.reused}:result;
    }
    if(action==='link'){
      if(entry.type!=='url')throw Error('unsupported');
      window.LinkLibrary?.flush();
      return window.LinkLibraryHost.add(entry.text)?{ok:true}:{ok:false,error:'invalid_or_duplicate_link'};
    }
    throw Error('invalid_action');
  }
  let queue=Promise.resolve();
  api.onQuickClipRequest(input=>{
    queue=queue.then(()=>request(input)).catch(e=>({ok:false,error:e.message})).then(result=>api.quickClipResult(input.requestId,result));
  });
  window.QuickClipboard={changed};
  const old=document.querySelector('#tab-clip .clip-panel');
  for(const child of old.children)if(!child.classList.contains('panel-detach-handle')){child.hidden=true;child.style.display='none';}
  const root=document.createElement('div');root.id='quick-clipboard-main';old.append(root);
  const view=new window.QuickClipboardView(root,{request:api.quickClipboard,image:api.readClipImage,open:api.openQuickClipboard,main:true});
  api.onQuickClipChanged(()=>view.refresh());
  api.onAppSettingsChanged(()=>view.refresh());
  window.QuickClipboard.view=view;void view.refresh();
})();
