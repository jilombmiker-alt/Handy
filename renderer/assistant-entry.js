(() => {
  'use strict';
  const M=window.AssistantEntryModel;
  const errors={invalid_input:'请写一点内容；输入最多 12,000 字，附件提取文字最多 24,000 字。',invalid_url:'这个网址不是支持的公开 HTTP / HTTPS 链接。',note_too_long:'链接备注最多 4,000 字，可以把长内容另存为随手记。',save_failed:'未能保存，请保留输入后重试；也可以先复制备份。',storage_failed:'本地存储不可用，输入仍在，请复制备份后重试。',not_configured:'还没有可用的文字模型配置。请在设置中检查 AI；也可以先储存原文。',ai_disabled:'AI 协助未开启。可以勾选开启，或直接储存原文。',unauthorized:'AI 密钥无效或无权限，请在设置中检查。',timeout:'AI 响应超时，原文仍在。可以重试，或直接储存。',cancelled:'已停止整理，原文和已有草稿仍保留。',invalid_response:'AI 返回的内容不完整，未采用。可以重试，或先储存原文。',request_failed:'未能连接 AI 服务。可以重试，或先储存原文。',rate_limited:'AI 服务请求过于频繁，稍后重试即可。',conflict:'安排已经发生变化，未覆盖原数据。请重新生成建议后确认。',recording_busy:'已有录音正在进行，请先结束它；现在仍可打字。',record_limit:'随手记已达到数量上限，请先整理现有记录。',busy:'上一条还在处理中，请稍等或取消。'};
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(label,click,cls)=>{const b=node('button',label,cls);b.type='button';b.onclick=click;return b;};
  function menu(trigger,content){
    content.classList.add('handy-menu');content.id=content.id||'menu-'+crypto.randomUUID();content.setAttribute('popover','auto');
    trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',content.id);
    trigger.onclick=()=>{if(content.matches(':popover-open'))content.hidePopover();else{const r=trigger.getBoundingClientRect();content.style.left=Math.max(12,Math.min(r.left,innerWidth-300))+'px';content.style.top=Math.min(r.bottom+8,Math.max(12,innerHeight-340))+'px';content.showPopover();content.querySelector('button:not(:disabled),select')?.focus();}};
    content.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(content.matches(':popover-open'))));
    content.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||e.target.tagName==='SELECT')return;const items=[...content.querySelectorAll('button:not(:disabled),select')].filter(n=>n.getClientRects().length);if(!items.length)return;e.preventDefault();const i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowUp'?-1:1)+items.length)%items.length].focus();});
    content.addEventListener('click',e=>{if(e.target.closest('button')&&!e.target.closest('[data-keep-menu]'))content.hidePopover();});
    document.body.append(content);return content;
  }
  window.HandyMenu=menu;
  function mount(root,{api,openTool,showTools,recording=()=>window.PanelRecording}){
    let pending=null,attachments=[],busy=false,voiceId='',voiceStopping=false,voiceRecovery=false,polling=false,requestId=crypto.randomUUID(),epoch=0,source='',savedRoute=null,draftBroken=false;
    let entryMode='command',voiceMode='command',voiceStarting=false,voiceKind='short',voiceCancelled=false,lastAnswer='';
    let conversation=[],receipts=[],contextPlanIds=[],meetingDraft=null,taskComplete=false;
    let timedStartId='',desktopSequence=0,desktopRequest='';
    const unsubscribeDesktop=api.onDesktopProgress?.(p=>{if(busy&&p.requestId===desktopRequest)say(p.text);});
    const HISTORY='handy-entry-history-v1';let rounds=[],historyBroken=false;
    try{rounds=JSON.parse(localStorage.getItem(HISTORY)||'[]');if(!Array.isArray(rounds)||rounds.some(r=>!r||typeof r.id!=='string'||typeof r.input!=='string'))throw Error();}catch{historyBroken=true;rounds=[];}
    const shell=node('section',null,'entry-composer');shell.setAttribute('aria-label','储存或执行指令');
    const label=node('label','说出想法，或贴一点内容','entry-label');label.htmlFor='entry-input';
    const input=node('textarea');input.id='entry-input';input.maxLength=12000;input.rows=3;input.placeholder='记一下… / 准备讨论… / 安排今天…';input.setAttribute('aria-describedby','entry-policy');
    const files=node('div',null,'entry-files');
    const toolbar=node('div',null,'entry-toolbar'),accessories=node('div',null,'entry-accessories'),primary=node('div',null,'entry-primary');
    const speak=button('口述',()=>void voice('input'),'entry-subtle'),attach=button('附件',()=>void importFiles(),'entry-subtle');
    speak.title='开始听，再按一次结束并处理';attach.title='选择 Word 或 PDF，导入其中可读取的文字';
    const store=button('储存',()=>selectMode('store'),'entry-mode'),command=button('指令',()=>selectMode('command'),'entry-mode');
    store.id='entry-store';command.id='entry-command';store.title='原样保存到本机，不调用文字 AI';command.title='按你的目的处理；安排仍需确认';
    const send=button('',()=>void submit(entryMode),'entry-command');send.id='entry-send';
    send.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
    const modes=node('div',null,'entry-modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','输入用途');modes.append(command,store);
    const modeToggle=button('指令⌄',null,'entry-menu-trigger');modeToggle.id='entry-mode-toggle';modeToggle.setAttribute('aria-label','切换指令或储存');menu(modeToggle,modes);
    const toolsToggle=button('工具',null,'entry-menu-trigger'),toolMenu=node('div');toolsToggle.id='entry-tools-toggle';
    for(const [id,name] of [['notes','笔记'],['recorder','录音'],['todo','待办'],['clip','剪贴板']])toolMenu.append(button(name,()=>void openTool(id),'entry-menu-item'));
    toolMenu.append(attach,button('开始口述',()=>void voice('input'),'entry-menu-item'),button('更多工具',()=>showTools(),'entry-menu-item'));
    menu(toolsToggle,toolMenu);
    accessories.append(modeToggle,toolsToggle);primary.append(speak,send);toolbar.append(accessories,primary);
    const preferences=node('div',null,'entry-preferences'),aiLabel=node('label'),ai=node('input'),historyLabel=node('label'),history=node('input');
    ai.type=history.type='checkbox';ai.id='entry-ai';history.id='entry-history';
    aiLabel.append(ai,document.createTextNode('AI 协助'));historyLabel.append(history,document.createTextNode('参考近期笔记与待办'));preferences.append(aiLabel,historyLabel);
    const policy=node('p','语音使用已配置的转写服务；储存不调用文字 AI。开启 AI 后发送当前任务的输入、附件、对话与执行结果；其他历史需另行勾选。','entry-policy');policy.id='entry-policy';
    const options=node('details',null,'entry-options'),optionsLabel=node('summary','对话输入设置');options.append(optionsLabel,preferences,policy);
    const micLabel=node('label','麦克风 '),mic=node('select');mic.setAttribute('aria-label','录入麦克风');micLabel.append(mic);options.append(micLabel);
    options.addEventListener('toggle',async()=>{if(!options.open)return;try{const devices=await navigator.mediaDevices.enumerateDevices();mic.replaceChildren();const defaultOption=node('option','系统默认');defaultOption.value='';mic.append(defaultOption);for(const d of devices.filter(v=>v.kind==='audioinput'&&v.deviceId!=='default')){const o=node('option',d.label||'麦克风（授权后显示名称）');o.value=d.deviceId;mic.append(o);}mic.value=localStorage.getItem('handy-microphone-v1')||'';}catch{say('暂时无法列出麦克风，请检查权限。',true);}});
    mic.onchange=()=>{try{localStorage.setItem('handy-microphone-v1',mic.value);say('下一次录音使用所选麦克风；当前录音不受影响。');}catch{say(errors.storage_failed,true);}};
    const hint=node('p','短按说指令 · 长按录音 · 再按一次结束','entry-policy');
    const taskLine=node('div',null,'entry-task-line'),taskLabel=node('span','新任务');
    const fresh=button('新任务',()=>void cancelRound(),'entry-subtle');fresh.id='entry-new-task';
    const done=button('完成',()=>void cancelRound(),'entry-subtle');done.id='entry-done';
    taskLine.append(taskLabel,fresh,done);
    const status=node('p','','entry-status');status.id='entry-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const recovery=node('div',null,'entry-recovery');
    const cancel=button('取消',()=>void cancelRound(),'entry-subtle');cancel.id='entry-cancel';cancel.hidden=true;primary.prepend(cancel);
    const retry=button('重新尝试',()=>void submit('command'),'entry-subtle');retry.hidden=true;
    const copy=button('复制原文备份',()=>void copyText(M.documentText(input.value,attachments)),'entry-subtle');copy.hidden=true;
    const config=button('检查 AI 设置',()=>void openTool('settings'),'entry-subtle');config.hidden=true;
    const viewSaved=button('查看记录',()=>void openSaved(),'entry-subtle');viewSaved.hidden=true;
    recovery.append(retry,copy,config,viewSaved);
    const result=node('section',null,'entry-result');result.hidden=true;result.setAttribute('aria-label','处理结果');
    const nav=node('nav',null,'entry-nav'),find=button('找回记录',()=>void showRecords(),'entry-subtle'),tools=button('更多工具',()=>showTools(),'entry-subtle');nav.setAttribute('aria-label','其他入口');nav.append(find,button('历史记录',showHistory,'entry-subtle'),tools);
    const library=node('section',null,'entry-library');library.hidden=true;library.setAttribute('aria-label','找回记录');
    options.append(hint);
    shell.append(label,taskLine,input,files,toolbar,status,recovery,result,library);root.prepend(shell);
    function remember(role,text){if(!text)return;conversation.push({role,text:String(text).slice(0,8000)});while(conversation.length>12||conversation.reduce((n,v)=>n+v.text.length,0)>32000)conversation.splice(conversation.length>2?1:0,1);paintTask();}
    function paintTask(){taskLine.hidden=!conversation.length;taskLabel.textContent=conversation.length?'本次：'+conversation.find(v=>v.role==='user')?.text.slice(0,48):'';fresh.hidden=done.hidden=!conversation.length;}
    function publishReceipts(){document.dispatchEvent(new CustomEvent('notch:task-results',{detail:receipts.map(({text,tool,ok})=>({text,tool,ok}))}));}
    function selectMode(mode){entryMode=mode;if(voiceId&&voiceKind==='short')voiceMode=mode;store.setAttribute('aria-pressed',String(mode==='store'));command.setAttribute('aria-pressed',String(mode==='command'));modeToggle.textContent=(mode==='store'?'储存':'指令')+'⌄';send.setAttribute('aria-label',mode==='store'?'保存':'发送');send.title=mode==='store'?'保存到本机':'发送指令（Command + Enter）';persist();}
    function say(text,isError=false){status.textContent=text;status.dataset.error=String(isError);copy.hidden=!isError;config.hidden=!isError;retry.hidden=!isError||!ai.checked;}
    function persist(){
      if(draftBroken)return false;
      try{localStorage.setItem(M.KEY,JSON.stringify({text:input.value,attachments,pending,source,requestId,useHistory:history.checked,busy,entryMode,conversation,contextPlanIds,meetingDraft}));return true;}
      catch{say(errors.storage_failed,true);return false;}
    }
    function setBusy(value){busy=value;input.disabled=attach.disabled=send.disabled=value||!!voiceId||voiceStarting;modeToggle.disabled=store.disabled=command.disabled=value||voiceStarting||voiceStopping;toolsToggle.disabled=value||!!voiceId||voiceStarting;history.disabled=value||!!voiceId||!ai.checked;for(const control of result.querySelectorAll('input,textarea,button'))control.disabled=value;cancel.hidden=!(value||voiceId||voiceStarting||input.value||pending);speak.hidden=!(voiceId||voiceStarting);send.hidden=value||!!voiceId||voiceStarting;if(value)retry.hidden=true;shell.setAttribute('aria-busy',String(value));}
    function changed(){shell.dataset.resultOnly='false';if(pending)result.hidden=true;requestId=crypto.randomUUID();persist();setBusy(busy);}
    function archive(label='已保留'){
      if(!input.value.trim()&&!pending&&!attachments.length)return true;
      if(historyBroken){say('历史记录读取异常，未覆盖，请先备份。',true);return false;}
      const row=JSON.parse(JSON.stringify({id:requestId,at:Date.now(),input:input.value,attachments,result:pending?.proposal||null,label}));
      const next=[row,...rounds.filter(r=>r.id!==row.id)].slice(0,60);
      try{localStorage.setItem(HISTORY,JSON.stringify(next));rounds=next;return true;}catch{say(errors.storage_failed,true);return false;}
    }
    function clearRound(){taskComplete=false;lastAnswer='';conversation=[];receipts=[];contextPlanIds=[];meetingDraft=null;paintTask();publishReceipts();input.value='';attachments=[];pending=null;source='';requestId=crypto.randomUUID();library.hidden=true;viewSaved.hidden=true;paintFiles();paintResult();persist();setBusy(false);say('');}
    async function cancelRound(){
      if(timedStartId)void api.cancelTimedRecording(timedStartId);
      if(voiceStarting){voiceCancelled=true;say('正在取消，麦克风打开后会立即停止并保留原音频。');return;}
      if(voiceId){voiceCancelled=true;if(!voiceStopping)await voice();say('正在结束本次录入，不执行指令；原音频仍保留。');return;}
      epoch++;void api.assistantCancel();setBusy(false);if(archive('已结束任务'))clearRound();
    }
    async function resetHome(){
      // Window navigation must never stop or discard a live recording.
      if(voiceId||voiceStarting||voiceStopping)return false;
      if(draftBroken)return false;
      epoch++;void api.assistantCancel();
      if(!archive('返回首页，已保留'))return false;
      clearRound();selectMode('command');return true;
    }
    function showHistory(){
      if(busy||voiceId)return;library.hidden=false;library.replaceChildren(node('h2','历史记录'));
      if(!rounds.length)library.append(node('p','还没有历史记录。','entry-policy'));
      for(const row of rounds){const b=button('',()=>{if(!archive())return;clearRound();input.value=row.input||'';attachments=JSON.parse(JSON.stringify(row.attachments||[]));pending=row.result?{proposal:JSON.parse(JSON.stringify(row.result)),source:row.input,requestId:crypto.randomUUID()}:null;if(pending?.proposal.kind==='plan'){pending.proposal={kind:'reply',text:'历史安排（仅回看，不会再次执行）\n'+M.draftText(pending.proposal)};}paintFiles();paintResult();changed();input.focus();},'entry-record');b.append(node('strong',(row.input||'附件输入').slice(0,70)),node('small',`${new Date(row.at).toLocaleString()} · ${row.label}`));library.append(b);}
      library.scrollIntoView({block:'start'});
    }
    input.oninput=changed;history.onchange=persist;
    input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Enter'&&e.metaKey){e.preventDefault();void submit(entryMode);}};
    input.addEventListener('paste',e=>{const image=[...e.clipboardData.items].find(v=>v.kind==='file'&&v.type.startsWith('image/'));if(image){e.preventDefault();void savePastedImage(image.getAsFile());}});
    async function savePastedImage(file){
      if(busy||voiceId)return;
      if(!file||file.size>10*1024*1024){say('请粘贴 10 MB 内的图片。',true);return;}
      setBusy(true);try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});const r=await api.referenceImport(data);if(!r.ok)throw Error();savedRoute={tool:'gallery'};viewSaved.hidden=false;say('截图已保存到本机随手截图，没有发送给 AI。');}catch{say('截图保存失败，请保留原图后重试。',true);}finally{setBusy(false);}
    }
    async function saveResultImage(){
      const text=M.draftText(pending?.proposal);if(!text)return;
      const canvas=document.createElement('canvas');canvas.width=1000;const ctx=canvas.getContext('2d');ctx.font='24px sans-serif';const lines=[];
      for(const paragraph of text.split('\n')){let line='';for(const char of paragraph){if(ctx.measureText(line+char).width>900){lines.push(line);line='';}line+=char;}lines.push(line);}
      if(lines.length>100){say('内容太长，暂不能存为单张图片；可以存为随手记。',true);return;}
      canvas.height=Math.max(200,lines.length*38+100);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1000,canvas.height);ctx.fillStyle='#25282b';ctx.font='24px sans-serif';lines.forEach((line,i)=>ctx.fillText(line,50,60+i*38));
      try{const r=await api.referenceImport(canvas.toDataURL('image/png'));if(!r.ok)throw Error();savedRoute={tool:'gallery'};viewSaved.hidden=false;say('结果已存为图片，可在随手截图查看。');}catch{say('图片保存失败，文字仍在。',true);}
    }
    async function refreshSettings(){try{const s=await api.plannerGet();if(s.ok){ai.checked=s.state.aiEnabled===true;history.disabled=!ai.checked||busy||!!voiceId;return s.state;}}catch{}return null;}
    ai.onchange=async()=>{const value=ai.checked;ai.disabled=true;try{const s=await api.plannerGet();if(!s.ok)throw Error('storage_failed');const r=await api.plannerCommand({action:'settings',aiEnabled:value,revision:s.state.revision,requestId:crypto.randomUUID()});if(!r.ok)throw Error(r.error);if(!value){epoch++;busy=false;void api.assistantCancel();setBusy(false);}history.disabled=!value;say(value?'AI 已开启；只在点击指令时发送输入。':'AI 已关闭，储存仍按原文保存。');}catch(e){ai.checked=!value;say(errors[e.message]||errors.save_failed,true);}finally{ai.disabled=false;}};
    function paintFiles(){files.replaceChildren();for(const [i,f] of attachments.entries()){const row=node('span',f.title);const remove=button('移除',()=>{if(busy||voiceId)return;attachments.splice(i,1);paintFiles();changed();},'entry-subtle');remove.setAttribute('aria-label',`移除附件 ${f.title}`);row.append(remove);files.append(row);}}
    async function importFiles(){
      if(busy||voiceId)return;attach.disabled=true;
      try{const r=await api.importMeetingFiles();if(!r.ok)throw Error(r.error);const next=(r.files||[]).map(f=>({title:f.name||f.title||'参考材料',text:f.text}));if(next.some(f=>typeof f.text!=='string'||f.text.length>24000)||attachments.length+next.length>6||[...attachments,...next].reduce((n,f)=>n+f.text.length,0)>24000)throw Error('invalid_input');attachments.push(...next);paintFiles();changed();say('附件文字已加入；点击储存保存文字，点击指令才发送给 AI。');}catch(e){say(errors[e.message]||'附件未导入。请检查文件是否可读；扫描 PDF 可能需要先做文字识别。',true);}finally{attach.disabled=false;}
    }
    async function copyText(text){try{const r=await api.copyMeetingText(text);say(r?.ok?'已复制，可自行粘贴。':'复制失败，请选中文字手动复制。',!r?.ok);return r?.ok===true;}catch{say('复制失败，请选中文字手动复制。',true);return false;}}
    function saveNote(text,id=requestId){const r=window.QuickRecords.command({action:'store',requestId:id,content:text});if(!r.ok)throw Error(r.error);const note=r.state.records.find(n=>n.sourceEntryId===id);savedRoute={tool:'quick',recordId:note.id};return note;}
    function saved(message){archive('已保存');conversation=[];contextPlanIds=[];meetingDraft=null;paintTask();pending=null;input.value='';attachments=[];source='';requestId=crypto.randomUUID();paintFiles();paintResult();persist();say(message);viewSaved.hidden=false;shell.scrollIntoView({block:'start'});}
    function reply(text){lastAnswer=text;remember('tool',text);pending={proposal:{kind:'reply',text},source:input.value,requestId:crypto.randomUUID()};paintResult();archive('已回答');persist();say('结果来自 Handy 本机工具；可以继续补充这件事。');result.scrollIntoView({block:'start'});}
    async function executeBatch(raw){
      const steps=window.AssistantCapabilities.actions(raw),token=epoch,batchInput=input.value;
      receipts=[];publishReceipts();
      for(const [i,p] of steps.entries()){
        if(token!==epoch)break;
        say(`正在执行 ${i+1}/${steps.length}…`);
        let row={ok:false,tool:p.tool||({start_timer:'pomodoro',start_recording:'recorder',open_music:'music',music_control:'music',play_music:'music',focus_window:'windows',find_note:'notes',new_note:'notes'})[p.action]};
        try{
          let r;
          if(p.action==='start_recording'){
            if(!/(?:录音|录制|录.{0,12}音)/.test(batchInput))throw Error('recording_not_requested');
            timedStartId=requestId+':record';try{r=await api.startTimedRecording({seconds:p.seconds,requestId:timedStartId});}finally{timedStartId='';}
            if(token!==epoch)return;if(!r?.ok)throw Error(r?.error);
            row.ok=true;row.text=r.replayed?'这条录音请求已执行过，不会重新开始。':`已启动一次 ${p.seconds%60===0?p.seconds/60+' 分钟':p.seconds+' 秒'}录音，到点自动结束保存，不会重复。`;
            await openTool('recorder');
          }else if(p.action==='start_timer'){
            const s=await api.timerGet();if(!s.ok)throw Error(s.error);
            if(token!==epoch)break;
            if(s.active){row.text='已有计时，是否替换为 '+(p.seconds%60===0?p.seconds/60+' 分钟':p.seconds+' 秒')+'？';row.replace={id:s.active.id,revision:s.revision,seconds:p.seconds};}
            else {r=await api.timerCommand({action:'start',mode:'countdown',seconds:p.seconds,revision:s.revision});if(!r?.ok)throw Error(r?.error);row.ok=true;row.text=`已启动 ${p.seconds%60===0?p.seconds/60+' 分钟':p.seconds+' 秒'}倒计时。`;}
          }else if(p.action==='open_music'){
            const keepPanel=steps.slice(i+1).some(s=>['open_tool','new_note'].includes(s.action));
            r=await api.controlMusic(keepPanel?'open_background':'open');if(!r?.ok)throw Error(r?.error);row.ok=true;row.text='已打开汽水音乐，未发送播放指令。';
          }else if(p.action==='new_note'){
            r=await openTool('notes',{create:p.format});if(!r?.ok)throw Error(r?.error);row.ok=true;row.text=p.format==='meeting'?'会议记录已打开，可以直接写。':'新笔记已打开，可以直接写。';
          }else if(p.action==='open_tool'){
            r=await openTool(p.tool);if(!r?.ok)throw Error(r?.error);row.ok=true;row.text='已打开'+window.AssistantCapabilities.tools.find(t=>t.id===p.tool).label+'。';
          }else if(p.action==='copy_result'){
            const text=M.draftText(pending?.proposal)||lastAnswer;if(!text)throw Error('no_result');row.ok=await copyText(text);row.text=row.ok?'已复制当前结果。':'复制失败，可选中文字手动复制。';
          }else{const outcome=await executeAction(p);row.ok=outcome?.ok===true;row.text=outcome?.text||M.draftText(pending?.proposal)||'这一步尚未完成。';}
        }catch(e){row.text=({recording_busy:'已有录音或待保存音频，未开始第二段，请先结束并保存。',recording_not_requested:'本轮没有明确要求启动录音，未执行历史中的录音动作。',start_failed:'录音未启动，请检查麦克风权限。',not_installed:'未安装汽水音乐，未打开；其他步骤继续。',timer_busy:'已有计时，未覆盖。',feature_disabled:'工具被隐藏，请从设置中开启。',conflict:'计时状态已变化，未覆盖，请重新查看。'})[e.message]||'这一步未完成，请从对应工具检查后重试。';}
        // A dispatched step may finish after cancellation. Report the fact but never start the next one.
        if(token!==epoch)return;
        receipts.push(row);remember('tool',row.text);publishReceipts();persist();
      }
      if(token!==epoch)return;
      reply(receipts.map((r,i)=>`${i+1}. ${r.text}`).join('\n'));
      taskComplete=!receipts.some(r=>r.replace);
      input.value='';attachments=[];paintFiles();persist();
    }
    async function replaceTimer(row,control){
      if(busy||voiceId||!row.replace)return;setBusy(true);control.disabled=true;
      try{const r=await api.timerCommand({action:'replace',mode:'countdown',...row.replace});if(!r?.ok)throw Error(r?.error);row.ok=true;row.text='原计时已保留到历史，新倒计时已启动。';delete row.replace;remember('tool',row.text);publishReceipts();reply(receipts.map(r=>r.text).join('\n'));}
      catch{delete row.replace;row.text='计时状态已改变或保存失败，未替换。请打开计时查看。';publishReceipts();reply(receipts.map(r=>r.text).join('\n'));}
      finally{setBusy(false);}
    }
    async function executeAction(raw){
      const p=window.AssistantCapabilities.validate(raw);
      if(['open_app','web_search','search_mail','play_music'].includes(p.action))return executeDesktop(p);
      if(['start_timer','start_recording','open_music','new_note'].includes(p.action))return executeBatch(p);
      if(p.action==='help'){reply(window.AssistantCapabilities.help());return {ok:true};}
      if(p.action==='find_note')return findNote(p.query);
      if(p.action==='focus_window')return focusNamedWindow(p.query);
      if(p.action==='music_control'){const r=await api.controlMusic(p.command);reply(r?.ok?'已发送音乐控制指令；播放状态以播放器为准。':r?.error==='not_installed'?'未安装汽水音乐，音乐控制未执行。':'音乐控制失败，请检查播放器或权限。');taskComplete=true;return {ok:r?.ok===true};}
      if(p.action==='copy_result'){const text=M.draftText(pending?.proposal)||lastAnswer;if(!text){reply('当前没有可复制的结果。可说“打开剪贴板”查找已采集内容，或先生成一段文字。');return {ok:false};}return {ok:await copyText(text)};}
      if(p.action==='query_plans'){
        const r=await api.plannerGet();if(!r.ok)throw Error('storage_failed');const [start,end]=window.AssistantCapabilities.range(p);
        const items=r.state.items.filter(v=>{const d=v.scheduled===false?v.date:window.PlannerModel.day(v.start);return d>=start&&d<=end;}).sort((a,b)=>(a.start||0)-(b.start||0));
        contextPlanIds=[...new Set([...contextPlanIds,...items.map(v=>v.id)])].slice(-60);
        reply(`${p.date||p.period}的安排（${start}${end!==start?' 至 '+end:''}）\n\n`+(items.length?items.map(v=>`${v.title}\n${v.scheduled===false?v.date+' · 未设时段':window.PlannerModel.local(v.start)+' — '+window.PlannerModel.local(v.end)} · ${window.PlannerModel.labels[v.status]}${v.archived?' · 已归档':''}${v.progress?'\n进展：'+v.progress:''}${v.next?'\n下一步：'+v.next:''}`).join('\n\n'):'本机待办中没有这个时间范围的已保存安排。未确认的 AI 草稿不会自动成为待办，可从历史记录找回。'));return {ok:true};
      }
      const r=await openTool(p.tool);if(!r?.ok){reply(r?.error==='feature_disabled'?'这个工具已安装但被隐藏，请在右上角设置中开启；并不是“尚未接入”。':'工具打开失败，原输入保留。请从更多工具重试。');return;}
      remember('tool','已打开'+window.AssistantCapabilities.tools.find(t=>t.id===p.tool).label);archive('已打开工具');pending=null;input.value='';attachments=[];paintFiles();paintResult();persist();taskComplete=true;say('工具已打开。再次按快捷键开始新指令。');
    }
    async function executeDesktop(p){
      const token=epoch,id=requestId+':desktop:'+desktopSequence++;desktopRequest=id;
      const messages={app_not_found:'没有找到这个已安装应用。请使用应用的完整名称。',busy:'另一个桌面操作尚未结束，请稍后重试。',accessibility_permission_required:'需要辅助功能权限才能搜索和播放歌曲；可从右上角设置开启。',not_installed:'未安装汽水音乐，未尝试其他播放器。',song_not_found:'搜索结果中没有可确认的匹配歌曲，已停在播放器；不会播放不相干歌曲。',focus_changed:'当前前台窗口已变化，为避免误操作已停止。',search_changed:'搜索内容发生变化，已停止选歌。',mail_not_configured:'还没有连接对应邮箱。请在邮件工具的管理账号中添加；不会代填密码。',mail_partial_failure:'邮箱查询失败，请在邮件工具查看连接情况。',feature_disabled:'这个工具已隐藏，请在设置中开启。',cancelled:'操作已停止，已打开的应用或已开始的播放不会自动撤回。'};
      let r;try{r=await api.desktopAction({requestId:id,action:p});}finally{if(desktopRequest===id)desktopRequest='';}
      if(token!==epoch)return {ok:false,error:'cancelled'};
      const text=r?.text||messages[r?.error]||'这一步尚未完成。已停止操作，没有改动文件、购买或发送内容。';
      reply(text);taskComplete=true;input.value='';paintFiles();persist();
      if(r?.choices?.length){
        library.replaceChildren(node('h2','选择应用'));library.hidden=false;
        for(const c of r.choices)library.append(button(c.name,async()=>{if(busy||token!==epoch)return;setBusy(true);try{await executeDesktop({...p,appId:c.id});if(token===epoch)library.hidden=true;}finally{if(token===epoch)setBusy(false);}},'entry-record'));
      }
      if(r?.mail){await openTool('mail');if(token===epoch)await window.HandyMail?.showSearch(r.mail);}
      else if(r?.error==='mail_not_configured')await openTool('mail');
      return {ok:r?.ok===true,text,error:r?.error};
    }
    async function findNote(query){
      const token=epoch;await window.Notebook.flush();if(token!==epoch)return;
      const records=window.Notebook.references().notes.map(n=>window.Notebook.get(n.id)).filter(Boolean).map(n=>({id:n.id,title:n.title||'未命名笔记',text:n.meeting?window.NotebookModel.toText(n.meeting):n.content,at:n.updatedAt,open:()=>openTool('notes',{kind:'note',id:n.id})}));
      for(const n of window.QuickRecords.snapshot().state.records.filter(n=>!n.trashedAt&&n.content.trim()))records.push({id:n.id,title:window.QuickRecordModel.title(n),text:n.content,at:n.updatedAt,open:()=>openTool('quick',{recordId:n.id})});
      const terms=query.toLowerCase().split(/[\s，,、]+/).filter(Boolean);
      const matches=records.map(n=>({...n,score:terms.reduce((score,t)=>score+(n.title.toLowerCase().includes(t)?3:0)+(n.text.toLowerCase().includes(t)?1:0),0)})).filter(n=>!terms.length||n.score>0).sort((a,b)=>b.score-a.score||b.at-a.at);
      const choose=async n=>{const r=await n.open();if(token!==epoch)return;if(r?.ok){library.hidden=true;taskComplete=true;remember('tool',`已打开笔记：${n.title}\n${n.text.slice(0,600)}`);say('已打开“'+n.title+'”，可以继续记录。');input.value='';pending=null;paintResult();persist();}else say('笔记未能打开，原内容没有改变。',true);return {ok:r?.ok===true,text:r?.ok?'已打开笔记：'+n.title:'笔记未能打开。'};};
      if(matches.length===1&&terms.length)return choose(matches[0]);
      reply(matches.length?'找到以下记录，点选后直接继续写。未记录完成状态的笔记不会被判断为已完成。':'没有找到匹配笔记。换一两个内容关键词试试，或说“打开一个新笔记”。');
      library.replaceChildren(node('h2','选择要继续的记录'));library.hidden=false;
      for(const n of matches.slice(0,8)){const b=button('',()=>void choose(n),'entry-record');b.append(node('strong',n.title),node('small',n.text.slice(0,120)));library.append(b);}
    }
    async function focusNamedWindow(query){
      const token=epoch,r=await api.listWindows();if(token!==epoch)return;
      if(r.error){reply('暂时无法读取窗口。请在设置中检查辅助功能权限，再重新检测；已有窗口没有改变。');return {ok:false};}
      const aliases={'微信':'wechat','飞书':'lark','谷歌浏览器':'chrome','苹果浏览器':'safari'};const q=query.toLowerCase();
      const matches=r.items.filter(w=>q&&[w.appName,w.title].some(v=>String(v).toLowerCase().includes(q)||(aliases[q]&&String(v).toLowerCase().includes(aliases[q]))));
      const choose=async w=>{const ok=await api.focusWindow(w.id);if(token!==epoch)return;taskComplete=!!ok;reply(ok?'已切回 '+w.appName+' · '+w.title:'窗口已变化或聚焦失败，请重新扫描。');return {ok:!!ok};};
      if(matches.length===1)return choose(matches[0]);
      reply(matches.length?'找到多个窗口，选择要切回的一个。':'没有找到已打开的“'+query+'”窗口。可先打开应用，或从当前窗口工具重新扫描。');
      library.replaceChildren();library.hidden=!matches.length;
      for(const w of matches.slice(0,10))library.append(button(w.appName+' · '+w.title,()=>void choose(w),'entry-record'));
    }
    async function storeInput(text,forceNote=false){
      const target=forceNote||attachments.length?{kind:'note',text:M.documentText(text,attachments)}:M.storageTarget(text,window.NotchDomain.normalizeHttpUrl);
      if(target.kind==='note'){saveNote(target.text);saved('已储存为一条随手记。');}
      else{
        const previous=window.LinkLibraryHost.snapshot().groups.flatMap(g=>g.links||[]).find(l=>l.url===target.url);
        if(previous){savedRoute={tool:'links'};say('这个链接已经收藏，原备注未被覆盖。可查看收藏，或修改输入另存为随手记。');viewSaved.hidden=false;return;}
        const r=window.LinkLibraryHost.add(target.url,'',{note:target.note,strict:true,quiet:true});if(!r)throw Error('save_failed');savedRoute={tool:'links'};saved('链接已收藏；预览信息稍后补全，不影响保存。');
      }
    }
    function references(){
      if(!history.checked)return [];
      const notes=window.QuickRecords.snapshot().state.records.filter(n=>!n.trashedAt&&n.content.trim()).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,5).map(n=>({title:window.QuickRecordModel.title(n),text:n.content.slice(0,2000)}));
      for(const n of window.Notebook.references().notes.slice(0,3)){const full=window.Notebook.get(n.id);if(full)notes.push({title:n.title.slice(0,200),text:full.content.slice(0,2000)});}
      return notes;
    }
    async function submit(mode,fromVoice=false){
      if(busy||voiceId)return;
      if(draftBroken){say('本地草稿读取异常，尚未覆盖旧内容。请先复制当前输入并备份数据。',true);return;}
      const text=input.value;if(!text.trim()&&!attachments.length){say('先写一点内容，或添加参考材料。');input.focus();return;}
      if(!persist())return;viewSaved.hidden=true;desktopSequence=0;setBusy(true);const token=++epoch;
      try{
        if(mode==='store'){await storeInput(text);return;}
        if(/^(取消|新任务|完成|新一轮|重新开始)[。！!\s]*$/.test(text.trim())){await cancelRound();return;}
        const previousConversation=conversation.map(v=>({...v}));
        if(conversation.at(-1)?.role!=='user'||conversation.at(-1)?.text!==text)remember('user',text);
        const routed=window.AssistantCapabilities.route(text,{attachments});if(routed){
          if(routed.proposal.kind==='actions')await executeBatch(routed.proposal);else await executeAction(routed.proposal);
          return;
        }
        if(pending?.proposal.kind==='plan'&&/^(确认|确认安排|就这样安排)[。！!\s]*$/.test(text.trim())){setBusy(false);await confirm({disabled:false});return;}
        const local=M.localInstruction(text);if(local&&!attachments.length){await storeInput(local.text,true);return;}
        const settings=await refreshSettings();if(!settings?.aiEnabled)throw Error('ai_disabled');
        say('正在理解你的目的… 可以停止，原文不会丢失。');cancel.hidden=false;
        const response=await api.assistantGenerate({text:text.trim()||'根据附件整理重点',attachments,useHistory:history.checked,references:references(),previousDraft:M.draftText(pending?.proposal),previousProposal:pending?.proposal,conversation:previousConversation,contextPlanIds});
        if(token!==epoch)return;
        if(!response.ok)throw Error(response.error);
        if(response.proposal.kind==='action'){await executeAction(response.proposal);return;}
        if(response.proposal.kind==='actions'){await executeBatch(response.proposal);return;}
        source=M.documentText(conversation.filter(v=>v.role==='user').map(v=>v.text).join('\n'),attachments);pending={...response,source,requestId:crypto.randomUUID()};
        remember('assistant',M.draftText(response.proposal));
        if(!persist())return;
        if(response.proposal.kind==='meeting'){
          paintResult();archive('已生成会前草稿');
          if(meetingDraft){
            const original=window.Notebook.get(meetingDraft.id);
            if(!original||window.NotebookModel.version(original)!==meetingDraft.revision){say('会议笔记已有手动修改，未覆盖。新草稿保留在这里，可复制需要的部分。',true);return;}
            const next={...original,meeting:{...original.meeting,freeText:response.proposal.text,mode:'free'}};
            const saved=window.Notebook.save(next,meetingDraft.revision);if(!saved?.ok)throw Error(saved?.error||'save_failed');meetingDraft.revision=window.NotebookModel.version(saved.note);
            await openTool('notes',{kind:'note',id:meetingDraft.id});
          }else{
            const opened=await openTool('meeting',{content:response.proposal.text});if(!opened?.ok)throw Error(opened?.error||'save_failed');
            const note=window.Notebook.get(opened.noteId);meetingDraft={id:note.id,revision:window.NotebookModel.version(note)};
          }
          remember('tool','会前草稿已保存并打开，可以继续补充同一任务。');receipts=[{ok:true,tool:'notes',text:'会前草稿已打开，可直接补充。'}];publishReceipts();paintResult();persist();return;
        }
        if(fromVoice&&response.proposal.kind==='note'){setBusy(false);await confirm({disabled:false});return;}
        paintResult();archive('已生成');lastAnswer=M.draftText(response.proposal);say(response.proposal.kind==='reply'?'已回答。':'草稿已准备好，可直接修改；确认后才保存。');result.scrollIntoView({block:'start'});
      }catch(e){if(token===epoch)say(errors[e.message]||errors.request_failed,true);}
      finally{if(token===epoch){setBusy(false);persist();}}
    }
    function paintResult(){
      result.querySelectorAll('[data-entry-overflow]').forEach(e=>e.remove());
      document.querySelectorAll('.entry-result-menu').forEach(e=>e.remove());
      result.replaceChildren();result.hidden=!pending;nav.children[1].hidden=!!pending;shell.dataset.resultOnly=String(!!pending);if(!pending)return;
      const p=pending.proposal,heading=node('h2',({note:'想法草稿',meeting:'讨论草稿',plan:'建议安排',reply:'结果'})[p.kind]);
      shell.dataset.resultOnly='true';
      result.append(heading);
      if(p.kind==='plan'){
        const list=node('div',null,'entry-plan-list'),columns=node('div',null,'entry-plan-head');columns.append(node('span','事项'),node('span','日期'),node('span','时间'));list.append(columns);result.append(list);
        for(const [i,c] of p.changes.entries()){
          const item=node('details',null,'entry-plan-item'),summary=node('summary',null,'entry-plan-summary');
          const summaryTitle=node('span'),summaryDate=node('span'),summaryTime=node('span');summary.append(summaryTitle,summaryDate,summaryTime);item.append(summary);
          const stamp=t=>new Date(t).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
          const refreshSummary=()=>{summaryTitle.textContent=c.title||'未命名事项';const day=c.scheduled===false?c.date:window.PlannerModel.local(c.start).slice(0,10);summaryDate.textContent=(day||'未定日期').replaceAll('-','/');summaryTime.textContent=c.scheduled===false?'未定时间':stamp(c.start)+'–'+stamp(c.end);};
          const row=node('div',null,'entry-plan-row');
          const titleLabel=node('label',c.mode==='update'?'更新事项':'事项'),title=node('input');title.value=c.title;title.maxLength=200;titleLabel.append(title);title.oninput=()=>{c.title=title.value;refreshSummary();persist();};
          const dateLabel=node('label',c.scheduled===false?'日期':'开始'),date=node('input');date.type=c.scheduled===false?'date':'datetime-local';date.value=c.scheduled===false?c.date:window.PlannerModel.local(c.start);dateLabel.append(date);date.oninput=()=>{if(c.scheduled===false)c.date=date.value;else c.start=new Date(date.value).getTime();refreshSummary();persist();};
          row.append(titleLabel,dateLabel);
          if(c.scheduled!==false){const endLabel=node('label','结束'),end=node('input');end.type='datetime-local';end.value=window.PlannerModel.local(c.end);end.oninput=()=>{c.end=new Date(end.value).getTime();refreshSummary();persist();};endLabel.append(end);row.append(endLabel);}
          row.append(node('p',`${window.PlannerModel.labels[c.status]}${c.next?' · 下一步：'+c.next:''}`,'entry-policy'));item.append(row);list.append(item);refreshSummary();
        }
        if(!p.changes.length)result.append(node('p','还没有需要写入的事项。可以在上面继续补充。','entry-policy'));
      }else if(p.kind==='reply'){
        result.append(node('div',p.text,'entry-answer'));
      }else{
        const draft=node('textarea');draft.value=p.text;draft.rows=6;draft.maxLength=12000;draft.setAttribute('aria-label','修改生成内容');draft.oninput=()=>{p.text=draft.value;persist();};result.append(draft);
      }
      const controls=node('div',null,'entry-result-actions');
      const conflicts=receipts.filter(row=>row.replace);
      if(!conflicts.length)controls.append(button('继续补充',()=>{input.value='';changed();input.focus();shell.scrollIntoView({block:'start'});},'entry-subtle'));
      for(const row of conflicts){const replace=button('替换',()=>void replaceTimer(row,replace),'entry-command');replace.title='结束原计时并开始新计时';controls.append(button('保留',()=>{delete row.replace;row.text='已保留原计时，没有启动新的倒计时。';publishReceipts();reply(receipts.map(r=>r.text).join('\n'));},'entry-subtle'),replace);}
      if(!conflicts.length){
        if(p.kind!=='reply'&&(p.kind!=='plan'||p.changes.length)){const accept=button(p.kind==='plan'?'确认安排':p.kind==='meeting'&&meetingDraft?'打开会议笔记':'保存到笔记',()=>void confirm(accept),'entry-command');accept.id='entry-confirm';controls.append(accept);}
        controls.append(button('取消',()=>void cancelRound(),'entry-subtle'));
        const more=button('⋯',()=>{},'entry-subtle entry-more'),overflow=node('div',null,'entry-result-menu');more.setAttribute('aria-label','更多结果操作');
        if(p.kind==='reply'){const accept=button('保存到笔记',()=>void confirm(accept));accept.id='entry-confirm';overflow.append(accept);}
        if(p.kind==='plan'&&(p.reply||(p.notes||[]).length)){const context=node('details'),caption=node('summary','安排说明');context.append(caption,node('p',[p.reply,...p.notes||[]].filter(Boolean).join('\n')));overflow.append(context);}
        overflow.append(button('复制内容',()=>void copyText(M.draftText(p))),button('存为图片',()=>void saveResultImage()),button('历史记录',showHistory));menu(more,overflow);controls.append(more);
      }
      result.append(controls);
    }
    async function confirm(accept){
      if(busy||!pending)return;accept.disabled=true;setBusy(true);
      try{
        const p=pending.proposal;
        if(p.kind==='meeting'&&meetingDraft){await openTool('notes',{kind:'note',id:meetingDraft.id});return;}
        if(p.kind==='plan'){
          const r=await api.plannerCommand({action:'apply',revision:pending.revision,requestId:pending.requestId,changes:p.changes,source:pending.source.slice(0,8000),aiProposal:true});
          if(!r.ok)throw Error(r.error);savedRoute={tool:'todo'};saved(r.state.reminders?'安排已保存；有具体时段的事项会按现有设置提醒。':'安排已保存；当前到点提醒关闭，可在待办中开启。');
        }else{if(!p.text.trim())throw Error('invalid_input');saveNote(`${p.text}\n\n—— 原始输入 ——\n${pending.source}`,pending.requestId);saved('整理内容与原始输入已一起保存为随手记。');}
      }catch(e){say(errors[e.message]||errors.save_failed,true);accept.disabled=false;}
      finally{setBusy(false);persist();}
    }
    async function openSaved(){if(savedRoute)await openTool(savedRoute.tool,{recordId:savedRoute.recordId});}
    async function showRecords(){
      library.hidden=!library.hidden;find.setAttribute('aria-expanded',String(!library.hidden));if(library.hidden)return;
      library.replaceChildren();const search=node('input');search.type='search';search.placeholder='搜索已保存的内容';search.setAttribute('aria-label','搜索记录');const rows=node('div');library.append(search,rows);
      const plans=await api.plannerGet();
      const draw=()=>{try{
        const records=window.QuickRecords.snapshot().state.records.filter(n=>!n.trashedAt&&n.content.trim()).map(n=>({title:window.QuickRecordModel.title(n),text:n.content,at:n.updatedAt,type:'随手记',open:()=>openTool('quick',{recordId:n.id})}));
        for(const n of window.Notebook.references().notes){const note=window.Notebook.get(n.id);if(note)records.push({title:n.title,text:note.content,at:note.updatedAt,type:'笔记',open:()=>window.ToolLauncher.openPayload({kind:'note',id:n.id})});}
        for(const l of window.LinkLibraryHost.snapshot().groups.flatMap(g=>g.links||[]))records.push({title:l.title==='未命名'?l.url:l.title,text:l.url+' '+(l.note||''),at:l.createdAt,type:'链接',open:()=>openTool('links')});
        for(const p of plans.state?.items||[])records.push({title:p.title,text:[p.date||window.PlannerModel.day(p.start),p.progress,p.next,p.body].filter(Boolean).join(' · '),at:p.start||new Date(p.date).getTime(),type:`待办 · ${window.PlannerModel.labels[p.status]}`,open:async()=>{await openTool('todo');await window.PanelPlanner.view.reveal(p.id);}});
        const query=search.value.trim().toLowerCase();const matches=records.filter(r=>!query||(r.title+' '+r.text).toLowerCase().includes(query)).sort((a,b)=>(b.at||0)-(a.at||0));rows.replaceChildren();
        if(!matches.length)rows.append(node('p',query?'没有找到匹配记录。':'还没有记录，先储存一条试试。','entry-policy'));
        for(const r of matches.slice(0,12)){const b=button('',()=>void r.open(),'entry-record');b.append(node('strong',r.title),node('small',`${r.type} · ${r.text.slice(0,90)}`));rows.append(b);}
        if(matches.length>12)rows.append(node('p',`显示前 12 条，共 ${matches.length} 条匹配；可以继续缩小关键词。`,'entry-policy'));
      }catch{say(errors.storage_failed,true);}};
      search.oninput=draw;draw();search.focus();
    }
    async function voice(kind='short'){
      if(busy){say('正在整理上一条，完成后再说；也可以先停止整理。');return;}
      if(voiceStarting||voiceStopping)return;speak.disabled=true;
      try{
        if(!voiceId){
          if(!persist()||!archive())return;
          if(taskComplete){epoch++;clearRound();}
          receipts=[];publishReceipts();
          if(pending)lastAnswer=M.draftText(pending.proposal);
          input.value='';requestId=crypto.randomUUID();library.hidden=true;persist();voiceCancelled=false;
          voiceStarting=true;setBusy(false);voiceKind=kind==='long'?'long':'short';voiceMode=kind==='short'?'command':entryMode;
          if(kind==='short')selectMode('command');
          say('正在打开麦克风…');
          const r=await recording().command(kind==='long'?'assistant-record':'assistant-start');
          if(!r?.ok)throw Error(r?.error||'microphone_unavailable');
          voiceId=r.recordingId;voiceStopping=false;speak.textContent='结束';
          if(voiceCancelled){await recording().command('assistant-stop',voiceId);voiceStopping=true;}
          say(kind==='long'?'正在持续录音，松手不会结束；再按一次结束并保存。':'正在听指令；再按一次结束，我会直接处理。');
        }
        else{const r=await recording().command(voiceRecovery?'assistant-retry':'assistant-stop',voiceId);if(!r?.ok)throw Error(r?.error||'save_failed');voiceStopping=true;speak.textContent='保存中…';}
        setBusy(false);
      }catch(e){say(errors[e.message]||'无法开始口述，请从录音工具检查麦克风和转写配置。',true);}
      finally{voiceStarting=false;setBusy(false);speak.disabled=voiceStopping;}
    }
    const timer=setInterval(async()=>{if(polling||!voiceId)return;polling=true;try{
      const v=await recording().command('assistant-status',voiceId);if(!v?.ok){say('本次录音状态已变化，请到录音工具查看；未操作其他录音。',true);voiceId='';voiceStopping=false;speak.disabled=false;setBusy(false);return;}
      if(v.finished&&v.recordingId===voiceId){
        const text=v.savedText||'',kind=voiceKind;voiceId='';voiceStopping=false;voiceRecovery=false;speak.disabled=false;speak.textContent='口述';setBusy(false);
        if(voiceCancelled){input.value=text;archive('录入已取消');clearRound();say('已取消指令，原音频与转写保留在录音工具。');return;}
        if(kind==='long'){say('录音已保存，可在录音工具查看原音频、转写与整理结果。');savedRoute={tool:'recorder'};viewSaved.hidden=false;return;}
        if(!window.TranscriptionModel.actionable(text)){input.value='';say('没有识别到有效指令，未执行任何任务。原音频已保留。');return;}
        if(v.transcriptionComplete===false){input.value=text;changed();say('转写未完整结束，或当前是系统备用转写，未自动执行。原音频与文字已保存；请核对文字后发送，或在设置中检查 Qwen 配置。',true);return;}
        input.value=text;
        changed();await submit(voiceMode,true);
      }
      else if(v.status==='save-failed'){voiceStopping=false;voiceRecovery=true;speak.disabled=false;speak.textContent='重试保存口述';say('音频尚未保存，请重试保存或到录音工具恢复；不要强退应用。',true);}
      else if(v.transcript&&!window.TranscriptionModel.contaminated(v.transcript)){input.value=v.transcript;status.textContent=`正在听 · ${v.transcriptionProvider||'转写中'}${v.microphone?' · '+v.microphone:''}`;}
    }catch{say('暂时无法读取口述状态，请去录音工具查看。',true);}finally{polling=false;}},400);
    try{const raw=localStorage.getItem(M.KEY);if(raw){const d=JSON.parse(raw);if(typeof d.text!=='string'||!Array.isArray(d.attachments))throw Error();input.value=d.text;attachments=d.attachments;pending=d.pending||null;source=d.source||'';requestId=d.requestId||crypto.randomUUID();entryMode=d.entryMode==='store'?'store':'command';history.checked=d.useHistory===true;paintFiles();paintResult();if(d.busy)say('上次处理被中断，原文和已有草稿已恢复。',true);}}
    catch{draftBroken=true;say('本地草稿读取异常，未覆盖旧内容。请先备份应用数据。',true);}
    try{const d=JSON.parse(localStorage.getItem(M.KEY)||'{}');if(Array.isArray(d.conversation))for(const v of d.conversation.slice(-12))if(v&&['user','assistant','tool'].includes(v.role)&&typeof v.text==='string')remember(v.role,v.text);if(conversation.length){contextPlanIds=(Array.isArray(d.contextPlanIds)?d.contextPlanIds:[]).filter(id=>typeof id==='string'&&id.length<=180).slice(-60);if(typeof d.meetingDraft?.id==='string'&&typeof d.meetingDraft?.revision==='string')meetingDraft=d.meetingDraft;}}catch{}
    paintTask();void refreshSettings();
    selectMode(entryMode);
    setBusy(false);
    window.addEventListener('beforeunload',e=>{if(voiceId||!persist()){e.preventDefault();e.returnValue=false;}});
    return {focus:()=>input.focus(),submit,hotkey:voice,refreshSettings,settings:options,showHistory,showRecords,resetHome,newConversation:cancelRound,get busy(){return busy;},get pending(){return pending;},flush(){if(!persist())throw Error('storage_failed');},destroy(){clearInterval(timer);unsubscribeDesktop?.();epoch++;void api.assistantCancel();modes.remove();toolMenu.remove();}};
  }
  window.AssistantEntry={mount};
})();
