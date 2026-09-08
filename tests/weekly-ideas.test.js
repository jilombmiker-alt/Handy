const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../renderer/quick-record-model'),D=require('../renderer/domain');
const at=(d,h=14,m=0)=>new Date(2026,8,d,h,m).getTime(),now=at(11);
const capture=(s,content='原话',organized=false)=>M.change(s,{action:'capture',recordingId:'audio-1',content,organized},now,'capture-1');
test('capture is independent, durable and idempotent; AI only updates an untouched inactive record',()=>{
  let s=M.initial('正在写的内容','active',now);s=capture(s);
  assert.equal(s.activeId,'active');assert.equal(M.active(s).content,'正在写的内容');assert.equal(s.records.length,2);
  s=capture(M.parse(JSON.stringify(s)),'整理稿',true);assert.equal(s.records[0].content,'整理稿');
  s=capture(s,'第二份 AI 结果',true);assert.equal(s.records.length,2);assert.equal(s.records[0].content,'整理稿');
  assert.throws(()=>capture(s,'x'.repeat(60001)),/invalid_input/);
});
test('open, manual edit, confirmation and trash protect against late AI and replay',()=>{
  for(const action of ['open','save','confirm','trash']){
    let s=capture(M.initial('别的记录','active',now));s=M.change(s,{action:'select',recordId:'capture-1'},now);
    if(action==='save')s=M.change(s,{action,recordId:'capture-1',revision:1,title:'',content:'我改过了'},now);
    if(action==='confirm')s=M.change(s,{action,recordId:'capture-1',revision:1},now);
    if(action==='trash')s=M.change(s,{action},now);
    if(action!=='open'&&action!=='trash')s=M.change(s,{action:'select',recordId:'active'},now);
    const before=structuredClone(s.records.find(r=>r.id==='capture-1'));
    s=capture(s,'迟到的整理',true);assert.deepEqual(s.records.find(r=>r.id==='capture-1'),before);
  }
});
test('weekly review includes unfinished AND confirmed ideas; choices never create todos',()=>{
  let s=M.initial('未成形的想法','a',now);s=M.change(s,{action:'confirm',recordId:'a',revision:1},now);
  assert.equal(M.weeklyDue(s,now),1);assert.equal(M.pending(s).length,0);
  s=M.change(s,{action:'review',recordId:'a',revision:2,choice:'next-week'},now);
  assert.equal(M.weeklyDue(s,at(11)),0);assert.equal(M.weeklyDue(s,at(18)),1);
  assert.equal(s.records[0].confirmedAt,now);assert.equal(s.records.length,1);
  s=M.change(s,{action:'save',recordId:'a',revision:2,title:'',content:'想法又补了一句'},at(11));assert.equal(M.weeklyDue(s,at(11)),1);
  assert.throws(()=>M.change(s,{action:'review',recordId:'a',revision:2,choice:'later'},now),/conflict/);
});
test('Friday at 14:00, independent opt-out, daily priority and durable claims',()=>{
  let s=M.initial('周末想试试','a',at(7));
  for(const time of [at(9),at(10,16),at(11,13,59),at(11,21,1),at(12)])assert.equal(M.weeklyDue(s,time),0);
  assert.deepEqual(M.reminder(s,at(11,9)),{mode:'weekly',count:0});
  assert.equal(M.reminder(s,now).count,1);
  assert.equal(M.weeklyDue(s,at(11,16)),1);assert.equal(M.weeklyDue(s,at(11,21)),1);
  s=M.change(s,{action:'weekly-shown'},now);s=M.parse(JSON.stringify(s));assert.equal(M.reminder(s,now).count,0);assert.equal(M.due(s,at(11,20)),0);
  assert.equal(M.weeklyDue(s,at(18)),1);
  s=M.change(s,{action:'settings',enabled:false,time:'20:30',weeklyEnabled:false},now);assert.equal(M.weeklyDue(s,at(18)),0);
  s=M.change(s,{action:'settings',enabled:true,time:'20:00'},now);assert.equal(s.settings.weeklyEnabled,false);
});
test('Friday reminder preserves legacy opt-out, empty state and local year boundary',()=>{
  let s=M.parse(JSON.stringify(M.initial('跨年想法','a',now)));
  const friday=new Date(2027,0,1,14).getTime();
  assert.equal(M.weeklyDue(s,friday),1);
  assert.equal(M.weeklyDue(s,new Date(2026,11,31,14).getTime()),0);
  s.settings.weeklyEnabled=false;assert.equal(M.weeklyDue(M.parse(JSON.stringify(s)),friday),0);
  s.settings.weeklyEnabled=true;s.records[0].content='';assert.equal(M.weeklyDue(s,friday),0);
});
test('dismiss is reversible and data/source additions survive normalization',()=>{
  let s=M.initial('先不做','a',now);s=M.change(s,{action:'review',recordId:'a',revision:1,choice:'dismiss'},now);
  assert.equal(M.ideas(s).length,0);s=M.change(s,{action:'review-reset',recordId:'a'},now);assert.equal(M.ideas(s).length,1);
  assert.equal(D.createRecording({id:'r',quickCapture:true}).quickCapture,true);
  const note=D.normalizeNoteArchive([{id:'n',content:'原文',sourceQuickRecordId:'q',sourceRecordingId:'r'}])[0];assert.equal(note.sourceQuickRecordId,'q');assert.equal(note.sourceRecordingId,'r');
});
