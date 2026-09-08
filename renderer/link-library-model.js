(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LinkLibraryModel=api;})(globalThis,()=>{
  const clone=v=>JSON.parse(JSON.stringify(v));
  function text(value,max){if(typeof value!=='string'||value.length>max)throw Error('invalid_text');return value;}
  function patch(groups,id,changes,groupId){const next=clone(groups);let item;for(const g of next){const row=(g.links||[]).find(r=>r.id===id);if(row)item=row;}if(!item)throw Error('not_found');
    for(const key of Object.keys(changes)){if(key==='note')item.note=text(changes.note,4000);else if(key==='title'){item.title=text(changes.title,200).trim();if(!item.title)throw Error('invalid_text');item.titleUserSet=true;}else if(key==='pinned'){if(typeof changes.pinned!=='boolean')throw Error('invalid_text');item.pinned=changes.pinned;}
      else if(key==='tags'){if(!Array.isArray(changes.tags)||changes.tags.length>12)throw Error('invalid_text');item.tags=[...new Set(changes.tags.map(t=>text(t,30).trim()).filter(Boolean))];}
      else if(key==='noteIds'){if(!Array.isArray(changes.noteIds)||changes.noteIds.length>30||changes.noteIds.some(v=>typeof v!=='string'||v.length>120))throw Error('invalid_text');item.noteIds=[...new Set(changes.noteIds)];}
      else if(key==='analysis'){const a=changes.analysis;item.analysis={summary:text(a.summary,1000),use:text(a.use,1000),scenario:text(a.scenario,1000),source:text(a.source||'metadata',40),warning:text(a.warning||'',500),at:Date.now()};}
      else throw Error('invalid_action');
    }
    if(groupId){const target=next.find(g=>g.id===groupId);if(!target)throw Error('not_found');if(!(target.links||[]).some(r=>r.id===id)){for(const g of next)g.links=(g.links||[]).filter(r=>r.id!==id);target.links.push(item);target.collapsed=false;}}
    return next;
  }
  function matches(item,{search='',view='all'}={}){return (view!=='pinned'||item.pinned===true)&&(view!=='project'||item.noteIds?.length>0)&&[item.title,item.url,item.note,...item.tags||[],item.analysis?.summary,item.analysis?.use,item.analysis?.scenario].join(' ').toLowerCase().includes(search.trim().toLowerCase());}
  return {clone,text,patch,matches};
});
