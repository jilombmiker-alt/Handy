(() => {
  'use strict';
  const api=window.notchAPI,M=window.LauncherModel;
  if(!api?.launcherLayout)return;
  document.body.classList.add('launcher-enabled');
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  const home=document.getElementById('tab-home'),legacy=document.getElementById('home-bento');
  const header=node('header',null,'launcher-header'),back=node('button','返回','launcher-back'),title=node('strong','Handy'),actions=node('div',null,'launcher-actions');
  const collapse=node('button','⌄'),settings=node('button','设置');
  back.type=collapse.type=settings.type='button';collapse.setAttribute('aria-label','收起工具启动器');
  const theme=document.getElementById('theme-toggle');
  settings.id='launcher-settings';settings.setAttribute('aria-label','设置');settings.title='打开设置';
  const menuToggle=node('button'),headerMenu=node('div');menuToggle.type='button';menuToggle.id='launcher-menu-toggle';menuToggle.setAttribute('aria-label','更多：调整与历史');menuToggle.title='更多：调整与历史';
  menuToggle.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
  actions.append(settings,menuToggle);header.append(back,title,actions);panel.prepend(header);
  title.title='拖动标题栏移动窗口';
  window.HandyMenu(menuToggle,headerMenu);
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
  const drawer=node('section',null,'launcher-tool-drawer');drawer.hidden=true;drawer.setAttribute('aria-label','全部工具');
  drawer.append(welcome,search,grid,empty,more);landing.append(drawer);
  const entry=window.AssistantEntry?.mount(landing,{api,openTool:open,showTools:()=>{drawer.hidden=!drawer.hidden;if(!drawer.hidden){moreOpen=true;paint();search.focus();}}});
  const adjustment=node('details'),adjustTitle=node('summary','调整');adjustment.append(adjustTitle);adjustment.dataset.keepMenu='true';
  const appearanceKey='handy-entry-appearance-v1';let appearance={font:16,size:'auto'};
  try{const saved=JSON.parse(localStorage.getItem(appearanceKey)||'null');if(saved){if([14,16,18].includes(saved.font))appearance.font=saved.font;if(saved.size==='wide')appearance.size='wide';}}catch{}
  const fontLabel=node('label','输入字号 '),fontSize=node('select'),sizeLabel=node('label','窗口大小 '),windowSize=node('select');
  fontSize.setAttribute('aria-label','输入字号');windowSize.setAttribute('aria-label','窗口大小');
  for(const size of [14,16,18]){const o=node('option',size+'px');o.value=String(size);fontSize.append(o);}fontSize.value=String(appearance.font);
  for(const [value,label] of [['auto','紧凑 · 按内容展开'],['wide','宽敞']]){const o=node('option',label);o.value=value;windowSize.append(o);}windowSize.value=appearance.size;
  fontLabel.append(fontSize);sizeLabel.append(windowSize);adjustment.append(theme,fontLabel,sizeLabel);theme.setAttribute('aria-label','切换白色或黑曜石');theme.title='切换白色或黑曜石';
  const menuButton=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
  const positionButtons=node('div');positionButtons.setAttribute('aria-label','窗口位置');
  for(const [value,label] of [['left','移到左侧'],['center','回到中央'],['right','移到右侧']])positionButtons.append(menuButton(label,()=>void api.launcherPosition(value)));
  adjustment.append(positionButtons);
  collapse.textContent='收起';
  headerMenu.append(adjustment,menuButton('历史记录',async()=>{await open(null);entry.showHistory();}),menuButton('找回已存内容',async()=>{await open(null);void entry.showRecords();}),menuButton('新对话',async()=>{await open(null);await entry.newConversation();entry.focus();}),collapse);
  headerMenu.append(menuButton('笔记库',()=>void open('notes',{inline:true})));
  const openWindows=node('details'),openWindowsTitle=node('summary','已打开窗口'),openWindowRows=node('div');openWindows.dataset.keepMenu='true';openWindows.hidden=true;openWindows.append(openWindowsTitle,openWindowRows);headerMenu.append(openWindows);
  api.onFloatList(keys=>{openWindows.hidden=!keys.length;openWindowRows.replaceChildren();for(const key of keys){const [kind,id]=key.split(':');const name=kind==='note'?window.Notebook.get(id)?.title||'笔记':kind==='module'?window.PanelModuleCatalog?.[id]?.label||id:kind==='quick'?'随手记':'录音';openWindowRows.append(menuButton(name,()=>void api.openFloat({kind,id,detached:true})));}});
  document.querySelector('.settings-column-primary')?.prepend(entry.settings);
  function applyAppearance(){document.body.style.setProperty('--entry-font-size',appearance.font+'px');try{localStorage.setItem(appearanceKey,JSON.stringify(appearance));}catch{showStatusToast('外观设置未能保存，本次仍可使用。');}updateEntryLayout();}
  fontSize.onchange=()=>{appearance.font=Number(fontSize.value);applyAppearance();};windowSize.onchange=()=>{appearance.size=windowSize.value;applyAppearance();};
  const virtual=node('section',null,'launcher-tool');virtual.hidden=true;home.append(virtual);
  let current=null,moreOpen=false,quickEditor=null,navigating=false,queue=Promise.resolve();
  let entryLayout='';
  async function resetHome(){
    drawer.hidden=true;search.value='';moreOpen=false;
    await entry.resetHome();home.scrollTop=landing.scrollTop=0;
    updateEntryLayout();
  }
  function updateEntryLayout(){if(current)return;const result=landing.querySelector('.entry-result'),library=landing.querySelector('.entry-library');const layout=appearance.size==='wide'?'home-wide':!drawer.hidden||!library?.hidden?'home-expanded':result&&!result.hidden?(entry.pending?.proposal.kind==='plan'?'home-plan':'home-reply'):'home';if(entryLayout!==layout){entryLayout=layout;void api.launcherLayout(layout);}}
  new MutationObserver(updateEntryLayout).observe(landing,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
  document.body.style.setProperty('--entry-font-size',appearance.font+'px');
  const taskDetails=node('details'),taskSummary=node('summary','执行结果');taskDetails.dataset.keepMenu='true';taskDetails.hidden=true;taskDetails.append(taskSummary);headerMenu.append(taskDetails);
  const taskBar=node('section',null,'launcher-task-bar');taskBar.hidden=true;taskBar.setAttribute('aria-label','本次任务执行结果');taskDetails.append(taskBar);
  document.addEventListener('notch:task-results',e=>{
    taskBar.replaceChildren();const rows=e.detail||[];taskBar.hidden=taskDetails.hidden=!rows.length;
    for(const row of rows){const b=node('button',row.text);b.type='button';b.title=row.text;b.dataset.ok=String(row.ok);b.onclick=()=>void open(row.tool||null);taskBar.append(b);}
    const dismiss=node('button','关闭结果');dismiss.type='button';dismiss.onclick=()=>{taskBar.hidden=taskDetails.hidden=true;};taskBar.append(dismiss);
  });
  const noteHub=node('section',null,'launcher-note-hub');noteHub.setAttribute('aria-label','笔记记录');
  const noteActions=node('div'),newRecord=node('button','新记录'),newMeeting=node('button','会议整理'),directory=node('button','显示目录');
  for(const b of [newRecord,newMeeting,directory])b.type='button';
  const notesPage=document.querySelector('.notes-page'),noteLibrary=document.querySelector('.notes-library');
  notesPage.classList.add('directory-collapsed');directory.setAttribute('aria-expanded','false');directory.id='notes-directory-toggle';
  directory.onclick=()=>{const closed=notesPage.classList.toggle('directory-collapsed');directory.textContent=closed?'显示目录':'收起目录';directory.setAttribute('aria-expanded',String(!closed));};
  newRecord.onclick=()=>void open('notes',{create:'plain'});newMeeting.onclick=()=>void open('meeting');noteActions.append(directory,newRecord,newMeeting);
  const quickHistory=node('details'),quickTitle=node('summary','快捷保存的记录'),quickSearch=node('input'),quickRows=node('div');quickSearch.type='search';quickSearch.placeholder='查找快捷记录';quickSearch.setAttribute('aria-label','搜索快捷保存的笔记');
  quickHistory.className='launcher-quick-history';quickHistory.append(quickTitle,quickSearch,quickRows);noteLibrary.append(quickHistory);noteHub.append(noteActions);document.getElementById('tab-notes').prepend(noteHub);
  function paintQuickHistory(){
    quickRows.replaceChildren();const query=quickSearch.value.trim().toLowerCase();
    const rows=window.QuickRecords.snapshot().state.records.filter(n=>!n.trashedAt&&n.content.trim()&&(!query||(n.title+' '+n.content).toLowerCase().includes(query))).sort((a,b)=>b.updatedAt-a.updatedAt);
    quickTitle.textContent=`快捷保存的记录（${rows.length}）`;
    for(const n of rows.slice(0,50)){const b=node('button',window.QuickRecordModel.title(n));b.type='button';b.onclick=()=>void open('quick',{recordId:n.id});quickRows.append(b);}
    if(!rows.length)quickRows.append(node('p','暂无匹配记录。'));
  }
  quickSearch.oninput=paintQuickHistory;quickHistory.ontoggle=()=>{if(quickHistory.open)paintQuickHistory();};
  const cached=new Map();
  const clipNotice=node('section',null,'entry-policy');clipNotice.hidden=true;
  const clipNoticeText=node('p','剪贴板记录当前关闭。开启后才会积累新复制的内容；开启前的内容无法追溯。');
  const clipEnable=node('button','开启剪贴板记录');clipEnable.type='button';clipEnable.className='entry-store';clipEnable.id='launcher-enable-clipboard';
  clipEnable.onclick=async()=>{clipEnable.disabled=true;try{const r=await api.setFeature('clip',true);if(!r.ok)throw Error();applyFeatureSettings(r.settings);clipNotice.hidden=true;await open('clip');}catch{clipNoticeText.textContent='未能开启，请从右上角设置重试；已有内容未修改。';}finally{clipEnable.disabled=false;}};
  clipNotice.append(clipNoticeText,clipEnable);document.getElementById('tab-clip').prepend(clipNotice);
  let usage={},hiddenTools=[];try{usage=JSON.parse(localStorage.getItem('handy-tool-usage-v1')||'{}');hiddenTools=JSON.parse(localStorage.getItem('handy-hidden-tools-v1')||'[]');}catch{}
  if(!usage||typeof usage!=='object')usage={};if(!Array.isArray(hiddenTools))hiddenTools=[];
  const manage=node('details',null,'launcher-manage'),manageLabel=node('summary','管理工具显示');manage.append(manageLabel);drawer.append(manage);
  for(const t of M.tools.filter(t=>!['settings','quick'].includes(t.id))){const label=node('label'),check=node('input');check.type='checkbox';check.checked=!hiddenTools.includes(t.id);label.append(check,document.createTextNode(t.label));manage.append(label);check.onchange=()=>{hiddenTools=check.checked?hiddenTools.filter(id=>id!==t.id):[...hiddenTools,t.id];try{localStorage.setItem('handy-hidden-tools-v1',JSON.stringify(hiddenTools));}catch{}paint();};}
  const symbols={quick:'M5 4h14v16H5zM8 8h8M8 12h6',todo:'m4 7 2 2 4-4M13 7h7M4 16l2 2 4-4M13 16h7',recorder:'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3',clip:'M8 5H5v16h14V5h-3M8 3h8v4H8z',links:'m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',pomodoro:'M9 2h6M12 8v5l3 2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0',music:'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3h3M20 16a3 3 0 1 1-3-3h3',commands:'M3 6h7l2 3h9v11H3z'};
  function paint(){
    let mapping={};try{mapping=window.ToolShortcutModel.normalize(JSON.parse(localStorage.getItem('notch-tool-shortcuts-v1')||'null'));}catch{}
    const query=search.value.trim().toLowerCase();
    const rows=M.tools.filter(t=>!['settings','quick'].includes(t.id)&&!hiddenTools.includes(t.id)&&(moreOpen||query||t.primary)&&(!query||`${t.label} ${t.hint} ${t.id==='notes'?'随手记 新记录':''} ${mapping[t.id]||''}`.toLowerCase().includes(query))).sort((a,b)=>(Number(usage[b.id])||0)-(Number(usage[a.id])||0));
    grid.replaceChildren();empty.hidden=rows.length>0;
    for(const t of rows){
      const button=node('button',null,'launcher-tile');button.type='button';button.dataset.launcherTool=t.id;
      const icon=node('span',null,'launcher-icon');icon.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${symbols[t.id]||'M4 4h16v16H4zM4 10h16'}"/></svg>`;
      const label=node('span',t.label),hint=node('small',t.hint),key=node('kbd',mapping[t.id]||'');
      button.append(icon,label,key,hint);button.onclick=()=>void open(t.id);grid.append(button);
    }
    more.textContent='收起工具';more.setAttribute('aria-expanded',String(!drawer.hidden));
  }
  async function flush(){entry?.flush();await quickEditor?.flush();}
  function display(id){
    current=id;const tool=M.tools.find(t=>t.id===id);title.textContent=tool?.label||'Handy';back.hidden=!id;
    if(id==='settings')settings.setAttribute('aria-current','page');else settings.removeAttribute('aria-current');
    landing.hidden=!!id;virtual.hidden=!id||tool?.tab!=='home';
    for(const [key,element] of cached)element.hidden=key!==id;
    document.body.dataset.launcherTool=id||'home';
    for(const p of document.querySelectorAll('.handy-menu:popover-open'))p.hidePopover();
    if(id){entryLayout='';void api.launcherLayout(id);}else updateEntryLayout();
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
    taskBar.hidden=true;
    const tool=M.tools.find(t=>t.id===id);if(id&&!tool)throw Error('unknown_tool');
    // Always refresh actual settings, not a stale startup tab cache.
    if(tool&&tool.tab!=='home'){const s=await api.getAppSettings();applyFeatureSettings(s);if(tool.tab!=='clip'&&!TABS.includes(tool.tab)){showStatusToast(`${tool.label}已隐藏，请在设置中开启。`);return {ok:false,error:'feature_disabled'};}}
    await flush();await window.Notebook.flush();
    if(!id&&!payload.preserveEntry)await resetHome();
    // The assistant stays a quiet input surface; working tools own independent windows.
    if(!payload.inline&&id&&(['notes','meeting','quick','recorder'].includes(id)||Object.hasOwn(window.PanelModuleCatalog||{},id))){
      let kind=id==='notes'||id==='meeting'?'note':id==='quick'||id==='recorder'?id:'module',floatId=kind==='module'?id:undefined;
      if(kind==='note'){
        await window.Notebook.flushForExit();
        if(payload.kind==='note'){
          if(!window.Notebook.get(payload.id))return {ok:false,error:'not_found'};
          floatId=payload.id;
        }else if(id==='notes'&&!payload.create&&selectedNoteId&&window.Notebook.get(selectedNoteId))floatId=selectedNoteId;
        else{
          const created=await window.Notebook.create(id==='meeting'?'meeting':payload.create||'plain',typeof payload.content==='string'?payload.content.slice(0,12000):'',null,{stage:payload.stage==='prep'?'prep':'live'});
          if(!created?.ok)return created;floatId=created.note.id;
        }
      }
      const r=await api.openFloat({kind,id:floatId,detached:true});
      if(r?.ok){
        drawer.hidden=true;
        for(const p of document.querySelectorAll('.handy-menu:popover-open'))p.hidePopover();
        // Manual tool selection starts a separate activity; archive the previous
        // result, but do not erase the assistant's active multi-step execution.
        if(!entry.busy)await entry.newConversation();
        if(kind==='quick'&&(payload.recordId||payload.review))api.broadcastFloat({kind:'quick',recordId:payload.recordId,review:payload.review});
        usage[id]=Math.min(100000,(Number(usage[id])||0)+1);try{localStorage.setItem('handy-tool-usage-v1',JSON.stringify(usage));}catch{}
      }
      return {...r,noteId:kind==='note'?floatId:undefined};
    }
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
    if(id==='clip'&&!TABS.includes('clip')){
      // Opening the tool does not opt the user into background clipboard collection.
      activeTab='clip';applyTabDom('clip');display('clip');renderClipList();
    }
    if(id==='clip')clipNotice.hidden=TABS.includes('clip');
    if(id==='meeting'){
      const created=await window.Notebook.create('meeting',typeof payload.content==='string'?payload.content.slice(0,12000):'',null,{stage:payload.stage==='prep'?'prep':'live'});if(!created?.ok)return created;
      selectedNoteId=created.note.id;renderNotesLibrary();
    }
    if(id==='notes'&&['plain','meeting'].includes(payload.create)){
      const created=await window.Notebook.create(payload.create);if(!created?.ok)return created;
      selectedNoteId=created.note.id;renderNotesLibrary();
    }
    if(id==='notes'||id==='meeting')paintQuickHistory();
    if(!isExpanded)await setMode(true);
    if(id==='quick'&&payload.review)await quickEditor.review(payload.review);
    else if(id==='quick'&&payload.recordId)await quickEditor.openRecord(payload.recordId);
    const scope=id?(tool.tab==='home'?cached.get(id):document.getElementById(`tab-${tool.tab}`)):landing;
    const focus=scope?.querySelector(payload.create?'#notes-editor,textarea':id==='quick'?'[data-field="content"]':'input:not([type="checkbox"]):not([type="hidden"]),textarea,button');
    if(focus&&focus.getClientRects().length)focus.focus({preventScroll:true});
    if(!id){entry?.focus();void entry?.refreshSettings();}
    if(id&&id!=='settings'){usage[id]=Math.min(100000,(Number(usage[id])||0)+1);try{localStorage.setItem('handy-tool-usage-v1',JSON.stringify(usage));}catch{}}
    return {ok:true,inline:true,...((id==='meeting'||id==='notes')?{noteId:selectedNoteId}:{})};
  }
  function open(id,payload={}){
    const result=queue.catch(()=>{}).then(()=>navigate(id,payload));queue=result;
    return result.catch(()=>{showStatusToast('暂时无法切换，请先保存当前输入后重试。');return {ok:false,error:'open_failed'};});
  }
  async function openPayload(payload){
    if(payload?.kind==='voice'){
      const opened=await open(null,{preserveEntry:true});
      if(opened?.ok)await entry.hotkey(payload.gesture);
      return;
    }
    // Finder activation and ready-to-show can arrive together: open, never toggle.
    if(payload?.kind==='resume')return open(current);
    if(payload?.kind==='group'){
      await open(null);search.value='';moreOpen=true;drawer.hidden=false;paint();
      const members=new Set((payload.tools||[]).map(k=>k.startsWith('module:')?k.slice(7):k));
      for(const button of grid.children)button.hidden=!members.has(button.dataset.launcherTool);
      title.textContent=payload.label||'工具组合';return;
    }
    const id=M.route(payload);if(id)await open(id,payload);else showStatusToast('这个工具暂时无法打开。');
  }
  search.oninput=paint;search.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)grid.querySelector('button')?.click();};
  more.onclick=()=>{drawer.hidden=true;entry?.focus();};back.onclick=()=>{search.value='';drawer.hidden=true;paint();void open(null);};
  settings.onclick=()=>void open('settings');collapse.onclick=()=>void setMode(false);
  const permissions=document.querySelector('.settings-permission-panel');
  if(permissions){permissions.classList.add('tile','settings-card');document.querySelector('.settings-column-secondary')?.prepend(permissions);}
  // Older internal links still use setActiveTab: synchronize the same shell, without reopening windows.
  document.addEventListener('notch:tabchange',e=>{if(navigating)return;const tab=e.detail?.tab;if(tab==='home')void resetHome();display(tab==='home'?null:M.tools.find(t=>t.tab===tab)?.id||null);});
  document.addEventListener('notch:modechange',e=>{if(e.detail?.expanded){paint();if(!current){if(!navigating)void resetHome();entry?.focus();}}else for(const p of document.querySelectorAll('.handy-menu:popover-open'))p.hidePopover();});
  api.onLauncherOpen(p=>void openPayload(p));
  api.onLauncherChanged(p=>{if(p?.kind==='quick'&&quickEditor){const run=async()=>{if(p.review)await quickEditor.review(p.review);else if(p.recordId)await quickEditor.openRecord(p.recordId);else if(p.refresh)await quickEditor.refresh();};void run().catch(()=>showStatusToast('记录已更新，当前未保存输入仍保留。'));}});
  window.addEventListener('beforeunload',e=>{if(quickEditor&&quickEditor.saved<quickEditor.dirty){e.preventDefault();e.returnValue=false;void quickEditor.flush().catch(()=>{});}});
  // Hide obsolete floating-only actions, not the underlying data or controllers.
  for(const b of document.querySelectorAll('.nb-entry'))if(['收回全部','悬浮录音'].includes(b.textContent))b.hidden=true;
  if(legacy)legacy.hidden=true;
  const shortcutHint=document.querySelector('.settings-shortcut-map');if(shortcutHint)shortcutHint.textContent='展开后可用自定义工具快捷键；默认 N 随手记、T 待办、R 录音、L 链接、M 音乐。输入时不触发。';
  window.ToolLauncher={open,openPayload,flush,entry,get current(){return current;}};
  paint();display(null);void setActiveTab('home');
})();
