'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const M=require('./renderer/planner-model');
function createPlannerStore(file){
  let cachedPath='',state=null,error='',undo=null;
  function load(){const p=file();if(p===cachedPath&&state)return;cachedPath=p;undo=null;error='';
    try{state=M.validate(JSON.parse(fs.readFileSync(p,'utf8')));}catch(e){if(e.code==='ENOENT')state=M.empty();else {state=M.empty();error='corrupt_store';}}
  }
  function write(next){const p=file(),temp=`${p}.${crypto.randomUUID()}.tmp`;try{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600,flag:'wx'});fs.renameSync(temp,p);}catch(e){try{fs.unlinkSync(temp);}catch{}throw Error('save_failed');}state=next;}
  function snapshot(){load();return error?{ok:false,error}:{ok:true,state:M.clone(state)};}
  function command(c){load();if(error)return {ok:false,error};try{
    if(!c||typeof c.requestId!=='string'||c.requestId.length>100)throw Error('invalid_request');
    if(state.receipts.includes(c.requestId))return snapshot();
    if(c.revision!==state.revision)throw Error('conflict');
    let next;
    if(c.action==='undo'){
      if(!undo||undo.revision!==state.revision)throw Error('nothing_to_undo');
      next={...M.clone(undo.before),revision:state.revision+1,claims:state.claims,receipts:state.receipts};
      // Keep the audit trail even when reversing a change. Newly added entries are archived,
      // so undo does not erase the only evidence that the arrangement ever existed.
      next.events=M.clone(state.events);
      for(const current of state.items){let restored=next.items.find(r=>r.id===current.id);
        if(!restored){restored={...M.clone(current),archived:true};next.items.push(restored);}
        if(JSON.stringify(restored)!==JSON.stringify(current))next.events.push({id:`${next.revision}:${current.id}`,at:Date.now(),itemId:current.id,before:M.clone(current),after:M.clone(restored),source:'撤销最近操作',undo:true});
      }
      M.validate(next);
    }else if(c.action==='settings'){
      next={...M.clone(state),revision:state.revision+1};
      for(const key of ['reminders','aiEnabled'])if(c[key]!==undefined){if(typeof c[key]!=='boolean')throw Error('invalid_request');next[key]=c[key];}
      if(c.categories!==undefined){next.categories={...M.categories,...state.categories,...c.categories};}
      M.validate(next);
    }
    else if(c.action==='apply')next=M.apply(state,c.changes,Date.now(),c.source||'');
    else throw Error('invalid_action');
    next.receipts=[...state.receipts.slice(-99),c.requestId];
    const previous=M.clone(state);write(next);undo=['undo','settings'].includes(c.action)?null:{before:previous,revision:next.revision};return {...snapshot(),undoable:!!undo};
  }catch(e){return {ok:false,error:['conflict','nothing_to_undo','invalid_request','invalid_action','invalid_changes','invalid_time','invalid_state','invalid_text','invalid_id','duplicate_id','duplicate_change','not_found','save_failed','corrupt_store'].includes(e.message)?e.message:'save_failed'};}}
  function claim(now=Date.now()){
    load();if(error)return [];
    const due=M.due(state,now);if(!due.length)return [];
    const next=M.clone(state);for(const r of due)next.claims[r.key]=now;
    for(const [key,at] of Object.entries(next.claims))if(now-at>7*86400000)delete next.claims[key];
    try{write(next);return due;}catch{return [];}
  }
  return {snapshot,command,claim};
}
module.exports={createPlannerStore};
