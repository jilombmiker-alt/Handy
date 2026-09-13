'use strict';
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const Capabilities=require('./renderer/assistant-capabilities');
const fail=error=>({ok:false,error});
const key=s=>String(s).normalize('NFKC').toLowerCase().replace(/[\s·._-]/g,'');
const aliases={ '谷歌浏览器':'com.google.Chrome','chrome':'com.google.Chrome','google':'com.google.Chrome','谷歌':'com.google.Chrome','微信':'com.tencent.xinWeChat','wechat':'com.tencent.xinWeChat','飞书':'com.bytedance.macos.feishu','计算器':'com.apple.calculator','地图':'com.apple.Maps','浏览器':'com.apple.Safari','safari':'com.apple.Safari','邮件':'com.apple.mail','汽水音乐':'com.soda.music','汽车音乐':'com.soda.music','音乐':'com.apple.Music' };
function catalog(rows){
  return rows.filter(r=>r&&typeof r.path==='string'&&r.path.endsWith('.app')&&typeof r.name==='string'&&typeof r.bundleId==='string').map(r=>({...r,id:crypto.createHash('sha256').update(r.path).digest('hex').slice(0,24)}));
}
function matches(rows,query){
  const q=key(query),alias=aliases[q];
  const exact=rows.filter(r=>(alias&&r.bundleId.toLowerCase()===alias.toLowerCase())||[r.name,r.filename,r.bundleId].some(s=>key(s)===q));
  return exact.length?exact:rows.filter(r=>[r.name,r.filename].some(s=>key(s).includes(q)));
}
function searchURL(p){
  const url=new URL(({google:'https://www.google.com/search',bing:'https://www.bing.com/search',baidu:'https://www.baidu.com/s'})[p.engine]);
  url.searchParams.set(p.engine==='baidu'?'wd':'q',p.query);return url.href;
}
function check(signal){if(signal?.aborted)throw Error('cancelled');}
function wait(ms,signal){return new Promise((resolve,reject)=>{
  check(signal);const abort=()=>{clearTimeout(timer);reject(Error('cancelled'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});
});}
function openApplication(path,signal){
  check(signal);return new Promise((resolve,reject)=>{
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;env.XPC_SERVICE_NAME='0';
    execFile('/usr/bin/open',['-a',path],{timeout:5000,env,signal},error=>error?reject(Error(signal.aborted?'cancelled':'launch_failed')):resolve());
  });
}
function createDesktopActions(options){
  const active=new Map(),completed=new Map();let disposed=false,cached=null,cacheAt=0;
  const inventory=()=>{if(!cached||Date.now()-cacheAt>30000){cached=catalog(options.inventory());cacheAt=Date.now();}return cached;};
  async function execute(p,signal,progress){
    check(signal);
    if(p.action==='open_app'){
      progress('正在定位应用…');
      const rows=inventory(),found=matches(rows,p.query),chosen=p.appId?found.find(r=>r.id===p.appId):found.length===1?found[0]:null;
      if(!chosen)return found.length?{ok:false,error:'choose_app',choices:found.slice(0,10).map(({id,name,filename})=>({id,name:filename||name})),text:'找到多个应用，请选择一个。'}:fail('app_not_found');
      // Only a freshly enumerated app bundle can be launched, never a model path.
      const current=catalog(options.inventory()).find(r=>r.id===chosen.id&&r.bundleId===chosen.bundleId);
      if(!current)return fail('app_not_found');
      check(signal);progress('正在打开 '+chosen.name+'…');await options.launch(chosen.path,signal);
      for(let i=0;i<10;i++){check(signal);if(options.running(chosen.path))return {ok:true,verified:true,text:'已打开 '+chosen.name+'。'};await wait(200,signal);}
      return {ok:false,error:'launch_unverified',text:'已请求打开 '+chosen.name+'，但尚未确认应用运行；没有自动重复启动。'};
    }
    if(p.action==='web_search'){
      progress('正在打开搜索结果…');check(signal);await options.openURL(searchURL(p));check(signal);
      return {ok:true,verified:false,text:'已将“'+p.query+'”的搜索链接交给默认浏览器；网页是否加载成功以浏览器为准。'};
    }
    if(p.action==='search_mail'){
      const mail=options.mail();if(!mail)return fail('mail_unavailable');
      const s=mail.snapshot();if(!s.ok)return s;
      const accounts=s.accounts.filter(a=>!p.provider||a.provider===p.provider);
      if(!accounts.length)return fail('mail_not_configured');
      let failed=0;const failures=new Map();for(const a of accounts){check(signal);progress('正在只读查询邮件…');const r=await mail.search(a.id,p,signal);check(signal);if(!r.ok){failed++;failures.set(a.id,r.error||'connection_failed');}}
      const snapshot=mail.snapshot();const resultAccounts=snapshot.accounts.filter(a=>accounts.some(v=>v.id===a.id)).map(a=>failures.has(a.id)?{...a,error:failures.get(a.id)}:a);
      const count=resultAccounts.filter(a=>!a.error).reduce((n,a)=>n+a.items.length,0);
      return {ok:failed<accounts.length,verified:failed===0,error:failed?'mail_partial_failure':undefined,mail:{...snapshot,accounts:resultAccounts},text:failed?`部分邮箱查询失败；其余找到 ${count} 封。旧缓存会明确标注，邮件没有改动。`:`找到 ${count} 封邮件，已放到邮件工具中；不改已读状态。`};
    }
    if(p.action==='play_music')return options.playMusic(p.query,{signal,progress});
    return fail('unsupported_action');
  }
  return {
    async run(owner,input,progress=()=>{}){
      if(disposed)return fail('cancelled');
      if(!input||typeof input.requestId!=='string'||!input.requestId||input.requestId.length>160)return fail('invalid_input');
      let p;try{p=Capabilities.validate(input.action);}catch{return fail('invalid_input');}
      if(!['open_app','web_search','search_mail','play_music'].includes(p.action))return fail('unsupported_action');
      const id=owner+':'+input.requestId,signature=JSON.stringify(p);
      if(completed.has(id)){const old=completed.get(id);return old.signature===signature?{...old.result,replayed:true}:fail('request_conflict');}
      if(active.size)return fail('busy'); // One foreground desktop action at a time.
      const controller=new AbortController();active.set(owner,{controller,id});
      let timedOut=false,abort;
      const timeout=setTimeout(()=>{timedOut=true;controller.abort();},options.timeoutMs||20000);
      let result;
      try{result=await Promise.race([execute(p,controller.signal,text=>{if(!controller.signal.aborted)progress(text);}),new Promise((_,reject)=>{abort=()=>reject(Error('cancelled'));controller.signal.addEventListener('abort',abort,{once:true});})]);}
      catch(e){result=fail(controller.signal.aborted?(timedOut?'timeout':'cancelled'):e.message==='launch_failed'?e.message:'operation_failed');}
      finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',abort);active.delete(owner);}
      // Never auto retry partial operations after cancellation or uncertain verification.
      completed.set(id,{signature,result});while(completed.size>100)completed.delete(completed.keys().next().value);
      return result;
    },
    cancel(owner){active.get(owner)?.controller.abort();return {ok:true};},
    cancelAll(){for(const job of active.values())job.controller.abort();},
    dispose(){disposed=true;for(const job of active.values())job.controller.abort();},
  };
}
function createSodaPlayback(options){return async(query,{signal,progress=()=>{}})=>{
  if(!options.installed())return fail('not_installed');
  if(!options.trusted())return fail('accessibility_permission_required');
  if(options.busy())return fail('busy');
  options.setBusy(true);let abortMusic;const pause=options.wait||wait;
  try{
    const bridge=options.bridge();abortMusic=()=>bridge.cancel();signal.addEventListener('abort',abortMusic,{once:true});check(signal);progress('正在打开汽水音乐…');
    if(!await options.open())return fail('launch_failed');
    for(let i=0;i<15&&!bridge.running();i++)await pause(200,signal);
    check(signal);progress('正在搜索“'+query+'”…');
    const searched=await bridge.search(query);check(signal);if(searched!=='searched')return fail(searched);
    let rows;for(let i=0;i<8;i++){await pause(350,signal);rows=JSON.parse(await bridge.searchRows(query,false));check(signal);if(rows.error)return fail(rows.error);if(rows.rows?.length)break;}
    if(!rows?.rows?.length)return fail('song_not_found');
    progress('正在选择匹配歌曲…');check(signal);
    const played=JSON.parse(await bridge.searchRows(query,true));check(signal);if(!played.dispatched)return fail(played.error||'play_control_unavailable');
    progress('正在确认播放状态…');let previous=null;const chosen=played.selected.join(' ');
    for(let i=0;i<10;i++){
      await pause(450,signal);const raw=JSON.parse(await bridge.status());check(signal);
      const current=options.normalize({...raw,installed:true,running:true},previous);
      const title=String(current.title||'').replace(/\s*(VIP|原唱)\s*/g,'').trim();
      const artist=String(current.artist||'').trim();
      if(title&&artist&&chosen.includes(title)&&chosen.includes(artist)&&current.playing===true)return {ok:true,verified:true,text:'已播放 '+title+' · '+artist+'。'};
      previous=current;
    }
    return {ok:false,error:'playback_unverified',text:'已选择匹配歌曲，但尚未确认播放进度。可能需要登录、会员或手动播放；没有购买或重复点击。'};
  }finally{if(abortMusic)signal.removeEventListener('abort',abortMusic);options.setBusy(false);}
};}
module.exports={createDesktopActions,createSodaPlayback,catalog,matches,searchURL,openApplication,wait,check};
