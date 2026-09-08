(() => {
  'use strict';
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  const errors={conflict:'另一处已修改资料。输入已保留，请复制草稿后重新打开。',store_unreadable:'资料文件无法读取，未覆盖原文件。请从设置打开数据目录检查备份。',shortcut_occupied:'快捷键已被占用，原配置未变。请换一个。',shortcut_requires_input:'这份资料需要填写模板或选择文档，请把快捷键动作设为打开资料包。',invalid_shortcut:'快捷键无效或重复，请使用如 Alt+P 的组合。',missing_variables:'请先填写模板里的空白项。',save_failed:'保存失败，输入已保留。',not_configured:'请先在设置中配置文本 AI。',generation_failed:'生成未完成，原资料和输入均保留，可以重试。',file_missing:'原文件已移动或删除，请重新添加。',too_large:'材料超过限制：最多 5 份文档、共 24000 字。',cancelled:'已取消，原内容保留。',timeout:'生成超时，原内容保留。',invalid_input:'请填写名称和内容，或添加步骤／文档。',pdf_encrypted:'PDF 已加密，请先解密或粘贴文字。',no_text:'没有可提取文字，扫描件请改用文字材料。'};
  window.MaterialPacks={mount(root,api,{compact=false}={}){
    let state=null,editing=false,using=false,dirty=false,busy=false,disposed=false,revision=0,selected='',documents=[],generation=0;
    root.replaceChildren();root.classList.add('material-packs');root.classList.toggle('mp-compact',compact);
    const head=node('div',null,'mp-head'),title=node('strong','快捷资料包'),search=node('input'),list=node('div',null,'mp-list'),detail=node('div',null,'mp-detail'),status=node('p',null,'mp-status');status.setAttribute('role','status');
    const button=(text,fn,parent=head)=>{const b=node('button',text);b.type='button';b.onclick=fn;parent.append(b);return b;};
    search.type='search';search.placeholder='搜索提示词、模板、文档';search.setAttribute('aria-label','搜索资料包');head.append(title);button('新增',()=>compact?api.packsSelect(''):edit());
    root.append(head,search,list,detail,status);search.oninput=render;
    const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
    const failure=r=>message(errors[r?.error]||'操作未完成，内容保留，请重试。',true);
    async function call(fn){if(busy)return null;busy=true;root.setAttribute('aria-busy','true');try{return await fn();}catch{return {ok:false,error:'operation_failed'};}finally{busy=false;root.removeAttribute('aria-busy');}}
    function field(form,name,label,value='',area=false){const l=node('label',label),input=node(area?'textarea':'input');input.name=name;input.value=value;input.autocomplete='off';l.append(input);form.append(l);return input;}
    function reset(){generation++;void api.packsCancel();detail.replaceChildren();editing=using=dirty=false;documents=[];search.hidden=list.hidden=false;message('');}
    function leave(){if(dirty){message('还有未保存内容，请保存或明确放弃。',true);return false;}reset();return true;}
    function edit(item){
      if(busy||!leave())return;editing=true;revision=state?.revision||0;documents=[...(item?.documents||[])];detail.replaceChildren();list.hidden=search.hidden=true;
      const form=node('form',null,'mp-form'),name=field(form,'name','名称',item?.name||''),text=field(form,'text','提示词／模板',item?.text||'',true);name.maxLength=80;text.maxLength=30000;text.placeholder='例如：请把以下内容整理成 {{风格}} 风格：\n{{原文}}';
      const more=node('details');more.append(node('summary','文档、固定步骤与快捷键'));const steps=field(more,'steps','固定步骤（选填，每行一步）',item?.steps||'',true),shortcut=field(more,'shortcut','单独唤出快捷键（选填，如 Alt+P）',item?.shortcut||'');steps.maxLength=10000;
      const shortcutLabel=node('label','快捷键动作'),shortcutAction=node('select');for(const [value,label] of [['open','打开资料包'],['copy','直接复制提示词与步骤'],['paste','直接粘贴提示词与步骤']]){const o=node('option',label);o.value=value;shortcutAction.append(o);}shortcutAction.value=item?.shortcutAction||'open';shortcutLabel.append(shortcutAction);more.append(shortcutLabel);
      more.append(node('p','直接取用不包含文档；有模板空白时请选打开资料包。粘贴需原窗口可确认且剪贴板功能已启用，否则仅复制。不会自动调用 AI 或发送消息。','mp-hint'));
      const docs=node('div',null,'mp-docs');more.append(docs);
      function renderDocs(){docs.replaceChildren();for(const d of documents){const row=node('div',null,'mp-doc-row');row.append(node('span',d.name));button('打开',()=>void openDoc(d.id),row);button('移除',()=>{if(busy)return;documents=documents.filter(v=>v.id!==d.id);dirty=true;renderDocs();},row);docs.append(row);}}
      button('添加 Word / PDF / 文本',async()=>{if(busy)return;const r=await call(()=>api.packsImport());if(!r)return;if(!r.ok)return failure(r);if(documents.length+r.files.length>5)return failure({error:'too_large'});documents.push(...r.files);dirty=true;renderDocs();},more);
      more.append(node('p','只在本机提取文字；最多 5 份、共 24000 字。不识别扫描图、批注或排版。原文件移动后需重新添加。','mp-hint'));renderDocs();form.append(more);
      const actions=node('div',null,'mp-actions'),save=button('保存',null,actions);save.type='submit';button('放弃编辑',()=>{if(!busy){reset();void refresh();}},actions);form.append(actions);detail.append(form);
      form.oninput=()=>{dirty=true;};form.onsubmit=async e=>{e.preventDefault();if(busy)return;save.disabled=true;const r=await call(()=>api.packsCommand({action:'save',id:item?.id,revision,name:name.value,text:text.value,steps:steps.value,shortcut:shortcut.value.trim(),shortcutAction:shortcutAction.value,documentIds:documents.map(d=>d.id)}));save.disabled=false;if(!r)return;if(!r.ok)return failure(r);state=r;reset();render();message('已保存。');};name.focus();
    }
    async function openDoc(id){const r=await call(()=>api.packsOpen(id));if(r&&!r.ok)failure(r);}
    function use(item){
      if(busy||!leave())return;selected=item.id;using=true;list.hidden=search.hidden=true;detail.append(node('h2',item.name));
      const form=node('div',null,'mp-form'),values=Object.create(null),checks=[];const names=[...new Set([...item.text.matchAll(/\{\{([^{}\n]{1,40})\}\}/g)].map(m=>m[1].trim()))];
      for(const n of names){const input=field(form,n,n,'',true);input.maxLength=16000;values[n]=input;input.oninput=()=>{dirty=true;};}
      if(item.steps){const steps=node('details');steps.append(node('summary','固定步骤'));for(const line of item.steps.split('\n').filter(Boolean)){const label=node('label',null,'mp-check'),c=node('input');c.type='checkbox';label.append(c,document.createTextNode(line));steps.append(label);}form.append(steps);}
      if(item.documents.length){const docs=node('fieldset');docs.append(node('legend','本次取用的文档文字（默认不选）'));for(const d of item.documents){const label=node('label',null,'mp-check'),c=node('input');c.type='checkbox';c.value=d.id;checks.push(c);label.append(c,document.createTextNode(d.name));docs.append(label);button('打开原文件',()=>void openDoc(d.id),docs);}form.append(docs);}
      const preview=field(form,'preview','本次内容预览','',true);preview.readOnly=true;preview.classList.add('mp-preview');const actions=node('div',null,'mp-actions');
      async function prepare(){const r=await api.packsCompose({id:item.id,values:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.value])),documents:checks.filter(c=>c.checked).map(c=>c.value)});if(!r.ok){failure(r);return null;}preview.value=r.text;return r.text;}
      button('复制',async()=>{const r=await call(async()=>{const text=await prepare();return text?api.packsCopy({text}):null;});if(r?.ok)message('已复制；可到目标应用按 ⌘V。');else if(r)failure(r);},actions);
      button('粘贴到原窗口',async()=>{const r=await call(async()=>{const text=await prepare();return text?api.packsCopy({text,paste:true}):null;});if(r?.ok)message(r.pasted?'已发送粘贴指令，未自动发送消息。':'已复制；未能确认原输入位置，请手动 ⌘V。');else if(r)failure(r);},actions);
      const ai=node('details');ai.append(node('summary','使用 AI 生成'));const model=node('p','读取文本模型配置…','mp-hint');ai.append(model);void api.packsConfig().then(c=>{model.textContent=c.configured?`文本模型：${c.model}`:'尚未配置文本 AI，可从主面板设置配置；复制不受影响。';}).catch(()=>{model.textContent='模型配置读取失败，请检查设置。';});const consent=node('label',null,'mp-check'),check=node('input');check.type='checkbox';consent.append(check,document.createTextNode('发送上方预览内容到此文本模型'));ai.append(consent);
      button('更新发送预览',async()=>{lastSent=await call(prepare)||'';check.checked=false;},ai);
      const output=field(ai,'output','生成结果（可修改后复制）','',true);output.maxLength=30000;output.oninput=()=>{dirty=true;};let lastSent='';
      button('生成',async()=>{if(busy)return;const text=await call(prepare);if(typeof text!=='string')return;if(!check.checked||text!==lastSent){check.checked=false;lastSent=text;message('请核对预览并勾选同意发送，再生成。');return;}const epoch=++generation;message('正在生成，可取消…');const r=await call(()=>api.packsGenerate({text,confirmed:true}));if(epoch!==generation||disposed)return;if(r?.ok){output.value=r.text;dirty=true;message('生成完成，未替换原资料。');}else failure(r);},ai);
      button('取消生成',()=>void api.packsCancel(),ai);button('复制结果',async()=>{if(!output.value.trim())return;const r=await call(()=>api.packsCopy({text:output.value}));if(r?.ok)message('已复制结果。');else if(r)failure(r);},ai);
      button('返回列表',()=>{if(!busy&&leave())render();},actions);button('放弃本次输入',()=>{if(!busy){reset();render();}},actions);form.append(actions,ai);detail.append(form);void prepare().catch(()=>{});
    }
    function render(){if(!state||editing||using)return;root.dataset.revision=String(state.revision);list.replaceChildren();const query=search.value.trim().toLowerCase(),items=state.items.filter(p=>[p.name,p.text,...p.documents.map(d=>d.name)].join(' ').toLowerCase().includes(query));
      if(!items.length)list.append(node('p',state.items.length?'没有匹配的资料':'存一段提示词或一份模板，下次直接取用。','mp-hint'));
      for(const item of items){const row=node('div',null,'mp-row'),open=button(item.name,()=>compact?api.packsSelect(item.id):use(item),row);open.className='mp-open';open.title=item.text.slice(0,400);if(item.shortcut&&!item.shortcutActive)row.append(node('span','快捷键未注册','mp-hint'));
        if(!compact){button('编辑',()=>edit(item),row);let armed=false;const del=button('删除',async()=>{if(busy)return;if(!armed){armed=true;del.textContent='确认删除';return;}const r=await call(()=>api.packsCommand({action:'delete',id:item.id,revision:state.revision,confirmed:true}));if(r?.ok){state=r;render();}else if(r)failure(r);},row);del.onblur=()=>{armed=false;del.textContent='删除';};}list.append(row);}
    }
    async function refresh(){if(disposed||busy||dirty||editing||using)return;try{const r=await api.packsGet();if(!r.ok)return failure(r);state=r;render();return r;}catch{failure();}}
    const unsub=api.onPacksSelect?.(async id=>{if(compact||disposed||busy)return;if(dirty||editing){message('请先保存或放弃当前内容，再打开另一份资料。');return;}reset();await refresh();const item=state?.items.find(p=>p.id===id);item?use(item):edit();});
    void refresh().then(s=>{if(!compact&&s?.selectedId){const p=s.items.find(p=>p.id===s.selectedId);if(p)use(p);}});
    const stopChanged=api.onPacksChanged?.(()=>void refresh());
    const unload=e=>{if(dirty||busy||editing){e.preventDefault();e.returnValue=false;}};window.addEventListener('beforeunload',unload);
    return {refresh,async flush(){if(dirty||busy||editing){message('请先保存、复制结果或明确放弃当前输入。',true);throw Error('unsaved_materials');}},destroy(){disposed=true;stopChanged?.();generation++;unsub?.();window.removeEventListener('beforeunload',unload);void api.packsCancel();}};
  }};
})();
