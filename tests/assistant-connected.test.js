const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../renderer/assistant-capabilities'),T=require('../renderer/transcription-model');
test('direct tool intent covers existing tools, conversational prefixes and aliases',()=>{
 for(const t of C.tools){assert.equal(C.direct('帮我打开我的'+t.label+'功能。')?.tool,t.id,t.label);}
 assert.equal(C.direct('嗯。我想查看一下。哦，我明天的计划。')?.period,'明天');
 assert.equal(C.direct('文章里说打开笔记'),null);
 assert.equal(C.direct('记一下，明天打开笔记'),null);
 assert.equal(C.direct('帮我打开剪切板')?.tool,'clip');
 assert.equal(C.direct('你有哪些功能')?.action,'help');
 assert.ok(C.help().includes('会中自由记录'));assert.ok(C.help().includes('剪贴板'));
});
test('action validation rejects arbitrary tools and date range is local and DST-safe',()=>{
 assert.throws(()=>C.validate({kind:'action',action:'shell'}));
 assert.throws(()=>C.validate({kind:'action',action:'open_tool',tool:'terminal'}));
 assert.deepEqual(C.range({period:'明天'},new Date(2026,11,31,23)),['2027-01-01','2027-01-01']);
 assert.deepEqual(C.range({period:'本周'},new Date(2026,8,13)),['2026-09-07','2026-09-13']);
});
test('ASR segments preserve repeated speech and deduplicate by event and item, not words',()=>{
 const s={};const event=(id,item,text)=>({event_id:id,item_id:item,type:'conversation.item.input_audio_transcription.completed',transcript:text});
 T.update(s,event('1','a','好的'));T.update(s,event('2','b','好的'));T.update(s,event('2','b','好的'));
 assert.deepEqual(s.finalSegments,['好的','好的']);
 T.update(s,{event_id:'3',item_id:'c',type:'conversation.item.input_audio_transcription.text',text:'会议',stash:'准备'});
 T.update(s,event('4','c','会前准备'));assert.equal(s.interim,'');assert.equal(s.finalSegments.at(-1),'会前准备');
 T.update(s,{event_id:'5',item_id:'c',type:'conversation.item.input_audio_transcription.text',text:'旧中间稿'});assert.equal(s.interim,'');
 assert.equal(T.config.turn_detection.silence_duration_ms,800);assert.equal(T.config.sample_rate,16000);
});
