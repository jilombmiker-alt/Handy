'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../renderer/assistant-capabilities');
const {createDesktopActions,catalog,matches,searchURL,wait}=require('../main-desktop-actions');
const rows=[{path:'/Applications/Chrome.app',bundleId:'com.google.Chrome',name:'Google Chrome',filename:'Google Chrome'},{path:'/System/Applications/Calculator.app',bundleId:'com.apple.calculator',name:'Calculator',filename:'Calculator'}];
const action=(name,extra={})=>({kind:'action',action:name,...extra});
function setup(extra={}){const calls=[];let running=false;const s=createDesktopActions({inventory:()=>rows,running:()=>running,launch:async path=>{calls.push(path);running=true;},openURL:async url=>calls.push(url),mail:()=>null,playMusic:async q=>({ok:false,error:'song_not_found'}),...extra});return {s,calls};}
test('desktop routing preserves search punctuation, artist intent, application launch and combination',()=>{
  assert.deepEqual(C.route('帮我打开计算器').proposal,action('open_app',{query:'计算器'}));
  assert.equal(C.route('打开微信').proposal.action,'open_app');
  assert.equal(C.route('帮我打开一下我的微信吧').proposal.query,'微信');
  assert.equal(C.route('切回微信').proposal.action,'focus_window');
  assert.deepEqual(C.route('在Google搜索 AI & UI').proposal,action('web_search',{engine:'google',query:'AI & UI'}));
  assert.equal(C.route('播放一首薛之谦的歌').proposal.query,'薛之谦');
  assert.equal(C.route('查看Gmail未读邮件').proposal.action,'search_mail');
  assert.equal(C.route('打开计算器，然后计时五分钟').proposal.actions.length,2);
  for(const s of ['记一下，打开计算器','如果我有空就播放音乐','不要打开计算器','打开计算器，然后给同事发邮件','打开笔记，'.repeat(8)])assert.equal(C.route(s),null,s);
  assert.equal(C.route('打开计算器',{attachments:[{title:'x',text:'y'}]}),null);
});
test('registry rejects destructive, arbitrary automation, invalid dates and malformed queries',()=>{
  for(const p of [action('send_mail'),action('delete_file'),action('computer_use'),action('web_search',{query:'x',engine:'evil'}),action('open_app',{query:'x\nsh'}),action('play_music',{query:''}),action('search_mail',{since:'2026-02-31'}),action('search_mail',{since:'2026-09-11',before:'2026-09-10'})])assert.throws(()=>C.validate(p));
  assert.throws(()=>C.actions({kind:'actions',actions:[action('open_app',{query:'Chrome'}),action('send_mail')]}));
});
test('search URL encoding cannot switch host, scheme or inject extra parameters',()=>{
  for(const query of ['中文 & q=test #hi','https://evil.test/?x=1','javascript:alert(1)','a+b%20c']){
    const url=new URL(searchURL({engine:'google',query}));assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('q'),query);assert.equal([...url.searchParams].length,1);
  }
});
test('installed app matching uses aliases, exact names then disambiguation',()=>{
  const apps=catalog(rows);assert.equal(matches(apps,'谷歌浏览器')[0].bundleId,'com.google.Chrome');assert.equal(matches(apps,'计算器')[0].bundleId,'com.apple.calculator');
  assert.equal(matches(apps,'/bin/sh').length,0);assert.equal(matches(apps,'Chrome')[0].id.length,24);
});
test('verified launch is request-idempotent; unknown app, foreign action and changed request are denied',async()=>{
  const {s,calls}=setup();const request={requestId:'one',action:action('open_app',{query:'计算器'})};
  assert.equal((await s.run(1,request)).verified,true);assert.equal((await s.run(1,request)).replayed,true);assert.equal(calls.length,1);
  assert.equal((await s.run(1,{...request,action:action('open_app',{query:'Chrome'})})).error,'request_conflict');
  assert.equal((await s.run(1,{requestId:'two',action:action('open_app',{query:'not-installed'})})).error,'app_not_found');
  assert.equal((await s.run(1,{requestId:'three',action:action('new_note',{format:'plain'})})).error,'unsupported_action');assert.equal(calls.length,1);
});
test('app choices only accept IDs matching original query; missing apps are rechecked',async()=>{
  const variants=[...rows,{...rows[0],path:'/Applications/Chrome Beta.app',name:'Chrome Beta',filename:'Chrome Beta'}];
  const {s,calls}=setup({inventory:()=>variants});let result=await s.run(1,{requestId:'a',action:action('open_app',{query:'Chro'})});assert.equal(result.choices.length,2);assert.equal(calls.length,0);
  result=await s.run(1,{requestId:'b',action:action('open_app',{query:'Chro',appId:catalog(rows)[1].id})});assert.equal(result.error,'choose_app');assert.equal(calls.length,0);
});
test('cancel in-flight operation prevents late work; concurrent desktop jobs are rejected',async()=>{
  const {s,calls}=setup({launch:async(p,signal)=>{await wait(500,signal);calls.push(p);}});
  const request={requestId:'a',action:action('open_app',{query:'Chrome'})};const promise=s.run(1,request);
  assert.equal((await s.run(2,{...request,requestId:'b'})).error,'busy');s.cancel(1);
  assert.equal((await promise).error,'cancelled');assert.equal(calls.length,0);assert.equal((await s.run(1,request)).replayed,true);
});
test('browser acknowledgement is not page verification; mail missing account stays explicit',async()=>{
  const {s,calls}=setup();const r=await s.run(1,{requestId:'a',action:action('web_search',{engine:'google',query:'test'})});assert.equal(r.ok,true);assert.equal(r.verified,false);assert.equal(calls.length,1);
  assert.equal((await s.run(1,{requestId:'b',action:action('search_mail')})).error,'mail_unavailable');
});
test('mail results remain local structured data, with partial failures and no auto retry',async()=>{
  const queries=[];const mail={snapshot:()=>({ok:true,accounts:[{id:'a',provider:'qq',items:[{subject:'fixture'}]},{id:'b',provider:'gmail',items:[],error:'auth_failed'}]}),search:async(id,q)=>{queries.push(id);return {ok:id==='a'};}};
  const {s}=setup({mail:()=>mail});const r=await s.run(1,{requestId:'mail',action:action('search_mail',{query:'fixture'})});assert.equal(r.ok,true);assert.equal(r.verified,false);assert.equal(r.mail.accounts.length,2);assert.deepEqual(queries,['a','b']);
  assert.equal((await s.run(1,{requestId:'none',action:action('search_mail',{provider:'icloud'})})).error,'mail_not_configured');
});
test('stalled adapter times out and releases executor without dispatching a second action',async()=>{
  const {s}=setup({timeoutMs:15,openURL:()=>new Promise(()=>{})});
  assert.equal((await s.run(1,{requestId:'stall',action:action('web_search',{query:'x'})})).error,'timeout');
  assert.equal((await s.run(1,{requestId:'next',action:action('open_app',{query:'计算器'})})).ok,true);
});
test('music verifies actual matching title, artist and progress; it never buys or retries playback',async()=>{
  const {createSodaPlayback}=require('../main-desktop-actions');const normalize=require('../renderer/music-state').normalize;
  let playing=false,counter=0,clicks=0,busy=false;
  const bridge={cancel(){},running:()=>true,search:async()=> 'searched',searchRows:async(q,play)=>{if(play)clicks++;return JSON.stringify(play?{dispatched:true,selected:['1','演员 VIP 原唱','薛之谦','意外','04:00']}:{rows:[['1','演员','薛之谦','04:00']]});},status:async()=>JSON.stringify({title:'演员',artist:'薛之谦',timeline:`00:0${playing?Math.min(counter++,8):0} / 04:00`})};
  const play=createSodaPlayback({installed:()=>true,trusted:()=>true,busy:()=>busy,setBusy:v=>busy=v,bridge:()=>bridge,open:async()=>true,wait:async()=>{},normalize});
  assert.equal((await play('薛之谦',{signal:new AbortController().signal})).error,'playback_unverified');assert.equal(clicks,1);assert.equal(busy,false);
  playing=true;assert.equal((await play('薛之谦',{signal:new AbortController().signal})).verified,true);assert.equal(clicks,2);
  bridge.status=async()=>JSON.stringify({title:'演员',artist:'其他歌手',timeline:`00:0${Math.min(counter++,8)} / 04:00`,playing:true});
  assert.equal((await play('薛之谦',{signal:new AbortController().signal})).ok,false);
});
test('music cancellation after search prevents selection and resets busy guard',async()=>{
  const {createSodaPlayback}=require('../main-desktop-actions');const c=new AbortController();let clicks=0,busy=false,cancelled=0;
  const bridge={running:()=>true,cancel:()=>cancelled++,search:async()=>{c.abort();return 'searched';},searchRows:async()=>clicks++};
  const play=createSodaPlayback({installed:()=>true,trusted:()=>true,busy:()=>busy,setBusy:v=>busy=v,bridge:()=>bridge,open:async()=>true,wait:async()=>{}});
  await assert.rejects(play('薛之谦',{signal:c.signal}),/cancelled/);assert.equal(clicks,0);assert.equal(busy,false);assert.equal(cancelled,1);
});
