(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.LauncherModel=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  const tools = [
    ['quick','新记录','笔记中的快捷记录','home'],['todo','待办','安排与进展','todo'],
    ['recorder','录音','口述一个想法','recordings'],['clip','剪贴板','找回并复用','clip'],
    ['links','链接','收好灵感来源','links'],['pomodoro','计时','留一段专注时间','home'],
    ['music','音乐','随手控制播放','home'],['commands','资料包','取用常用文字','home'],
    ['notes','笔记','查看与继续写','notes'],['meeting','会议整理','自由记录，结束后整理核对','notes'],['windows','当前窗口','找回工作现场','home'],
    ['gallery','随手截图','粘贴截图与保存结果图片','home'],['mirror','镜子','主动开启摄像头','home'],['credentials','密钥','本机安全保存','credentials'],
    ['mail','邮件','查看各邮箱','mail'],['inbox','待确认','确认 AI 建议','inbox'],['settings','设置','外观、权限与快捷键','settings']
  ].map(([id,label,hint,tab],i)=>({id,label,hint,tab,primary:(i<8&&id!=='quick')||id==='notes'}));
  function route(payload){
    if(payload?.kind==='note')return /^[\w-]{1,180}$/.test(String(payload.id||''))?'notes':null;
    const id=payload?.kind==='module'?payload.id:payload?.kind;
    return tools.some(t=>t.id===id)?id:null;
  }
  function bounds(area,mode){
    const size=mode===true||mode==='home'?[720,280]:({'home-reply':[720,320],'home-plan':[720,440],'home-expanded':[720,620],'home-wide':[840,620],quick:[760,580],pomodoro:[600,490],music:[600,510],gallery:[660,660]})[mode]||[1120,660];
    const margin=12,width=Math.max(1,Math.min(size[0],area.width-margin*2));
    const height=Math.max(1,Math.min(size[1],area.height-margin*2));
    return {x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width:Math.round(width),height:Math.round(height)};
  }
  function placedBounds(area,mode,position){
    const b=bounds(area,mode);
    if(!position||!Number.isFinite(position.x)||!Number.isFinite(position.y))return b;
    const mx=Math.min(12,Math.max(0,(area.width-b.width)/2)),my=Math.min(12,Math.max(0,(area.height-b.height)/2));
    return {...b,x:Math.round(Math.max(area.x+mx,Math.min(position.x,area.x+area.width-b.width-mx))),y:Math.round(Math.max(area.y+my,Math.min(position.y,area.y+area.height-b.height-my)))};
  }
  return {tools,route,bounds,placedBounds};
});
