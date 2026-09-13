'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const clone=v=>JSON.parse(JSON.stringify(v));
const elapsed=(s,now)=>s.elapsedMs+(s.running?Math.max(0,now-s.segmentAt):0);
function createTimerStore(file,{now=Date.now}={}){
  let state=null,loaded='',error='';
  const empty=()=>({version:1,revision:0,active:null,history:[],settings:{mode:'countdown',seconds:1800,title:''}});
  function valid(s){
    const session=v=>v&&typeof v.id==='string'&&['countdown','countup'].includes(v.mode)&&typeof v.title==='string'&&v.title.length<=200&&Number.isFinite(v.elapsedMs)&&v.elapsedMs>=0&&Number.isFinite(v.startedAt)&&Number.isFinite(v.segmentAt)&&Number.isFinite(v.checkpointAt)&&Number.isFinite(v.plannedMs)&&v.plannedMs>=0&&v.plannedMs<=86400000&&typeof v.running==='boolean'&&typeof v.notified==='boolean'&&typeof v.recordingId==='string';
    if(!s||s.version!==1||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.history)||s.history.length>10000||s.history.some(v=>!session(v)||!Number.isFinite(v.endedAt))||s.active&&!session(s.active)||!s.settings||!['countdown','countup'].includes(s.settings.mode)||!Number.isInteger(s.settings.seconds)||s.settings.seconds<1||s.settings.seconds>86400||typeof s.settings.title!=='string')throw Error('corrupt_store');
    return s;
  }
  function write(next){const p=file(),tmp=`${p}.${crypto.randomUUID()}.tmp`;try{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(tmp,JSON.stringify(valid(next)),{mode:0o600,flag:'wx'});fs.renameSync(tmp,p);}catch(e){try{fs.unlinkSync(tmp);}catch{}throw Error('save_failed');}state=next;}
  function load(){const p=file();if(loaded===p&&state)return;loaded=p;error='';try{state=valid(JSON.parse(fs.readFileSync(p,'utf8')));if(state.active?.running){const a=state.active;a.elapsedMs=elapsed(a,a.checkpointAt);a.running=false;a.segmentAt=a.checkpointAt;a.recovered=true;}}catch(e){state=empty();if(e.code!=='ENOENT')error='corrupt_store';}}
  function snapshot(){load();if(error)return {ok:false,error};const result=clone(state);if(result.active)result.active.currentMs=elapsed(result.active,now());return {ok:true,...result};}
  function command(c){load();if(error)return {ok:false,error};try{
    if(!c||c.revision!==state.revision)throw Error('conflict');
    const next=clone(state),at=now();let a=next.active;
    if(c.action==='start'||c.action==='replace'){
      if(c.action==='replace'){
        if(!a||c.id!==a.id)throw Error('stale_session');
        if(next.history.length>=10000)throw Error('history_full');
        next.history.push({...a,elapsedMs:elapsed(a,at),running:false,endedAt:at});a=null;
      }
      if(a)throw Error('timer_busy');
      const mode=c.mode||next.settings.mode,seconds=mode==='countup'?next.settings.seconds:Number(c.seconds??next.settings.seconds),title=String(c.title||'').trim();
      if(!['countup','countdown'].includes(mode)||!Number.isInteger(seconds)||seconds<1||seconds>86400||title.length>200)throw Error('invalid_duration');
      if(c.recordingId&&mode!=='countdown')throw Error('invalid_recording');
      next.active={id:crypto.randomUUID(),mode,title,planId:c.planId||'',plannedMs:mode==='countdown'?seconds*1000:0,elapsedMs:0,startedAt:at,segmentAt:at,checkpointAt:at,running:true,notified:false,recordingId:c.recordingId||'',recovered:false};
      next.settings={mode,seconds,title};
    }else{
      if(!a||c.id!==a.id)throw Error('stale_session');
      if(c.action==='pause'){a.elapsedMs=elapsed(a,at);a.running=false;}
      else if(c.action==='resume'){if(a.running)throw Error('timer_busy');a.running=true;a.recovered=false;}
      else if(c.action==='finish'){
        if(next.history.length>=10000)throw Error('history_full');
        a.elapsedMs=elapsed(a,at);a.running=false;next.history.push({...a,endedAt:at});next.active=null;
      }else throw Error('invalid_action');
      a.segmentAt=at;a.checkpointAt=at;
    }
    next.revision++;write(next);return snapshot();
  }catch(e){return {ok:false,error:e.message};}}
  function tick(){load();if(error||!state.active?.running)return {ok:!error};const at=now(),a=state.active;
    const due=a.mode==='countdown'&&!a.notified&&elapsed(a,at)>=a.plannedMs;
    if(!due&&at-a.checkpointAt<5000)return {ok:true};
    const next=clone(state);next.active.checkpointAt=at;if(due){next.active.notified=true;next.revision++;}
    try{write(next);return {ok:true,due:due?clone(next.active):null};}catch{return {ok:false,error:'save_failed'};}
  }
  function pauseForExit(){const s=snapshot();return s.ok&&s.active?.running?command({action:'pause',revision:s.revision,id:s.active.id}):s;}
  return {snapshot,command,tick,pauseForExit};
}
function timerPresentation(snapshot){
  const a=snapshot?.ok&&snapshot.active;
  if(!a)return {title:'',menu:'打开计时小窗',active:false};
  const remaining=a.mode==='countdown'?Math.max(0,a.plannedMs-a.currentMs):a.currentMs;
  const seconds=a.mode==='countdown'?Math.ceil(remaining/1000):Math.floor(remaining/1000);
  const time=(seconds>=3600?String(Math.floor(seconds/3600)).padStart(2,'0')+':':'')+String(Math.floor(seconds/60)%60).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  const due=a.mode==='countdown'&&remaining===0;
  const title=due?'◷ 时间到':`${a.running?'◷':'Ⅱ'} ${time}`;
  return {title,active:true,menu:`${due?'时间到':a.running?(a.mode==='countdown'?'剩余 ':'已用 ')+time:'已暂停 '+time} · 打开计时小窗`};
}
module.exports={createTimerStore,elapsed,timerPresentation};
