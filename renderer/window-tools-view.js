(() => {
  'use strict';
  const errors={forbidden:'此窗口没有操作权限，请回主面板重试。',corrupt_store:'组合文件无法读取，原文件未覆盖。请检查本地数据文件。',save_failed:'保存失败，输入已保留，请重试。',conflict:'组合已在别处修改，输入未丢失。请取消后重新编辑最新版本。',invalid_group:'请填写名称并至少选择一个工具。',window_limit:'已达到 12 个小窗上限，请先关闭不需要的小窗。',group_limit:'最多保存 20 个组合。',not_found:'这个组合已被删除，请重新选择。',partial_open:'部分工具未能打开，可重试；已打开的工具会复用。'};
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
  window.WindowToolsView={mount(root,api,options={}){
    let disposed=false,groups=null,editing=null,busy=false,signature='';
    root.replaceChildren();const section=node('section',null,'window-tools module-float');section.classList.toggle('wt-compact',!!options.compact);
    const switcherRoot=node('div',null,'ws-host');
    const button=(text,action,parent,cls)=>{const b=node('button',text,cls);b.type='button';b.onclick=action;parent.append(b);return b;};
    const details=node('details',null,'wt-combinations'),summary=node('summary','内部工具组合');details.append(summary);
    const groupList=node('div',null,'wt-group-list'),formRoot=node('div',null,'wt-editor'),groupStatus=node('p',null,'wt-status');groupStatus.setAttribute('role','status');
    const hint=node('p','只展开工具，不自动开始活动。组合共用已有小窗，隐藏也会隐藏共用的小窗。','wt-hint');
    details.append(hint,groupList,formRoot,groupStatus);
    const activity=node('p',null,'wt-activity');activity.setAttribute('role','status');activity.hidden=true;
    section.append(switcherRoot,details,activity);root.append(section);
    const switcher=window.WindowSwitcher.mount(switcherRoot,api,{...options,editing:value=>section.classList.toggle('ws-managing',value)});
    const refresh=()=>switcher.refresh();
    function message(text,error=false){groupStatus.textContent=text;groupStatus.classList.toggle('error',error);}
    async function readGroups(){
      try{const s=await api.toolGroupsGet();if(disposed)return;
        if(!s.ok){message(errors[s.error]||'读取组合失败，请稍后重试。',true);return;}
        groups=s;activity.textContent=s.activity?`${s.activity} · 工具已隐藏，展开组合可继续操作`:'';activity.hidden=!s.activity;
        const next=JSON.stringify([s.revision,s.sessions]);if(!editing&&next!==signature){signature=next;renderGroups();}
      }catch{if(!disposed)message('组合读取失败，请稍后重试。',true);}
    }
    async function act(c){
      if(busy)return;busy=true;message(c.action==='open'?'正在展开工具…':'正在处理…');
      section.querySelectorAll('.wt-group-list button').forEach(b=>b.disabled=true);
      try{const r=await api.toolGroupsCommand(c);if(!r.ok){message(errors[r.error]||'操作失败，请重试。',true);return false;}
        message(c.action==='open'?(r.overlap?'已展开；屏幕空间不足，部分小窗重叠，可拖动调整。':'已展开，可拖动调整位置。'):c.action==='hide'?'已隐藏小窗；内容和正在进行的活动保留。':'已保存。');return true;
      }catch{message('操作未完成，输入保留，请重试。',true);return false;}
      finally{busy=false;signature='';await readGroups();section.querySelectorAll('.wt-group-list button').forEach(b=>b.disabled=false);}
    }
    function edit(g){
      if(editing||busy)return;editing={id:g?.id,revision:groups.revision};formRoot.replaceChildren();
      const form=node('form'),nameLabel=node('label','组合名称'),name=node('input');name.type='text';name.value=g?.name||'';name.maxLength=24;name.required=true;nameLabel.append(name);
      const fields=node('fieldset');fields.append(node('legend','包含哪些工具'));const checks=[];
      Object.entries(groups.tools).forEach(([key,title])=>{const l=node('label'),c=node('input');c.type='checkbox';c.value=key;c.checked=g?.tools.includes(key)||false;l.append(c,document.createTextNode(title));fields.append(l);checks.push(c);});
      const controls=node('div',null,'wt-recovery'),save=button('保存组合',null,controls,'wt-primary');save.type='submit';
      const cancel=button('取消',()=>{if(busy)return;editing=null;formRoot.replaceChildren();signature='';void readGroups();message('');},controls);
      form.append(nameLabel,fields,controls);formRoot.append(form);name.focus();
      form.onsubmit=async e=>{e.preventDefault();if(busy)return;save.disabled=cancel.disabled=true;
        const ok=await act({action:'save',...editing,name:name.value,tools:checks.filter(c=>c.checked).map(c=>c.value)});
        if(ok){editing=null;formRoot.replaceChildren();signature='';await readGroups();}else save.disabled=cancel.disabled=false;
      };
    }
    function renderGroups(){
      groupList.replaceChildren();if(!groups)return;
      if(options.compact){
        groups.groups.forEach(g=>button(g.name,()=>void act({action:'open',id:g.id,revision:groups.revision}),groupList,'wt-preset'));
        button('管理组合',()=>options.manage?.(),groupList);return;
      }
      groups.groups.forEach(g=>{
        const row=node('div',null,'wt-group');const open=button('',()=>void act({action:'open',id:g.id,revision:groups.revision}),row,'wt-group-open');
        open.append(node('strong',g.name),node('span',g.tools.map(k=>groups.tools[k]).join(' · ')));
        button('修改',()=>edit(g),row);
        const session=groups.sessions?.[g.id]||[];
        if(session.some(v=>v.visible))button('隐藏',()=>void act({action:'hide',id:g.id,revision:groups.revision}),row);
        const remove=button('删除',()=>{if(remove.dataset.confirm!=='yes'){remove.dataset.confirm='yes';remove.textContent='确认删除';return;}void act({action:'delete',id:g.id,revision:groups.revision});},row,'wt-delete');
        groupList.append(row);
      });
      button('添加组合',()=>edit(null),groupList,'wt-add');
      details.scrollTop=0;
    }
    details.ontoggle=()=>{if(details.open)void readGroups();};
    const poll=setInterval(()=>{if(!disposed)void readGroups();},2000);
    void readGroups();
    return {refresh,async flush(){await switcher.flush();if(editing){details.open=true;message('组合尚未保存，请保存或取消修改后再关闭。',true);throw Error('unsaved_group');}},destroy(){disposed=true;clearInterval(poll);switcher.destroy();root.replaceChildren();}};
  }};
})();
