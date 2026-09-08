(() => {
  'use strict';
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  const errors={conflict:'分组已在别处修改，当前输入保留。请取消后按最新内容重试。',save_failed:'保存失败，输入保留，请重试。',invalid_group:'请起一个名字，并至少选一个窗口。',stale_window:'所选窗口已经变化，请刷新后重新选择。',scan_required:'窗口状态暂不确定，请重新检测后再选。',corrupt_store:'分组文件无法读取，原文件未覆盖。',group_limit:'最多保存 20 个分组。',invalid_member:'原分组已变化，请重新选择。',duplicate_window:'同一个窗口只需选择一次。',not_found:'分组已被删除，请重新选择。'};
  const recovery={screen_recording_permission_required:['需要窗口标题读取权限','screen-recording'],accessibility_permission_required:['需要辅助功能权限','accessibility'],automation_permission_required:['需要自动化许可','automation'],window_scan_timeout:['窗口读取超时，不必重新授权',null],window_titles_unavailable:['暂时读不到标题，不能判断是否打开','screen-recording']};
  window.WindowSwitcher={mount(root,api,options={}){
    let rows=[],scanError='',loading=false,disposed=false,state={revision:0,groups:[]},active='',editing=null,busy=false,selected=0,signature='',groupError='';
    let hidden=new Set(options.hidden?.get()||[]);
    const section=node('section',null,'window-switcher'),toolbar=node('div',null,'ws-toolbar'),nav=node('div',null,'ws-groups');nav.setAttribute('aria-label','窗口分组');
    const button=(text,fn,parent,cls)=>{const e=node('button',text,cls);e.type='button';e.onclick=fn;parent.append(e);return e;};
    const searchRow=node('div',null,'wt-search');searchRow.hidden=true;
    const label=node('label','搜索窗口'),input=node('input');input.type='search';input.placeholder='应用名或窗口标题';input.autocomplete='off';label.append(input);searchRow.append(label);
    const searchButton=button('搜索',()=>{searchRow.hidden=!searchRow.hidden;searchButton.setAttribute('aria-expanded',String(!searchRow.hidden));if(!searchRow.hidden)input.focus();else{input.value='';render();}},toolbar);searchButton.setAttribute('aria-expanded','false');
    const refreshButton=button('刷新',()=>void refresh(),toolbar);
    const createButton=button('新建分组',()=>edit(),toolbar,'ws-create');
    const restore=button('恢复隐藏',()=>setHidden([]),toolbar);restore.hidden=!hidden.size;
    const form=node('form',null,'ws-edit');form.hidden=true;
    const nameLabel=node('label','分组名称'),name=node('input');name.type='text';name.maxLength=24;name.placeholder='例如：学习';nameLabel.append(name);
    const formActions=node('div',null,'ws-edit-actions'),save=button('保存分组',null,formActions,'wt-primary');save.type='submit';
    const cancel=button('取消',()=>{if(!busy)endEdit();},formActions);form.append(nameLabel,formActions);
    const deleteButton=button('删除分组',()=>{if(!editing?.id||busy)return;if(deleteButton.dataset.confirm!=='yes'){deleteButton.dataset.confirm='yes';deleteButton.textContent='确认删除分组';return;}void mutate({action:'delete',id:editing.id,revision:editing.revision});},formActions);deleteButton.hidden=true;
    const list=node('div',null,'wt-results ws-grid');list.setAttribute('aria-label','当前窗口');
    const status=node('p',null,'wt-status ws-status');status.setAttribute('role','status');
    section.append(nav,toolbar,searchRow,form,list,status);root.append(section);
    const message=(value,error=false)=>{status.textContent=value;status.classList.toggle('error',error);};
    const hideKey=v=>`${v.appName.trim()}\u0000${v.title.trim()}`;
    function setHidden(keys){try{options.hidden?.set(keys);hidden=new Set(keys);render();}catch{message('隐藏设置未能保存，请重试。',true);}}
    const group=()=>state.groups.find(g=>g.id===active);
    function displayRows(){const source=active?(group()?.members||[]):rows.filter(v=>!hidden.has(hideKey(v)));
      const terms=input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
      return source.filter(v=>terms.every(t=>(v.appName+' '+v.title).toLocaleLowerCase().includes(t)));
    }
    async function focus(item){
      if(!item?.id||scanError)return;
      try{if(!await api.focusWindow(item.id))message('未能切换：窗口可能已关闭、改名或存在同名窗口。请刷新；仍失败可检查辅助功能。',true);else message('已发送窗口切换请求。');}
      catch{message('切换失败，请刷新后重试。',true);}
    }
    function drawIcon(parent,item){
      if(item.icon&&/^data:image\//.test(item.icon)){const img=node('img');img.src=item.icon;img.alt='';img.width=32;img.height=32;parent.append(img);}
      else{const mark=node('span',Array.from(item.appName||'窗口').slice(0,2).join(''),'ws-icon-fallback');mark.setAttribute('aria-hidden','true');parent.append(mark);}
    }
    function drawWindow(item,index){
      const row=node('div',null,'wt-row ws-item'),closed=item.status&&item.status!=='open',b=button('',()=>void focus(item),row,'wt-window');
      b.dataset.windowId=item.id||'';b.disabled=!!closed||!!scanError;b.classList.toggle('selected',index===selected);b.title=`${item.appName}\n${item.title}`;
      drawIcon(b,item);const text=node('span',null,'wt-window-text');text.append(node('strong',item.appName),node('span',item.title));b.append(text);
      if(closed){const statusText=({closed:'未打开',ambiguous:'需要重选',unknown:'状态未知'})[item.status];row.classList.add('ws-unavailable');row.append(node('span',statusText,'ws-window-state'));if(item.status!=='unknown')button('重新选择',()=>edit(group(),item.refId),row,'ws-rebind');}
      else if(options.hidden&&!active)button('隐藏',()=>setHidden([...hidden,hideKey(item)]),row,'wt-hide');
      return row;
    }
    function render(){
      const focused=document.activeElement?.dataset?.windowId,top=list.scrollTop;list.replaceChildren();restore.hidden=!hidden.size||!!active;
      if(editing){renderChoices();return;}
      if(scanError){list.classList.remove('ws-grid');const [text,pane]=recovery[scanError]||['窗口读取未完成，请重新检测',null];list.append(node('p',text,'wt-empty'));
        const actions=node('div',null,'wt-recovery');button('重新检测',()=>void refresh(),actions);if(pane){button('打开系统设置',()=>api.settings(pane),actions);button(api.restartLabel||'完全重启',()=>api.restart(),actions);}list.append(actions);
        if(!active)return;
      }else list.classList.add('ws-grid');
      const matches=displayRows();selected=Math.max(0,Math.min(selected,matches.length-1));
      if(!matches.length){list.append(node('p',loading?'正在读取窗口…':input.value?'没有匹配结果，试试应用名或刷新。':active?'这个分组暂时没有窗口。':'尚未读到窗口，打开应用后刷新。','wt-empty'));return;}
      matches.forEach((item,index)=>list.append(drawWindow(scanError?{...item,id:null,status:'unknown'}:item,index)));
      list.scrollTop=top;if(focused)list.querySelectorAll('[data-window-id]').forEach(b=>{if(b.dataset.windowId===focused)b.focus({preventScroll:true});});
    }
    function renderNav(){
      if(editing)return;nav.replaceChildren();
      const all=button('全部',()=>select(''),nav);all.setAttribute('aria-pressed',String(!active));
      state.groups.forEach(g=>{const b=button(g.name,()=>select(g.id),nav,'ws-group');b.dataset.groupId=g.id;b.setAttribute('aria-pressed',String(active===g.id));b.title=g.name;});
      if(active)button('编辑',()=>edit(group()),nav,'ws-manage');
    }
    function select(id){if(editing||busy)return;active=id;selected=0;input.value='';list.scrollTop=0;renderNav();render();}
    async function readGroups(){
      try{const r=await api.windowGroupsGet();if(disposed)return;if(!r.ok){groupError=r.error;message(errors[r.error]||'分组读取失败，请重试。',true);createButton.disabled=true;return;}
        groupError='';createButton.disabled=false;state=r;if(active&&!group())active='';const next=JSON.stringify(r);
        if(!editing&&next!==signature){signature=next;renderNav();render();}
      }catch{groupError='unavailable';message('分组读取失败，请刷新后重试。',true);}
    }
    async function refresh(){
      if(loading||disposed)return;loading=true;refreshButton.disabled=true;if(!rows.length)render();
      try{const r=await api.listWindows();if(disposed)return;rows=Array.isArray(r.items)?r.items:[];scanError=r.error||'';message('');await readGroups();}
      catch{scanError='window_scan_failed';rows=[];}
      finally{loading=false;refreshButton.disabled=false;if(!disposed)render();}
    }
    function edit(g=null,replaceRef=null){
      if(editing||busy||groupError)return;
      const choices=new Map();for(const m of g?.members||[])choices.set('ref:'+m.refId,{item:m,choice:{refId:m.refId},checked:m.refId!==replaceRef});
      editing={id:g?.id,revision:state.revision,choices};name.value=g?.name||'';form.hidden=false;deleteButton.hidden=!g;deleteButton.textContent='删除分组';deleteButton.dataset.confirm='';section.classList.add('ws-editing');options.editing?.(true);name.focus();
      message(replaceRef?'取消原窗口的勾选了，请勾选替代窗口后保存。':'勾选要放在一起的窗口；保存分组不会打开或关闭应用。');renderChoices();
    }
    function renderChoices(){
      list.replaceChildren();list.classList.remove('ws-grid');
      const included=new Set([...editing.choices.values()].map(v=>v.item.id).filter(Boolean));
      for(const r of rows)if(!included.has(r.id)&&!editing.choices.has('window:'+r.id))editing.choices.set('window:'+r.id,{item:r,choice:{windowId:r.id},checked:false});
      for(const [key,v] of editing.choices){
        const l=node('label',null,'ws-choice'),c=node('input');c.type='checkbox';c.checked=v.checked;c.disabled=!!scanError&&!v.choice.refId;c.onchange=()=>v.checked=c.checked;c.dataset.choice=key;
        l.append(c);drawIcon(l,v.item);const text=node('span');text.append(node('strong',v.item.appName),node('span',v.item.title+(v.item.status==='closed'?' · 未打开':'')));l.append(text);list.append(l);
      }
      if(!editing.choices.size)list.append(node('p','请先打开想加入的窗口，再点刷新。','wt-empty'));
    }
    function endEdit(){editing=null;form.hidden=true;section.classList.remove('ws-editing');options.editing?.(false);signature='';message('');void readGroups();renderNav();render();}
    async function mutate(c){
      if(busy)return;busy=true;form.querySelectorAll('input,button').forEach(e=>e.disabled=true);list.querySelectorAll('input').forEach(e=>e.disabled=true);
      try{const r=await api.windowGroupsCommand(c);if(!r.ok){message(errors[r.error]||'保存未完成，请重试。',true);return;}
        state=r;active=c.action==='delete'?'':c.id||r.groups.at(-1)?.id||'';endEdit();message(c.action==='delete'?'已删除分组，系统窗口没有关闭。':'分组已保存。');
      }catch{message('保存失败，输入保留，请重试。',true);}
      finally{busy=false;form.querySelectorAll('input,button').forEach(e=>e.disabled=false);if(editing)renderChoices();}
    }
    form.onsubmit=e=>{e.preventDefault();if(editing)void mutate({action:'save',id:editing.id,revision:editing.revision,name:name.value,members:[...editing.choices.values()].filter(v=>v.checked).map(v=>v.choice)});};
    input.oninput=()=>{selected=0;list.scrollTop=0;render();};
    input.onkeydown=e=>{if(e.isComposing||e.metaKey||e.altKey||e.ctrlKey||editing)return;const matches=displayRows();
      if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();selected=Math.max(0,Math.min(matches.length-1,selected+(e.key==='ArrowDown'?1:-1)));render();list.querySelector('.selected')?.scrollIntoView({block:'nearest'});}
      if(e.key==='Enter'){e.preventDefault();void focus(matches[selected]);}if(e.key==='Escape'){e.preventDefault();input.value='';render();}
    };
    const poll=setInterval(()=>{if(!disposed)void readGroups();},2000);
    renderNav();render();void readGroups();if(!options.compact)void refresh();
    return {refresh,async flush(){if(editing){message('分组尚未保存，请保存或取消后再关闭。',true);throw Error('unsaved_window_group');}},destroy(){disposed=true;clearInterval(poll);root.replaceChildren();}};
  }};
})();
