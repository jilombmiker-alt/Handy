'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTimerStore}=require('../main-timer');
function fixture(){let at=100000;const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'timer-test-')),'timer.json'),store=createTimerStore(()=>file,{now:()=>at});return {store,file,advance:ms=>at+=ms,now:()=>at,cmd:c=>store.command({revision:store.snapshot().revision,id:store.snapshot().active?.id,...c})};}
test('countdown supports 90 minutes, accurate elapsed, pause and one due claim without completing',()=>{
 const f=fixture();assert.equal(f.cmd({action:'start',seconds:5400,title:'会议'}).ok,true);f.advance(30000);f.cmd({action:'pause'});f.advance(90000);assert.equal(f.store.snapshot().active.currentMs,30000);f.cmd({action:'resume'});f.advance(5370000);assert.ok(f.store.tick().due);assert.equal(f.store.tick().due,undefined);assert.equal(f.store.snapshot().history.length,0);assert.equal(f.store.snapshot().active.running,true);f.advance(120000);f.cmd({action:'finish'});assert.equal(f.store.snapshot().history[0].elapsedMs,5520000);assert.equal(f.store.snapshot().history[0].plannedMs,5400000);
});
test('stopwatch needs no duration, records independent history and rejects stale commands',()=>{
 const f=fixture();assert.equal(f.cmd({action:'start',mode:'countup',seconds:0}).ok,true);const stale=f.store.snapshot();f.advance(1234);assert.equal(f.store.tick().due,undefined);f.cmd({action:'finish'});assert.equal(f.store.snapshot().history[0].elapsedMs,1234);assert.equal(f.store.command({action:'finish',id:stale.active.id,revision:stale.revision}).error,'conflict');assert.equal(f.cmd({action:'start',mode:'countup',recordingId:'old'}).error,'invalid_recording');
});
test('restart restores paused checkpoint, normal quit pauses exactly and old store corruption survives',()=>{
 const f=fixture();f.cmd({action:'start',seconds:60});f.advance(5000);f.store.tick();f.advance(20000);const recovered=createTimerStore(()=>f.file,{now:f.now});assert.equal(recovered.snapshot().active.running,false);assert.equal(recovered.snapshot().active.currentMs,5000);assert.equal(recovered.snapshot().active.recovered,true);f.store.pauseForExit();assert.equal(createTimerStore(()=>f.file,{now:f.now}).snapshot().active.currentMs,25000);
 const broken=path.join(path.dirname(f.file),'broken.json');fs.writeFileSync(broken,'{invalid');const s=createTimerStore(()=>broken);assert.equal(s.snapshot().error,'corrupt_store');assert.equal(s.command({}).error,'corrupt_store');assert.equal(fs.readFileSync(broken,'utf8'),'{invalid');
});
test('failed saves do not mutate live state or consume a due event',()=>{
 const f=fixture();f.cmd({action:'start',seconds:1,recordingId:'recording-original'});f.advance(2000);const rename=fs.renameSync;fs.renameSync=()=>{throw Error('fixture');};try{assert.equal(f.store.tick().error,'save_failed');assert.equal(f.store.snapshot().active.notified,false);assert.equal(f.cmd({action:'finish'}).error,'save_failed');assert.equal(f.store.snapshot().history.length,0);}finally{fs.renameSync=rename;}assert.equal(f.store.tick().due.recordingId,'recording-original');assert.equal(f.store.tick().due,undefined);
});
