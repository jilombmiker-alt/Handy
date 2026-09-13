(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.TranscriptionModel=value;})(globalThis,()=>{
  const config={input_audio_format:'pcm',sample_rate:16000,input_audio_transcription:{language:'zh'},turn_detection:{type:'server_vad',threshold:0.2,silence_duration_ms:800}};
  function contaminated(text){return /Handy\s*桌面助手[。．.\s]*术语[：:]/i.test(text);}
  function actionable(text){return !!String(text).replace(/[\s，。！？,.!?、]/g,'').replace(/^(?:嗯|呃|啊|哦|唔|额)+$/,'')&&!contaminated(text);}
  function observePcm(session,bytes){
    let sum=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const count=Math.floor(bytes.byteLength/2);
    for(let i=0;i<count;i++){const v=view.getInt16(i*2,true)/32768;sum+=v*v;}
    session.audibleSamples=(session.audibleSamples||0)+(count&&Math.sqrt(sum/count)>.0015?count:0);
  }
  function update(session,message){
    session.asrItems ||= new Map();session.asrSeen ||= new Set();
    if(message.event_id&&session.asrSeen.has(message.event_id))return false;
    if(message.event_id)session.asrSeen.add(message.event_id);
    const final=message.type==='conversation.item.input_audio_transcription.completed';
    if(!final&&message.type!=='conversation.item.input_audio_transcription.text')return false;
    const id=message.item_id||(final?(message.event_id||`unkeyed-${session.asrItems.size}`):'unkeyed-live');
    const old=session.asrItems.get(id);if(old?.final&&!final)return false;
    let text=final?String(message.transcript||'').trim():`${String(message.text||'')}${String(message.stash||'')}`.trim();
    if(contaminated(text)){session.contaminated=true;text='';}
    session.asrItems.set(id,{text,final});
    // Completion is keyed by utterance, not by its text: repeated spoken sentences
    // are legitimate, while duplicate network events are not new speech.
    if(!message.item_id&&final){for(const [key,v] of session.asrItems)if(!v.final)session.asrItems.delete(key);}
    session.finalSegments=[...session.asrItems.values()].filter(v=>v.final).map(v=>v.text);
    session.interim=[...session.asrItems.values()].filter(v=>!v.final).map(v=>v.text).join(' ');
    return true;
  }
  return {config,update,contaminated,actionable,observePcm};
});
