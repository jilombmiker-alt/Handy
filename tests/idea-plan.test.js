const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const I=require('../renderer/idea-plan-model'),M=require('../renderer/planner-model'),{createPlannerStore}=require('../main-planner');
function setup(){
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'idea-plan-unit-')),'planner.json'),store=createPlannerStore(()=>file);
  const record={id:'quick-1',revision:1,title:'给自己做学习卡片',content:'先整理三个最常用的知识点。',reviewChoice:'next-week',reviewWeek:'2026-09-07'};
  let counter=0,mode='ok',calls=0;
  const controller=I.controller({getRecord:id=>id===record.id?record:null,getPlanner:()=>store.snapshot(),clock:()=>new Date(2026,8,10,16).getTime(),uid:()=>`id-${++counter}`,
    applyPlanner:c=>{calls++;if(mode==='fail')return {ok:false,error:'save_failed'};const result=store.command(c);if(mode==='lost')throw Error('response lost');return result;}});
  return {file,store,record,controller,calls:()=>calls,mode:v=>{mode=v;}};
}
test('preview and cancel never write; user fields and source are saved atomically only on confirmation',async()=>{
  const f=setup(),p=await f.controller.request({operation:'prepare',recordId:f.record.id,revision:1});assert.equal(p.ok,true);assert.equal(p.values.date,'2026-09-14');assert.equal(fs.existsSync(f.file),false);
  const saved=await f.controller.request({operation:'confirm',token:p.token,values:{...p.values,title:'先做三张学习卡片',date:'2026-09-12'}});assert.equal(saved.ok,true);
  const item=f.store.snapshot().state.items[0];assert.equal(item.title,'先做三张学习卡片');assert.equal(item.scheduled,false);assert.equal(item.body,f.record.content);assert.equal(item.sourceIdea.id,f.record.id);assert.equal(f.record.content,'先整理三个最常用的知识点。');
  assert.equal(f.store.snapshot().state.events[0].after.sourceIdea.id,f.record.id);
  const g=setup(),draft=await g.controller.request({operation:'prepare',recordId:g.record.id,revision:1});await g.controller.request({operation:'cancel',token:draft.token});assert.equal(g.store.snapshot().state.items.length,0);assert.equal((await g.controller.request({operation:'confirm',token:draft.token,values:draft.values})).error,'draft_expired');
});
test('failure, uncertain response, double confirmation and restart do not duplicate tasks',async()=>{
  const f=setup(),p=await f.controller.request({operation:'prepare',recordId:f.record.id,revision:1}),c={operation:'confirm',token:p.token,values:p.values};
  f.mode('fail');assert.equal((await f.controller.request(c)).error,'save_failed');assert.equal(f.store.snapshot().state.items.length,0);
  f.mode('lost');assert.equal((await f.controller.request(c)).error,'request_failed');assert.equal(f.store.snapshot().state.items.length,1);
  f.mode('ok');assert.equal((await f.controller.request(c)).ok,true);assert.equal((await f.controller.request(c)).ok,true);assert.equal(f.calls(),2);
  const restarted=createPlannerStore(()=>f.file),next=I.controller({getRecord:()=>f.record,getPlanner:()=>restarted.snapshot(),applyPlanner:()=>assert.fail('must reuse')});
  assert.equal((await next.request({operation:'prepare',recordId:f.record.id,revision:1})).saved.id,f.store.snapshot().state.items[0].id);
});
test('changed or trashed source, invalid dates and partial time ranges cannot commit',async()=>{
  const f=setup(),p=await f.controller.request({operation:'prepare',recordId:f.record.id,revision:1}),c={operation:'confirm',token:p.token,values:p.values};
  f.record.revision=2;assert.equal((await f.controller.request(c)).error,'source_changed');f.record.revision=1;f.record.trashedAt=1;assert.equal((await f.controller.request(c)).error,'source_changed');delete f.record.trashedAt;
  for(const values of [{date:'2026-02-30'},{start:'09:00'},{start:'10:00',end:'09:00'},{title:''},{title:'x'.repeat(201)}])assert.equal((await f.controller.request({...c,values:{...p.values,...values}})).ok,false);
  assert.equal(f.store.snapshot().state.items.length,0);
  assert.equal((await f.controller.request({...c,values:{...p.values,start:'09:00',end:'10:00'}})).ok,true);
});
test('source metadata survives editing and archive; existing done work is reused',async()=>{
  const f=setup(),p=await f.controller.request({operation:'prepare',recordId:f.record.id,revision:1});await f.controller.request({operation:'confirm',token:p.token,values:p.values});
  let s=f.store.snapshot().state;const id=s.items[0].id;f.store.command({action:'apply',revision:s.revision,requestId:'finish',changes:[{id,mode:'update',status:'done',archived:true}]});
  s=f.store.snapshot().state;assert.equal(s.items[0].sourceIdea.id,f.record.id);const reused=await f.controller.request({operation:'prepare',recordId:f.record.id,revision:1});assert.equal(reused.saved.status,'done');assert.equal(reused.saved.archived,true);
  assert.throws(()=>M.item({...s.items[0],sourceIdea:{id:'x',revision:0,title:'bad'}}),/invalid_state/);
});
test('long source is linked without silent truncation; stale weekly intentions do not roll forward',async()=>{
  const f=setup();f.record.content='x'.repeat(9000);const p=await f.controller.request({operation:'prepare',recordId:f.record.id,revision:1});assert.equal(p.longSource,true);
  await f.controller.request({operation:'confirm',token:p.token,values:p.values});assert.equal(f.store.snapshot().state.items[0].body,'');assert.equal(f.record.content.length,9000);
  assert.equal(I.dateFor({...f.record,reviewWeek:'2026-08-31'},new Date(2026,8,10).getTime()),'2026-09-10');
  assert.equal(I.dateFor({...f.record,reviewChoice:'weekend'},new Date(2026,8,13).getTime()),'2026-09-13');
});
