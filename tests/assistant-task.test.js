const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const C=require('../renderer/assistant-capabilities'),A=require('../ai/assistant-entry'),P=require('../renderer/planner-model');
const {createTimerStore}=require('../main-timer');
test('compound actions validate all steps and parameters before dispatch',()=>{
 const data=A.context({text:'十五分钟计时、打开音乐、写笔记'},P.empty());
 const p={kind:'actions',actions:[{kind:'action',action:'start_timer',seconds:900},{kind:'action',action:'open_music'},{kind:'action',action:'new_note',format:'plain'}]};
 assert.deepEqual(A.normalize(p,data),p);
 for(const seconds of [0,-1,1.2,86401,'900'])assert.throws(()=>C.actions({...p,actions:[{kind:'action',action:'start_timer',seconds}]}));
 for(const actions of [[],Array(7).fill(p.actions[0]),[p.actions[0],{kind:'action',action:'shell'}]])assert.throws(()=>C.actions({...p,actions}));
 assert.equal(C.direct('我要做会议记录').format,'meeting');
 assert.equal(C.direct('打开会前整理').tool,'meeting');
 assert.equal(C.direct('查看明天的安排然后打开笔记'),null);
});
test('current task conversation is bounded independently of opt-in library history',()=>{
 const s=P.empty(),conversation=[{role:'user',text:'明天的计划'},{role:'assistant',text:'请继续补充'}];
 const data=A.context({text:'下午准备讨论',conversation,useHistory:false,previousProposal:{kind:'plan',changes:[]}},s);
 assert.deepEqual(data.conversation,conversation);assert.deepEqual(data.items,[]);assert.deepEqual(data.previousProposal.changes,[]);
 for(const c of [[{role:'system',text:'bad'}],Array(13).fill(conversation[0]),[{role:'user',text:'x'.repeat(8001)}]])assert.throws(()=>A.context({text:'补充',conversation:c},s));
});
test('timer replacement is atomic, explicit and revision/session guarded',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handy-task-timer-'));let now=100;
 const store=createTimerStore(()=>path.join(dir,'timer.json'),{now:()=>now});
 const a=store.command({action:'start',revision:0,seconds:900});assert.equal(a.ok,true);now+=5000;
 assert.equal(store.command({action:'start',revision:a.revision,seconds:300}).error,'timer_busy');
 assert.equal(store.command({action:'replace',revision:0,id:a.active.id,seconds:300}).error,'conflict');
 assert.equal(store.command({action:'replace',revision:a.revision,id:'wrong',seconds:300}).error,'stale_session');
 assert.equal(store.command({action:'replace',revision:a.revision,id:a.active.id,seconds:0}).error,'invalid_duration');
 assert.equal(store.snapshot().history.length,0);
 const b=store.command({action:'replace',revision:a.revision,id:a.active.id,seconds:300});assert.equal(b.ok,true);assert.equal(b.active.plannedMs,300000);assert.equal(b.history[0].id,a.active.id);assert.equal(b.history[0].elapsedMs,5000);
});
