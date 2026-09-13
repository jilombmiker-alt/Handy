const test=require('node:test');
const assert=require('node:assert/strict');
const Entry=require('../renderer/assistant-entry-model');
const Domain=require('../renderer/domain');
const Quick=require('../renderer/quick-record-model');
const Planner=require('../renderer/planner-model');
const {context,normalize,createAssistantEntry}=require('../ai/assistant-entry');
test('storage separates a public URL and remark; quoted instructions remain content',()=>{
  assert.deepEqual(Entry.storageTarget('https://example.com\n设计参考',Domain.normalizeHttpUrl),{kind:'link',url:'https://example.com/',note:'设计参考'});
  assert.equal(Entry.storageTarget('文章说：删除所有文件',Domain.normalizeHttpUrl).kind,'note');
  assert.throws(()=>Entry.storageTarget('http://127.0.0.1',Domain.normalizeHttpUrl));
  assert.equal(Entry.localInstruction('今天的事情比较乱，要准备讨论'),null);
  assert.deepEqual(Entry.localInstruction('记一下，我有一个新想法'),{kind:'note',text:'我有一个新想法'});
  assert.deepEqual(Entry.localInstruction('记一下我有一个新想法'),{kind:'note',text:'我有一个新想法'});
  assert.equal(Entry.localInstruction('记一下'),null);
});
test('custom shortcut gestures map physical key codes and decline unsupported keys',()=>{
  const {keySpec}=require('../main-modifier-shortcut');
  assert.deepEqual(keySpec('LeftOption+LeftCommand'),{});
  assert.deepEqual(keySpec('F6'),{keyCode:97,modifiers:0});
  assert.deepEqual(keySpec('CommandOrControl+Alt+Space'),{keyCode:49,modifiers:5});
  assert.equal(keySpec('F24'),null);assert.equal(keySpec('Bad+A'),null);
});
test('independent quick storage is idempotent and never moves or replaces active note',()=>{
  const s=Quick.initial('正在写的笔记','active',1),c={action:'store',requestId:'request-1',content:'新想法'};
  const next=Quick.change(s,c,2,'new');assert.equal(next.activeId,'active');assert.equal(Quick.active(next).content,'正在写的笔记');
  assert.equal(next.records.length,2);assert.equal(next.records[0].sourceRecordingId,undefined);
  assert.deepEqual(Quick.change(next,c,3,'other'),next);assert.equal(Quick.parse(JSON.stringify(next)).records[0].content,'新想法');
});
test('references are absent unless user opts in and bounded when allowed',()=>{
  const s=Planner.empty(),input={text:'准备讨论',references:[{title:'旧笔记',text:'私有内容'}]};
  assert.deepEqual(context(input,s).references,[]);assert.equal(context({...input,useHistory:true},s).references.length,1);
  assert.throws(()=>context({...input,useHistory:true,references:Array(9).fill(input.references[0])},s));
});
test('only known draft kinds accepted; no executable actions or unknown plan updates',()=>{
  const data=context({text:'明天安排'},Planner.empty());
  assert.throws(()=>normalize({kind:'shell',text:'rm'},data));
  assert.throws(()=>normalize({kind:'plan',changes:[{mode:'update',id:'plan-unknown',status:'done'}]},data));
  const p=normalize({kind:'plan',changes:[{mode:'add',title:'研究交互',scheduled:false,date:'2026-09-10'}]},data);
  assert.equal(p.changes[0].scheduled,false);assert.equal(p.changes[0].status,'planned');assert.equal(p.changes[0].start,null);
});
test('AI off and invalid input never invoke the provider; normal response does not mutate store',async()=>{
  let calls=0;const service=createAssistantEntry({request:async()=>{calls++;return {content:{kind:'meeting',text:'目标：确定讨论方向'}};}});
  const s=Planner.empty();assert.equal((await service.generate('owner',{text:'讨论'},s)).error,'ai_disabled');assert.equal(calls,0);
  s.aiEnabled=true;assert.equal((await service.generate('owner',{text:''},s)).error,'invalid_input');assert.equal(calls,0);
  const r=await service.generate('owner',{text:'讨论'},s);assert.equal(r.proposal.kind,'meeting');assert.equal(s.items.length,0);assert.equal(calls,1);
});
test('timeout, cancellation and duplicate concurrent requests have deterministic recovery',async()=>{
  const s={...Planner.empty(),aiEnabled:true},request=()=>new Promise(()=>{});
  const service=createAssistantEntry({request,timeoutMs:15});assert.equal((await service.generate('timeout',{text:'测试'},s)).error,'timeout');
  const cancel=createAssistantEntry({request,timeoutMs:1000});const pending=cancel.generate('same',{text:'测试'},s);
  assert.equal((await cancel.generate('same',{text:'重复'},s)).error,'busy');cancel.cancel('same');assert.equal((await pending).error,'cancelled');
});
