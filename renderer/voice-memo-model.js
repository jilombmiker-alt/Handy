(function(root,factory){const model=factory();if(typeof module==='object')module.exports=model;if(root)root.VoiceMemoModel=model;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const text=(value,max=60000)=>typeof value==='string'?value.replace(/\0/g,'').slice(0,max):'';
  function normalize(value={}){
    return {rawTranscript:typeof value.rawTranscript==='string'?value.rawTranscript:'',cleaned:text(value.cleaned),summary:Array.isArray(value.summary)?value.summary.map(s=>text(s,1500)).filter(Boolean).slice(0,12):[],
      uncertainties:Array.isArray(value.uncertainties)?value.uncertainties.map(s=>text(s,500)).filter(Boolean).slice(0,12):[],
      markers:Array.isArray(value.markers)?value.markers.filter(m=>Number.isFinite(m?.offsetMs)).slice(0,100).map(m=>({offsetMs:Math.max(0,Math.round(m.offsetMs)),context:text(m.context,500)})):[],
      status:['idle','running','done','failed','cancelled'].includes(value.status)?value.status:'idle',error:text(value.error,80),updatedAt:Number(value.updatedAt)||0};
  }
  function result(value){
    if(typeof value==='string')value=JSON.parse(value.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    if(!value||typeof value.cleaned!=='string'||!value.cleaned.trim()||value.cleaned.length>18000||!Array.isArray(value.summary)||value.summary.length<1||value.summary.length>12||value.summary.some(s=>typeof s!=='string'||!s.trim()||s.length>1500))throw Error('invalid_response');
    return {cleaned:value.cleaned.trim(),summary:value.summary,uncertainties:normalize(value).uncertainties};
  }
  function source(input){
    if(!input||typeof input.text!=='string'||!input.text.trim())throw Error('empty_text');
    if(input.text.length>8000)throw Error('text_too_long');
    // Audio offsets point into the original text; avoid repeating long excerpts in requests.
    return {text:input.text,markers:normalize(input).markers.map(m=>({...m,context:m.context.slice(-80)}))};
  }
  return {normalize,result,source};
});
