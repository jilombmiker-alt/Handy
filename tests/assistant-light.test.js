const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../renderer/assistant-capabilities'),T=require('../renderer/transcription-model'),M=require('../renderer/notebook-model');
const {createMeetingPrep}=require('../ai/meeting-prep');
test('new note and existing windows dispatch, while compound requests stay with AI',()=>{
 assert.equal(C.direct('打开一个笔记').action,'new_note');
 assert.equal(C.direct('打开笔记库').tool,'notes');
 assert.equal(C.direct('切回微信页面').action,'focus_window');
 assert.equal(C.direct('打开一个笔记然后切回微信'),null);
 assert.throws(()=>C.validate({kind:'action',action:'focus_window',query:'a'.repeat(201)}));
 assert.throws(()=>C.validate({kind:'action',action:'music_control',command:'shell'}));
});
test('no corpus, silence and fillers cannot become commands',()=>{
 assert.equal(T.config.input_audio_transcription.context,undefined);
 for(const text of ['', '嗯嗯。','啊，呃。','Handy 桌面助手。术语：笔记、AI'])assert.equal(T.actionable(text),false);
 assert.equal(T.actionable('帮我打开一个笔记'),true);
 const session={};T.observePcm(session,new Uint8Array(6400));assert.equal(session.audibleSamples,0);
 const pcm=new Int16Array(2000).fill(1000);T.observePcm(session,new Uint8Array(pcm.buffer));assert.equal(session.audibleSamples,2000);
 T.update(session,{type:'conversation.item.input_audio_transcription.completed',transcript:'Handy 桌面助手。术语：笔记、AI',item_id:'x'});assert.equal(session.contaminated,true);assert.deepEqual(session.finalSegments,['']);
});
test('meeting organization retains original and rejects malformed or failed responses',async()=>{
 const original='1. 缩小范围\n2. 先试笔记\n3. 时间还没决定';
 const service=createMeetingPrep({request:async p=>{assert.equal(p.prompt.user,original);return {content:JSON.stringify({summary:'范围：先试笔记。时间待确认。'})};}});
 const r=await service.generate(1,{mode:'review',text:original});assert.equal(r.ok,true);
 const note=M.meeting({freeText:original,summary:r.summary,summarySource:original});assert.equal(note.freeText,original);assert.equal(note.summary,r.summary);assert.match(M.toText(note),/时间待确认/);
 const bad=createMeetingPrep({request:async()=>({content:'{"summary":""}'})});assert.equal((await bad.generate(2,{mode:'review',text:original})).error,'invalid_response');
 const failed=createMeetingPrep({request:async()=>{throw Error('offline');}});assert.equal((await failed.generate(3,{mode:'review',text:original})).ok,false);
});
