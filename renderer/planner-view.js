(() => {
  'use strict';
  const M=window.PlannerModel;
  const period=r=>r.scheduled===false?`${M.itemDay(r)}${r.until?` 至 ${r.until}`:''} · 未排时段`:`${M.itemDay(r)} ${clock(r.start)}–${clock(r.end)}`;
  const errors={conflict:'安排已在其他窗口更新。输入仍保留，请刷新后核对再保存。',save_failed:'本机保存失败，输入已保留，请重试。',corrupt_store:'本机安排文件无法读取，未覆盖原文件。请从备份恢复后重新打开。',invalid_time:'请检查起止时间：结束须晚于开始，单段不超过 24 小时。',invalid_text:'请填写内容，并缩短过长的文字。',not_configured:'尚未配置文本模型，请到设置中的 API 配置检查。',unauthorized:'模型密钥不可用，请检查 API 配置。',timeout:'整理超时，原输入已保留，可以重试。',cancelled:'已取消建议，原安排没有改变。',invalid_response:'模型结果不完整或引用了未知事项，未采用。',invalid_input:'请输入不超过 8000 字的内容；单日最多向 AI 提供 60 项。',request_failed:'模型暂不可用，请检查网络或稍后重试。',recording_busy:'已有录音进行中，请先结束原录音。',nothing_to_undo:'没有可撤销的最近操作。'};
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const id=()=>`plan-${crypto.randomUUID()}`;
  const clock=ms=>new Date(ms).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  function mount(root,api,options={}){
    let state=null,disposed=false,busy=false,dirty=false,editing=null,editRevision=0,proposal=null,proposalSource='',voiceId='',voiceStopping=false,signature='',undoRevision=-1,aiBusy=false,aiEpoch=0,libraryOpen=false,legacyData=null;
    const shell=el('section',null,'planner'),header=el('header',null,'planner-head'),heading=el('h2','今日安排'),date=el('input');date.type='date';date.value=M.day();date.setAttribute('aria-label','安排日期');
    const actions=el('div',null,'planner-actions'),body=el('div',null,'planner-body'),left=el('div',null,'planner-timeline'),right=el('div',null,'planner-compose'),list=el('div',null,'planner-list');
    const more=el('details',null,'planner-more');more.append(el('summary','更多'));const moreBody=el('div',null,'planner-more-body');more.append(moreBody);
    const focus=el('p',null,'planner-focus'),message=el('p',null,'planner-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    const remind=el('label',null,'planner-check'),check=el('input');check.type='checkbox';remind.append(check,document.createTextNode('到点提醒'));
    function say(text,error=false){message.textContent=text;message.classList.toggle('error',error);if(typeof libraryMessage!=='undefined'){libraryMessage.textContent=text;libraryMessage.classList.toggle('error',error);}}
    function button(text,fn,parent=actions){const b=el('button',text);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(()=>say('操作未完成，输入仍保留，请重试。',true));parent.append(b);return b;}
    button('刷新',async()=>{await refresh(true);if(dirty){editRevision=state?.revision;say('内容已保留，请核对最新清单后再保存。');}},moreBody);
    const undo=button('撤销',()=>command({action:'undo'}),moreBody);undo.disabled=true;
    button('手动添加',()=>{openEditor();form.hidden=false;form.scrollIntoView({block:'nearest'});},moreBody);
    if(options.legacy)button('以前的分类清单',options.legacy,moreBody);
    if(options.review)button('每周回看 · 想法',options.review,moreBody);
    moreBody.append(remind);if(options.float&&!window.notchAPI?.launcherLayout)button('悬浮',options.float);
    const libraryButton=button('待办分类清单',async()=>{libraryOpen=!libraryOpen;filters.hidden=!libraryOpen;libraryButton.setAttribute('aria-pressed',String(libraryOpen));heading.textContent=libraryOpen?'待办清单':scope.value==='week'?'本周目标':'今日安排';render(true);if(libraryOpen)await refreshLegacy();},header);
    libraryButton.setAttribute('aria-pressed','false');
    const scope=el('select');scope.setAttribute('aria-label','规划范围');for(const [v,t] of [['day','按天'],['week','本周']]){const o=el('option',t);o.value=v;scope.append(o);}scope.className='planner-scope';
    header.prepend(heading);header.append(scope,date,actions,more);left.append(focus,list);body.append(right,left);shell.append(header,body);root.append(shell);
    const weekReview=el('section',null,'planner-week-review');weekReview.hidden=true;
    weekReview.append(el('p','本周回看，也别漏掉还没成形的想法。','planner-help'));
    if(options.review)button('回看想法 · 决定周末或下周',options.review,weekReview);
    left.prepend(weekReview);
    const filters=el('section',null,'planner-filters');filters.hidden=true;const filterRow=el('div',null,'planner-actions');filters.append(filterRow);left.prepend(filters);
    const range=field(filterRow,'range','查看范围','text',[['all','全部记录'],['day','所选日期'],['week','所选周'],['history','历史 / 已完成'],['future','未来安排']]);
    const categoryFilter=field(filterRow,'filter-category','分类','text',[['','全部分类']]);
    const search=field(filterRow,'search','搜索事项 / 项目');search.type='search';search.placeholder='找以前做过的事…';
    const categoryEditor=el('details');categoryEditor.append(el('summary','管理分类'));const categoryName=field(categoryEditor,'category-name','分类名称');categoryName.maxLength=40;
    button('新增分类',()=>{if(!categoryName.value.trim()){say('先填写分类名称。',true);return;}return command({action:'settings',categories:{[`cat-${crypto.randomUUID()}`]:categoryName.value.trim()}});},categoryEditor);
    button('重命名所选分类',()=>{if(!categoryFilter.value||!categoryName.value.trim()){say('先选择一个分类并填写新名称。',true);return;}return command({action:'settings',categories:{[categoryFilter.value]:categoryName.value.trim()}});},categoryEditor);filters.append(categoryEditor);
    const stats=el('p',null,'planner-help');filters.append(stats);
    const libraryMessage=el('p',null,'planner-message');libraryMessage.setAttribute('role','status');filters.append(libraryMessage);
    const oldList=el('details',null,'planner-legacy');oldList.append(el('summary','以前四分类中的记录'));const oldRows=el('div');oldList.append(el('p','旧记录保留原样，没有历史完成时间；以下仅显示当前状态。编辑仍在原分类清单。','planner-help'),oldRows);if(options.legacy)button('打开原分类编辑',options.legacy,oldList);left.append(oldList);oldList.hidden=true;
    const form=el('form',null,'planner-form'),formTitle=el('h3','手动添加');form.hidden=true;form.append(formTitle);right.append(form);
    const fields={};
    function field(parent,key,label,type='text',values){const wrap=el('label',null,'planner-field');wrap.append(el('span',label));
    const input=values?el('select'):el(type==='textarea'?'textarea':'input');if(values){for(const [value,name] of values){const opt=el('option',name);opt.value=value;input.append(opt);}}else if(type!=='textarea')input.type=type;
      input.setAttribute('aria-label',label);input.name=key;wrap.append(input);parent.append(wrap);return input;
    }
    fields.title=field(form,'title','事项');fields.title.maxLength=200;fields.title.required=true;
    fields.body=field(form,'body','原文 / 详细内容（选填）','textarea');fields.body.maxLength=8000;
    const times=el('div',null,'planner-pair');form.append(times);fields.start=field(times,'start','开始（可不填）','datetime-local');fields.end=field(times,'end','结束（可不填）','datetime-local');
    fields.date=field(times,'date','日期（未排时段时）','date');fields.until=field(times,'until','目标截止日（选填）','date');
    const timingHint=el('p',null,'planner-help');timingHint.hidden=true;form.append(timingHint);
    let timingQuery=0;
    async function updateTimingHint(){const query=++timingQuery,key=fields.title.value.trim().toLocaleLowerCase();timingHint.hidden=true;if(!key||!api.timerGet)return;
      try{const result=await api.timerGet();if(query!==timingQuery||!result?.ok)return;const values=result.history.filter(r=>r.title.trim().toLocaleLowerCase()===key).slice(-10).map(r=>r.elapsedMs).sort((a,b)=>a-b);if(values.length<2)return;
        timingHint.textContent=`之前 ${values.length} 次同名事项通常用了约 ${Math.max(1,Math.round(values[Math.floor(values.length/2)]/60000))} 分钟，仅供安排时参考。`;timingHint.hidden=false;
      }catch{}
    }
    fields.title.addEventListener('change',updateTimingHint);
    const grouping=el('div',null,'planner-pair');form.append(grouping);fields.topic=field(grouping,'topic','项目 / 主题（选填）');fields.topic.maxLength=120;
    fields.area=field(grouping,'area','维度','text',[['work','工作'],['life','生活'],['learn','学习']]);
    fields.category=field(grouping,'category','分类','text',Object.entries(M.categories));fields.kind=field(grouping,'kind','类型','text',[['task','待办事项'],['goal','目标']]);
    const fixed=el('label',null,'planner-check');fields.fixed=el('input');fields.fixed.type='checkbox';fixed.append(fields.fixed,document.createTextNode('固定时段（会议 / 约定）'));form.append(fixed);
    fields.status=field(form,'status','进展状态','text',M.states.map(s=>[s,M.labels[s]]));
    fields.progress=field(form,'progress','这次完成了什么 / 在等什么','textarea');fields.progress.maxLength=4000;
    fields.next=field(form,'next','下一步（选填）');fields.next.maxLength=1000;
    const save=el('button','保存安排');save.type='submit';form.append(save);button('放下编辑',()=>{dirty=false;openEditor();form.hidden=true;say('未改变原安排。');},form);
    form.oninput=()=>{dirty=true;};form.onchange=()=>{dirty=true;};
    function readFields(){const scheduled=!!(fields.start.value||fields.end.value);return {id:editing||id(),title:fields.title.value,body:fields.body.value,scheduled,date:fields.date.value||date.value,until:fields.until.value||null,kind:fields.kind.value,category:fields.category.value,start:scheduled?new Date(fields.start.value).getTime():null,end:scheduled?new Date(fields.end.value).getTime():null,topic:fields.topic.value,area:fields.area.value,fixed:fields.fixed.checked,status:fields.status.value,progress:fields.progress.value,next:fields.next.value,archived:state?.items.find(r=>r.id===editing)?.archived||false,mode:editing?'update':'add'};}
    form.onsubmit=async e=>{e.preventDefault();if(busy)return;const c=readFields();try{M.item(c);}catch(error){say(errors[error.message]||'请检查输入',true);return;}
      if(await command({action:'apply',changes:[c]},editRevision)){dirty=false;openEditor(null,true);form.hidden=true;}
    };
    function openEditor(row=null,force=false){if(dirty&&!force){say('编辑内容还没保存，请先保存或点击“放下编辑”。',true);return false;}
      editing=row?.id||null;editRevision=state?.revision||0;formTitle.textContent=row?'更新这一步':'新增一段安排';
      if(row){right.hidden=false;form.hidden=false;form.scrollIntoView({block:'nearest'});}
      const start=new Date(`${date.value}T09:00`).getTime();const v=row||{title:'',start,end:start+3600000,date:date.value,topic:'',area:'work',status:'planned',progress:'',next:'',fixed:false,category:'P3',kind:'task'};
      for(const k of Object.keys(fields)){if(k==='fixed')fields[k].checked=v[k];else fields[k].value=['start','end'].includes(k)?v[k]===null?'':M.local(v[k]):k==='date'?M.itemDay(v):v[k]||(['category','kind'].includes(k)?k==='category'?'P3':'task':'');}dirty=false;void updateTimingHint();return true;
    }
    const ai=el('section',null,'planner-ai');const input=field(ai,'instruction','说或写一句，要做什么？','textarea');input.maxLength=8000;
    input.placeholder='先写下想做的事，不必把时间和轻重缓急都想清楚。';
    const draftKey=location.pathname.endsWith('floating.html')?'notch-planner-input-float-v1':'notch-planner-input-main-v1';
    let draftFailed=false;try{input.value=localStorage.getItem(draftKey)||'';}catch{}
    function saveInput(){try{localStorage.setItem(draftKey,input.value);draftFailed=false;}catch{draftFailed=true;say('口述输入草稿保存失败，请先复制备份。',true);}}
    input.addEventListener('input',saveInput);
    const aiToggle=el('label',null,'planner-check'),aiCheck=el('input');aiCheck.type='checkbox';aiCheck.setAttribute('role','switch');aiCheck.setAttribute('aria-label','AI 协助');aiToggle.append(aiCheck,document.createTextNode('AI 协助'));actions.prepend(aiToggle);
    const aiHelp=el('p',null,'planner-help');ai.append(aiHelp);
    const conversationBox=el('details',null,'planner-conversation');conversationBox.append(el('summary','本次沟通'));const chat=el('div');conversationBox.append(chat);ai.append(conversationBox);conversationBox.hidden=true;
    const conversationKey=`${draftKey}-conversation`;let conversation=[];try{const saved=JSON.parse(localStorage.getItem(conversationKey)||'[]');if(Array.isArray(saved))conversation=saved.filter(r=>r&&['user','assistant'].includes(r.role)&&typeof r.text==='string').slice(-8);}catch{}
    function drawConversation(){chat.replaceChildren();for(const r of conversation)chat.append(el('p',`${r.role==='user'?'我':'AI 建议'}：${r.text}`,'planner-progress'));}
    function saveConversation(){try{localStorage.setItem(conversationKey,JSON.stringify(conversation));}catch{say('本次沟通未能保存到本机，请复制需要保留的内容。',true);}drawConversation();}
    button('结束本次沟通',()=>{invalidateAI();conversation=[];saveConversation();say('已清空本次沟通，待办记录不变。');},conversationBox);drawConversation();
    const aiActions=el('div',null,'planner-actions');ai.append(aiActions);
    const direct=button('原样记下',async()=>{if(aiBusy||voiceId){say('请先结束口述或取消 AI。',true);return;}const raw=input.value;if(!raw.trim()){say('先写一点内容。');input.focus();return;}const w=M.week(date.value),weekly=scope.value==='week';
      const c={mode:'add',id:id(),title:raw.trim().slice(0,200),body:raw,scheduled:false,date:weekly?w.from:date.value,...(weekly?{until:w.to}:{}),start:null,end:null,kind:weekly?'goal':'task',category:categoryFilter.value||'P3',area:'work',status:'planned'};
      if(await command({action:'apply',changes:[c],source:raw})){input.value='';saveInput();say('已原样保存到本机，未使用 AI；需要时再补时间。');}
    },aiActions);direct.classList.add('planner-primary');
    const speak=button('语音输入',async()=>{
      if(!voiceId){speak.disabled=true;speak.textContent='正在连接麦克风…';try{const r=await api.plannerVoice('start');if(!r?.ok){speak.textContent='语音输入';say(errors[r?.error]||'无法开始录音，请检查录音设置。',true);return;}voiceId=r.recordingId;speak.textContent='结束语音';say('正在听，文字会显示在下方。');}finally{speak.disabled=false;}}
      else{voiceStopping=true;speak.disabled=true;try{await api.plannerVoice(speak.dataset.recovery==='true'?'retry-save':'stop');speak.textContent='正在保存口述…';}finally{speak.disabled=false;}}
    },aiActions);
    async function askAI(mode){
      if(!state?.aiEnabled){say('AI 已关闭；你可以直接原样记下。');return;}
      if(aiBusy||voiceId){say('请先结束并保存口述。',true);return;}
      if(!input.value.trim()){say('先说或写一句，例如“明天十点到十一点对需求”。');input.focus();return;}
      const epoch=++aiEpoch;aiBusy=true;generate.disabled=discuss.disabled=true;cancel.hidden=false;proposalSource=input.value;proposal=null;preview.replaceChildren();say('正在梳理，清单尚未改变…');
      try{const r=await api.plannerSuggest({text:proposalSource,day:date.value,scope:scope.value,mode,conversation});if(epoch!==aiEpoch||!state.aiEnabled)return;if(!r?.ok){say(r.error==='ai_disabled'?'AI 已关闭，原话仍保留。':r.error==='unknown_item'?'没找到对应事项。请写出清单里的名称，再试一次。':errors[r?.error]||'暂时没完成，请重试。',true);return;}
        conversation=[...conversation,{role:'user',text:proposalSource.slice(0,4000)},{role:'assistant',text:(r.reply||r.notes.join('；')||'已提炼为待确认草案。').slice(0,4000)}].slice(-8);saveConversation();conversationBox.open=mode==='discuss';
        proposal=r;renderProposal();const cov=r.coverage;say((r.changes.length?'核对草案，确认后才保存。':'继续补充你的想法，或点“提炼待确认草案”。')+(cov?` 已参考 ${cov.items}/${cov.total} 项安排、${cov.events} 条进展、${cov.legacy} 条旧记录（所选范围 ${cov.selected}/${cov.selectedTotal} 项）。`:''));
      }finally{if(epoch===aiEpoch){aiBusy=false;generate.disabled=discuss.disabled=false;cancel.hidden=true;}}
    }
    const discuss=button('聊聊怎么安排',()=>askAI('discuss'),aiActions),generate=button('提炼待确认草案',()=>askAI('extract'),aiActions);
    function invalidateAI(){aiEpoch++;aiBusy=false;generate.disabled=discuss.disabled=false;cancel.hidden=true;proposal=null;preview.replaceChildren();void api.plannerCancel();}
    const cancel=button('取消',()=>{invalidateAI();say('已取消，原话和安排未改变。');},aiActions);cancel.hidden=true;
    aiCheck.onchange=async()=>{const enabled=aiCheck.checked;if(!enabled)invalidateAI();await command({action:'settings',aiEnabled:enabled});aiCheck.checked=!!state?.aiEnabled;};
    button('清空输入',()=>{input.value='';saveInput();},moreBody);
    const live=el('p',null,'planner-voice-text'),preview=el('div',null,'planner-preview');ai.append(message,live,preview);right.prepend(ai);
    function renderProposal(){preview.replaceChildren();if(!proposal)return;
      if(proposal.reply)preview.append(el('p',proposal.reply,'planner-reply'));
      for(const note of proposal.notes)preview.append(el('p',note,'planner-help'));
      const decision=el('div',null,'planner-actions');preview.append(decision);
      const editors=[];
      for(const c of proposal.changes){const before=state.items.find(r=>r.id===c.id);const box=el('fieldset'),legend=el('legend',c.mode==='add'?'新增事项':`更新：原 ${before?`${period(before)} · ${M.labels[before.status]}`:'事项'}`);box.append(legend);
        box.append(el('strong',c.title),el('p',`${period(c)} · ${M.labels[c.status]}`,'planner-help'));
        if(c.progress)box.append(el('p',c.progress));if(c.next)box.append(el('p',`下一步：${c.next}`));
        const edit=el('details');edit.append(el('summary','修改这条'));box.append(edit);
        const f={};f.title=field(edit,'title','事项');f.start=field(edit,'start','开始','datetime-local');f.end=field(edit,'end','结束','datetime-local');
        f.date=field(edit,'date','日期','date');f.until=field(edit,'until','目标截止日（选填）','date');f.category=field(edit,'category','分类','text',Object.entries({...M.categories,...state.categories}));f.kind=field(edit,'kind','类型','text',[['task','待办事项'],['goal','目标']]);f.topic=field(edit,'topic','主题');f.area=field(edit,'area','维度','text',[['work','工作'],['life','生活'],['learn','学习']]);f.status=field(edit,'status','状态','text',M.states.map(s=>[s,M.labels[s]]));
        f.progress=field(edit,'progress','进展','textarea');f.next=field(edit,'next','下一步');
        for(const k of Object.keys(f))f[k].value=['start','end'].includes(k)?c[k]===null?'':M.local(c[k]):k==='date'?M.itemDay(c):c[k]||'';
        preview.append(box);editors.push({c,f});
      }
      if(proposal.changes.length)button('确认保存',async()=>{
        if(!proposal||!state.aiEnabled){say('AI 已关闭，建议未采用。');return;}
        const changes=editors.map(({c,f})=>({...c,...Object.fromEntries(Object.entries(f).map(([k,v])=>[k,['start','end'].includes(k)?v.value?new Date(v.value).getTime():null:k==='until'?v.value||null:v.value])),scheduled:!!(f.start.value||f.end.value)}));
        if(await command({action:'apply',changes,source:proposalSource,aiProposal:true},proposal.revision)){proposal=null;preview.replaceChildren();input.value='';saveInput();say('已保存。需要时再说一句就好。');}
      },decision).classList.add('planner-primary');
      if(proposal.changes.length)button('暂不保存',()=>{proposal=null;preview.replaceChildren();say('未改变原安排。');},decision);
      else proposal=null;
    }
    const backlog=el('details',null,'planner-backlog');backlog.append(el('summary','查看以前的安排'));const backlogList=el('div');backlog.append(backlogList);moreBody.append(backlog);
    async function command(c,revision=state?.revision){if(busy||!state)return false;busy=true;save.disabled=true;
      try{const result=await api.plannerCommand({...c,revision,requestId:crypto.randomUUID()});if(!result?.ok){say(errors[result?.error]||'未保存，请检查内容后重试。',true);return false;}
        state=result.state;if(!dirty)editRevision=state.revision;undoRevision=result.undoable?state.revision:-1;undo.disabled=undoRevision!==state.revision;render(true);say('已保存到本机。');return true;
      }catch{say(errors.save_failed,true);return false;}finally{busy=false;save.disabled=false;}
    }
    function render(force=false){if(!state)return;check.checked=state.reminders;undo.disabled=undoRevision!==state.revision;
      if(!state.aiEnabled&&(aiBusy||proposal))invalidateAI();aiCheck.checked=!!state.aiEnabled;discuss.hidden=generate.hidden=conversationBox.hidden=!state.aiEnabled;
      aiHelp.textContent=state.aiEnabled?'AI 仅在你点击时参考已有安排、近期进展和本次沟通，发送给当前配置的文本模型。建议不等于决定，确认后才保存。':'AI 已关闭：原话直接保存到本机。语音输入仍使用你配置的语音识别服务。';
      oldList.hidden=!libraryOpen;right.hidden=libraryOpen&&form.hidden;libraryButton.textContent=libraryOpen?'返回安排':'待办分类清单';
      for(const select of [fields.category,categoryFilter]){const entries=Object.entries({...M.categories,...state.categories}),signature=JSON.stringify(entries);if(select.dataset.options!==signature){const value=select.value;select.replaceChildren();if(select===categoryFilter){const option=el('option','全部分类');option.value='';select.append(option);}for(const [key,name] of entries){const option=el('option',name);option.value=key;select.append(option);}select.value=value|| (select===categoryFilter?'':'P3');select.dataset.options=signature;}}
      const f=M.focus(state.items);focus.textContent=`当前：${f.current?`${f.current.title} · 至 ${clock(f.current.end)}`:'暂无进行中的安排'}　下一项：${f.next?`${clock(f.next.start)} ${f.next.title}`:'暂无安排'}`;
      focus.hidden=libraryOpen||!f.current&&!f.next;
      const next=JSON.stringify([state.revision,date.value,scope.value,libraryOpen,range.value,categoryFilter.value,search.value]);if(next===signature&&!force)return;if(!force&&list.contains(document.activeElement))return;signature=next;list.replaceChildren();backlogList.replaceChildren();
      const items=M.query(state,{date:date.value,range:libraryOpen?range.value:scope.value,category:libraryOpen?categoryFilter.value:'',search:libraryOpen?search.value:''}),overlaps=new Set(M.conflicts(items).flat());stats.textContent=M.habits(state,items);
      if(!items.length)list.append(el('p','还没有安排。说或写一句，确认后会出现在这里。','planner-empty'));
      const groups=new Map();
      for(const r of items){const row=el('article',null,'planner-row');row.dataset.id=r.id;row.classList.toggle('done',r.status==='done');
        const title=el('button',r.title,'planner-title');title.type='button';title.onclick=()=>openEditor(r);row.append(el('time',r.scheduled===false?'未排时段':`${clock(r.start)}–${clock(r.end)}`),title,el('span',`${r.kind==='goal'?'目标 · ':''}${M.labels[r.status]}${r.archived?' · 已归档':''} · ${M.itemDay(r)}${r.until?` 至 ${r.until}`:''}${r.topic?` · ${r.topic}`:''}`,'planner-meta'));
        if(r.body){const original=el('details',null,'planner-original');original.append(el('summary','查看原文'),el('p',r.body,'planner-progress'));row.append(original);}
        if(overlaps.has(r.id))row.append(el('p','时间重叠，请核对；不会自动移动其他事项。','planner-conflict'));
        if(r.progress)row.append(el('p',r.progress,'planner-progress'));if(r.next)row.append(el('p',`下一步：${r.next}`,'planner-help'));
        const controls=el('div',null,'planner-actions'),extras=el('details',null,'planner-row-more');extras.append(el('summary','调整'));const extraActions=el('div',null,'planner-actions');extras.append(extraActions);row.append(controls);
        button(r.status==='done'?'恢复未完成':'完成',()=>command({action:'apply',changes:[{mode:'update',id:r.id,status:r.status==='done'?'planned':'done'}]}),controls);
        if(api.timerStartPlan&&!r.archived&&r.status!=='done')button('计时',async()=>{try{const result=await api.timerStartPlan(r.id);say(result?.ok?'已开始计时；安排状态不变。':result?.error==='timer_busy'?'已有计时，请先结束当前这次。':'计时未开始，请重试。',!result?.ok);}catch{say('计时未开始，请重试。',true);}},controls);
        controls.append(extras);
        for(const [status,label] of [['active','开始'],['waiting','等待']])button(label,()=>command({action:'apply',changes:[{mode:'update',id:r.id,status}]}),extraActions).disabled=r.status===status;
        button('再做 15 分钟',()=>{if(r.fixed){say('固定时段请点“改时间”调整。');return;}return command({action:'apply',changes:[{mode:'update',id:r.id,end:Math.max(r.end,Date.now())+900000,status:'active'}]});},extraActions).disabled=r.status==='done'||r.scheduled===false;
        button('改时间 / 记进展',()=>openEditor(r),extraActions);
        if(r.sourceIdea&&options.source)button('查看来源想法',()=>options.source(r.id),extraActions).title='打开当前来源记录；它可能已被追加。';
        if(r.next)button('安排下一步',()=>{if(openEditor({...r,id:null,title:r.next,progress:'',next:'',status:'planned'}))formTitle.textContent='安排下一步';},extraActions);
        button(r.archived?'恢复归档':'归档',()=>command({action:'apply',changes:[{mode:'update',id:r.id,archived:!r.archived}]}),extraActions);
        const log=el('details',null,'planner-item-history');log.append(el('summary','查看这项的进展历史'));const events=M.history(state,r.id);
        if(!events.length)log.append(el('p','此前未记录变更时间，无法还原。','planner-help'));
        for(const e of events){const record=el('div',null,'planner-history');record.append(el('p',`${M.local(e.at).replace('T',' ')} · ${M.eventLabel(e)}`,'planner-help'),el('p',`当时安排：${e.after.title} · ${period(e.after)} · ${M.labels[e.after.status]}`,'planner-help'));if(e.before&&(e.before.start!==e.after.start||e.before.end!==e.after.end||M.itemDay(e.before)!==M.itemDay(e.after)))record.append(el('p',`调整前：${period(e.before)}`,'planner-help'));if(e.after.progress)record.append(el('p',`当时进展：${e.after.progress}`,'planner-progress'));if(e.after.next)record.append(el('p',`下一步：${e.after.next}`,'planner-help'));log.append(record);}row.append(log);
        if(libraryOpen){const cat=r.category||'P3',key=`${cat}\u0000${r.topic||''}`;if(!groups.has(key)){const group=el('details',null,'planner-project');group.open=true;const name=state.categories?.[cat]||M.categories[cat]||'其他';const siblings=items.filter(v=>(v.category||'P3')===cat&&(v.topic||'')===(r.topic||''));group.append(el('summary',`${name} / ${r.topic||'未分项目'} · ${siblings.filter(v=>v.status==='done').length}/${siblings.length} 项完成`));list.append(group);groups.set(key,group);}groups.get(key).append(row);}else list.append(row);
      }
      if(libraryOpen){oldRows.replaceChildren();if(!legacyData?.ok)oldRows.append(el('p','旧记录暂未读取；可打开原分类清单查看。','planner-help'));else{const old=legacyData.items.filter(r=>(!categoryFilter.value||r.priority===categoryFilter.value)&&(!search.value.trim()||r.text.includes(search.value.trim())));for(const r of old){const deadline=new Date(r.deadline).getTime();if(Number.isFinite(deadline)&&range.value!=='all'&&!M.query({items:[{...r,id:r.id,title:r.text,start:deadline,end:deadline+1,status:r.done?'done':'planned',archived:false}],events:[]},{date:date.value,range:range.value}).length)continue;oldRows.append(el('p',`${r.detail} · ${r.text} · ${r.done?'已完成（时间未记录）':'未完成'}${Number.isFinite(deadline)?` · 截止 ${M.local(deadline).replace('T',' ')}`:''}`,'planner-help'));}if(!oldRows.children.length)oldRows.append(el('p','此范围没有旧记录。','planner-help'));}}
      for(const r of state.items.filter(r=>r.archived||M.itemDay(r)!==date.value).sort((a,b)=>M.itemDay(b).localeCompare(M.itemDay(a))).slice(0,200)){
        const row=el('div',null,'planner-history');row.append(el('p',`${M.itemDay(r)} · ${r.title} · ${r.archived?'已归档':M.labels[r.status]}`));
        button('查看 / 重新安排',()=>{if(openEditor(r))say('请手动选择新的时间；不会自动把未完成事项塞到今天。');},row);backlogList.append(row);
      }
      const history=el('details');history.append(el('summary','查看最近进展记录'));
      for(const e of state.events.slice(-50).reverse())history.append(el('p',`${M.local(e.at).replace('T',' ')} · ${e.after.title} · ${M.labels[e.after.status]}${e.after.progress?` · ${e.after.progress}`:''}`,'planner-help'));backlogList.append(history);
    }
    function dateChanged(){if(!date.value)date.value=M.day();invalidateAI();render(true);if(!dirty)openEditor();heading.textContent=libraryOpen?'待办清单':scope.value==='week'?'本周目标':'今日安排';weekReview.hidden=scope.value!=='week'||!options.review;}
    date.onchange=dateChanged;scope.onchange=dateChanged;range.onchange=categoryFilter.onchange=()=>render(true);search.oninput=()=>render(true);check.onchange=()=>command({action:'settings',reminders:check.checked});
    async function refreshLegacy(){try{legacyData=await api.plannerLegacy?.();if(libraryOpen)render(true);}catch{legacyData=null;}}
    void refreshLegacy();
    async function refresh(explicit=false){if(disposed||busy)return;try{const result=await api.plannerGet();if(!result?.ok){say(errors[result?.error]||'无法读取安排，请重试。',true);return;}const first=!state,changed=state?.revision!==result.state.revision;state=result.state;if(!dirty&&changed)openEditor(editing?state.items.find(r=>r.id===editing):null);render();if(first)openEditor();if(explicit&&!dirty)say('已读取最新安排。');}catch{if(explicit)say('读取失败，请重试。',true);}}
    let polling=false,lastRefresh=0;
    const timer=setInterval(async()=>{if(polling||disposed)return;polling=true;try{if(Date.now()-lastRefresh>1200){lastRefresh=Date.now();await refresh();}if(voiceId){const v=await api.plannerVoice('text');if(!v?.ok)return;live.textContent=v.transcript||v.feedback||'';
        if(v.status==='idle'&&v.recordingId===voiceId){input.value+=(input.value?'\n':'')+v.savedText;saveInput();voiceId='';voiceStopping=false;speak.dataset.recovery='false';speak.disabled=false;speak.textContent='语音输入';live.textContent='';say(v.savedText?'文字已保留。可以修改识别错的字，再点“帮我安排”。':'音频已保存，但没有识别出文字。可以直接打字，稍后检查录音设置。');}
        else if(v.status==='save-failed'){speak.disabled=false;speak.dataset.recovery='true';speak.textContent='重试保存口述';say('原录音尚未保存，可重试保存；仍失败时可到录制页恢复，当前口述不会被丢弃。',true);}
      }}catch{say('暂时无法读取口述状态，请稍后重试；原录音不会清除。',true);}finally{polling=false;}},250);
    const unsaved=()=>dirty||proposal||aiBusy||voiceId||draftFailed;
    const unload=event=>{if(unsaved()){event.preventDefault();event.returnValue=false;say('请先保存或放下编辑、处理建议，并结束口述。',true);}};
    window.addEventListener('beforeunload',unload);void refresh();
    return {async reveal(itemId){
      if(unsaved()||busy)return {ok:false,error:'unsaved_planner'};
      const result=await api.plannerGet();if(!result?.ok)return result;
      if(unsaved()||busy||disposed)return {ok:false,error:'unsaved_planner'};
      state=result.state;const row=state.items.find(r=>r.id===itemId);if(!row)return {ok:false,error:'not_found'};
      libraryOpen=false;filters.hidden=true;libraryButton.setAttribute('aria-pressed','false');date.value=M.itemDay(row);scope.value='day';dateChanged();openEditor(row);return {ok:true};
    },async flush(){if(unsaved()){say('请先保存或放下编辑、处理建议，并结束口述再收回。',true);throw Error('unsaved_planner');}},destroy(){disposed=true;clearInterval(timer);window.removeEventListener('beforeunload',unload);void api.plannerCancel();},refresh};
  }
  window.PlannerView={mount};
})();
