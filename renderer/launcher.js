(() => {
  'use strict';
  const api=window.notchAPI,M=window.LauncherModel;
  if(!api?.launcherLayout)return;
  document.body.classList.add('launcher-enabled');
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  const home=document.getElementById('tab-home'),legacy=document.getElementById('home-bento');
  const header=node('header',null,'launcher-header'),back=node('button','工具','launcher-back'),title=node('strong','随手用'),actions=node('div',null,'launcher-actions');
  const collapse=node('button','⌄'),settings=node('button','设置');
  back.type=collapse.type=settings.type='button';collapse.setAttribute('aria-label','收起工具启动器');
  const theme=document.getElementById('theme-toggle');
  actions.append(settings,theme,collapse);header.append(back,title,actions);panel.prepend(header);
  const landing=node('section',null,'launcher-landing'),search=node('input'),grid=node('div',null,'launcher-grid'),more=node('button','更多工具'),empty=node('p','没有找到这个工具，换个词试试。','launcher-empty');
  search.type='search';search.placeholder='找一个工具，开始使用';search.setAttribute('aria-label','搜索工具');
  more.type='button';more.className='launcher-more';empty.hidden=true;landing.append(search,grid,empty,more);home.append(landing);
  const welcome=node('section',null,'launcher-welcome'),welcomeCopy=node('p','Handy，随手即用。选个工具开始，权限按需开启。');
  const welcomeActions=node('div'),permissionHelp=node('button','使用与权限'),dismissWelcome=node('button','知道了');
  welcome.setAttribute('aria-label','首次使用提示');permissionHelp.type=dismissWelcome.type='button';
  permissionHelp.id='launcher-permission-help';dismissWelcome.id='launcher-welcome-dismiss';
  welcomeActions.append(permissionHelp,dismissWelcome);welcome.append(welcomeCopy,welcomeActions);landing.prepend(welcome);
  try { welcome.hidden=localStorage.getItem('handy-welcome-dismissed-v1')==='true'; } catch {}
  dismissWelcome.onclick=()=>{try{localStorage.setItem('handy-welcome-dismissed-v1','true');}catch{}welcome.hidden=true;search.focus();};
  permissionHelp.onclick=async()=>{const result=await open('settings');if(result.ok){const target=document.getElementById('settings-permission-title');target?.setAttribute('tabindex','-1');target?.focus();target?.scrollIntoView({block:'center'});}};
  const virtual=node('section',null,'launcher-tool');virtual.hidden=true;home.append(virtual);
  let current=null,moreOpen=false,quickEditor=null,navigating=false,queue=Promise.resolve();
  const cached=new Map();
  const symbols={quick:'M5 4h14v16H5zM8 8h8M8 12h6',todo:'m4 7 2 2 4-4M13 7h7M4 16l2 2 4-4M13 16h7',recorder:'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3',clip:'M8 5H5v16h14V5h-3M8 3h8v4H8z',links:'m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',pomodoro:'M9 2h6M12 8v5l3 2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0',music:'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3h3M20 16a3 3 0 1 1-3-3h3',commands:'M3 6h7l2 3h9v11H3z'};
  function paint(){
    let mapping={};try{mapping=window.ToolShortcutModel.normalize(JSON.parse(localStorage.getItem('notch-tool-shortcuts-v1')||'null'));}catch{}
    const query=search.value.trim().toLowerCase();
    const rows=M.tools.filter(t=>(moreOpen||query||t.primary)&&(!query||`${t.label} ${t.hint} ${mapping[t.id]||''}`.toLowerCase().includes(query)));
    grid.replaceChildren();empty.hidden=rows.length>0;
    for(const t of rows){
      const button=node('button',null,'launcher-tile');button.type='button';button.dataset.launcherTool=t.id;
      const icon=node('span',null,'launcher-icon');icon.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${symbols[t.id]||'M4 4h16v16H4zM4 10h16'}"/></svg>`;
      const label=node('span',t.label),hint=node('small',t.hint),key=node('kbd',mapping[t.id]||'');
      button.append(icon,label,key,hint);button.onclick=()=>void open(t.id);grid.append(button);
    }
    more.textContent=moreOpen?'只看常用工具':'更多工具';more.setAttribute('aria-expanded',String(moreOpen));
  }
  async function flush(){await quickEditor?.flush();}
  function display(id){
    current=id;const tool=M.tools.find(t=>t.id===id);title.textContent=tool?.label||'随手用';back.hidden=!id;
    landing.hidden=!!id;virtual.hidden=!id||tool?.tab!=='home';
    for(const [key,element] of cached)element.hidden=key!==id;
    document.body.dataset.launcherTool=id||'home';
    void api.launcherLayout(id||'home');
  }
  async function mount(id){
    if(cached.has(id)){if(id==='quick')await quickEditor.refresh();return;}
    const root=node('section',null,`launcher-tool-content launcher-${id}`);virtual.append(root);cached.set(id,root);
    try{
      if(id==='quick'){
        const request=p=>window.Notebook.request({kind:'quick',...p}),result=await request({action:'get'});
        if(!result.ok)throw Error(result.error);
        quickEditor=new window.QuickRecordEditor(root,result,{get:()=>request({action:'get'}),command:command=>request({action:'records',command}),archive:()=>request({action:'archive'}),source:()=>request({action:'source'}),plan:p=>request({action:'idea-plan',...p}),openPlan:recordId=>request({action:'idea-plan-open',recordId})});
      }else if(id==='gallery'){
        window.ReferenceView.mount(root,api);
      }else{
        const selector={pomodoro:'#home-timer-body',commands:'.mp-home-root',music:'#home-music',windows:'#window-tools-root',mirror:'.home-mirror'}[id];
        const existing=selector&&document.querySelector(selector);if(!existing)throw Error('missing_tool');
        existing.hidden=false;root.append(existing);
      }
    }catch(error){cached.delete(id);root.remove();throw error;}
  }
  async function navigate(id,payload={}){
    const tool=M.tools.find(t=>t.id===id);if(id&&!tool)throw Error('unknown_tool');
    if(tool&&tool.tab!=='home'&&!TABS.includes(tool.tab)){showStatusToast(`${tool.label}尚未启用，请在设置中主动开启。`);return {ok:false,error:'feature_disabled'};}
    await flush();await window.Notebook.flush();
    if(payload.kind==='note'){
      if(!window.Notebook.get(payload.id)){showStatusToast('未找到这篇笔记，原内容未改变。');return {ok:false,error:'not_found'};}
      selectedNoteId=payload.id;if(notesSearch)notesSearch.value='';
    }
    if(id!=='mirror')stopMirror();
    if(tool?.tab==='home')await mount(id);
    navigating=true;
    try{await setActiveTab(tool?.tab||'home');display(id);}finally{navigating=false;}
    if(payload.kind==='note')renderNotesLibrary();
    if(id==='todo')window.PanelPlanner?.show(true);
    if(!isExpanded)await setMode(true);
    if(id==='quick'&&payload.review)await quickEditor.review(payload.review);
    else if(id==='quick'&&payload.recordId)await quickEditor.openRecord(payload.recordId);
    const scope=id?(tool.tab==='home'?cached.get(id):document.getElementById(`tab-${tool.tab}`)):landing;
    const focus=scope?.querySelector(id==='quick'?'[data-field="content"]':'input:not([type="checkbox"]):not([type="hidden"]),textarea,button');
    if(focus&&focus.getClientRects().length)focus.focus({preventScroll:true});
    return {ok:true,inline:true};
  }
  function open(id,payload={}){
    const result=queue.catch(()=>{}).then(()=>navigate(id,payload));queue=result;
    return result.catch(()=>{showStatusToast('暂时无法切换，请先保存当前输入后重试。');return {ok:false,error:'open_failed'};});
  }
  async function openPayload(payload){
    // Finder activation and ready-to-show can arrive together: open, never toggle.
    if(payload?.kind==='resume')return open(current);
    if(payload?.kind==='group'){
      await open(null);search.value='';moreOpen=true;paint();
      const members=new Set((payload.tools||[]).map(k=>k.startsWith('module:')?k.slice(7):k));
      for(const button of grid.children)button.hidden=!members.has(button.dataset.launcherTool);
      title.textContent=payload.label||'工具组合';return;
    }
    const id=M.route(payload);if(id)await open(id,payload);else showStatusToast('这个工具暂时无法打开。');
  }
  search.oninput=paint;search.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)grid.querySelector('button')?.click();};
  more.onclick=()=>{moreOpen=!moreOpen;paint();};back.onclick=()=>{search.value='';paint();void open(null);};
  settings.onclick=()=>void open('settings');collapse.onclick=()=>void setMode(false);
  const permissions=document.querySelector('.settings-permission-panel');
  if(permissions){permissions.classList.add('tile','settings-card');document.querySelector('.settings-column-secondary')?.prepend(permissions);}
  // Older internal links still use setActiveTab: synchronize the same shell, without reopening windows.
  document.addEventListener('notch:tabchange',e=>{if(navigating)return;const tab=e.detail?.tab;display(tab==='home'?null:M.tools.find(t=>t.tab===tab)?.id||null);});
  document.addEventListener('notch:modechange',e=>{if(e.detail?.expanded){paint();if(!current)search.focus();}});
  api.onLauncherOpen(p=>void openPayload(p));
  api.onLauncherChanged(p=>{if(p?.kind==='quick'&&quickEditor){const run=async()=>{if(p.review)await quickEditor.review(p.review);else if(p.recordId)await quickEditor.openRecord(p.recordId);else if(p.refresh)await quickEditor.refresh();};void run().catch(()=>showStatusToast('记录已更新，当前未保存输入仍保留。'));}});
  window.addEventListener('beforeunload',e=>{if(quickEditor&&quickEditor.saved<quickEditor.dirty){e.preventDefault();e.returnValue=false;void quickEditor.flush().catch(()=>{});}});
  // Hide obsolete floating-only actions, not the underlying data or controllers.
  for(const b of document.querySelectorAll('.nb-entry'))if(['收回全部','悬浮录音'].includes(b.textContent))b.hidden=true;
  if(legacy)legacy.hidden=true;
  const shortcutHint=document.querySelector('.settings-shortcut-map');if(shortcutHint)shortcutHint.textContent='展开后可用自定义工具快捷键；默认 N 随手记、T 待办、R 录音、L 链接、M 音乐。输入时不触发。';
  window.ToolLauncher={open,openPayload,flush,get current(){return current;}};
  paint();display(null);void setActiveTab('home');
})();
