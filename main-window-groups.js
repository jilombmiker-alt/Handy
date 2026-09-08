'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const clone=v=>structuredClone(v);
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const validId=v=>typeof v==='string'&&/^[\w-]{1,180}$/.test(v);
const sameApp=(a,b)=>a.appPath?b.appPath===a.appPath:a.appName===b.appName;
function createWindowGroups({file,scan}){
  let state,loaded,error='';const bindings=new Map();
  function load(){const p=file();if(loaded===p&&state)return;loaded=p;error='';bindings.clear();
    try{state=JSON.parse(fs.readFileSync(p,'utf8'));const ids=new Set();
      if(state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.groups)||state.groups.length>20)throw Error();
      for(const g of state.groups){if(!validId(g.id)||ids.has(g.id)||!text(g.name,24)||!Array.isArray(g.members)||!g.members.length||g.members.length>30)throw Error();ids.add(g.id);
        for(const m of g.members){if(!validId(m.refId)||ids.has(m.refId)||!text(m.appName,160)||!text(m.title,240)||typeof m.appPath!=='string'||m.appPath.length>4096)throw Error();ids.add(m.refId);}
      }
    }catch(e){state={version:1,revision:0,groups:[]};if(e.code!=='ENOENT')error='corrupt_store';}
  }
  function resolve(m,source){
    if(source.error)return {...m,status:'unknown',id:null};
    const rows=source.items||[],binding=bindings.get(m.refId);
    let target=binding&&rows.find(v=>v.id===binding&&sameApp(m,v));
    if(!target){bindings.delete(m.refId);const matches=rows.filter(v=>sameApp(m,v)&&v.title===m.title);
      if(matches.length>1||(!m.appPath&&matches.length))return {...m,status:'ambiguous',id:null};target=matches[0];
    }
    if(!target)return {...m,status:'closed',id:null};
    bindings.set(m.refId,target.id);return {...m,status:'open',id:target.id,title:target.title,icon:target.icon||null};
  }
  function snapshot(){load();if(error)return {ok:false,error};const source=scan();
    const groups=state.groups.map(g=>({...clone(g),members:g.members.map(m=>resolve(m,source))}));
    for(const g of groups){const used=new Map();g.members.forEach(m=>{if(m.id)used.set(m.id,(used.get(m.id)||0)+1);});g.members.forEach(m=>{if(m.id&&used.get(m.id)>1){m.status='ambiguous';m.id=null;}});}
    return {ok:true,revision:state.revision,groups,scanError:source.error||null};
  }
  function command(c){load();if(error)return {ok:false,error};if(!c||c.revision!==state.revision)return {ok:false,error:'conflict'};
    const next=clone(state),index=next.groups.findIndex(g=>g.id===c.id),pendingBindings=[];
    if(c.action==='delete'){if(index<0)return {ok:false,error:'not_found'};next.groups.splice(index,1);}
    else if(c.action==='save'){
      if(c.id&&index<0)return {ok:false,error:'not_found'};
      const name=typeof c.name==='string'?c.name.trim():'';
      if(!text(name,24)||!Array.isArray(c.members)||!c.members.length||c.members.length>30)return {ok:false,error:'invalid_group'};
      if(index<0&&next.groups.length>=20)return {ok:false,error:'group_limit'};
      const source=scan(),old=index<0?[]:next.groups[index].members,seen=new Set(),members=[];
      for(const choice of c.members){let member;
        if(choice?.refId){member=old.find(m=>m.refId===choice.refId);if(!member)return {ok:false,error:'invalid_member'};}
        else {if(source.error)return {ok:false,error:'scan_required'};const target=(source.items||[]).find(v=>v.id===choice?.windowId);if(!target||!text(target.appName,160)||!text(target.title,240)||typeof (target.appPath||'')!=='string'||(target.appPath||'').length>4096)return {ok:false,error:'stale_window'};
          member={refId:crypto.randomUUID(),appPath:target.appPath||'',appName:target.appName,title:target.title};pendingBindings.push([member.refId,target.id]);
        }
        const key=choice.refId?'ref:'+choice.refId:'window:'+choice.windowId;if(seen.has(key))return {ok:false,error:'duplicate_window'};seen.add(key);members.push(member);
      }
      const group={id:c.id||crypto.randomUUID(),name,members};if(index<0)next.groups.push(group);else next.groups[index]=group;
    }else return {ok:false,error:'invalid_action'};
    const p=file(),tmp=p+'.'+crypto.randomUUID()+'.tmp';next.revision++;
    try{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});fs.renameSync(tmp,p);state=next;pendingBindings.forEach(([key,id])=>bindings.set(key,id));const retained=new Set(state.groups.flatMap(g=>g.members.map(m=>m.refId)));for(const key of bindings.keys())if(!retained.has(key))bindings.delete(key);return snapshot();}
    catch{try{fs.unlinkSync(tmp);}catch{}return {ok:false,error:'save_failed'};}
  }
  return {snapshot,command};
}
module.exports={createWindowGroups};
