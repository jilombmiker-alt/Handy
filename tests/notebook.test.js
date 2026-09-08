const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/notebook-model');
const D = require('../renderer/domain');
const { createMeetingPrep } = require('../ai/meeting-prep');

test('legacy note normalization is unchanged and meeting fields survive ordinary archive updates', () => {
  const old = { id:'old',title:'旧笔记',titleSource:'user',content:'原文',createdAt:1,updatedAt:1 };
  assert.deepEqual(D.normalizeNoteArchive([old]),[old]);
  const note = { ...old,meeting:M.meeting({ freeText:'完整自由记录',topics:[{ id:'t',title:'讨论范围',notes:'原始记录' }] }) };
  const edited = D.updateNoteTitle([note],'old','新标题',2)[0];
  assert.equal(edited.meeting.freeText,'完整自由记录');
  assert.equal(edited.meeting.topics[0].notes,'原始记录');
  assert.notEqual(M.version(old),M.version(edited));
});
test('switching modes retains both topic and free notes; summary remains searchable', () => {
  const original = M.meeting({ mode:'free',freeText:'临时想法',topics:[{ title:'方案选择',notes:'先做小范围试点',focus:'比较成本' }] });
  const next = M.meeting({ ...original,mode:'topics' });
  assert.equal(next.freeText,original.freeText); assert.deepEqual(next.topics,original.topics);
  assert.match(M.toText(next),/临时想法/); assert.match(M.toText(next),/比较成本/);
});
test('review blocks unchecked topics and ownerless tasks but permits explicitly no follow-up', () => {
  const m = M.meeting({ topics:[{ title:'范围',notes:'已决定',status:'unchecked' }] });
  assert.equal(M.reviewErrors(m).length,2); m.topics[0].status='decided';m.noTasks=true;
  assert.deepEqual(M.reviewErrors(m),[]);
  m.tasks.push({ text:'落实',owner:'',due:'' }); assert.match(M.reviewErrors(m).join(''),/负责人/);
});
test('AI proposal requires a bounded usable agenda and treats markup as text', () => {
  assert.throws(() => M.proposal({ objective:'方向',topics:[] }));
  assert.throws(() => M.proposal({ objective:'方向',topics:[{ title:'事项' }] }));
  const p = M.proposal({ objective:'<script>not executable</script>',topics:[{ title:'议题',focus:'重点' }],questions:['待确认'] });
  assert.equal(p.questions,'待确认'); assert.match(p.objective,/<script>/);
});
function runtime(fetchImpl, extra = {}) {
  return createMeetingPrep({ getConfig:() => ({ apiKey:'test-only',model:'test',baseUrl:'https://example.com/v1' }),
    validateEndpoint:async (url) => url,fetchImpl,...extra });
}
test('meeting request uses one bounded call, no redirects, and returns a draft only', async () => {
  let calls=0;
  const prep = runtime(async (_url,options) => {
    calls++; assert.equal(options.redirect,'error'); const body=JSON.parse(options.body);
    assert.equal(body.max_tokens,1800);assert.match(body.messages[0].content,/不是访谈者/);
    return new Response(JSON.stringify({ choices:[{ message:{ content:JSON.stringify({ objective:'确认范围',topics:[{ title:'首批功能',focus:'确定必须交付的功能' }],questions:[] }) } }] }));
  });
  const result=await prep.generate('one','准备讨论第一批功能');
  assert.equal(result.ok,true); assert.equal(calls,1);assert.equal(result.proposal.topics.length,1);
});
test('meeting AI no-key and authorization failures expose no secrets',async () => {
  const absent=runtime(() => { throw Error('must not call'); },{getConfig:() => ({})});
  assert.deepEqual(await absent.generate(1,'会议目标'),{ok:false,error:'not_configured'});
  const denied=runtime(async () => new Response('private backend detail',{status:401}));
  assert.deepEqual(await denied.generate(1,'会议目标'),{ok:false,error:'unauthorized'});
});
test('meeting AI cancellation and timeout are recoverable; duplicate runs are blocked',async () => {
  const blocked=(_url,{signal}) => new Promise((_resolve,reject) => signal.addEventListener('abort',() => reject(new Error('aborted'))));
  const prep=runtime(blocked);
  const pending=prep.generate(1,'目标');await new Promise((r) => setImmediate(r));
  assert.deepEqual(await prep.generate(1,'目标'),{ok:false,error:'busy'});prep.cancel(1);
  assert.deepEqual(await pending,{ok:false,error:'cancelled'});
  const short=runtime(blocked,{timeoutMs:10});assert.deepEqual(await short.generate(1,'目标'),{ok:false,error:'timeout'});
});
