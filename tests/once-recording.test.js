const test=require('node:test'),assert=require('node:assert/strict');
const {createOnceRecording}=require('../main-once-recording');
const C=require('../renderer/assistant-capabilities');
test('five minute recording intent is one timed recording, not an unbound timer',()=>{
 for(const text of ['录音5分钟','帮我录音五分钟','给我录五分钟的音','请录音五分钟后停止'])assert.deepEqual(C.direct(text),{kind:'action',action:'start_recording',seconds:300});
 assert.equal(C.direct('录音1.5分钟').seconds,90);
 assert.equal(C.direct('计时五分钟'),null);assert.equal(C.direct('打开录音').action,'open_tool');
 assert.throws(()=>C.validate({kind:'action',action:'start_recording',seconds:0}));
});
test('300 second deadline claims once across repeated ticks and duplicate submissions',async()=>{
 let at=0,starts=0;const stops=[];
 const s=createOnceRecording({now:()=>at,start:async()=>({ok:true,recordingId:'r'+(++starts)}),stop:async id=>{stops.push(id);return {ok:true};}});
 const p={seconds:300,requestId:'one-request'};await Promise.all([s.begin(p),s.begin(p)]);assert.equal(starts,1);
 at=299999;assert.equal(await s.tick(),null);at=300000;await Promise.all([s.tick(),s.tick()]);assert.deepEqual(stops,['r1']);
 for(let i=0;i<10;i++){at+=300000;await s.tick();await s.begin(p);}assert.equal(starts,1);assert.deepEqual(stops,['r1']);
 assert.equal((await s.begin({...p,seconds:600})).error,'request_conflict');
});
test('stale deadline targets only original ID, later request replaces only deadline not audio',async()=>{
 let at=0,current='r1',starts=0;const targets=[];
 const s=createOnceRecording({now:()=>at,start:async()=>({ok:true,recordingId:current}),stop:async id=>{targets.push(id);return {ok:id===current};}});
 await s.begin({seconds:300,requestId:'a'});current='r2';at=300001;await s.tick();assert.deepEqual(targets,['r1']);
 await s.begin({seconds:300,requestId:'b'});at+=300000;await s.tick();assert.deepEqual(targets,['r1','r2']);
 const fresh=createOnceRecording({start:async()=>{starts++;},stop:async()=>{}});await fresh.tick();assert.equal(starts,0);
});
test('cancel during start stops the just-started session, busy requests never start',async()=>{
 let release,starts=0;const stopped=[];
 const s=createOnceRecording({start:()=>{starts++;return new Promise(r=>release=r);},stop:async id=>{stopped.push(id);return {ok:true};}});
 const pending=s.begin({seconds:300,requestId:'first'});
 assert.equal((await s.begin({seconds:300,requestId:'second'})).error,'recording_busy');
 s.cancel('first');release({ok:true,recordingId:'recording-cancelled'});assert.equal((await pending).error,'cancelled');assert.equal(starts,1);assert.deepEqual(stopped,['recording-cancelled']);assert.equal(s.active,null);
});
