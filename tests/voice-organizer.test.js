const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../renderer/voice-memo-model');
const Domain=require('../renderer/domain');
const {SYSTEM,createVoiceOrganizer}=require('../ai/voice-organizer');
const output={cleaned:'暂定周六完成，预算 120 元。',summary:['暂定周六完成'],uncertainties:[]};
const config={apiKey:'synthetic-test-key',model:'synthetic',baseUrl:'https://example.com/v1'};
const options={getConfig:()=>config,validateEndpoint:async url=>url,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}))};
test('voice metadata preserves immutable original and legacy recording compatibility',()=>{
  const original='嗯，可能周五，不对，周六。'+ '正文'.repeat(35000);
  const row=Domain.createRecording({id:'recording-1',transcript:original,voice:{rawTranscript:original,cleaned:'可能周六。'}});
  assert.equal(row.voice.rawTranscript,original);assert.equal(row.transcript,original);
  assert.equal(Domain.createRecording({id:'recording-old'}).voice,undefined);
  assert.equal(M.normalize({markers:[{offsetMs:-4},{offsetMs:NaN}]}).markers.length,1);
});
test('voice request is bounded, original text is not silently truncated',()=>{
  assert.throws(()=>M.source({text:'x'.repeat(8001)}),/text_too_long/);
  assert.throws(()=>M.source({text:' '}),/empty_text/);
  assert.equal(M.source({text:'想法',markers:Array.from({length:200},()=>({offsetMs:1,context:'x'.repeat(600)}))}).markers.length,100);
  assert.equal(M.source({text:'想法',markers:[{offsetMs:1,context:'x'.repeat(600)}]}).markers[0].context.length,80);
});
test('voice cleanup uses faithful correction rules and never exposes configuration',async()=>{
  let sent;const service=createVoiceOrganizer({...options,fetchImpl:async(url,req)=>{sent=JSON.parse(req.body);assert.equal(req.redirect,'error');return options.fetchImpl();}});
  assert.deepEqual(await service.generate('recording-one',{text:'嗯，暂定周五，不对周六，预算120元。'}),{ok:true,...output});
  assert.equal(sent.max_tokens,8000);assert.match(SYSTEM,/可能、暂定、我不确定/);assert.match(SYSTEM,/后一次明确表达/);assert.match(SYSTEM,/不擅自猜词或发言人/);
});
test('voice failures, malformed output and provider truncation are retryable and safe',async()=>{
  assert.equal((await createVoiceOrganizer({...options,getConfig:()=>({})}).generate('recording-one',{text:'想法'})).error,'not_configured');
  for(const [status,error] of [[401,'unauthorized'],[429,'rate_limited'],[500,'request_failed']]){
    const service=createVoiceOrganizer({...options,fetchImpl:async()=>new Response('private error',{status})});
    assert.deepEqual(await service.generate('recording-one',{text:'想法'}),{ok:false,error});
  }
  for(const result of [{choices:[{message:{content:'garbage'}}]},{choices:[{message:{content:JSON.stringify(output)},finish_reason:'length'}]}]){
    const service=createVoiceOrganizer({...options,fetchImpl:async()=>new Response(JSON.stringify(result))});
    assert.equal((await service.generate('recording-one',{text:'想法'})).error,'invalid_response');
  }
  assert.throws(()=>M.result({cleaned:'正文',summary:[]}),/invalid_response/);
});
test('voice cancellation, timeout, duplicate request and concurrency are bounded',async()=>{
  const service=createVoiceOrganizer({...options,timeoutMs:40,fetchImpl:()=>new Promise(()=>{})});
  const first=service.generate('recording-one',{text:'想法'}),second=service.generate('recording-two',{text:'想法'});
  assert.equal((await service.generate('recording-one',{text:'想法'})).error,'busy');
  assert.equal((await service.generate('recording-three',{text:'想法'})).error,'busy');
  service.cancel('recording-one');assert.equal((await first).error,'cancelled');
  assert.equal((await second).error,'timeout');
  assert.equal((await service.generate('../bad',{text:'想法'})).error,'invalid_id');
});
