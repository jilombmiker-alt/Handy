(() => {
  'use strict';
  const errors={timer_busy:'已有计时，请先结束当前这次。',conflict:'计时已更新，请再试一次。',stale_session:'这次计时已结束，请刷新。',save_failed:'本地保存失败，计时与输入仍保留，请重试。',corrupt_store:'计时文件无法读取，原文件未覆盖，请从备份恢复。',invalid_duration:'请设置 1 秒至 24 小时。',no_recording:'请先开始录音，再选择到点结束本次录音。',invalid_recording:'正计时没有到点动作，请使用倒计时。',history_full:'计时记录已达上限，请先备份整理。'};
  const format=ms=>{const s=Math.floor(Math.max(0,ms)/1000);return `${Math.floor(s/3600)?String(Math.floor(s/3600)).padStart(2,'0')+':':''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
  window.SimpleTimer={format,mount(root,api,{compact=false,open=()=>{}}={}){
    let state=null,busy=false,pending=Promise.resolve(),disposed=false,historyKey='',refreshing=false;
    const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
    const box=node('section',null,'simple-timer module-float'),head=node('div',null,'timer-head'),label=node('span','计时'),mode=node('select');
    mode.setAttribute('aria-label','计时模式');for(const [value,text] of [['countdown','倒计时'],['countup','正计时']]){const o=node('option',text);o.value=value;mode.append(o);}head.append(label,mode);
    const digits=node('div',null,'timer-digits'),minutes=node('input'),seconds=node('input'),clock=node('output','00:00');
    for(const [e,name,max] of [[minutes,'分钟',1440],[seconds,'秒',59]]){e.type='number';e.min='0';e.max=String(max);e.setAttribute('aria-label',name);}minutes.value='30';seconds.value='0';digits.append(minutes,node('span',':'),seconds,clock);
    const actions=node('div',null,'timer-actions'),toggle=node('button','开始'),finish=node('button','结束'),more=node('button',compact?'':'选项与记录');for(const e of [toggle,finish,more])e.type='button';actions.append(toggle,finish,more);
    if(compact){more.title='打开计时小窗';more.setAttribute('aria-label','打开计时小窗');more.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';}
    const status=node('p',null,'timer-status');status.setAttribute('role','status');
    const options=node('div',null,'timer-options');options.hidden=true;more.setAttribute('aria-expanded','false');
    const titleLabel=node('label','这次做什么（选填）'),title=node('input');title.maxLength=200;titleLabel.append(title);
    const stopLabel=node('label',null,'timer-recording'),stop=node('input');stop.type='checkbox';stopLabel.append(stop,node('span','到点结束当前这次录音'));
    const hint=node('p','只关联已开始的录音，不自动打开麦克风。','timer-hint'),suggestion=node('p',null,'timer-hint'),history=node('details'),list=node('div',null,'timer-history');history.append(node('summary','用时记录'),list);options.append(titleLabel,stopLabel,hint,suggestion,history);
    box.append(head,digits,actions,status,options);root.replaceChildren(box);box.classList.toggle('timer-compact',compact);
    function say(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
    function controls(){const a=state?.active,idle=!a,down=mode.value==='countdown';minutes.hidden=seconds.hidden=digits.children[1].hidden=!idle||!down;clock.hidden=idle&&down;mode.disabled=title.disabled=stop.disabled=busy||!!a;minutes.disabled=seconds.disabled=busy||!!a;toggle.disabled=finish.disabled=busy||!state?.ok;finish.hidden=!a;stopLabel.hidden=hint.hidden=!down;toggle.textContent=!a?'开始':a.running?'暂停':'继续';}
    function render(s){if(s?.ok&&state?.ok&&s.revision<state.revision)return;const wasActive=!!state?.active;state=s;if(!s?.ok){say(errors[s?.error]||'读取失败，请稍后重试。',true);controls();return;}
      const a=s.active;if(a){mode.value=a.mode;title.value=a.title;const overtime=a.mode==='countdown'&&a.currentMs>=a.plannedMs;clock.textContent=(overtime?'+':'')+format(a.mode==='countup'?a.currentMs:Math.abs(a.plannedMs-a.currentMs));say(`${a.title|| (a.mode==='countup'?'正在记录用时':'倒计时')}${overtime?' · 已到点，可继续或结束':a.recovered?' · 上次计时已暂停':!a.running?' · 已暂停':''}`);}
      else{clock.textContent='00:00';if(!box.dataset.ready||wasActive){mode.value=s.settings.mode;minutes.value=String(Math.floor(s.settings.seconds/60));seconds.value=String(s.settings.seconds%60).padStart(2,'0');box.dataset.ready='true';}if(!status.classList.contains('error'))say('');}
      const key=String(s.history.length);if(historyKey!==key){historyKey=key;list.replaceChildren();for(const r of s.history.slice(-100).reverse()){const row=node('div',null,'timer-history-row');row.append(node('strong',r.title||'未命名计时'),node('span',`${new Date(r.startedAt).toLocaleString()} · ${r.mode==='countdown'?'预计 '+format(r.plannedMs)+' / ':''}实际 ${format(r.elapsedMs)}`));list.append(row);}if(!s.history.length)list.append(node('p','结束后自动保存在这里。'));}
      controls();suggest();
    }
    function suggest(){if(!state?.ok)return;const key=title.value.trim().toLocaleLowerCase(),rows=key?state.history.filter(r=>r.title.trim().toLocaleLowerCase()===key).slice(-10):[];const values=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b);suggestion.textContent=values.length>=2?`之前 ${values.length} 次通常用了约 ${Math.max(1,Math.round(values[Math.floor(values.length/2)]/60000))} 分钟，仅供参考。`:'';}
    async function refresh(){if(busy||disposed||refreshing)return;refreshing=true;try{const s=await api.get();if(!disposed&&!busy)render(s);}catch{if(!disposed)say('暂时无法读取，请重试。',true);}finally{refreshing=false;}}
    function command(action){if(busy||!state?.ok)return;busy=true;controls();pending=(async()=>{try{const a=state.active;const r=await api.command({action,revision:state.revision,id:a?.id,mode:mode.value,seconds:Number(minutes.value)*60+Number(seconds.value),title:title.value,stopRecording:stop.checked});if(!r?.ok){say(errors[r?.error]||'操作失败，请重试。',true);const updated=await api.get();if(updated?.ok)state=updated;return;}say('');render(r);if(action==='finish'){stop.checked=false;say('用时已保存在本机。');}}catch{say('操作未完成，请重试。',true);}finally{busy=false;controls();}})();return pending;}
    toggle.onclick=()=>command(!state?.active?'start':state.active.running?'pause':'resume');finish.onclick=()=>command('finish');mode.onchange=()=>{if(mode.value==='countup')stop.checked=false;controls();};title.oninput=suggest;
    more.onclick=()=>{if(compact){open();return;}options.hidden=!options.hidden;more.setAttribute('aria-expanded',String(!options.hidden));api.layout?.(!options.hidden);};
    refresh();api.layout?.(false);const interval=setInterval(refresh,500);
    return {refresh,async flush(){await pending;},destroy(){disposed=true;clearInterval(interval);}};
  }};
})();
