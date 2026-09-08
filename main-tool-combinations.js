'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const TOOLS = Object.freeze({quick:'随手记',recorder:'录音','module:todo':'待办','module:links':'链接','module:pomodoro':'计时','module:music':'音乐','module:commands':'快捷资料包','module:gallery':'图片画廊'});
const defaults = () => [
  {id:'discussion',name:'临时讨论',tools:['quick','recorder','module:pomodoro']},
  {id:'writing',name:'写作',tools:['quick','module:links']},
  {id:'daily',name:'日常推进',tools:['module:todo','module:pomodoro']},
];
function validGroup(g) { return g && typeof g.id==='string' && /^[\w-]{1,80}$/.test(g.id) && typeof g.name==='string' && !!g.name.trim() && g.name.length<=24 && Array.isArray(g.tools) && g.tools.length>0 && g.tools.length<=8 && new Set(g.tools).size===g.tools.length && g.tools.every(k=>typeof k==='string'&&Object.hasOwn(TOOLS,k)); }
function createCombinationStore(file) {
  let state, loaded, error;
  function load() {
    const p=file(); if(loaded===p && state)return; loaded=p; error='';
    try { state=JSON.parse(fs.readFileSync(p,'utf8')); if(state.version!==1 || !Number.isSafeInteger(state.revision) || state.revision<0 || !Array.isArray(state.groups) || state.groups.length>20 || !state.groups.every(validGroup) || new Set(state.groups.map(g=>g.id)).size!==state.groups.length)throw Error(); }
    catch(e){state={version:1,revision:0,groups:defaults()};if(e.code!=='ENOENT')error='corrupt_store';}
  }
  function snapshot(){load();return error?{ok:false,error}:{ok:true,...structuredClone(state),tools:TOOLS};}
  function command(c){load();if(error)return {ok:false,error};if(!c || c.revision!==state.revision)return {ok:false,error:'conflict'};
    const next=structuredClone(state);
    if(c.action==='save'){
      const g={id:c.id || crypto.randomUUID(),name:typeof c.name==='string'?c.name.trim():'',tools:c.tools};
      if(!validGroup(g))return {ok:false,error:'invalid_group'};
      const index=next.groups.findIndex(v=>v.id===g.id);
      if(c.id && index<0)return {ok:false,error:'not_found'};
      if(index<0){if(next.groups.length>=20)return {ok:false,error:'group_limit'};next.groups.push(g);}else next.groups[index]=g;
    }else if(c.action==='delete'){
      if(!next.groups.some(v=>v.id===c.id))return {ok:false,error:'not_found'};
      next.groups=next.groups.filter(v=>v.id!==c.id);
    }else return {ok:false,error:'invalid_action'};
    next.revision++;
    const p=file(),tmp=p+'.'+crypto.randomUUID()+'.tmp';
    try{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});fs.renameSync(tmp,p);state=next;return snapshot();}
    catch{try{fs.unlinkSync(tmp);}catch{}return {ok:false,error:'save_failed'};}
  }
  return {snapshot,command};
}

// Find a free position without moving existing windows. Small screens report overflow.
function placeTool(size,area,occupied){
  for(let y=area.y+12;y+size.height<=area.y+area.height-12;y+=24){
    for(let x=area.x+12;x+size.width<=area.x+area.width-12;x+=24){
      const b={x,y,...size};
      if(!occupied.some(o=>b.x<o.x+o.width+12 && b.x+b.width+12>o.x && b.y<o.y+o.height+12 && b.y+b.height+12>o.y))return {bounds:b,overlap:false};
    }
  }
  return {bounds:{x:area.x+12,y:area.y+12,...size},overlap:true};
}
module.exports={TOOLS,defaults,validGroup,createCombinationStore,placeTool};
