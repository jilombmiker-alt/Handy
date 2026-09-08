(() => {
  'use strict';
  const M=window.ClipboardModel;
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const errors={occupied:'这个快捷键已被占用，原快捷键仍保留。',invalid_shortcut:'请用组合键（如 Option＋V）或 F1–F24。',save_failed:'设置未能保存，原快捷键仍保留。',storage_failed:'本机保存失败，内容已保留在编辑框，请勿退出。',conflict:'这条内容已发生变化，请先取消编辑再重新打开。',name_required:'给片段起一个简短名字（最多 80 字）。',invalid_text:'请输入正文，最多 10 万字。',missing_file:'原文件已移动或删除，无法复制。',invalid_or_duplicate_link:'链接无效，或者已经收藏过了。',not_found:'这条记录已被删除，请重新选择。',unsupported:'这类内容暂不支持该操作。',host_unavailable:'主面板暂未响应，请稍后重试。',feature_disabled:'请先在面板设置中启用剪贴板。',copy_failed:'复制失败，请重试。',busy:'正在处理上一条，请稍等。',snippet_limit:'已保存 200 个场景片段，请先整理旧片段。'};
  class QuickClipboardView{
    constructor(root,api){
      this.root=root;this.api=api;this.data={history:[],snippets:[]};this.selected='';this.mode='all';this.busy=false;this.requestVersion=0;this.editing=false;this.dirty=false;this.images=new Map();
      root.classList.add('qc');
      const head=node('header',null,'qc-head');head.append(node('strong','剪贴板'));this.shortcut=node('button','⌥ V','qc-shortcut');this.shortcut.type='button';this.shortcut.title='修改唤出快捷键';this.shortcut.onclick=()=>{this.settings.open=!this.settings.open;};head.append(this.shortcut);
      if(api.main){if(!window.notchAPI?.launcherLayout)head.append(this.button('独立打开',()=>api.open()));}else head.append(this.button('关闭',()=>this.close(),'qc-close'));
      this.search=node('input',null,'qc-search');Object.assign(this.search,{type:'search',placeholder:'搜索刚复制的内容，或场景片段…',autocomplete:'off'});this.search.setAttribute('aria-label','搜索剪贴内容');this.search.setAttribute('role','combobox');this.search.setAttribute('aria-controls','qc-results');this.search.setAttribute('aria-expanded','true');this.search.setAttribute('aria-autocomplete','list');
      this.search.oninput=()=>{this.selected='';this.draw();};this.search.onkeydown=e=>this.keydown(e);
      const tabs=node('nav',null,'qc-tabs');tabs.setAttribute('aria-label','剪贴记录范围');this.tabs=[];
      for(const [value,label] of [['all','全部'],['history','最近复制'],['snippets','场景片段']]){const b=this.button(label,()=>{this.mode=value;this.selected='';this.draw();this.search.focus();});b.dataset.mode=value;this.tabs.push(b);tabs.append(b);}
      this.count=node('span','','qc-count');tabs.append(this.count);
      this.list=node('div',null,'qc-list');this.list.id='qc-results';this.list.setAttribute('role','listbox');this.list.setAttribute('aria-label','可复用内容');
      this.actions=node('details',null,'qc-actions');this.actions.append(node('summary','更多操作'));this.actionButtons=node('div',null,'qc-action-buttons');this.actions.append(this.actionButtons);
      this.editor=node('form',null,'qc-editor');this.editor.hidden=true;this.editor.onsubmit=e=>{e.preventDefault();void this.saveEditor();};
      this.settings=node('details',null,'qc-settings');this.settings.append(node('summary','快捷键与采集设置'));
      const prefs=node('div',null,'qc-prefs'),label=node('label','唤出快捷键');this.keyInput=node('input');this.keyInput.readOnly=true;this.keyInput.placeholder='点这里，按下新组合键';this.keyInput.setAttribute('aria-label','录入新的剪贴板快捷键');
      this.keyInput.onkeydown=e=>{if(e.key==='Tab')return;e.preventDefault();e.stopPropagation();if(e.key==='Escape'){this.keyInput.blur();return;}const key=M.fromKey(e);if(key){this.pendingKey=key;this.keyInput.value=M.label(key);}else if(!['Meta','Alt','Shift','Control'].includes(e.key))this.say(errors.invalid_shortcut);};label.append(this.keyInput);
      prefs.append(label,this.button('保存快捷键',()=>this.configure({shortcut:this.pendingKey||this.settingsData.shortcut})),this.button('恢复 Option＋V',()=>this.configure({shortcut:M.DEFAULT_SHORTCUT})));
      this.pause=this.button('暂停采集',()=>this.configure({paused:!this.settingsData.paused}));prefs.append(this.pause,this.button('新建场景片段',()=>this.edit(null)),this.button('清空最近复制',()=>this.confirmClear()));
      prefs.append(this.button('辅助功能设置',()=>this.request({action:'permissions'})));
      prefs.append(node('p','只在本机保存，最多保留 100 条。场景片段单独保留；暂停不会删除已有内容。'));this.settings.append(prefs);
      this.confirmation=node('div',null,'qc-confirm');this.confirmation.hidden=true;
      this.status=node('p','','qc-status');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
      this.noteOpen=this.button('打开刚存的笔记',async()=>{if(this.busy||!this.savedNoteId)return;this.busy=true;this.noteOpen.disabled=true;try{const r=await this.request({action:'openNote',values:{noteId:this.savedNoteId}});this.say(r?.ok?'已打开笔记小窗。':r?.error==='not_found'?'这篇笔记已不存在；原剪贴内容仍保留。':'暂未打开，请先保存其他编辑后重试。');}finally{this.busy=false;this.noteOpen.disabled=false;}},'qc-open-note');this.noteOpen.hidden=true;
      this.footer=node('footer','↑ ↓ 选择　↵ 粘贴　⌘ ↵ 仅复制　Esc 关闭','qc-footer');
      root.append(head,this.search,tabs,this.list,this.actions,this.editor,this.confirmation,this.settings,this.status,this.noteOpen,this.footer);
      root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&e.target!==this.search&&!e.defaultPrevented){e.preventDefault();void this.close();}});
      window.addEventListener('beforeunload',e=>{if(this.dirty){e.preventDefault();e.returnValue=false;}});
    }
    button(text,fn,cls){const b=node('button',text,cls);b.type='button';b.onclick=()=>{Promise.resolve().then(fn).catch(()=>this.say('操作未完成，请重试。'));};return b;}
    say(text){this.status.textContent=text;}
    async request(input){try{return await this.api.request(input);}catch{return {ok:false,error:'host_unavailable'};}}
    async refresh(){
      const version=++this.requestVersion,result=await this.request({action:'get'});if(version!==this.requestVersion)return;
      if(!result.ok){this.say(errors[result.error]||'暂时无法读取');return;}
      this.data=result;this.settingsData=result.settings;this.shortcut.textContent=M.label(result.settings.shortcut);this.shortcut.title='点击修改唤出快捷键';
      if(!this.pendingKey)this.keyInput.value=M.label(result.settings.shortcut);
      this.pause.textContent=result.settings.paused?'恢复采集':'暂停采集';document.documentElement.dataset.theme=result.theme==='obsidian'?'obsidian':'white';
      if(result.settings.error)this.say(errors[result.settings.error]);else if(result.storageError)this.say('场景片段读取失败，原数据未覆盖。请先备份本机数据。');
      this.draw();
    }
    rows(){return M.rows(this.data.history,this.data.snippets,this.search.value,this.mode);}
    draw(){
      const rows=this.rows();if(!rows.some(v=>v.key===this.selected))this.selected=rows[0]?.key||'';
      this.tabs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===this.mode)));this.count.textContent=`${rows.length} 条`;
      this.list.replaceChildren();
      if(!rows.length)this.list.append(node('p',this.search.value?'没有找到，试试更短的关键词。':this.mode==='snippets'?'把整段 SOP 或固定回复存为场景片段，下次直接搜索名字。':'复制一点文字、图片或文件，它就会出现在这里。','qc-empty'));
      rows.forEach((row,index)=>{
        const item=node('div',null,'qc-row');item.id='qc-option-'+index;item.setAttribute('role','option');item.setAttribute('aria-selected',String(row.key===this.selected));item.dataset.key=row.key;
        const mark=node('span',row.type==='image'?'图':row.type==='file'?'件':row.type==='url'?'↗':row.source==='snippet'?'存':'文','qc-mark');
        if(row.type==='image'&&row.imagePath){const img=node('img');img.alt='';img.width=40;img.height=34;mark.replaceChildren(img);if(this.images.has(row.imagePath))img.src=this.images.get(row.imagePath);else this.api.image(row.imagePath).then(src=>{if(src){this.images.set(row.imagePath,src);if(img.isConnected)img.src=src;}}).catch(()=>{});}
        const content=node('div',null,'qc-content');const title=row.name||(row.type==='image'?'剪贴图片':row.type==='file'?row.fileNames.join('、'):row.text)||'空内容';content.append(node('strong',title.slice(0,180)),node('span',row.source==='snippet'?(row.type==='file'?'原文件引用':row.text?.slice(0,160)||'整段复用'):row.type==='file'?'文件引用 · 原文件移动后可能失效':row.type==='image'?'原图保留':new Date(row.timestamp).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})));
        item.append(mark,content,node('span',row.key===this.selected?'↵':'','qc-enter'));item.onclick=()=>{this.selected=row.key;this.draw();void this.use('paste');};this.list.append(item);
        if(row.key===this.selected)this.search.setAttribute('aria-activedescendant',item.id);
      });
      if(!this.selected)this.search.removeAttribute('aria-activedescendant');
      this.actionButtons.replaceChildren();const selected=rows.find(v=>v.key===this.selected);
      if(selected){if(selected.text)this.actionButtons.append(node('pre',selected.text,'qc-preview'));this.actionButtons.append(this.button('仅复制',()=>this.use('copy')));if(selected.type!=='image')this.actionButtons.append(this.button(selected.source==='snippet'?'编辑片段':'存为场景片段',()=>this.edit(selected)));
        if(selected.text)this.actionButtons.append(this.button('转存笔记',()=>this.use('note')));if(selected.type==='url')this.actionButtons.append(this.button('收藏链接',()=>this.use('link')));if(selected.type==='file')this.actionButtons.append(this.button('在 Finder 中查看',()=>this.use('openFile')));
        this.actionButtons.append(this.button('删除这一条',()=>this.confirm('删除这条记录？不影响原文件或其他笔记。',()=>this.mutate({action:selected.source==='snippet'?'deleteSnippet':'deleteHistory',key:selected.key,values:{confirmed:true,revision:selected.timestamp}}))));}
    }
    keydown(e){
      if(e.isComposing||e.keyCode===229||e.repeat)return;
      if(e.key==='Escape'){e.preventDefault();void this.close();return;}
      if(e.altKey||e.ctrlKey||e.shiftKey)return;
      const rows=this.rows(),index=rows.findIndex(v=>v.key===this.selected);
      if(['ArrowDown','ArrowUp'].includes(e.key)&&!e.metaKey){e.preventDefault();this.selected=rows[Math.max(0,Math.min(rows.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.key||'';this.draw();this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});}
      else if(e.key==='Enter'){e.preventDefault();void this.use(e.metaKey?'copy':'paste');}
    }
    async use(action){
      if(this.busy||this.editing||!this.selected)return;this.busy=true;
      const result=await this.request({action,key:this.selected});this.busy=false;
      if(!result.ok)return this.say(errors[result.error]||'操作未完成，请重试。');
      if(action==='note'){this.savedNoteId=result.noteId;this.noteOpen.hidden=false;this.say(result.reused?'已找回之前转存的笔记，没有重复创建。':'已存入笔记，原记录保留。');return;}
      this.say(result.pasted?'已向原输入框发送粘贴指令。':action==='paste'?'已复制。无法确认原输入位置，请回到输入框按 ⌘V。':action==='note'?'已存入笔记，原记录保留。':action==='link'?'已收藏链接。':action==='openFile'?'已在 Finder 中定位原文件。':'已复制，可按 ⌘V 粘贴。');
    }
    async configure(changes){const result=await this.request({action:'settings',changes});if(!result.ok)return this.say(errors[result.error]||'设置未保存。');this.pendingKey=null;this.say(changes.shortcut?'快捷键已更新。':changes.paused?'已暂停采集。':'已恢复采集。');await this.refresh();}
    edit(entry){
      if(this.editing)return;this.editing=true;this.dirty=false;this.editEntry=entry;this.list.hidden=this.actions.hidden=true;this.editor.hidden=false;this.editor.replaceChildren(node('strong',entry?.source==='snippet'?'编辑场景片段':'保存整段场景片段'));
      const nameLabel=node('label','片段名称');this.name=node('input');this.name.maxLength=80;this.name.value=entry?.name||'';this.name.required=true;nameLabel.append(this.name);
      const textLabel=node('label',entry?.type==='file'?'原文件（保留引用，不读取正文）':'正文（保留原样，一次复用）');this.text=node('textarea');this.text.maxLength=100000;this.text.value=entry?.type==='file'?entry.fileNames.join('\n'):entry?.text||'';this.text.readOnly=entry?.type==='file';textLabel.append(this.text);
      this.name.oninput=this.text.oninput=()=>{this.dirty=true;};const save=node('button','保存片段');save.type='submit';this.editor.append(nameLabel,textLabel,save,this.button('取消',()=>this.cancelEditor()));this.name.focus();
    }
    async saveEditor(){if(this.busy)return;this.busy=true;const result=await this.request({action:'saveSnippet',key:this.editEntry?.key,values:{name:this.name.value,text:this.text.value,revision:this.editEntry?.timestamp}});this.busy=false;
      if(!result.ok)return this.say(errors[result.error]||'保存失败，请重试。');this.endEditor();this.say('已保存，下次搜索名字即可整段复用。');await this.refresh();}
    endEditor(){this.editing=this.dirty=false;this.editor.hidden=true;this.list.hidden=this.actions.hidden=false;this.search.focus();}
    cancelEditor(){if(this.dirty)this.confirm('放弃这次尚未保存的修改？',()=>this.endEditor());else this.endEditor();}
    confirm(text,fn){this.confirmation.hidden=false;this.confirmation.replaceChildren(node('p',text),this.button('确认',async()=>{this.confirmation.hidden=true;await fn();}),this.button('取消',()=>{this.confirmation.hidden=true;this.search.focus();}));this.confirmation.querySelector('button')?.focus();}
    confirmClear(){const ids=this.data.history.map(v=>v.id);if(!ids.length)return this.say('目前没有临时历史。');this.confirm(`清空当前 ${ids.length} 条历史？场景片段仍保留。`,()=>this.mutate({action:'clearHistory',values:{confirmed:true,ids}}));}
    async mutate(input){const result=await this.request(input);if(!result.ok)this.say(errors[result.error]||'操作未完成。');else{this.say('已处理。');await this.refresh();}}
    async close(){if(this.busy)return;if(this.dirty)return this.confirm('关闭会放弃未保存的片段修改，是否继续？',async()=>{this.endEditor();if(!this.api.main)await this.request({action:'close'});});if(this.editing){this.endEditor();return;}if(!this.api.main)await this.request({action:'close'});else this.search.blur();}
    focus(){if(!this.editing){this.search.value='';this.selected='';this.search.focus();}void this.refresh();}
    quit(){const exit=()=>this.request({action:'quit-ready'});if(this.busy){this.say('正在保存，请稍后再退出。');return;}if(this.dirty)this.confirm('退出会放弃未保存的片段修改，是否继续？',()=>{this.endEditor();return exit();});else void exit();}
    disabled(){this.say('剪贴板已关闭，采集和全局快捷键均已停止。');}
  }
  window.QuickClipboardView=QuickClipboardView;
})();
