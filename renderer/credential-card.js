(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CredentialCard=factory();})(typeof globalThis==='object'?globalThis:this,()=>{
  function parseConfig(text){
    if(typeof text!=='string'||text.length>16000)return null;
    const key=text.match(/(?:api[_ -]?key|token|password)\s*["']?\s*[:=]\s*["']?([^\s"',;]{1,4096})/i)?.[1]||'';
    const website=text.match(/https?:\/\/[^\s"'<>]+/i)?.[0]||'';
    return {password:key,website};
  }
  function mount(root,api){
    const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
    root.replaceChildren();root.classList.add('material-packs');let state=[],dirty=false,busy=false,editing='',disposed=false,revealTimer=null,revision='empty';
    const head=el('div'),title=el('strong','账号与密钥'),search=el('input'),form=el('form'),list=el('div'),status=el('p');head.className='mp-head';status.className='mp-status';status.setAttribute('role','status');head.append(title);root.append(head,search,form,list,status);
    const message=(s,error=false)=>{status.textContent=s;status.classList.toggle('error',error);};
    const fail=r=>message(r?.error==='conflict'?'另一处已修改密钥库。本次输入保留，请备份草稿后放弃编辑并刷新。':r?.error==='vault_unreadable'?'密钥库无法解密或已损坏，未覆盖原文件。请在设置中检查安全存储与备份。':'操作失败，输入已保留。请检查系统安全存储后重试。',true);
    const button=(name,fn,parent)=>{const b=el('button',name);b.type='button';b.onclick=fn;parent.append(b);return b;};
    const fields={};for(const [name,label,type,max] of [['service','名称','text',80],['account','所属账号（选填）','text',320],['website','网站／控制台地址（选填）','url',2000],['password','密码 / API Key','password',4096],['note','备注（选填）','text',2000]]){const l=el('label',label),i=el('input');i.name=name;i.type=type;i.maxLength=max;i.autocomplete='off';l.append(i);form.append(l);fields[name]=i;}
    form.className='mp-form';form.hidden=true;fields.service.required=true;fields.password.required=true;
    const hide=()=>{fields.password.type='password';clearTimeout(revealTimer);};
    button('查看 / 遮挡',()=>{if(fields.password.type==='password'){fields.password.type='text';revealTimer=setTimeout(hide,15000);}else hide();},form);
    const parse=el('details');parse.append(el('summary','从配置文字识别（仅本机）'));const input=el('textarea');input.maxLength=16000;input.setAttribute('aria-label','主动粘贴配置文字');parse.append(input);
    button('识别到表单',()=>{const p=parseConfig(input.value);if(!p)return;fields.password.value=p.password;fields.website.value=p.website;input.value='';hide();dirty=true;message('已填入识别结果，请核对名称、网址和密钥后保存。');},parse);parse.append(el('p','只识别你主动粘贴的内容，不扫描剪贴板或浏览器。'));form.append(parse);
    const actions=el('div');actions.className='mp-actions';const save=button('加密保存',null,actions);save.type='submit';button('放弃编辑',()=>{if(busy)return;form.reset();input.value='';form.hidden=true;dirty=false;editing='';hide();list.hidden=false;},actions);form.append(actions);
    button('新增',()=>{if(busy||dirty)return message('请先保存或放弃当前编辑。',true);hide();form.reset();editing='';form.hidden=false;list.hidden=true;fields.password.required=true;fields.password.placeholder='';fields.service.focus();},head);
    button('刷新',()=>{if(dirty||busy)return message('请先保存或放弃当前编辑。',true);void refresh();},head);
    search.type='search';search.placeholder='搜索名称、账号或网址';search.setAttribute('aria-label','搜索账号密钥');search.oninput=render;form.oninput=()=>{dirty=true;};
    function render(){if(disposed)return;list.replaceChildren();const q=search.value.toLowerCase();for(const row of state.filter(r=>[r.service,r.account,r.website,r.note].join(' ').toLowerCase().includes(q))){const item=el('div');item.className='mp-row';const body=el('div');body.append(el('strong',row.service),el('p',row.account||row.website||'未填写账号'),el('code','••••••••'));item.append(body);
      button('查看 / 编辑',async()=>{if(busy||dirty)return message('请先保存或放弃当前编辑。',true);busy=true;try{const r=await api.getCredential(row.id);if(!r.ok)return fail(r);revision=r.revision;editing=row.id;for(const key of Object.keys(fields))fields[key].value=key==='password'?'':r.item[key]||'';fields.password.required=false;fields.password.placeholder='留空保留原密钥';form.hidden=false;list.hidden=true;hide();
        // Plain secret is fetched only on explicit reveal, never retained in list state.
        revealSaved=row.id;
      }catch{fail();}finally{busy=false;}},item);
      if(row.website)button('打开网站',async()=>{try{const r=await api.openCredential(row.id);if(!r.ok)fail(r);}catch{fail();}},item);
      button('复制密钥',async()=>{try{message(await api.copyCredential(row.id,'password')?'已复制；不进入本应用历史，60 秒后若仍是本次内容则清空。':'复制失败。');}catch{fail();}},item);
      if(row.account)button('复制账号',async()=>{try{message(await api.copyCredential(row.id,'account')?'账号已复制。':'复制失败。');}catch{fail();}},item);
      let armed=false;const del=button('删除',async()=>{if(busy)return;if(!armed){armed=true;del.textContent='确认删除';return;}busy=true;try{const r=await api.deleteCredentials({ids:[row.id],revision});if(!r.ok)fail(r);else await refresh();}catch{fail();}finally{busy=false;}},item);del.onblur=()=>{armed=false;del.textContent='删除';};list.append(item);
    }if(!list.children.length)list.append(el('p',state.length?'没有匹配的账号或密钥。':'还没有保存账号密钥。'));}
    let revealSaved='';const reveal=el('button','查看已保存密钥');reveal.type='button';reveal.onclick=async()=>{if(!editing||busy)return;busy=true;try{const r=await api.getCredential(revealSaved);if(!r.ok)return fail(r);fields.password.value=r.item.password;fields.password.type='text';clearTimeout(revealTimer);revealTimer=setTimeout(()=>{if(fields.password.value===r.item.password)fields.password.value='';hide();},15000);}catch{fail();}finally{busy=false;}};form.append(reveal);
    form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;save.disabled=true;try{const r=await api.saveCredential({revision,...(editing?{id:editing}:{}),...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value]))});if(!r.ok)return fail(r);dirty=false;form.reset();form.hidden=true;list.hidden=false;editing='';hide();await refresh();message('已加密保存在本机。');}catch{fail();}finally{busy=false;save.disabled=false;}};
    async function refresh(){try{const r=await api.listCredentials();if(!r.ok)return fail(r);revision=r.revision;state=r.items;render();}catch{fail();}}
    const onBlur=()=>{hide();if(!dirty)fields.password.value='';};window.addEventListener('blur',onBlur);void refresh();
    const unload=e=>{if(dirty||busy){e.preventDefault();e.returnValue=false;}};window.addEventListener('beforeunload',unload);
    return {refresh,async flush(){if(dirty||busy){message('请先保存或放弃密钥编辑。',true);throw Error('unsaved_credentials');}},destroy(){disposed=true;hide();form.reset();window.removeEventListener('blur',onBlur);window.removeEventListener('beforeunload',unload);}};
  }
  return {parseConfig,mount};
});
