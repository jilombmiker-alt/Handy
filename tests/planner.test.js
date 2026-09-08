const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../renderer/planner-model'),{createPlannerStore}=require('../main-planner'),{createPlannerAI}=require('../ai/planner');
const {normalizeProposal}=require('../ai/planner');
const at=new Date('2026-09-06T09:00').getTime();
const row=(id='plan-one')=>({mode:'add',id,title:'对齐需求',start:at,end:at+3600000,topic:'产品上线',area:'work',fixed:true,status:'planned',progress:'',next:''});
test('planner keeps time blocks distinct from completed status and detects overlap',()=>{
  let s=M.apply(M.empty(),[row(),{...row('plan-two'),start:at+1800000,fixed:false}]);
  assert.equal(M.conflicts(s.items).length,1);assert.equal(s.items[0].status,'planned');
  assert.equal(M.focus(s.items,at+1000).current.id,'plan-one');
  s=M.apply(s,[{mode:'update',id:'plan-one',status:'done',progress:'需求已确认',next:'补充异常状态'}]);
  assert.equal(s.items[1].start,at+1800000);assert.equal(s.events.length,3);assert.equal(M.conflicts(s.items).length,0);
  assert.throws(()=>M.apply(s,[{mode:'update',id:'plan-one',end:at}]),/invalid_time/);
  assert.throws(()=>M.apply(s,[{mode:'update',id:'plan-unknown',status:'done'}]),/not_found/);
});
test('planner reminders are claimed once, never complete tasks, skip old days and disabled state',()=>{
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'planner-')),'state.json'),store=createPlannerStore(()=>file);
  assert.equal(store.command({action:'apply',changes:[row()],revision:0,requestId:'one'}).ok,true);
  assert.equal(store.claim(at+1000)[0].phase,'start');assert.equal(store.claim(at+2000).length,0);
  assert.equal(store.claim(at+3600000)[0].phase,'end');assert.equal(store.snapshot().state.items[0].status,'planned');
  assert.equal(createPlannerStore(()=>file).claim(at+3601000).length,0);
  assert.equal(store.claim(at+86400000).length,0);
  const disabled={...M.apply(M.empty(),[row()]),reminders:false};assert.deepEqual(M.due(disabled,at+1000),[]);
});
test('planner atomic batch, revision conflict, idempotence, undo and soft archive',()=>{
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'planner-')),'state.json'),store=createPlannerStore(()=>file);
  const c={action:'apply',changes:[row()],revision:0,requestId:'same'};
  assert.equal(store.command(c).ok,true);assert.equal(store.command(c).state.items.length,1);
  assert.equal(store.command({...c,requestId:'stale'}).error,'conflict');
  assert.equal(store.command({action:'apply',changes:[{mode:'update',id:'plan-one',status:'done'},{...row('plan-two'),end:0}],revision:1,requestId:'bad'}).ok,false);
  assert.equal(store.snapshot().state.items[0].status,'planned');
  assert.equal(store.command({action:'apply',changes:[{mode:'update',id:'plan-one',archived:true}],revision:1,requestId:'archive'}).state.items[0].archived,true);
  assert.equal(store.command({action:'undo',revision:2,requestId:'undo'}).state.items[0].archived,false);
  assert.equal(store.snapshot().state.events.length,3,'undo keeps the archive and reversal audit');
  assert.equal(store.snapshot().state.events[2].undo,true);
  assert.equal(createPlannerStore(()=>file).snapshot().state.revision,3);
});
test('planner corruption is preserved and failed disk writes leave state unchanged',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'planner-')),file=path.join(dir,'bad.json');fs.writeFileSync(file,'not json');
  const store=createPlannerStore(()=>file);assert.equal(store.snapshot().error,'corrupt_store');
  assert.equal(store.command({action:'apply',changes:[row()],revision:0,requestId:'x'}).error,'corrupt_store');assert.equal(fs.readFileSync(file,'utf8'),'not json');
  const blocked=createPlannerStore(()=>path.join(dir,'bad.json','child'));assert.equal(blocked.snapshot().ok,false);
  const writable=createPlannerStore(()=>path.join(dir,'good.json'));writable.snapshot();
  const original=fs.renameSync;fs.renameSync=()=>{throw Object.assign(Error('synthetic disk full'),{code:'ENOSPC'});};
  try{assert.equal(writable.command({action:'apply',changes:[row()],revision:0,requestId:'disk-full'}).error,'save_failed');assert.equal(writable.snapshot().state.items.length,0);}finally{fs.renameSync=original;}
});
test('planner AI only proposes; empty credentials, cancellation and malformed output are safe',async()=>{
  const opts={getConfig:()=>({}),validateEndpoint:async u=>u,fetchImpl:async()=>{throw Error('must not call');}};
  const input={text:'上午对需求',day:'2026-09-06',items:[]};
  assert.equal((await createPlannerAI(opts).generate(1,input)).error,'not_configured');
  const cfg={getConfig:()=>({apiKey:'test',model:'synthetic',baseUrl:'https://example.com/v1'}),validateEndpoint:async u=>u};
  const ai=createPlannerAI({...cfg,fetchImpl:()=>new Promise(()=>{}),timeoutMs:20});
  const run=ai.generate(1,input);assert.equal((await ai.generate(1,input)).error,'busy');ai.cancel(1);assert.equal((await run).error,'cancelled');
  assert.equal((await ai.generate(2,input)).error,'timeout');
  const bad=createPlannerAI({...cfg,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'invalid'}}]}))});assert.equal((await bad.generate(1,input)).error,'invalid_response');
});
test('production AI parser accepts minimal adds and partial updates without weakening validation',async()=>{
  const original=M.item(row()),input={text:'需求已经完成',day:'2026-09-06',items:[original]};
  const cfg={getConfig:()=>({apiKey:'test',model:'synthetic',baseUrl:'https://example.com/v1'}),validateEndpoint:async u=>u};
  const ai=createPlannerAI({...cfg,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({changes:[{mode:'update',id:original.id,status:'done'}],reply:'确认后更新这一步。'})}}]}))});
  const r=await ai.generate(1,input);assert.equal(r.ok,true);assert.equal(r.changes[0].start,original.start);assert.equal(r.changes[0].fixed,true);assert.equal(r.changes[0].status,'done');assert.equal(original.status,'planned');
  const minimal=normalizeProposal({changes:[{mode:'add',title:'对需求',start:'2026-09-06T10:00:00',end:'2026-09-06 11:00:00',topic:null}]},input);
  assert.equal(minimal.changes[0].status,'planned');assert.equal(minimal.changes[0].topic,'');
  assert.throws(()=>normalizeProposal({changes:[{mode:'update',id:'plan-unknown',status:'done'}]},input),/unknown_item/);
  assert.throws(()=>normalizeProposal({changes:[{mode:'add',title:'坏日期',start:'2026-02-31T10:00',end:'2026-02-31T11:00'}]},input),/invalid_time/);
  assert.throws(()=>normalizeProposal({changes:[{mode:'update',id:original.id,status:'nonsense'}]},input),/invalid_state/);
  const missing=normalizeProposal({changes:[{mode:'add',title:'想做一件事'}]},input);assert.equal(missing.changes.length,1);assert.equal(missing.changes[0].scheduled,false);assert.equal(missing.changes[0].date,input.day);
  assert.ok(normalizeProposal({changes:[]},input).reply);
});
test('unscheduled raw text and weekly goals keep history, future dates and reminder boundaries',()=>{
  const raw='  整理想法\n  不要自动改字  ',r={...row(),scheduled:false,start:null,end:null,date:'2026-09-07',until:'2026-09-13',kind:'goal',body:raw,category:'P2'};
  let s=M.apply(M.empty(),[r],at,'原话');assert.equal(s.items[0].body,raw);assert.deepEqual(M.due(s,at),[]);assert.equal(M.focus(s.items,at).current,null);assert.deepEqual(M.conflicts(s.items),[]);
  assert.equal(M.query(s,{date:'2026-09-10',range:'week'}).length,1);assert.equal(M.query(s,{date:'2026-09-06',range:'future'}).length,1);assert.equal(M.query(s,{date:'2026-09-20',range:'history'}).length,1);
  assert.equal(M.query(s,{date:'2026-09-10',range:'all',search:'不要自动',category:'P2'}).length,1);
  s=M.apply(s,[{mode:'update',id:r.id,status:'done',progress:'完成第一版'}],at+1000);
  assert.equal(M.history(s,r.id)[0].at,at+1000);assert.equal(M.eventLabel(M.history(s,r.id)[0]),'标记完成 · 记录进展');assert.match(M.habits(s,s.items),/不代表实际用时/);
  assert.throws(()=>M.item({...r,date:'2026-02-31'}),/invalid_time/);assert.throws(()=>M.item({...r,start:at}),/invalid_time/);
});
test('settings retain reminders and legacy schema, persist AI opt-in and categories',()=>{
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'planner-settings-')),'state.json');const old=M.empty();delete old.aiEnabled;delete old.categories;fs.writeFileSync(file,JSON.stringify(old));
  const store=createPlannerStore(()=>file);assert.notEqual(store.snapshot().state.aiEnabled,true);
  let s=store.command({action:'settings',revision:0,requestId:'ai-on',aiEnabled:true}).state;assert.equal(s.reminders,true);
  s=store.command({action:'settings',revision:1,requestId:'category',categories:{'cat-extra':'备选'}}).state;assert.equal(s.aiEnabled,true);assert.equal(s.categories['cat-extra'],'备选');
  assert.equal(createPlannerStore(()=>file).snapshot().state.aiEnabled,true);
  assert.equal(store.command({action:'settings',revision:2,requestId:'bad',aiEnabled:'yes'}).error,'invalid_request');
});
test('AI conversation uses bounded supplied context; discuss never changes goals',()=>{
  const {buildContext}=require('../ai/planner');let s=M.empty();for(let n=0;n<5;n++)s=M.apply(s,Array.from({length:20},(_,j)=>row(`plan-${n}-${j}`)));
  const input={day:'2026-09-06',scope:'week',mode:'discuss',text:'我还没决定本周目标',conversation:[{role:'assistant',text:'可以考虑先准备材料'}]};
  const context=buildContext(s,input,{items:[{text:'旧待办',done:true}]});assert.equal(context.items.length,60);assert.equal(context.events.length,30);assert.equal(context.coverage.total,100);assert.equal(context.legacy[0].done,true);assert.match(context.legacy[0].history,/只读/);
  const p=normalizeProposal({changes:[{mode:'add',title:'不得擅自决定'}],reply:'先核对周五交付的范围。'},context);assert.equal(p.changes.length,0);assert.match(p.reply,/周五/);
  assert.throws(()=>buildContext(s,{...input,day:'2026-02-31'}),/invalid_input/);
});
