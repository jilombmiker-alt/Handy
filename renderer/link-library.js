(() => {
  'use strict';
  const host=window.LinkLibraryHost,api=window.notchAPI,page=document.querySelector('.links-page');if(!host||!page||typeof api?.linkSettings!=='function')return;
  const M=window.LinkLibraryModel,node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  let settings={aiEnabled:false,thumbnails:true},limit=60,dirty=false,pendingProposal=false,pendingDelete=false,activeForm=null,aiEpoch=0,aiBusy=false,loadedSignature='',imageCache=new Map();
  page.classList.add('link-library');
  const bar=node('div',null,'ll-filters'),status=node('p',null,'ll-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  function say(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
  function button(text,fn,parent){const b=node('button',text,'ll-button');b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(()=>say('操作未完成，输入仍保留，请重试。',true));parent.append(b);return b;}
  function field(parent,label,type='text',values){const wrap=node('label',null,'ll-field');wrap.append(node('span',label));const n=node(values?'select':type==='textarea'?'textarea':'input');if(values)for(const [value,text]of values){const o=node('option',text);o.value=value;n.append(o);}else if(type!=='textarea')n.type=type;n.setAttribute('aria-label',label);wrap.append(n);parent.append(wrap);return n;}
  const view=field(bar,'查看','text',[['all','全部收藏'],['pinned','日常常用'],['project','项目引用']]),groups=field(bar,'分组','text',[['','全部分组']]),search=field(bar,'搜索标题、备注或用途');search.type='search';search.placeholder='也可以写“我想找导航设计参考”';
  const thumbnails=field(bar,'显示小图','checkbox'),ai=field(bar,'AI 协助','checkbox');ai.setAttribute('role','switch');
  const tools=node('div',null,'ll-tools'),groupForm=node('form',null,'ll-group-form');groupForm.hidden=true;
  button('新建分组',()=>{groupForm.hidden=!groupForm.hidden;if(!groupForm.hidden)groupName.focus();},tools);
  const recommend=button('从收藏里找参考',()=>runAI({mode:'recommend',query:search.value}),tools);recommend.hidden=true;
  const cancel=button('取消 AI',()=>{aiEpoch++;aiBusy=false;pendingProposal=false;void api.linkCancel();cancel.hidden=true;recommend.disabled=false;recommendations.replaceChildren();page.querySelectorAll('.ll-proposal').forEach(n=>n.replaceChildren());say('已取消；收藏和备注没有改变。');},tools);cancel.hidden=true;
  const groupName=field(groupForm,'新分组名称');groupName.maxLength=40;const groupSubmit=node('button','创建','ll-button');groupSubmit.type='submit';groupForm.append(groupSubmit);
  groupForm.onsubmit=async e=>{e.preventDefault();const r=await host.command({action:'group',name:groupName.value,revision:host.snapshot().revision});if(!r.ok)return say(errorText(r.error),true);groupName.value='';groupForm.hidden=true;syncGroups();say('分组已创建。选中它再收藏，或在链接详情里移入。');};
  const help=node('details',null,'ll-help');help.append(node('summary','关于预览与 AI'),node('p','收藏先存本机；公开网页的标题和小图在后台补全。AI 默认关闭，只有主动点击才将所选链接、备注和公开页面文字发送到已有文本模型。视频目前只读取页面介绍，不读取视频或字幕。推荐只查已有收藏，不联网找新网站。'));
  tools.append(help);
  const recommendations=node('div',null,'ll-recommendations');page.querySelector('.links-toolbar').after(bar,tools,groupForm,status,recommendations);
  const deletion=node('section',null,'ll-delete-confirm ll-tools');deletion.hidden=true;deletion.setAttribute('aria-label','确认删除收藏');status.after(deletion);
  function confirmDelete(label,commit){
    if(dirty||pendingProposal||aiBusy||groupName.value.trim())return say('请先保存或放下编辑，再删除。',true);
    const focus=document.activeElement;pendingDelete=true;deletion.hidden=false;deletion.replaceChildren();deletion.append(node('span',`删除${label}？无法撤销；关联笔记正文会保留。`));
    const close=()=>{pendingDelete=false;deletion.hidden=true;deletion.replaceChildren();host.render();if(focus?.isConnected)focus.focus();else add.focus();};
    button('确认删除',()=>{const result=commit();if(result.ok){close();say('已删除所选收藏，笔记正文保留。');}else say(errorText(result.error),true);},deletion);
    const cancelDelete=button('取消',()=>{close();say('已取消，收藏没有改变。');},deletion);cancelDelete.focus();
    deletion.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelDelete.click();}};
  }
  const add=document.getElementById('link-add');add.placeholder='粘贴网址并回车，先收藏，备注稍后补';add.setAttribute('aria-label','收藏公开网址');
  const more=button('显示更多',()=>{limit+=60;host.render();},page);more.hidden=true;
  const errors={conflict:'收藏已更新，未覆盖你的编辑。请先复制需要保留的文字，放下后重新打开详情。',save_failed:'本机保存失败，输入仍保留，请重试。',invalid_text:'内容过长或为空，请检查输入。',not_found:'链接、分组或笔记已不存在，请刷新后重试。',duplicate_group:'已有同名分组，请换个名称。',not_configured:'尚未配置文本模型，请到设置检查 API。',ai_disabled:'AI 已关闭，未生成或采用建议。',unavailable:'网页暂时读不到；收藏和备注仍保留。',timeout:'读取或整理超时，可以稍后重试。',invalid_response:'这次未得到可用建议，原内容未改变。',unauthorized:'模型密钥不可用，请到设置检查。',unsafe_url:'只支持公开网页，不读取内网或本地网址。',too_large:'网页内容过大，未继续读取。'};
  const errorText=code=>errors[code]||'暂时无法完成，请稍后重试。';
  errors.unsaved_links='主面板或链接小窗有未保存内容，请先保存或放下编辑，再删除。';errors.confirmation_required='请确认要删除的收藏。';
  function syncGroups(){const snapshot=host.snapshot(),signature=JSON.stringify(snapshot.groups.map(g=>[g.id,g.name]));if(signature===loadedSignature)return;loadedSignature=signature;const value=groups.value;groups.replaceChildren();const all=node('option','全部分组');all.value='';groups.append(all);for(const g of snapshot.groups){const option=node('option',g.name);option.value=g.id;groups.append(option);}groups.value=snapshot.groups.some(g=>g.id===value)?value:'';}
  function rerender(){if(dirty){say('详情里有未保存内容，请先保存或放下编辑。',true);return;}limit=60;host.render();}
  view.onchange=groups.onchange=search.oninput=rerender;
  async function changeSettings(changes){const r=await api.linkSettings(changes);if(!r?.ok){say(errorText(r?.error),true);thumbnails.checked=settings.thumbnails;ai.checked=settings.aiEnabled;return;}settings=r;applySettings();if(!dirty)host.render();}
  thumbnails.onchange=()=>changeSettings({thumbnails:thumbnails.checked});ai.onchange=()=>changeSettings({aiEnabled:ai.checked});
  function applySettings(){thumbnails.checked=settings.thumbnails;ai.checked=settings.aiEnabled;recommend.hidden=!settings.aiEnabled;page.classList.toggle('ll-no-thumbnails',!settings.thumbnails);if(!settings.aiEnabled){aiEpoch++;aiBusy=false;pendingProposal=false;void api.linkCancel();cancel.hidden=true;recommendations.replaceChildren();page.querySelectorAll('.ll-proposal').forEach(n=>n.replaceChildren());}}
  const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);void loadImage(e.target);}},{root:document.getElementById('link-groups'),rootMargin:'100px'});
  async function loadImage(img){const ref=img.dataset.preview;if(!settings.thumbnails||!ref)return;let data=imageCache.get(ref);if(!data){data=await api.linkImage(ref);if(data){imageCache.set(ref,data);if(imageCache.size>100)imageCache.delete(imageCache.keys().next().value);}}if(data&&img.isConnected)img.src=data;else img.hidden=true;}
  async function runAI(input,output){if(!settings.aiEnabled)return say(errors.ai_disabled,true);if(aiBusy)return say('上一条 AI 请求还在处理，可先取消。');if(dirty)return say('先保存或放下备注编辑，再请 AI 提炼。',true);if(input.mode==='recommend'&&!input.query.trim())return say('先在搜索框写下你想找什么。');
    const epoch=++aiEpoch;aiBusy=true;cancel.hidden=false;recommend.disabled=true;say('正在整理建议；收藏没有改变…');
    try{const r=await api.linkAI(input);if(epoch!==aiEpoch||!settings.aiEnabled)return;if(!r?.ok)return say(errorText(r?.error),true);
      if(input.mode==='recommend'){recommendations.replaceChildren();recommendations.append(node('p',`从 ${r.coverage} 条收藏中匹配；不是全部历史的保证。`));for(const result of r.recommendations){const item=host.snapshot().groups.flatMap(g=>g.links||[]).find(i=>i.id===result.id);if(!item)continue;const line=node('div');button(item.title,()=>api.openExternal(item.url),line);line.append(node('p',result.reason));recommendations.append(line);}if(!r.recommendations.length)recommendations.append(node('p','这批收藏中没有找到合适参考。'));say('以下是建议，不会修改你的分类。');return;}
      if(!output?.isConnected)return;pendingProposal=true;output.replaceChildren();output.append(node('h4','AI 建议 · 确认后保留'),node('p',r.warning||'信息有限，请核对。','ll-warning'));
      const summary=field(output,'是什么','textarea'),use=field(output,'能做什么','textarea'),scenario=field(output,'适用场景','textarea'),tags=field(output,'建议标签（逗号分隔）');summary.value=r.summary;use.value=r.use;scenario.value=r.scenario;tags.value=r.tags.join('，');
      button('保留这份提炼',async()=>{if(!settings.aiEnabled)return say(errors.ai_disabled,true);const current=host.snapshot().groups.flatMap(g=>g.links||[]).find(i=>i.id===input.id);const response=await host.command({action:'patch',id:input.id,revision:r.revision,changes:{analysis:{summary:summary.value,use:use.value,scenario:scenario.value,source:r.source,warning:r.warning},tags:[...new Set([...(current?.tags||[]),...tags.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean)])]}});if(response.ok){pendingProposal=false;host.render();}say(response.ok?'提炼已保留；你的备注和分组没有改变。':errorText(response.error),!response.ok);},output);
      button('不用这份',()=>{pendingProposal=false;output.replaceChildren();},output);say('提炼仅供参考，尚未保存。');
    }finally{if(epoch===aiEpoch){aiBusy=false;cancel.hidden=true;recommend.disabled=false;}}
  }
  function decorate(row,item,group){
    if(item.preview){const mark=row.querySelector('.link-favicon');mark.replaceChildren();mark.classList.add('ll-thumbnail');const image=node('img');image.alt='';image.width=56;image.height=40;image.dataset.preview=item.preview;mark.append(image);observer.observe(image);}
    const text=row.querySelector('.link-open'),brief=node('span',item.note||item.analysis?.use||item.description||'', 'll-note');if(brief.textContent){brief.title=brief.textContent;text.append(brief);}if(item.pinned)text.querySelector('strong').prepend(document.createTextNode('常用 · '));
    const details=node('details',null,'ll-detail');details.append(node('summary','备注 / 详情'));row.append(details);
    let built=false;details.ontoggle=()=>{if(!details.open)return;if(dirty&&activeForm!==details){details.open=false;say('请先保存或放下另一条备注。',true);return;}if(built)return;built=true;const expected=host.snapshot().revision,form=node('form',null,'ll-edit');details.append(form);activeForm=details;
      const title=field(form,'标题'),note=field(form,'我的备注','textarea'),destination=field(form,'放入分组','text',host.snapshot().groups.map(g=>[g.id,g.name])),tags=field(form,'标签（逗号分隔）'),pinned=field(form,'设为日常常用','checkbox');
      title.value=item.title;title.maxLength=200;note.value=item.note||'';note.maxLength=4000;destination.value=group.id;tags.value=(item.tags||[]).join('，');pinned.checked=!!item.pinned;
      form.oninput=()=>{dirty=true;activeForm=details;};form.onchange=form.oninput;
      const save=node('button','保存备注与分类','ll-button');save.type='submit';form.append(save);
      form.onsubmit=async e=>{e.preventDefault();const r=await host.command({action:'patch',id:item.id,revision:expected,groupId:destination.value,changes:{title:title.value,note:note.value,tags:tags.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean),pinned:pinned.checked}});if(r.ok){dirty=false;activeForm=null;host.render();say('已保存到本机。');}else say(errorText(r.error),true);};
      button('放下编辑',()=>{dirty=false;activeForm=null;host.render();say('未改变原备注。');},form);
      if(item.preview){const large=node('img',null,'ll-large-preview');large.alt='网页提供的预览图';large.dataset.preview=item.preview;details.append(large);void loadImage(large);}
      details.append(node('p',item.warning||'预览信息尚未读取；不影响收藏。','ll-warning'));
      button('读取网页预览',async()=>{if(dirty||pendingProposal||aiBusy)return say('请先处理当前编辑或 AI 建议。',true);say('正在读取公开页面，收藏已保留…');const r=await host.refreshPreview(item.id);say(r?.ok?'预览已更新，备注与分组没有改变。':errorText(r?.error),!r?.ok);},details);
      if(item.analysis){details.append(node('h4','已保留的 AI 提炼'));for(const [key,label]of [['summary','是什么'],['use','能做什么'],['scenario','何时用']])details.append(node('p',`${label}：${item.analysis[key]}`));}
      const aiOutput=node('div',null,'ll-proposal');button('AI 提炼这条',()=>runAI({mode:'analyze',id:item.id},aiOutput),details);details.append(aiOutput);
      const notes=host.notes(),association=node('section',null,'ll-association');association.append(node('h4','关联笔记'));details.append(association);
      const choose=field(association,'选择已有普通笔记','text',[['','选择笔记…'],...notes.map(n=>[n.id,n.title||'未命名笔记'])]);
      button('关联到这篇',async()=>{if(dirty)return say('先保存或放下备注，再关联笔记。',true);if(!choose.value)return say('请先选择笔记。');const r=await host.command({action:'patch',id:item.id,revision:host.snapshot().revision,changes:{noteIds:[...item.noteIds||[],choose.value]}});say(r.ok?'已关联。笔记正文没有被改写。':errorText(r.error),!r.ok);},association);
      for(const noteId of item.noteIds||[]){const linked=notes.find(n=>n.id===noteId),line=node('div',null,'ll-tools');button(linked?.title||'笔记已删除',()=>host.openNote(noteId),line).disabled=!linked;button('解除关联',async()=>{if(dirty)return say('先处理备注编辑。',true);const r=await host.command({action:'patch',id:item.id,revision:host.snapshot().revision,changes:{noteIds:(item.noteIds||[]).filter(id=>id!==noteId)}});say(r.ok?'已解除，笔记和链接都保留。':errorText(r.error),!r.ok);},line);association.append(line);}
    };
  }
  function renderNoteReferences(noteId,root){const rows=host.snapshot().groups.flatMap(g=>g.links||[]).filter(r=>r.noteIds?.includes(noteId));if(!rows.length)return;const section=node('section',null,'ll-note-references');section.append(node('strong','关联资料'));for(const item of rows){const card=node('div');button(item.title,()=>api.openExternal(item.url),card);if(item.note)card.append(node('span',item.note));section.append(card);}root.append(section);}
  function refreshNoteReferences(){const root=document.querySelector('#notes-detail');if(!root)return;root.querySelector('.ll-note-references')?.remove();const id=root.querySelector('[data-note-id]')?.dataset.noteId;if(id)renderNoteReferences(id,root);}
  window.LinkLibrary={decorate,confirmDelete,notify:say,matches:(item,id)=>(!groups.value||groups.value===id)&&M.matches(item,{search:search.value,view:view.value}),get filtering(){return !!search.value||!!groups.value||view.value!=='all';},get limit(){return limit;},get hasUnsaved(){return dirty||pendingProposal||aiBusy||!!groupName.value.trim();},get hasDraft(){return dirty||pendingProposal||aiBusy||pendingDelete;},get selectedGroup(){return groups.value;},beforeRender(){observer.disconnect();},afterRender(total){syncGroups();more.hidden=total<=limit;more.textContent=`显示更多（已显示 ${Math.min(total,limit)} / ${total}）`;},renderNoteReferences,refreshNoteReferences,flush(){if(dirty||pendingProposal||groupName.value.trim()||aiBusy)throw Error('unsaved_links');}};
  const unload=e=>{try{window.LinkLibrary.flush();}catch{e.preventDefault();e.returnValue=false;say('请先保存或放下备注、处理新分组，并结束 AI。',true);}};window.addEventListener('beforeunload',unload);
  let timerBusy=false;setInterval(async()=>{if(timerBusy)return;timerBusy=true;try{const current=await api.linkSettings();if(current?.ok&&JSON.stringify(current)!==JSON.stringify(settings)){settings=current;applySettings();}}catch{}finally{timerBusy=false;}},1500);
  api.linkSettings().then(value=>{if(value?.ok)settings=value;applySettings();host.render();}).catch(()=>say('暂时无法读取设置，AI 保持关闭。',true));host.render();
})();
