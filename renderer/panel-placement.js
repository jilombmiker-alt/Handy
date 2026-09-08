(() => {
  if(window.notchAPI?.launcherLayout)return;
  const api=window.notchAPI,handle=document.getElementById('panel-move-handle'),menu=document.getElementById('panel-position-menu');
  if(!handle||!api?.panelDrag)return;
  const topbar=handle.closest('.topbar');
  let session=null,suppressUntil=0;
  const closeMenu=()=>{menu.hidden=true;handle.setAttribute('aria-expanded','false');};
  const applyPlacement=state=>{document.documentElement.dataset.panelEdge=state?.placement?.edge||'free';};
  const refresh=async()=>{try{applyPlacement(await api.panelPosition('get'));}catch{}};
  window.PanelPlacement={refresh,closeMenu(){if(menu.hidden)return false;closeMenu();handle.focus();return true;}};
  void refresh();
  document.getElementById('reset-panel-layout')?.addEventListener('click',async()=>{
    const result=await api.panelPosition('reset').catch(()=>null);
    if(!result?.ok){showStatusToast('位置未恢复，请重试。');return;}
    window.resetPanelLayout?.();closeMenu();
  });
  document.addEventListener('notch:modechange',e=>{if(!e.detail?.expanded)closeMenu();});
  handle.addEventListener('click',()=>{if(performance.now()<suppressUntil)return;menu.hidden=!menu.hidden;handle.setAttribute('aria-expanded',String(!menu.hidden));});
  document.addEventListener('pointerdown',e=>{if(!handle.contains(e.target)&&!menu.contains(e.target))closeMenu();});
  topbar.addEventListener('pointerdown',e=>{
    if(e.button!==0||session||(!handle.contains(e.target)&&e.target.closest('button,input,select,textarea,a,.tabs')))return;
    e.preventDefault();const target=handle.contains(e.target)?handle:topbar;target.setPointerCapture(e.pointerId);
    // Capture the OS origin at press time, not after the pointer has already travelled.
    session={target,id:e.pointerId,x:e.screenX,y:e.screenY,moved:false,start:api.panelDrag('start')};
  });
  topbar.addEventListener('pointermove',e=>{
    const s=session;if(!s||s.ending||e.pointerId!==s.id)return;
    if(!e.buttons){void finish('cancel');return;}
    if(!s.moved&&Math.hypot(e.screenX-s.x,e.screenY-s.y)>=6){s.moved=true;closeMenu();suppressUntil=Infinity;handle.classList.add('moving');}
  });
  async function finish(phase) {
    const s=session;if(!s||s.ending)return;s.ending=true;
    try {if(s.start){const started=await s.start;if(started?.ok){const result=await api.panelDrag(s.moved?phase:'cancel',{token:started.token});if(!result?.ok)showStatusToast('位置未保存，请重试。');}else showStatusToast('当前暂时无法移动，请稍后重试。');}}
    catch {showStatusToast('移动已中止，原内容未改变。');}
    finally {if(session===s)session=null;handle.classList.remove('moving');if(s.moved)suppressUntil=performance.now()+400;if(s.target.hasPointerCapture(s.id))s.target.releasePointerCapture(s.id);}
  }
  topbar.addEventListener('pointerup',()=>void finish('end'));
  topbar.addEventListener('pointercancel',()=>void finish('cancel'));
  topbar.addEventListener('lostpointercapture',()=>void finish('cancel'));
  window.addEventListener('blur',()=>void finish('cancel'));
  api.onPanelPlacement?.(state=>{
    applyPlacement(state);
    handle.textContent=state.dragEdge?`松手靠${({left:'左',right:'右',top:'上'})[state.dragEdge]}隐藏`:'Handy';
    if(state.cancelled&&session&&!session.ending){const s=session;session=null;handle.classList.remove('moving');if(s.moved)suppressUntil=performance.now()+400;if(s.target.hasPointerCapture(s.id))s.target.releasePointerCapture(s.id);}
  });
  menu.addEventListener('click',async e=>{const button=e.target.closest('[data-panel-position]');if(!button)return;const result=await api.panelPosition(button.dataset.panelPosition).catch(()=>null);if(!result?.ok)showStatusToast('无法保存位置，请重试。');closeMenu();});
})();
