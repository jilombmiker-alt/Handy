(() => {
  'use strict';
  const labels={not_configured:'尚未配置文本模型，请打开 API 配置。',unauthorized:'模型密钥不可用，请检查配置后重试。',timeout:'整理超时，可以稍后重试。',cancelled:'已取消整理。',invalid_response:'模型结果不完整，未采用。',rate_limited:'模型服务繁忙，请稍后重试。',request_failed:'暂时无法连接模型，请检查网络后重试。',text_too_long:'转写超过 8000 字符，未截断或发送。请精简校对副本后重试。',empty_text:'暂无转写。可先回听音频，补充校对副本再整理。',busy:'已有整理进行中，请稍后再试。',storage_failed:'本机写入失败，请复制结果备份并重试保存。',interrupted:'上次整理被退出中断，可手动重试。',source_changed:'整理时校对副本发生变化，未覆盖当前内容。'};
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  function button(label,action){const b=node('button','workspace-button compact',label);b.type='button';b.addEventListener('click',()=>void action());return b;}
  function mount(root,recording,api){
    const v=recording.voice,section=node('section','voice-memo');
    const status=node('p','voice-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const savedHint=recording.audioPath?'原音频和原始转写已独立保留。':'原始转写已保留；这条记录没有可用音频。';
    status.textContent=v.status==='running'?`正在整理… ${savedHint}`:v.status==='done'?`整理完成，请核对原意。${savedHint}`:`${labels[v.error]||'可以继续回听或整理这次想法。'} ${savedHint}`;
    if(v.status==='failed')status.classList.add('error');
    const actions=node('div','voice-actions');
    actions.append(button(v.status==='running'?'取消整理':v.cleaned?'重新整理':'整理想法',()=>api.organize(v.status==='running')));
    if(api.capture){
      const record=api.quickRecord?.(),captureFailed=!!api.captureError?.(),hint=node('p','voice-help');
      hint.textContent=captureFailed?'随手记未能写入最新内容，录音结果仍保留，请重试。':record?.trashedAt?'关联随手记已在回收站，不会自动恢复。':record?'已存为独立随手记，可继续补充或转为笔记。':'随手记尚未保存，原音频与转写仍保留。';
      if(record&&!record.trashedAt)actions.append(button('打开随手记',async()=>{const result=await api.openQuick();if(!result?.ok)status.textContent='打开失败，请先保存随手记小窗的输入后重试。';}));
      if(!record||captureFailed)actions.append(button(captureFailed?'重试存入随手记':'存入随手记',()=>{const result=api.capture();if(!result?.ok){status.textContent='随手记保存失败，请复制内容备份后重试。';status.classList.add('error');}}));
      section.append(hint);
    }
    const retry=button('重试保存',()=>{const previous={status:v.status,error:v.error};v.status=v.cleaned?'done':'idle';v.error='';if(api.save()){status.textContent='已保存到本机。';status.classList.remove('error');retry.hidden=true;}else Object.assign(v,previous);});if(v.error!=='storage_failed')retry.hidden=true;actions.append(retry);
    const tabs=node('nav','voice-tabs');tabs.setAttribute('aria-label','录音输出');
    const content=node('div','voice-content');
    function show(tab){
      for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.tab===tab));
      content.replaceChildren();
      if(tab==='cleaned'){
        const label=node('label','voice-field','整理稿（可编辑）'),editor=node('textarea','recording-transcript-editor voice-cleaned');
        editor.setAttribute('aria-label','口述整理稿');editor.value=v.cleaned;editor.readOnly=v.status==='running';editor.placeholder=v.status==='running'?'正在忠实整理你的想法…':'整理结果会放在这里，原始转写不会被替换。';
        editor.addEventListener('input',()=>{v.cleaned=editor.value;v.updatedAt=Date.now();if(!api.save()){status.textContent=labels.storage_failed;status.classList.add('error');retry.hidden=false;}});
        label.append(editor);content.append(label,button('复制整理稿',()=>api.copy(editor.value)));
        if(v.uncertainties.length){const hint=node('p','voice-help',`待核对：${v.uncertainties.join('；')}`);content.append(hint);}
      }else if(tab==='summary'){
        const list=node('ul','voice-summary');for(const text of v.summary)list.append(node('li','',text));
        content.append(v.summary.length?list:node('p','voice-help','整理完成后，这里会显示整段重点。'));
        if(v.summary.length)content.append(button('复制重点',()=>api.copy(v.summary.join('\n'))));
      }else{
        const label=node('label','voice-field','原始转写（保留识别结果）'),raw=node('textarea','recording-transcript-editor voice-raw');
        raw.readOnly=true;raw.value=v.rawTranscript;raw.setAttribute('aria-label','原始转写');label.append(raw);content.append(label,button('复制原始转写',()=>api.copy(v.rawTranscript)));
        const details=node('details','voice-correction'),summary=node('summary','','校对识别结果（不改原始记录）');
        const corrected=node('textarea','recording-transcript-editor');corrected.value=recording.transcript;corrected.setAttribute('aria-label','录音转写文本');
        corrected.addEventListener('input',()=>{recording.transcript=corrected.value;if(!api.save()){status.textContent=labels.storage_failed;retry.hidden=false;}});
        details.append(summary,corrected,node('p','voice-help','重试整理时使用这份校对副本；录音和原始转写不变。'));content.append(details);
      }
    }
    for(const [key,label] of [['cleaned','整理稿'],['summary','整段重点'],['raw','原始转写']]){const b=button(label,()=>show(key));b.dataset.tab=key;tabs.append(b);}
    section.append(status,actions,tabs,content);
    if(v.markers.length){
      const markers=node('details','voice-markers'),summary=node('summary','',`已标记 ${v.markers.length} 处重点 · 点击回听`);markers.append(summary);
      v.markers.forEach((m,i)=>{const b=button(`重点 ${i+1} · ${m.context.slice(-42)||'音频中的这个时刻'}`,()=>api.seek(m.offsetMs));b.title='从标记前 3 秒开始回听';markers.append(b);});section.append(markers);
    }
    root.append(section);show(v.cleaned||v.status==='running'?'cleaned':'raw');
  }
  window.VoiceMemoView={mount,labels};
})();
