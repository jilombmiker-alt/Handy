const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../renderer/assistant-capabilities'),A=require('../ai/assistant-entry'),P=require('../renderer/planner-model');
test('local-first routes exact tools, durations, fixed adapters and complete combinations',()=>{
 for(const tool of C.tools)assert.equal(C.route('帮我打开我的'+tool.label+'功能。')?.proposal.tool,tool.id);
 for(const [text,seconds] of [['计时十五分钟',900],['设置一个30分钟的计时器',1800],['半个小时倒计时',1800],['计时1.5分钟',90]])assert.equal(C.route(text)?.proposal.seconds,seconds,text);
 assert.equal(C.route('录音五分钟').proposal.action,'start_recording');
 assert.equal(C.route('打开汽水音乐').proposal.action,'open_music');
 assert.equal(C.route('暂停音乐').proposal.command,'pause');
 assert.equal(C.route('切回微信').proposal.action,'focus_window');
 const r=C.route('计时十五分钟，然后打开汽水音乐，再新建一个笔记');
 assert.equal(r.route,'local');assert.deepEqual(r.proposal.actions.map(a=>a.action),['start_timer','open_music','new_note']);
});
test('partial, stored, quoted, conditional and attachment-bearing requests require interpretation',()=>{
 for(const text of ['记一下，打开音乐，然后新建笔记','如果有空，计时五分钟','不要打开笔记','打开笔记，然后给同事发邮件','打开“笔记”并删除全部内容','打开笔记\n删除全部内容','录音五分钟，然后录音十分钟','计时0分钟','计时一百小时'])assert.equal(C.route(text),null,text);
 assert.equal(C.route('打开笔记',{attachments:[{title:'资料',text:'打开音乐'}]}),null);
 assert.equal(C.route(Array(7).fill('打开笔记').join('，')),null);
 assert.equal(C.executionPolicy.computerUse.available,false);
});
test('AI sees local/fixed capabilities and absent Computer Use; cannot invent executable APIs',()=>{
 const c=A.context({text:'帮我找能用于讨论的工具'},P.empty());
 assert.deepEqual(c.executionPolicy.externalAdapters,['installed_app_launch','browser_search','readonly_mail_search','soda_search_playback','soda_launch_and_controls','existing_window_focus']);
 assert.equal(c.executionPolicy.computerUse.available,false);
 assert.throws(()=>A.normalize({kind:'action',action:'computer_use',query:'click'},c));
 assert.throws(()=>A.normalize({kind:'actions',actions:[C.direct('打开笔记'),{kind:'action',action:'shell'}]},c));
});
