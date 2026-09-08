const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../renderer/quick-record-model');
const at=(day,h=20,m=30)=>new Date(2026,8,day,h,m).getTime();
const edit=(s,text,now=at(5))=>M.change(s,{action:'save',recordId:M.active(s).id,revision:M.active(s).revision,title:'',content:text},now);
test('legacy migration preserves independent body; roundtrip and corruption guard',()=>{
  const s=M.initial('旧的随手记','one',at(5));assert.equal(M.active(s).content,'旧的随手记');assert.deepEqual(M.parse(JSON.stringify(s)),s);
  assert.throws(()=>M.parse('{broken'));assert.throws(()=>M.parse(JSON.stringify({...s,activeId:'missing'})));
});
test('new idea and switch preserve independent drafts; blank new is reused',()=>{
  let s=M.initial('诚信\n1. 真实','one',at(5));s=M.change(s,{action:'new'},at(5),'two');assert.equal(s.previousId,'one');
  assert.equal(M.change(s,{action:'new'},at(5),'three').records.length,2);
  s=edit(s,'另一条灵感');s=M.change(s,{action:'select',recordId:'one'},at(5));assert.equal(M.active(s).content,'诚信\n1. 真实');assert.equal(s.records.find(r=>r.id==='two').content,'另一条灵感');
});
test('explicit confirmation, later editing returns to pending and stale revisions fail',()=>{
  let s=M.initial('一条想法','one',at(5));const original=structuredClone(s);
  s=M.change(s,{action:'confirm',recordId:'one',revision:1},at(5));assert.equal(M.pending(s).length,0);assert.equal(M.active(s).confirmedLength,4);
  assert.throws(()=>M.change(s,{action:'save',recordId:'one',revision:1,title:'',content:'过期'},at(5)),/conflict/);
  s=edit(s,'一条想法\n追加');assert.equal(M.pending(s).length,1);assert.equal(M.active(original).content,'一条想法');
});
test('pin, recoverable trash and restore do not remove contents',()=>{
  let s=M.initial('保留的记录','one',at(5));s=M.change(s,{action:'pin'},at(5));assert.equal(M.active(s).pinned,true);
  s=M.change(s,{action:'trash'},at(5),'two');assert.equal(M.pending(s).length,0);assert.equal(s.records[1].content,'保留的记录');
  s=M.change(s,{action:'restore',recordId:'one'},at(5));assert.equal(M.pending(s).length,1);
});
test('evening once a day, missed evening rolls over without piling up',()=>{
  let s=M.initial('待确认','one',at(5,18));assert.equal(M.due(s,at(5,20,29)),0);assert.equal(M.due(s,at(5)),1);
  assert.equal(M.due(s,at(5,22)),0);assert.equal(M.due(s,at(6,5)),0);assert.equal(M.due(s,at(6,9)),1);
  s=M.change(s,{action:'shown'},at(6,9));assert.equal(M.due(s,at(6,20,30)),0);assert.equal(M.due(M.parse(JSON.stringify(s)),at(6,20,45)),0);
});
test('tomorrow, settings, empty and confirmed records',()=>{
  let s=M.initial('待确认','one',at(5));s=M.change(s,{action:'tomorrow'},at(5));assert.equal(M.due(s,at(5,20,50)),0);assert.equal(M.due(s,at(6,9)),1);
  s=M.change(s,{action:'settings',enabled:false,time:'20:45'},at(5));assert.equal(M.due(s,at(7,9)),0);
  assert.throws(()=>M.change(s,{action:'settings',enabled:true,time:'22:00'},at(5)),/invalid_input/);
  assert.equal(M.due(M.initial('  ','blank',at(5)),at(5)),0);
  const confirmed=M.change(M.initial('记录','one',at(5)),{action:'confirm',recordId:'one',revision:1},at(5));assert.equal(M.due(confirmed,at(6,9)),0);
});
test('no reminder during typing, absence, lock, suspend, recording, fullscreen or unknown idle',()=>{
  const context={idleSeconds:10};assert.equal(M.eligible(context),true);
  for(const key of ['locked','suspended','recording','fullscreen'])assert.equal(M.eligible({...context,[key]:true}),false,key);
  for(const idleSeconds of [0,2,91,600,undefined,NaN])assert.equal(M.eligible({idleSeconds}),false);
});
test('next morning follows local calendar at month and year boundaries',()=>{
  for(const date of [new Date(2026,8,30,20,30),new Date(2026,11,31,20,30)]){
    const next=new Date(M.nextMorning(date.getTime()));assert.equal(next.getDate(),1);assert.equal(next.getHours(),6);
  }
});
