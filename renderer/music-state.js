(function(root){
  'use strict';
  const clean=v=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,300):'';
  const time=s=>{const parts=s.split(':').map(Number);return parts.reduce((n,v)=>n*60+v,0);};
  function normalize(raw={},previous=null,now=Date.now()){
    const base={ok:true,installed:raw.installed!==false,running:raw.running===true,sessionActive:raw.running===true,title:'',artist:'',elapsed:null,duration:null,playing:null,metadataAvailable:false,observedAt:now,icon:null};
    if(!base.installed)return {...base,playing:false,detail:'尚未安装汽水音乐'};
    if(!base.running)return {...base,playing:false,detail:'汽水尚未运行'};
    if(raw.error)return {...base,error:raw.error,detail:raw.error==='accessibility_permission_required'?'需要辅助功能权限；在更多中打开权限设置后重新检测。':'播放信息读取失败，请重新检测。'};
    const match=clean(raw.timeline).match(/^(\d{1,3}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,3}:\d{2}(?::\d{2})?)$/);
    const title=clean(raw.title),artist=clean(raw.artist);
    if(!title||!match)return {...base,detail:'客户端未提供当前歌曲信息'};
    const elapsed=time(match[1]),duration=time(match[2]);
    if(duration<=0||elapsed>duration||duration>86400||match.slice(1).some(s=>s.split(':').slice(1).some(n=>Number(n)>59)))return {...base,detail:'客户端未提供有效播放时间'};
    let playing=typeof raw.playing==='boolean'?raw.playing:null,playbackSource=playing===null?'unknown':'accessibility';
    // Progress movement establishes playback, not pause. A stationary clock can
    // also mean buffering, so never infer "paused" from silence or stale data.
    if(playing===null&&previous?.title===title&&previous?.artist===artist&&previous?.duration===duration&&now-previous.observedAt<=4000&&elapsed>previous.elapsed&&elapsed-previous.elapsed<=(now-previous.observedAt)/1000+2){playing=true;playbackSource='progress';}
    return {...base,title,artist,elapsed,duration,playing,playbackSource,metadataAvailable:true,detail:playing===true?'正在播放':playing===false?'已暂停':'已同步歌曲与进度'};
  }
  const clock=n=>Number.isFinite(n)?`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`:'--:--';
  const api={normalize,clock};if(typeof module==='object'&&module.exports)module.exports=api;else root.PanelMusicState=api;
})(typeof window==='object'?window:globalThis);
