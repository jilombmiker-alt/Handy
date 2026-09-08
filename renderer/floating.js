(() => {
  'use strict';
  const api = window.floatingAPI, root = document.getElementById('floating-root');
  let editor = null, identity = null, closing = false, pendingReview=false,pendingRecord='';
  const theme = (value) => { document.documentElement.dataset.theme = value === 'obsidian' ? value : 'white'; };
  async function dock() {
    if (closing) return; closing = true;
    try { await editor?.flush(); await api.cancel(); await api.dock(); }
    catch { closing = false; }
  }
  async function load() {
    identity = await api.request({ action:'identity' });
    const pin=document.createElement('button');pin.id='float-pin';pin.type='button';
    let pinned=(await api.request({action:'pin-state'})).pinned!==false;
    const updatePin=()=>{pin.textContent=pinned?'取消置顶':'置顶';pin.setAttribute('aria-pressed',String(pinned));pin.title='仅控制这个工具小窗的持续置顶';};updatePin();
    pin.onclick=async()=>{pin.disabled=true;try{const r=await api.request({action:'pin',pinned:!pinned});if(r.ok)pinned=r.pinned;updatePin();}finally{pin.disabled=false;}};
    document.getElementById('float-dock').before(pin);
    const result = await api.request({ action:'get' });
    if (!result?.ok) { root.textContent = '读取失败，请收回后重试。未修改已有内容。'; return; }
    theme(result.theme);
    if(identity.kind==='module'){
      if(identity.id==='music'){
        document.title='Handy · 音乐';
        document.getElementById('float-handle').textContent='音乐 · 拖动';
        document.getElementById('float-dock').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
        document.getElementById('float-dock').title='关闭悬浮窗，不停止播放';
        document.getElementById('float-handle').title='按住拖动，移到屏幕顶部可收回';
        document.getElementById('float-dock').setAttribute('aria-label','关闭音乐悬浮窗，不停止播放');
      }
      if(identity.id==='todo'){
        root.replaceChildren();const switcher=document.createElement('div');switcher.className='planner-switch';
        const daily=document.createElement('button'),old=document.createElement('button'),dailyRoot=document.createElement('div'),oldRoot=document.createElement('div');
        daily.type=old.type='button';daily.textContent='返回今天';old.textContent='以前的分类清单';switcher.append(daily,old);root.append(switcher,dailyRoot,oldRoot);oldRoot.hidden=true;switcher.hidden=true;
        const planner=window.PlannerView.mount(dailyRoot,api,{review:()=>api.request({action:'command',operation:'review-ideas'}),source:id=>api.request({action:'command',operation:'open-idea-source',values:{id}}),legacy:()=>{dailyRoot.hidden=true;oldRoot.hidden=false;switcher.hidden=false;}}),legacy=window.PanelModuleFloat.mount(oldRoot,identity.id,result,api);
        daily.onclick=()=>{dailyRoot.hidden=false;oldRoot.hidden=true;switcher.hidden=true;};old.onclick=()=>{dailyRoot.hidden=true;oldRoot.hidden=false;};
        editor={async flush(){await planner.flush();await legacy.flush();},destroy(){planner.destroy();legacy.destroy();}};return;
      }
      editor=window.PanelModuleFloat.mount(root,identity.id,result,api);return;
    }
    if (identity.kind === 'recorder') { renderRecorder(result); return; }
    if(identity.kind==='quick'){
      editor=new window.QuickRecordEditor(root,result,{get:()=>api.request({action:'get'}),command:(command)=>api.request({action:'records',command}),archive:()=>api.request({action:'archive'}),source:()=>api.request({action:'source'}),plan:payload=>api.request({action:'idea-plan',...payload}),openPlan:recordId=>api.request({action:'idea-plan-open',recordId})});
      if(pendingRecord)await editor.openRecord(pendingRecord);
      else if(pendingReview)await editor.review(pendingReview);
      return;
    }
    editor = new window.NotebookEditor(root,result.note,{
      linkedResources:()=>api.request({action:'linked-resources'}),openResource:linkId=>api.request({action:'open-resource',linkId}),
      quick:identity.kind === 'quick',
      save:(note,revision) => api.request({ action:'save',note,revision }),
      archive:() => api.request({ action:'archive' }),
      prepare:api.prepare,cancel:api.cancel,importFiles:api.importFiles,copy:api.copy,
      settings:() => api.request({ action:'settings' }),references:(ids) => api.request({ action:'references',ids }),
    });
  }
  function renderRecorder(value) {
    if (!root.querySelector('.float-recorder')) {
      root.innerHTML = '<section class="float-recorder"><span class="float-record-label"></span><span class="float-record-clock">00:00</span><div class="float-record-controls"><button type="button" data-record="start">开始录音</button><button type="button" data-record="pause">暂停</button><button type="button" data-record="stop">结束</button><button type="button" data-record="mark">标记重点</button></div><p class="float-record-transcript" aria-label="实时转写"></p><label class="voice-auto"><input type="checkbox" data-voice-auto>结束后自动整理</label><span class="float-record-feedback" role="status"></span><div class="float-record-controls"><button type="button" data-record="retry-save" hidden>重试保存</button><button type="button" data-record="results">查看记录</button><button type="button" data-record="permissions">权限与设置</button></div></section>';
      root.querySelector('[data-voice-auto]').addEventListener('change',async e=>{try{renderRecorder(await api.request({action:e.target.checked?'auto-on':'auto-off'}));}catch{e.target.checked=!e.target.checked;}});
      root.addEventListener('click',async (e) => {
        const button = e.target.closest('[data-record]'); if (!button) return;
        button.disabled = true;
        try { const result = await api.request({ action:button.dataset.record }); renderRecorder(result); }
        catch { root.querySelector('.float-record-feedback').textContent = '主界面未响应，请稍后重试。'; }
        finally { if (['permissions','results'].includes(button.dataset.record)) button.disabled = false; }
      });
    }
    const state = value.status || 'idle', active = ['recording','paused'].includes(state);
    root.querySelector('.float-recorder').dataset.state = state;
    root.querySelector('.float-record-label').textContent = ({ idle:'口述想法',starting:'等待麦克风',recording:'正在录音',paused:'已暂停',saving:'正在保存','save-failed':'等待重试保存' })[state] || '口述想法';
    root.querySelector('.float-record-clock').textContent = value.time || '00:00';
    root.querySelector('[data-record="start"]').disabled = state !== 'idle';
    root.querySelector('[data-record="pause"]').disabled = !active;
    root.querySelector('[data-record="pause"]').textContent = state === 'paused' ? '继续' : '暂停';
    root.querySelector('[data-record="stop"]').disabled = !active;
    root.querySelector('[data-record="mark"]').disabled = !active || value.markers>=100;
    root.querySelector('[data-record="mark"]').textContent = `标记重点${value.markers ? ` · ${value.markers}` : ''}`;
    const retry=root.querySelector('[data-record="retry-save"]');retry.hidden=state!=='save-failed';retry.disabled=state!=='save-failed';
    root.querySelector('[data-voice-auto]').checked=value.autoOrganize!==false;
    root.querySelector('.float-record-transcript').textContent=value.transcript || (active?'开始说话，文字会显示在这里。':'记录临时想法，原音频保留本机。');
    root.querySelector('.float-record-feedback').textContent = value.feedback || '收回小窗不会结束录音。仅点击开始时使用麦克风。';
  }
  api.onChanged((payload) => {
    if(payload.kind==='note'&&payload.linksChanged)editor?.refreshLinks?.();
    if (payload.kind === 'theme') theme(payload.theme);
    if (identity?.kind === 'recorder' && payload.kind === 'recorder') renderRecorder(payload);
    if(payload.kind==='quick'){
      if(payload.review){pendingReview=payload.review;if(identity?.kind==='quick')editor?.review(payload.review).catch(()=>{});}
      if(payload.recordId){pendingRecord=payload.recordId;if(identity?.kind==='quick')editor?.openRecord(payload.recordId).catch(()=>{});}
      if(payload.refresh&&identity?.kind==='quick')editor?.refresh().catch(()=>{});
    }
  });
  api.onClose(dock); document.getElementById('float-dock').onclick = dock;
  document.addEventListener('keydown',(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') { event.preventDefault(); void dock(); } });
  const handle = document.getElementById('float-handle'); let dragging = false;
  handle.addEventListener('pointerdown',async (event) => { if (event.button !== 0) return; dragging = true; handle.setPointerCapture(event.pointerId); await api.drag('start'); });
  handle.addEventListener('pointermove',async () => { if (!dragging) return; const result = await api.drag('move'); handle.textContent = result.overDock ? '松手收回灵动岛' : '拖动小窗'; });
  async function endDrag(phase) { if (!dragging) return; dragging = false; const result = await api.drag(phase); handle.textContent = '拖动小窗'; if (result.overDock) await dock(); }
  handle.addEventListener('pointerup',() => void endDrag('end'));
  handle.addEventListener('pointercancel',() => void endDrag('cancel'));
  window.addEventListener('beforeunload',() => { editor?.flush().catch(() => {}); editor?.destroy(); });
  load().catch(() => { root.textContent = '小窗暂不可用，请收回后重试。'; });
})();
