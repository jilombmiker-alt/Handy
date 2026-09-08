(() => {
  'use strict';
  const M=window.ToolShortcutModel,KEY='notch-tool-shortcuts-v1';
  let saved;try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
  let mapping=M.normalize(saved),draft={...mapping},recording=null,composing=false,busy=false;
  if(M.validate(mapping))mapping={...M.defaults};
  draft={...mapping};
  const labels={quick:'随手记',recorder:'录音',currentNote:'当前选中的笔记',...Object.fromEntries(Object.entries(window.PanelModuleCatalog).map(([k,v])=>[k,v.label]))};
  const form=document.getElementById('tool-shortcut-form'),fields=document.getElementById('tool-shortcut-fields'),status=document.getElementById('tool-shortcut-status');
  const buttons=new Map();
  function paint(){for(const [id,button] of buttons){button.textContent=recording===id?'请按键…':draft[id]||'未设置';button.setAttribute('aria-label',`${labels[id]}快捷键：${draft[id]||'未设置'}，点击录制`);}}
  for(const [id,label] of Object.entries(labels)){
    const row=document.createElement('div');row.className='tool-shortcut-row';
    const name=document.createElement('span');name.textContent=label;
    const record=document.createElement('button');record.type='button';record.className='workspace-button compact';record.onclick=()=>{recording=id;status.textContent='按下单键或组合键；Escape 取消录制。';paint();};
    const clear=document.createElement('button');clear.type='button';clear.className='workspace-button compact';clear.textContent='清除';clear.setAttribute('aria-label',`清除${label}快捷键`);clear.onclick=()=>{recording=null;draft[id]='';paint();};
    buttons.set(id,record);row.append(name,record,clear);fields.append(row);
  }
  paint();
  form.addEventListener('submit',event=>{
    event.preventDefault();recording=null;paint();
    const error=M.validate(draft);
    if(error){status.textContent=error==='duplicate'?'有重复快捷键，请给每个工具设置不同的按键。':'按键无效，请重新录制。';return;}
    try{localStorage.setItem(KEY,JSON.stringify(draft));mapping={...draft};status.textContent=window.notchAPI?.launcherLayout?'已保存。快捷键直接在当前面板打开工具，输入时不触发。':'已保存。快捷键只打开或定位浮窗，不会将它收回。';}
    catch{status.textContent='保存失败，原快捷键未改变，请重试。';}
  });
  document.addEventListener('compositionstart',()=>{composing=true;},true);
  document.addEventListener('compositionend',()=>{composing=false;},true);
  window.addEventListener('blur',()=>{recording=null;composing=false;paint();});
  document.addEventListener('notch:modechange',()=>{recording=null;paint();});
  // Capture phase prevents a user-assigned digit also switching a page.
  document.addEventListener('keydown',event=>{
    if(recording){
      if(!form.contains(event.target)){recording=null;paint();return;}
      event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Escape'){recording=null;paint();status.textContent='已取消录制。';return;}
      if(event.repeat||event.isComposing)return;
      const key=M.fromEvent(event);
      if(!key){status.textContent='可用字母、数字、F1–F24 或带修饰键的组合；不能占用退出等常用操作。';return;}
      draft[recording]=key;recording=null;paint();status.textContent='按键已录入，点击保存后生效。';return;
    }
    const target=event.target instanceof Element?event.target:null;
    const editing=!!target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],#tool-shortcut-form');
    const modal=[...document.querySelectorAll('[role="dialog"]:not([hidden]):not([aria-hidden="true"])')].some(el=>el.getClientRects().length>0);
    if(!M.eligible(event,{expanded:document.getElementById('app').classList.contains('expanded'),focused:document.hasFocus(),editing,modal,composing}))return;
    const key=M.fromEvent(event),id=key&&Object.keys(mapping).find(id=>mapping[id]===key);
    if(!id)return;event.preventDefault();event.stopImmediatePropagation();if(busy)return;
    busy=true;
    const open=async()=>{
      if(id==='currentNote'){
        if(typeof selectedNoteId==='undefined'||!selectedNoteId){showStatusToast('请先在笔记页选中一篇笔记。');return;}
        await Notebook.detach('note',selectedNoteId);
      }else await Notebook.detach(['quick','recorder'].includes(id)?id:'module',id);
    };
    void open().catch(()=>showStatusToast('暂时无法打开，原内容保持不变。')).finally(()=>{busy=false;});
  },true);
  function health(settings){
    const el=document.getElementById('panel-shortcut-health');if(!el)return;
    el.textContent=settings?.shortcutError?`双修饰键尚未启用：${settings.shortcutError==='accessibility_required'?'请在下方打开辅助功能设置，授权后重新检测并试用':'请重新检测，或安装完整新版'}。目前可用：${NotchDomain.panelShortcutLabel(settings.activeShortcut)||'顶部菜单栏'}。`:'';
  }
  window.notchAPI?.getAppSettings?.().then(health).catch(()=>{});
  window.notchAPI?.onAppSettingsChanged?.(health);
})();
