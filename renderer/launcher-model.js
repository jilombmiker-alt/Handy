(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.LauncherModel=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  const tools = [
    ['quick','随手记','想到就写','home'],['todo','待办','安排与进展','todo'],
    ['recorder','录音','口述一个想法','recordings'],['clip','剪贴板','找回并复用','clip'],
    ['links','链接','收好灵感来源','links'],['pomodoro','计时','留一段专注时间','home'],
    ['music','音乐','随手控制播放','home'],['commands','资料包','取用常用文字','home'],
    ['notes','笔记库','查看与继续写','notes'],['windows','当前窗口','找回工作现场','home'],
    ['gallery','参考图','缩放与双图对照','home'],['mirror','画廊与镜子','查看图片或照镜子','home'],['credentials','密钥','本机安全保存','credentials'],
    ['mail','邮件','查看各邮箱','mail'],['inbox','待确认','确认 AI 建议','inbox'],['settings','设置','外观、权限与快捷键','settings']
  ].map(([id,label,hint,tab],i)=>({id,label,hint,tab,primary:i<8}));
  function route(payload){
    if(payload?.kind==='note')return /^[\w-]{1,180}$/.test(String(payload.id||''))?'notes':null;
    const id=payload?.kind==='module'?payload.id:payload?.kind;
    return tools.some(t=>t.id===id)?id:null;
  }
  function bounds(area,mode){
    const size=mode===true||mode==='home'?[760,380]:({quick:[760,580],pomodoro:[600,490],music:[600,510],gallery:[660,660]})[mode]||[1120,660];
    const margin=12,width=Math.max(1,Math.min(size[0],area.width-margin*2));
    const height=Math.max(1,Math.min(size[1],area.height-margin*2));
    return {x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+area.height-height-margin),width:Math.round(width),height:Math.round(height)};
  }
  return {tools,route,bounds};
});
