(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.AssistantCapabilities=value;})(globalThis,()=>{
  const tools=[
    ['quick','新记录','笔记中的快捷记录方式，独立保存、持续追加。','灵感、工作学习时的临时记录','随手记|随心记'],
    ['notes','笔记','搜索、查看、修改本机笔记；会议笔记也在这里。','继续写已有内容、复盘知识','笔记库'],
    ['meeting','会议整理','可选会前理方向、会中自由记录，结束后 AI 整理，核对后保存；原文保留。','临时讨论、会前准备和会后回看','会前准备|会议准备|会前整理|会议记录'],
    ['todo','待办','制定今天或未来的安排，记录进展、查看完成历史与到点提醒。','规划今天、查询明天、回看本周','计划|日程|安排'],
    ['recorder','录音','持续录音、实时转写、标记重点；保留原音频与逐字稿，可整理口述。','长口述、临时讨论','录制'],
    ['clip','剪贴板','查找已采集内容、复制或粘贴、保存常用片段。关闭采集时不会凭空有历史。','找回刚复制的话、反复使用 SOP','粘贴板|剪切板'],
    ['links','链接收藏','保存网址、备注、分组和内容简介，关联笔记。','稍后阅读、积累设计网站','链接|收藏夹'],
    ['pomodoro','计时','倒计时或正向计时、到点提醒，可关联安排。','专注半小时、记录一件事耗时','计时器|番茄钟'],
    ['music','音乐','查看歌曲和进度，基础控制；明确点播时尝试汽水歌曲搜索与播放，未验证成功会说明。','听指定歌手或歌曲、快速切歌','播放器'],
    ['windows','当前窗口','找回已打开窗口、保存工作区组合。','多个应用间切换','窗口'],
    ['gallery','随手截图','粘贴或导入截图，保存结果图片、缩放和双图对照。','留存问题位置、设计对照','参考图|截图|画廊'],
    ['mirror','镜子','打开镜子页面后由你点击开启摄像头，离开即关闭。','临时检查仪容','镜像'],
    ['commands','资料包','保存提示词、文字模板和常用步骤，按需复制。','固定 SOP、反复使用提示词','常用指令|提示词'],
    ['credentials','密钥','在本机加密保存网址、账号和 API Key；不发送给 AI。','找回已存服务配置','API Key'],
    ['mail','邮件','按已配置账号只读查收和搜索邮件；支持主题、发件人、日期，不发送、不删除、不改已读。','找某封邮件、轻量查收','邮箱|收件箱'],
    ['inbox','待确认','查看本机待确认的建议，不替你默认执行。','回看待处理建议',''],
    ['settings','设置','修改快捷键、AI 配置、工具显示与权限。','配置与故障恢复','']
  ].map(([id,label,description,scene,aliases])=>({id,label,description,scene,aliases:aliases.split('|').filter(Boolean)}));
  const clean=text=>String(text).trim().replace(/^(?:(?:嗯|呃|哦|啊|那个)[，。,.\s]*)+/,'').replace(/[，。！？!?,.\s]/g,'');
  function durationNumber(s){
    if(s==='半')return .5;
    if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);
    const digits={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
    if(Object.hasOwn(digits,s))return digits[s];
    if(/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(s)){const [a,b]=s.split('十');return (digits[a]||1)*10+(digits[b]||0);}return NaN;
  }
  function timedIntent(text){
    const t=String(text).trim().replace(/[，。！？!?,\s]/g,'').replace(/^(?:嗯|呃|哦|啊)+/,'');
    const prefix='(?:请|帮我|给我|我想|我要|现在|开始)*',number='([0-9.零一二两三四五六七八九十半]+)',unit='(分钟|分|秒钟|秒|小时)';
    const m=new RegExp('^'+prefix+'(?:录音|录制)(?:一次|一段|一个)?'+number+unit+'(?:的音|录音|就停|后停止|后结束|到点结束)?$').exec(t)||new RegExp('^'+prefix+'(?:录|录一段|录个|录一个)'+number+unit+'(?:的)?(?:音|录音)$').exec(t);
    if(!m)return null;const seconds=durationNumber(m[1])*(m[2].startsWith('小')?3600:m[2].startsWith('分')?60:1);
    return Number.isInteger(seconds)&&seconds>=1&&seconds<=86400?{kind:'action',action:'start_recording',seconds}:null;
  }
  function direct(text){
    const timed=timedIntent(text);if(timed)return timed;
    const t=clean(text);
    if(/^(?:请|帮我|我想|我要)?(?:做|写|新建|开始|打开)(?:一个|一篇)?会议(?:记录|笔记)$/.test(t))return {kind:'action',action:'new_note',format:'meeting'};
    if(/^(?:请|帮我|我想|我要)?(?:新建|开始写|写|打开)(?:一个|一篇)(?:笔记|记录)$/.test(t)||/^(?:请|帮我|我想|我要)?(?:新建|开始写|写)(?:笔记|记录)$/.test(t))return {kind:'action',action:'new_note',format:'plain'};
    const app=/^(?:请|帮我)?(?:切回|回到|切到)(?:一下)?(微信|WeChat|QQ|飞书|WPS|Chrome|Safari)(?:窗口|页面)?$/i.exec(t);
    if(app)return {kind:'action',action:'focus_window',query:app[1]};
    if(/^(?:你|这个应用|Handy)?(?:有|能做|支持|可以做)(?:哪些|什么)(?:功能|事情|工具)?(?:介绍一下)?$/i.test(t)||/^(?:介绍|介绍一下)(?:你的)?功能$/.test(t))return {kind:'action',action:'help'};
    if(/^(?:请|帮我|请帮我)?复制(?:一下)?(?:这个|这些|刚才的|上面的)?(?:结果|内容|回答|文字)$/.test(t))return {kind:'action',action:'copy_result'};
    const m=/^(?:(?:请|帮我|请帮我|我想|我要|我想要|能不能|能否|可以)(?:帮我)?)?(?:打开|进入|调出|切到|开启)(?:一下)?(?:我的|这个|应用里的)?(.+?)(?:功能|工具|页面)?(?:吧|好吗|一下)?$/.exec(t);
    if(m){const tool=tools.find(v=>[v.label,...v.aliases].some(alias=>clean(alias)===m[1]));if(tool)return {kind:'action',action:'open_tool',tool:tool.id};}
    if(/(?:查看|查询|看看|看一下|有哪些|有什么)/.test(t)&&/(?:计划|待办|安排|日程)/.test(t)&&!/(?:新增|修改|删除|设置|然后|再帮|并且|同时)/.test(t)){
      const period=['后天','明天','昨天','下周','本周','这周','今天'].find(p=>t.includes(p));
      if(period)return {kind:'action',action:'query_plans',period};
    }
    return null;
  }
  function validate(p){
    if(!p||p.kind!=='action')throw Error('invalid_response');
    const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200&&!/[\x00-\x1f\x7f]/.test(v);
    if(p.action==='open_app'&&text(p.query))return {kind:'action',action:p.action,query:p.query.trim(),...(typeof p.appId==='string'&&/^[a-f0-9]{24}$/.test(p.appId)?{appId:p.appId}:{})};
    if(p.action==='web_search'&&text(p.query)&&['google','bing','baidu'].includes(p.engine||'google'))return {kind:'action',action:p.action,query:p.query.trim(),engine:p.engine||'google'};
    if(p.action==='search_mail'){
      if(p.query!==undefined&&p.query!==''&&!text(p.query))throw Error('invalid_response');
      if(p.from!==undefined&&p.from!==''&&!text(p.from))throw Error('invalid_response');
      if(p.provider!==undefined&&!['qq','netease','gmail','icloud'].includes(p.provider))throw Error('invalid_response');
      for(const k of ['since','before'])if(p[k]!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(p[k])||new Date(p[k]+'T12:00:00Z').toISOString().slice(0,10)!==p[k]))throw Error('invalid_response');
      if(p.since&&p.before&&p.since>=p.before)throw Error('invalid_response');
      return {kind:'action',action:p.action,query:(p.query||'').trim(),from:(p.from||'').trim(),...(p.provider?{provider:p.provider}:{}),...(p.since?{since:p.since}:{}),...(p.before?{before:p.before}:{}),unread:p.unread===true};
    }
    if(p.action==='open_tool'&&tools.some(t=>t.id===p.tool))return {kind:'action',action:p.action,tool:p.tool};
    if(['help','copy_result'].includes(p.action))return {kind:'action',action:p.action};
    if(['start_timer','start_recording'].includes(p.action)&&Number.isInteger(p.seconds)&&p.seconds>=1&&p.seconds<=86400)return {kind:'action',action:p.action,seconds:p.seconds};
    if(p.action==='open_music')return {kind:'action',action:p.action};
    if(p.action==='new_note'&&['plain','meeting'].includes(p.format))return {kind:'action',action:p.action,format:p.format};
    if(['find_note','focus_window'].includes(p.action)&&typeof p.query==='string'&&p.query.trim().length<=200)return {kind:'action',action:p.action,query:p.query.trim()};
    if(p.action==='music_control'&&['play','pause','next','previous'].includes(p.command))return {kind:'action',action:p.action,command:p.command};
    if(p.action==='play_music'&&typeof p.query==='string'&&p.query.trim()&&p.query.length<=200)return {kind:'action',action:p.action,query:p.query.trim()};
    if(p.action==='query_plans'){
      if(['今天','明天','后天','昨天','本周','这周','下周','全部'].includes(p.period))return {kind:'action',action:p.action,period:p.period};
      if(/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')&&!Number.isNaN(new Date(p.date+'T12:00:00').getTime()))return {kind:'action',action:p.action,date:p.date};
    }
    throw Error('invalid_response');
  }
  const executionPolicy={
    order:['local','fixed_adapter','ai_plan','computer_use'],
    computerUse:{available:false,reason:'not_configured'},
    externalAdapters:['installed_app_launch','browser_search','readonly_mail_search','soda_search_playback','soda_launch_and_controls','existing_window_focus'],
    neverEscalate:['permission_denied','feature_disabled','conflict','save_failed'],
  };
  function route(text,{attachments=[]}={}){
    if(typeof text!=='string'||!text.trim()||text.length>12000||attachments.length)return null;
    // Never execute commands quoted inside content, conditional instructions or
    // a request to store/transcribe/describe a command. No partial execution.
    if(/[“”「」『』"'\n]/.test(text)||/(?:如果|不要|先别|等到|之后再|完成后)/.test(text)||/^(?:请)?(?:帮我)?(?:记一下|记录一下|保存|收藏|储存|翻译|解释|总结|转写)/.test(text.trim()))return null;
    const fast=part=>{
      const d=direct(part);if(d)return d;
      const t=part.trim().replace(/[，。！？!?,\s]/g,'').replace(/^(?:嗯|呃|哦|啊)+/,'');
      const prefix='(?:(?:请|请帮我|帮我|给我|我想|我要|现在|开始|设置|设定)(?:一个)?)?';
      const number='([0-9.零一二两三四五六七八九十半]+)',unit='(分钟|分|秒钟|秒|小时)';
      const timer=new RegExp('^'+prefix+'(?:倒计时|计时)(?:一个)?'+number+'(?:个)?'+unit+'$').exec(t)||new RegExp('^'+prefix+number+'(?:个)?'+unit+'(?:的)?(?:倒计时|计时器|计时)$').exec(t);
      if(timer){const seconds=durationNumber(timer[1])*(timer[2].startsWith('小')?3600:timer[2].startsWith('分')?60:1);return Number.isInteger(seconds)&&seconds>=1&&seconds<=86400?{kind:'action',action:'start_timer',seconds}:null;}
      if(/^(?:请|帮我)?(?:打开|启动)(?:一下)?(?:汽水音乐|汽车音乐)(?:客户端)?$/.test(t))return {kind:'action',action:'open_music'};
      const music=/^(?:请|帮我)?(播放|继续播放|暂停)(?:音乐|歌曲|汽水音乐)$/.exec(t)||/^(?:请|帮我)?(下一首|上一首|切下一首|切上一首)(?:音乐|歌曲|汽水音乐)?$/.exec(t);
      if(music)return {kind:'action',action:'music_control',command:({'播放':'play','继续播放':'play','暂停':'pause','下一首':'next','上一首':'previous','切下一首':'next','切上一首':'previous'})[music[1]]};
      const original=part.trim().replace(/^[嗯呃哦啊][，。\s]*/,'').replace(/[。！!]+$/,'');
      const web=/^(?:请|帮我|请帮我)?(?:打开|用|在)?\s*(Google|谷歌|百度|Bing|必应)(?:浏览器)?\s*(?:帮我)?(?:搜索|搜一下|搜|查一下)\s*(.+)$/i.exec(original)||/^(?:请|帮我)?(搜索)\s*(.+)$/.exec(original);
      if(web)return {kind:'action',action:'web_search',engine:/百度/.test(web[1])?'baidu':/bing|必应/i.test(web[1])?'bing':'google',query:web[2].trim()};
      const song=/^(?:请|帮我|给我)?(?:在汽水音乐)?(?:播放|放)(?:一首|一曲|个)?\s*(.+?)(?:的歌曲|的歌|的音乐|这首歌)?$/.exec(original);
      if(song)return {kind:'action',action:'play_music',query:song[1].trim()};
      const mail=/^(?:请|帮我)?(?:查看|查找|搜索|找一下|看看)(?:(Gmail|QQ|163|iCloud)\s*)?(未读)?邮件(?:[：:，,\s]*(.+))?$/i.exec(original);
      if(mail)return {kind:'action',action:'search_mail',query:mail[3]||'',unread:!!mail[2],... (mail[1]?{provider:({'gmail':'gmail','qq':'qq','163':'netease','icloud':'icloud'})[mail[1].toLowerCase()]}:{})};
      const app=/^(?:请|帮我|请帮我)?(?:打开|启动)(?:一下)?\s*(?:我的)?(.+?)(?:应用|软件|客户端)?(?:吧|好吗)?$/.exec(original);
      if(app&&!/(?:[，,；;]|然后|并且|同时|打开|新建|播放|搜索|删除|发送|购买|录音|计时)/.test(app[1]))return {kind:'action',action:'open_app',query:app[1].trim()};
      return null;
    };
    let proposal=fast(text);
    if(!proposal){
      const parts=text.split(/(?:[，,；;]|然后|并且|同时|再帮我|接着)/).map(s=>s.trim().replace(/^(?:然后|接着|再)(?=打开|新建|开始|计时|播放|暂停|录音)/,'')).filter(Boolean);
      if(parts.length<2||parts.length>6)return null;
      const steps=parts.map(fast);if(steps.some(v=>!v))return null;
      // Repeating a recording start or result-dependent actions needs planning,
      // not a greedy shortcut. Timer replacement retains the existing guard.
      if(steps.filter(s=>s.action==='start_recording').length>1)return null;
      proposal={kind:'actions',actions:steps};
    }
    try{actions(proposal);}catch{return null;}
    return {route:'local',proposal};
  }
  function actions(p){
    if(p?.kind==='action')return [validate(p)];
    if(p?.kind!=='actions'||!Array.isArray(p.actions)||p.actions.length<1||p.actions.length>6)throw Error('invalid_response');
    return p.actions.map(validate);
  }
  function range(p,now=new Date()){
    const day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if(p.date)return [p.date,p.date];if(p.period==='全部')return ['0000','9999'];
    const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const offsets={'今天':0,'明天':1,'后天':2,'昨天':-1};
    if(Object.hasOwn(offsets,p.period)){d.setDate(d.getDate()+offsets[p.period]);return [day(d),day(d)];}
    d.setDate(d.getDate()-(d.getDay()+6)%7+(p.period==='下周'?7:0));const start=day(d);d.setDate(d.getDate()+6);return [start,day(d)];
  }
  function help(){return '桌面操作\n打开已安装软件：说“打开计算器”；同名应用会让你选择。\n浏览器搜索：说“在 Google 搜索 AI 前沿”，在默认浏览器展示结果；也支持百度和必应。\n音乐点播：说“播放一首薛之谦的歌”，尝试汽水固定适配；登录、会员及控件不可用时停止。\n邮件查询：说“查看 Gmail 未读邮件”，或“查找邮件 项目”；需要先连接邮箱，只读收件箱最近 5000 封中的最多 50 封，不向 AI 发送正文。\n没有发送、购买、删除或任意屏幕脚本能力。通用 Computer Use 尚未接入。\n\n'+tools.filter(t=>t.id!=='settings').map(t=>`${t.label}\n${t.description}\n适合：${t.scene}。说“打开${t.label}”即可进入。`).join('\n\n');}
  return {tools,direct,route,executionPolicy,validate,actions,range,help};
});
