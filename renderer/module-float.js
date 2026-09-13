(() => {
  'use strict';
  const labels={feature_disabled:'请先在主面板设置中启用剪贴板。',timer_running:'请先暂停计时，再调整时长。',invalid_duration:'请输入有效时长（最多 60 分钟）。',invalid_or_duplicate_link:'请输入公开网址；已收藏的网址无需重复添加。',invalid_text:'请输入内容。',save_failed:'保存失败，输入已保留，请重试。',operation_failed:'操作未完成，请重试或返回主面板检查。'};
  Object.assign(labels,{unsaved_links:'主面板或链接小窗有未保存内容，请先保存或清空，再删除。',confirmation_required:'请先确认删除。',conflict:'收藏已更新，没有删除。请刷新后重新确认。'});
  window.PanelModuleFloat={mount(root,kind,initial,api){
    if(kind==='credentials')return window.CredentialCard.mount(root,api);
    if(kind==='gallery')return window.ReferenceView.mount(root,api);
    if(kind==='commands')return window.MaterialPacks.mount(root,api);
    if(kind==='windows')return window.WindowToolsView.mount(root,{...api,settings:()=>api.request({action:'settings'}),restartLabel:'权限与重启设置',restart:()=>api.request({action:'settings'})});
    if(kind==='music')return window.PanelMusicFloat.mount(root,initial,api);
    if(kind==='pomodoro'){
      document.body.classList.add('timer-floating');document.title='Handy · 计时';
      return window.SimpleTimer.mount(root,{get:api.timerGet,command:api.timerCommand,layout:expanded=>api.request({action:'timer-layout',expanded})},{floating:true});
    }
    let state=initial,disposed=false,busy=false,loading=false,pending=Promise.resolve(),editing=null,dirty=false,revision=0,signature='';
    root.replaceChildren();
    const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
    const section=node('section',null,'module-float'),head=node('header',null,'module-heading');
    head.append(node('h1',window.PanelModuleCatalog[kind].label),node('span','与主面板同步'));
    const status=node('p',null,'module-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const controls=node('div',null,'module-actions'),form=node('form',null,'module-form'),list=node('div',null,'module-list');
    section.append(head,controls,form,list,status);root.append(section);
    const fields={};
    function button(text,action,parent=controls){const el=node('button',text);el.type='button';el.addEventListener('click',action);parent.append(el);return el;}
    function field(name,label,type='text'){
      const wrapper=node('label'),caption=node('span',label),input=node('input');input.name=name;input.type=type;input.autocomplete='off';
      if(type==='password')input.autocomplete='new-password';
      wrapper.append(caption,input);form.append(wrapper);fields[name]=input;return input;
    }
    const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
    function reportDirty(){if(kind==='links')void api.request({action:'command',operation:'edit-state',values:{dirty}}).catch(()=>{});}
    function clear(){form.reset();editing=null;dirty=false;reportDirty();revision++;if(fields.text)fields.text.readOnly=false;if(fields.priority)fields.priority.disabled=false;message('');}
    async function command(operation,values={},clearOnSuccess=false){
      if(busy)return false;busy=true;const startedRevision=revision;section.setAttribute('aria-busy','true');
      const task=(async()=>{try{
        const result=await api.request({action:'command',operation,values});
        if(!result?.ok){message(labels[result?.error]||'操作未完成，请在主面板检查权限或重试。',true);return false;}
        if(clearOnSuccess&&revision===startedRevision)clear();message(operation==='copy'?'已复制。':'已同步。');
        const snapshot=await api.request({action:'get'});if(snapshot?.ok)render(snapshot,true);return true;
      }catch{message('主面板暂未响应，输入已保留。',true);return false;}
      finally{busy=false;section.removeAttribute('aria-busy');}})();
      pending=task;return task;
    }
    async function refresh(){if(disposed||busy||loading)return;loading=true;try{const value=await api.request({action:'get'});if(disposed||busy)return;if(value?.ok)render(value);else message(labels[value?.error]||'读取失败，请重新检测。',true);}catch{if(!disposed&&!busy)message('主面板暂未响应，请重试。',true);}finally{loading=false;}}
    button('刷新',()=>void command(['music','windows','credentials'].includes(kind)?'refresh':'get'));
    if(['windows','music','credentials','clip'].includes(kind))button('权限与设置',()=>void api.request({action:'settings'}).catch(()=>message('主面板暂未响应，请重试。',true)));
    if(['todo','commands','links','credentials','pomodoro'].includes(kind)){
      if(kind==='todo'){
        const label=node('label'),select=node('select');select.name='priority';label.append(node('span','分类'),select);form.append(label);fields.priority=select;
        Object.entries(initial.categories||{}).forEach(([id,text])=>{const option=node('option',text);option.value=id;select.append(option);});
      }
      if(['todo','commands','links'].includes(kind))field('text',kind==='links'?'添加公开网址':'内容').maxLength=kind==='todo'?80:kind==='links'?2000:500;
      if(kind==='links'){field('note','我的备注（选填）').maxLength=4000;const label=node('label'),select=node('select');select.name='groupId';label.append(node('span','放入分组'),select);form.append(label);fields.groupId=select;const all=node('option','未分组');all.value='';select.append(all);for(const group of initial.groups||[]){const option=node('option',group.name);option.value=group.id;select.append(option);}}
      if(kind==='todo')field('deadline','截止时间（选填）','datetime-local');
      if(kind==='credentials'){field('service','服务名称').maxLength=80;field('account','账号').maxLength=320;field('password','密码','password').maxLength=4096;}
      if(kind==='pomodoro'){const m=field('minutes','分钟','number');m.min='0';m.max='60';const s=field('seconds','秒','number');s.min='0';s.max='59';}
      const actions=node('div',null,'module-actions'),submit=node('button',kind==='pomodoro'?'设置时长':'保存');submit.type='submit';actions.append(submit);form.append(actions);button('清空',clear,actions);
      form.addEventListener('input',()=>{dirty=true;reportDirty();revision++;});form.addEventListener('change',()=>{dirty=true;reportDirty();revision++;});
      form.addEventListener('submit',event=>{event.preventDefault();const values=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value]));
        if(values.deadline){const date=new Date(values.deadline);if(!Number.isFinite(date.getTime()))return message('请检查截止时间。',true);values.deadline=date.toISOString();}
        if(editing){values.id=editing;if(kind==='links')values.libraryRevision=Number(fields.note.dataset.libraryRevision);}void command(kind==='pomodoro'?'duration':editing?'edit':'add',values,true);
      });
    }else form.hidden=true;
    if(kind==='pomodoro'){button('开始 / 暂停',()=>void command('toggle'));button('重置',()=>void command('reset'));}
    if(kind==='music'){button('上一首',()=>void command('previous'));button('播放 / 暂停',()=>void command(state.playing?'pause':'play'));button('下一首',()=>void command('next'));}
    if(kind==='gallery'){button('上一张',()=>void command('previous'));button('下一张',()=>void command('next'));button('添加图片',()=>void command('add'));}
    function render(value,force=false){
      state=value;document.documentElement.dataset.theme=value.theme==='obsidian'?'obsidian':'white';
      const next=JSON.stringify(value);if(next===signature&&!force)return;
      // Keep inputs and focused row buttons intact during passive refreshes.
      if(!force&&list.contains(document.activeElement))return;
      signature=next;
      if(kind==='links'&&!dirty){const selected=fields.groupId.value;fields.groupId.replaceChildren();const empty=node('option','未分组');empty.value='';fields.groupId.append(empty);for(const group of value.groups||[]){const option=node('option',group.name);option.value=group.id;fields.groupId.append(option);}fields.groupId.value=(value.groups||[]).some(g=>g.id===selected)?selected:'';}
      list.replaceChildren();
      if(kind==='pomodoro'){list.append(node('p',value.time||'00:00','module-clock'),node('p',value.running?'正在专注':'已暂停','module-detail'));return;}
      if(kind==='music'){list.append(node('h2',value.title||'暂无播放'),node('p',value.playing?'正在播放':'已暂停','module-detail'));}
      if(kind==='gallery'){
        if(value.image){const image=node('img');image.src=value.image;image.alt='当前画廊图片';image.className='module-image';list.append(image);}else list.append(node('p','添加一张图片，留一点喜欢的风景。','module-empty'));
      }
      if(value.detail)list.append(node('p',value.detail,'module-detail'));
      if(Array.isArray(value.items)){
        if(!value.items.length)list.append(node('p',kind==='todo'?'暂时没有待办。':'这里还没有内容。','module-empty'));
        for(const item of value.items){
          const row=node('article',null,'module-row'),text=node('div',null,'module-row-text');row.dataset.id=item.id;row.classList.toggle('done',!!item.done);
          text.append(node('p',item.text||'未命名'));if(item.detail)text.append(node('span',item.detail));row.append(text);
          const actions=node('div',null,'module-actions');row.append(actions);list.append(row);
          const values={id:item.id,priority:item.priority};
          if(kind==='todo')button(item.done?'恢复':'完成',()=>void command('toggle',values),actions);
          if(['todo','commands','links'].includes(kind))button('编辑',()=>{editing=item.id;fields.text.value=kind==='links'?item.url:item.text;if(kind==='links'){fields.text.readOnly=true;fields.note.value=item.note||'';fields.groupId.value=(state.groups||[]).find(g=>(g.links||[]).some(r=>r.id===item.id))?.id||'';fields.note.dataset.libraryRevision=state.revision;}dirty=true;revision++;if(fields.priority){fields.priority.value=item.priority;fields.priority.disabled=true;}
            reportDirty();if(fields.deadline&&item.deadline){const date=new Date(item.deadline);fields.deadline.value=Number.isFinite(date.getTime())?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):'';}fields.text.focus();},actions);
          if(['commands','clip'].includes(kind))button('复制',()=>void command('copy',values),actions);
          if(['links','windows'].includes(kind))button('打开',()=>void command('open',values),actions);
          if(kind==='links'){if(item.note)text.append(node('p',item.note));button(item.pinned?'取消常用':'设为常用',()=>void command('library-command',{action:'patch',id:item.id,revision:state.revision,changes:{pinned:!item.pinned}}),actions);}
          if(kind==='credentials'){button('复制账号',()=>void command('copy',{...values,field:'account'}),actions);button('复制密码',()=>void command('copy',{...values,field:'password'}),actions);}
          if(['todo','commands','links','clip','credentials'].includes(kind)){
            let armed=false,deleteRevision;const remove=button('删除',()=>{if(kind==='links'&&dirty)return message(labels.unsaved_links,true);if(!armed){armed=true;deleteRevision=state.revision;remove.textContent='确认删除';remove.addEventListener('blur',()=>{armed=false;remove.textContent='删除';},{once:true});return;}armed=false;remove.textContent='删除';void command('delete',kind==='links'?{...values,confirmed:true,libraryRevision:deleteRevision}:values);},actions);
          }
        }
      }
    }
    render(initial);
    const timer=setInterval(()=>void refresh(),1000);
    return {async flush(){await pending;if(dirty){message('还有未保存的输入，请先保存或清空，再收回小窗。',true);throw Error('unsaved_input');}},destroy(){disposed=true;clearInterval(timer);}};
  }};
})();
