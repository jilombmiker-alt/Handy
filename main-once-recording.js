'use strict';
// Volatile by design: restarting an app never restarts a microphone.
function createOnceRecording({start,stop,now=Date.now}){
  const requests=new Map();let active=null,starting=false,pendingId='',cancelled=false;
  function begin({seconds,requestId}={}){
    if(!Number.isInteger(seconds)||seconds<1||seconds>86400||typeof requestId!=='string'||! /^[\w:-]{1,160}$/.test(requestId))return Promise.resolve({ok:false,error:'invalid_duration'});
    if(requests.has(requestId)){const prior=requests.get(requestId);return prior.seconds===seconds?prior.promise.then(r=>({...r,replayed:true})):Promise.resolve({ok:false,error:'request_conflict'});}
    if(starting)return Promise.resolve({ok:false,error:'recording_busy'});
    starting=true;pendingId=requestId;cancelled=false;
    const promise=(async()=>{
      try{
        const r=await start({seconds,requestId});
        if(!r?.ok||!r.recordingId)return {ok:false,error:r?.error||'start_failed'};
        if(cancelled){await stop(r.recordingId);return {ok:false,error:'cancelled'};}
        active={recordingId:r.recordingId,requestId,deadline:Number.isFinite(r.deadline)?r.deadline:now()+seconds*1000};
        return {ok:true,...active,seconds};
      }catch{return {ok:false,error:'start_failed'};}finally{starting=false;pendingId='';}
    })();
    requests.set(requestId,{seconds,promise});
    // Saturation must not evict a request and allow it to execute again.
    return promise;
  }
  async function tick(){
    if(!active||now()<active.deadline)return null;
    const job=active;active=null; // consume before awaiting, never recurrent
    try{return {job,result:await stop(job.recordingId)};}catch{return {job,result:{ok:false,error:'stop_failed'}};}
  }
  return {begin(p){if(requests.size>=1000&&!requests.has(p?.requestId))return Promise.resolve({ok:false,error:'request_limit'});return begin(p);},cancel(id){if(starting&&pendingId===id)cancelled=true;return {ok:true};},tick,get active(){return active?{...active}:null;}};
}
module.exports={createOnceRecording};
