(() => {
  'use strict';
  const errors = {
    not_installed:'未安装汽水音乐，请先安装客户端。',
    accessibility_permission_required:'需要辅助功能权限，请点「权限设置」后重新检测。',
    no_active_session:'汽水尚未运行，请点播放 / 暂停，或打开汽水。',
    launch_failed:'汽水启动失败，请点「打开汽水」重试。',
    music_control_unavailable:'后台控制组件不可用，请重新启动 Handy，或打开汽水操作。',
    music_input_focused:'汽水正在输入，请先退出搜索或登录输入框，再重试。',
    music_busy:'上一次控制还未结束，请稍后重试。',
  };
  const paths={previous:'M18 6 9 12l9 6V6ZM6 6v12',next:'m6 6 9 6-9 6V6ZM18 6v12',toggle:'m5 6 8 6-8 6V6ZM17 6v12M21 6v12'};
  window.PanelMusicFloat={mount(root,initial,api){
    let disposed=false,busy=false,refreshing=false,idleTimer,pending=Promise.resolve(),failed=false,latest=initial,lastLayout='';
    const body=document.body;
    body.classList.add('music-floating');
    const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
    const section=node('section',null,'module-float music-float'),row=node('div',null,'music-float-row');
    const copy=node('div',null,'music-float-copy'),title=node('strong'),artist=node('span');
    const info=node('div',null,'music-float-info'),time=node('span',null,'music-float-time');
    const progress=node('progress',null,'music-float-progress');progress.setAttribute('aria-label','歌曲播放进度');progress.hidden=true;
    title.id='float-music-title';info.append(artist,time);copy.append(title,info,progress);
    const transport=node('div',null,'music-float-controls');transport.setAttribute('role','group');transport.setAttribute('aria-label','汽水音乐控制');
    for(const [operation,label] of [['previous','上一首'],['toggle','播放 / 暂停'],['next','下一首']]){
      const button=node('button');button.type='button';button.dataset.musicOperation=operation;button.setAttribute('aria-label',label);button.title=label;
      button.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[operation]}"/></svg>`;
      button.addEventListener('click',()=>void command(operation));transport.append(button);
    }
    const artwork=node('div',null,'music-float-artwork');artwork.setAttribute('aria-hidden','true');
    artwork.innerHTML='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 15v2m5-6v10m6-15v20m6-16v12m5-7v2"/></svg>';
    row.append(artwork,copy,transport);
    const status=node('p',null,'music-float-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const actions=node('div',null,'music-float-actions');actions.id='music-float-options';actions.hidden=true;
    for(const [operation,label] of [['refresh','重新检测'],['open','打开汽水'],['settings','权限设置']]){
      const b=node('button',label);b.type='button';b.dataset.musicOperation=operation;b.addEventListener('click',()=>void command(operation));actions.append(b);
    }
    const more=node('button','···','music-float-more');more.type='button';more.title='更多';more.setAttribute('aria-label','更多');more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls',actions.id);
    document.querySelector('.float-bar').append(more);
    const footer=node('div',null,'music-float-footer');footer.append(status);
    function syncLayout(){
      const form='bar',expanded=failed||!actions.hidden;
      body.dataset.musicForm=form;body.dataset.musicExpanded=String(expanded);
      const key=`${form}:${expanded}`;if(lastLayout===key)return;lastLayout=key;
      void api.request({action:'music-layout',form,expanded}).then(result=>{if(!result?.ok)lastLayout='';}).catch(()=>{lastLayout='';});
    }
    function showOptions(open){actions.hidden=!open;row.hidden=open;more.textContent=open?'‹':'···';more.setAttribute('aria-label',open?'返回播放器':'更多');more.title=open?'返回播放器':'更多';more.setAttribute('aria-expanded',String(open));syncLayout();wake();}
    more.addEventListener('click',()=>showOptions(actions.hidden));
    const escapeOptions=event=>{if(event.key==='Escape'&&!actions.hidden){event.preventDefault();event.stopPropagation();showOptions(false);more.focus();}};
    body.addEventListener('keydown',escapeOptions);
    section.append(row,actions,footer);root.replaceChildren(section);
    function wake(){
      clearTimeout(idleTimer);body.classList.remove('music-idle');
      idleTimer=setTimeout(()=>{
        if(!busy&&!failed&&!body.matches(':hover')&&!body.querySelector(':focus-visible'))body.classList.add('music-idle');
      },3000);
    }
    function message(text,error=false){failed=error;status.textContent=text;status.classList.toggle('error',error);syncLayout();if(error)wake();}
    function render(value){
      if(disposed)return;
      latest=value;
      document.documentElement.dataset.theme=value.theme==='obsidian'?'obsidian':'white';
      title.textContent=value.installed===false?'汽水音乐':value.title||'汽水音乐';artist.textContent=value.installed===false?'尚未连接客户端':value.artist||'歌曲信息暂不可用';
      title.title=title.textContent;artist.title=artist.textContent;
      const timed=value.metadataAvailable===true&&Number.isFinite(value.elapsed)&&Number.isFinite(value.duration)&&value.duration>0;
      const clock=n=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
      time.textContent=timed?`${clock(value.elapsed)} / ${clock(value.duration)}`:'';
      progress.hidden=!timed;if(timed){progress.max=value.duration;progress.value=value.elapsed;progress.setAttribute('aria-valuetext',time.textContent);}
      const play=transport.querySelector('[data-music-operation="toggle"]');
      const playing=value.playing===true;play.setAttribute('aria-label',playing?'暂停':value.playing===false?'播放':'播放 / 暂停');
      play.querySelector('path').setAttribute('d',playing?'M8 5v14M16 5v14':value.playing===false?'m9 5 10 7-10 7V5Z':paths.toggle);
      play.querySelector('svg').setAttribute('fill',value.playing===false?'currentColor':'none');
      if(!failed||value.error==='accessibility_permission_required')message(value.detail||'播放状态暂不可用',value.error==='accessibility_permission_required');
      syncLayout();syncDisabled();
    }
    function syncDisabled(){
      section.querySelectorAll('[data-music-operation]').forEach(b=>b.disabled=busy);
      for(const b of transport.querySelectorAll('button'))b.disabled=busy||latest.installed===false||(latest.running===false&&b.dataset.musicOperation!=='toggle');
    }
    async function refresh(){
      if(disposed||busy||refreshing)return;refreshing=true;
      try{const value=await api.request({action:'get'});if(disposed||busy)return;if(value?.ok)render(value);else message('读取失败，请重新检测。',true);}
      catch{if(!disposed)message('主面板暂未响应，请重新检测。',true);}finally{refreshing=false;}
    }
    async function command(operation){
      if(disposed||busy)return;busy=true;wake();section.setAttribute('aria-busy','true');section.querySelectorAll('[data-music-operation]').forEach(b=>b.disabled=true);
      message('正在处理…');
      pending=(async()=>{
        try{
          const value=await api.request(operation==='settings'?{action:'settings'}:{action:'command',operation});
          if(disposed)return;
          if(!value?.ok){message(errors[value?.error]||'控制未完成，请重新检测，或打开汽水操作。',true);return;}
          failed=false;
          if(operation==='refresh')render(value);
          else message(operation==='settings'?'已打开设置，授权后请重新检测。':operation==='open'?'已请求打开汽水。':'控制已发送；如未响应，可点「打开汽水」。');
        }catch{if(!disposed)message('主面板暂未响应，请重试。',true);}
        finally{busy=false;if(!disposed){section.removeAttribute('aria-busy');syncDisabled();wake();}}
      })();
      return pending;
    }
    const events=['pointerenter','pointerleave','pointermove','focusin','focusout','keydown'];
    events.forEach(name=>body.addEventListener(name,wake));window.addEventListener('blur',wake);
    render(initial);wake();const timer=setInterval(()=>void refresh(),1000);
    return {async flush(){await pending;},destroy(){disposed=true;clearTimeout(idleTimer);clearInterval(timer);events.forEach(name=>body.removeEventListener(name,wake));window.removeEventListener('blur',wake);body.removeEventListener('keydown',escapeOptions);more.remove();body.classList.remove('music-floating','music-idle');}};
  }};
})();
