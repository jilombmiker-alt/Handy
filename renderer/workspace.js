(function initWorkspace() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const COMMANDS_KEY = 'notch-home-commands';
  const LINKS_KEY = 'notch-link-groups';
  const RECORDINGS_KEY = 'notch-recordings';
  const HIDDEN_WINDOWS_KEY = 'notch-hidden-windows';

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/></svg>';
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  // ============ 常用指令 ============
  const commandInput = document.getElementById('command-add');
  const commandList = document.getElementById('command-list');
  const commandBulkDelete = document.getElementById('command-bulk-delete');
  let commands = loadJson(COMMANDS_KEY, [])
    .map((item) => Domain.createCommand(item && item.text, item && item.id, item && item.createdAt))
    .filter(Boolean);
  let commandSelection = new Set();
  let commandSelectionAnchor = null;

  function persistCommands() {
    saveJson(COMMANDS_KEY, commands);
  }

  function renderCommands() {
    if (!commandList) return;
    commandList.replaceChildren();
    if (commandBulkDelete) {
      commandBulkDelete.hidden = commandSelection.size === 0;
      commandBulkDelete.textContent = '删除';
      commandBulkDelete.setAttribute('aria-label', commandSelection.size
        ? `删除 ${commandSelection.size} 项`
        : '删除所选');
    }
    if (!commands.length) {
      const empty = document.createElement('div');
      empty.className = 'command-empty';
      empty.textContent = '把常用命令、提示词或回复模板放在这里';
      commandList.appendChild(empty);
      return;
    }
    commands.forEach((command) => {
      const row = document.createElement('div');
      row.className = `command-item${commandSelection.has(command.id) ? ' multi-selected' : ''}`;
      row.dataset.id = command.id;

      const textButton = document.createElement('button');
      textButton.className = 'command-text';
      textButton.type = 'button';
      textButton.dataset.action = 'edit-command';
      textButton.title = '点击修改';
      textButton.textContent = command.text;

      const actions = document.createElement('div');
      actions.className = 'command-actions';
      const copy = document.createElement('button');
      copy.className = 'icon-button';
      copy.type = 'button';
      copy.dataset.action = 'copy-command';
      copy.setAttribute('aria-label', '复制指令');
      copy.innerHTML = COPY_ICON;
      const remove = document.createElement('button');
      remove.className = 'icon-button danger';
      remove.type = 'button';
      remove.dataset.action = 'delete-command';
      remove.setAttribute('aria-label', '删除指令');
      remove.innerHTML = DELETE_ICON;
      actions.append(copy, remove);
      row.append(textButton, actions);
      commandList.appendChild(row);
    });
  }

  function editCommand(row) {
    const command = commands.find((item) => item.id === row.dataset.id);
    if (!command || row.querySelector('input')) return;
    const button = row.querySelector('.command-text');
    const input = document.createElement('input');
    input.className = 'command-edit';
    input.value = command.text;
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value) command.text = value;
      persistCommands();
      renderCommands();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) finish(true);
      if (event.key === 'Escape') finish(false);
    });
  }

  if (commandInput) {
    commandInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const command = Domain.createCommand(commandInput.value, uid('command'), Date.now());
      if (!command) return;
      commands.unshift(command);
      commandInput.value = '';
      persistCommands();
      renderCommands();
    });
  }

  if (commandList) {
    commandList.addEventListener('click', async (event) => {
      const row = event.target.closest('.command-item');
      if (!row) return;
      const command = commands.find((item) => item.id === row.dataset.id);
      if (!command) return;
      if (event.shiftKey) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          commands.map((item) => item.id),
          [...commandSelection],
          command.id,
          commandSelectionAnchor,
          true
        );
        commandSelection = new Set(result.selected);
        commandSelectionAnchor = result.anchor;
        renderCommands();
        return;
      }
      commandSelectionAnchor = command.id;
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'edit-command') editCommand(row);
      if (action.dataset.action === 'delete-command') {
        commands = commands.filter((item) => item.id !== command.id);
        commandSelection.delete(command.id);
        persistCommands();
        renderCommands();
      }
      if (action.dataset.action === 'copy-command' && window.notchAPI) {
        const copied = await window.notchAPI.writeClipboard({ type: 'text', text: command.text });
        if (copied) {
          row.classList.add('copied');
          setTimeout(() => row.classList.remove('copied'), 700);
        }
      }
    });
  }
  commandBulkDelete?.addEventListener('click', () => {
    if (!commandSelection.size) return;
    commands = commands.filter((command) => !commandSelection.has(command.id));
    commandSelection.clear();
    commandSelectionAnchor = null;
    persistCommands();
    renderCommands();
  });

  // ============ 链接收藏夹 ============
  const linkInput = document.getElementById('link-add');
  const linkBulkDelete = document.getElementById('link-bulk-delete');
  const linkGroupsEl = document.getElementById('link-groups');
  const linksStatus = document.getElementById('links-status');
  let linkGroups = loadJson(LINKS_KEY, []);
  if (!Array.isArray(linkGroups)) linkGroups = [];
  let linkSelection = new Set();
  let linkSelectionAnchor = null;
  let addingLinkGroupId = '';
  let libraryRevision=0,librarySignature='';
  let linkFloatDirty=false;
  window.notchAPI?.onFloatList?.(keys=>{if(!keys.includes('module:links'))linkFloatDirty=false;});
  function removeLibraryLinks(payload){
    if(window.LinkLibrary?.hasUnsaved||linkFloatDirty)return {ok:false,error:'unsaved_links'};
    if(payload.confirmed!==true)return {ok:false,error:'confirmation_required'};
    if(payload.revision!==librarySnapshot().revision)return {ok:false,error:'conflict'};
    const ids=new Set(payload.ids||[]),group=payload.groupId&&linkGroups.find(g=>g.id===payload.groupId);
    if(payload.groupId&&!group)return {ok:false,error:'not_found'};
    if(group)for(const item of group.links||[])ids.add(item.id);
    if(!group&&(!ids.size||[...ids].some(id=>!allLinks().some(item=>item.id===id))))return {ok:false,error:'not_found'};
    const next=linkGroups.filter(g=>g!==group).map(g=>({...g,links:(g.links||[]).filter(item=>!ids.has(item.id))}));
    try{localStorage.setItem(LINKS_KEY,JSON.stringify(next));}catch{return {ok:false,error:'save_failed'};}
    linkGroups=next;for(const id of ids)linkSelection.delete(id);linkSelectionAnchor=null;
    renderLinkGroups();window.LinkLibrary?.refreshNoteReferences();return {ok:true};
  }
  function askToRemoveLinks(payload,label){
    if(window.LinkLibrary?.hasUnsaved||linkFloatDirty){window.LinkLibrary?.notify('主面板或链接小窗有未保存内容，请先保存或放下编辑，再删除。',true);return;}
    const revision=librarySnapshot().revision;
    window.LinkLibrary?.confirmDelete(label,()=>removeLibraryLinks({...payload,revision,confirmed:true}));
  }
  function librarySnapshot(){const signature=JSON.stringify(linkGroups);if(signature!==librarySignature){librarySignature=signature;libraryRevision++;}return {ok:true,groups:JSON.parse(signature),revision:libraryRevision};}
  async function libraryCommand(payload){
    if(payload.action==='get')return librarySnapshot();
    if(payload.changes?.analysis&&!(await window.notchAPI?.linkSettings())?.aiEnabled)return {ok:false,error:'ai_disabled'};
    if(payload.revision!==librarySnapshot().revision)return {ok:false,error:'conflict'};
    try{let next;
      if(payload.action==='group'){const name=window.LinkLibraryModel.text(payload.name,40).trim();if(!name)throw Error('invalid_text');if(linkGroups.some(g=>g.id!==payload.id&&g.name===name))throw Error('duplicate_group');next=JSON.parse(JSON.stringify(linkGroups));if(payload.id){const group=next.find(g=>g.id===payload.id);if(!group)throw Error('not_found');group.name=name;}else next.push({id:uid('group'),name,collapsed:false,links:[]});}
      else if(payload.action==='patch'){if(payload.changes?.noteIds?.some(id=>!window.Notebook?.get(id)||window.Notebook.get(id).meeting))throw Error('not_found');next=window.LinkLibraryModel.patch(linkGroups,payload.id,payload.changes||{},payload.groupId);}
      else throw Error('invalid_action');
      localStorage.setItem(LINKS_KEY,JSON.stringify(next));linkGroups=next;renderLinkGroups();window.LinkLibrary?.refreshNoteReferences();return librarySnapshot();
    }catch(e){return {ok:false,error:['invalid_text','not_found','invalid_action','duplicate_group'].includes(e.message)?e.message:'save_failed'};}
  }
  async function refreshLinkPreview(id){
    const item=allLinks().find(row=>row.id===id);if(!item)return {ok:false,error:'not_found'};
    const inspected=await window.notchAPI.inspectLink(item.url);if(!inspected?.ok)return inspected;
    const next=JSON.parse(JSON.stringify(linkGroups)),current=next.flatMap(g=>g.links||[]).find(row=>row.id===id);if(!current)return {ok:false,error:'not_found'};
    Object.assign(current,{preview:inspected.preview||'',description:inspected.description||'',source:inspected.source||'metadata',warning:inspected.warning||''});
    try{localStorage.setItem(LINKS_KEY,JSON.stringify(next));linkGroups=next;renderLinkGroups();return {ok:true};}catch{return {ok:false,error:'save_failed'};}
  }
  window.LinkLibraryHost={snapshot:librarySnapshot,command:libraryCommand,refreshPreview:refreshLinkPreview,render:renderLinkGroups,add:(url,group)=>addLink(url,group),notes:()=>window.Notebook?.references().notes.filter(n=>!window.Notebook.get(n.id)?.meeting)||[],openNote:async id=>{if(!window.Notebook?.get(id))return {ok:false,error:'not_found'};await window.Notebook.flushForExit();selectedNoteId=id;if(notesSearch)notesSearch.value='';await setActiveTab('notes');renderNotesLibrary();return {ok:true};}};

  function persistLinks() {
    saveJson(LINKS_KEY, linkGroups);
  }

  function setLinksStatus(message, tone = '') {
    if (linksStatus) {
      linksStatus.textContent = '';
      linksStatus.dataset.tone = tone;
    }
    if (message && typeof showStatusToast === 'function') showStatusToast(message);
  }

  function allLinks() {
    return linkGroups.flatMap((group) => Array.isArray(group.links) ? group.links : []);
  }

  function updateLinkBulkAction() {
    if (!linkBulkDelete) return;
    linkBulkDelete.hidden = linkSelection.size === 0;
    linkBulkDelete.textContent = '删除';
    linkBulkDelete.setAttribute('aria-label', linkSelection.size
      ? `删除 ${linkSelection.size} 项`
      : '删除所选');
  }

  function linkHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  }

  function createIconButton(action, label, icon, danger = false) {
    const button = document.createElement('button');
    button.className = `icon-button${danger ? ' danger' : ''}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function renderLinkGroups() {
    window.notchAPI?.broadcastFloat?.({kind:'note',linksChanged:true});
    if (!linkGroupsEl) return;
    if(window.LinkLibrary?.hasDraft)return;
    window.LinkLibrary?.beforeRender();
    linkGroupsEl.replaceChildren();
    updateLinkBulkAction();
    if (!linkGroups.length) {
      const empty = document.createElement('div');
      empty.className = 'links-empty';
      empty.innerHTML = '<strong>还没有链接</strong><span>粘贴网址先收下。备注和分组，想好了再补。</span>';
      linkGroupsEl.appendChild(empty);
      window.LinkLibrary?.afterRender(0);
      return;
    }

    let shown=0,total=0;
    linkGroups.forEach((group) => {
      const filtered=(group.links||[]).filter(link=>window.LinkLibrary?.matches(link,group.id)!==false);total+=filtered.length;
      if(window.LinkLibrary?.filtering&&!filtered.length)return;
      const section = document.createElement('section');
      section.className = `link-group${group.collapsed && !window.LinkLibrary?.filtering ? ' collapsed' : ''}`;
      section.dataset.groupId = group.id;

      const header = document.createElement('header');
      header.className = 'link-group-head';
      const toggle = document.createElement('button');
      toggle.className = 'group-toggle';
      toggle.type = 'button';
      toggle.dataset.action = 'toggle-group';
      toggle.setAttribute('aria-label', group.collapsed ? '展开分组' : '折叠分组');
      toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
      const name = document.createElement('input');
      name.className = 'group-name-input';
      name.value = String(group.name || '未命名分组');
      name.dataset.action = 'rename-group';
      name.setAttribute('aria-label', '分组名称');
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = `${Array.isArray(group.links) ? group.links.length : 0}`;
      header.append(toggle, name, count);
      header.appendChild(createIconButton('add-link-to-group', `在“${group.name || '当前分组'}”中新增链接`, ADD_ICON));
      header.appendChild(createIconButton('delete-group', '删除分组及其中所有链接', DELETE_ICON, true));

      const body = document.createElement('div');
      body.className = 'link-group-body';
      if (addingLinkGroupId === group.id) {
        const addRow = document.createElement('div');
        addRow.className = 'group-link-add';
        addRow.innerHTML = `<input data-group-link-input type="text" placeholder="粘贴网址并回车，添加到此分组" aria-label="添加链接到${String(group.name || '当前分组').replace(/[<>"&]/g, '')}" autocomplete="off" spellcheck="false"><button type="button" data-action="cancel-group-link-add" aria-label="取消">×</button>`;
        body.appendChild(addRow);
      }
      const list = document.createElement('div');
      list.className = 'link-list';
      filtered.forEach((link) => {
        if(shown++>=(window.LinkLibrary?.limit||60))return;
        const row = document.createElement('article');
        row.className = `link-item${linkSelection.has(link.id) ? ' multi-selected' : ''}`;
        row.dataset.linkId = link.id;
        row.dataset.groupId = group.id;
        const mark = document.createElement('span');
        mark.className = 'link-favicon';
        if (link.icon && String(link.icon).startsWith('data:image/')) {
          const image = document.createElement('img');
          image.src = link.icon;
          image.alt = '';
          mark.appendChild(image);
        } else {
          mark.textContent = (linkHostname(link.url).charAt(0) || '·').toUpperCase();
        }
        const open = document.createElement('button');
        open.className = 'link-open';
        open.type = 'button';
        open.dataset.action = 'open-link';
        const title = document.createElement('strong');
        title.textContent = link.title || linkHostname(link.url);
        const domain = document.createElement('span');
        domain.textContent = linkHostname(link.url);
        open.append(title, domain);
        const actions = document.createElement('div');
        actions.className = 'link-actions';
        actions.append(
          createIconButton('open-link', '打开链接', OPEN_ICON),
          createIconButton('edit-link', '修改名称', EDIT_ICON),
          createIconButton('delete-link', '删除链接', DELETE_ICON, true)
        );
        row.append(mark, open, actions);
        window.LinkLibrary?.decorate(row,link,group);
        list.appendChild(row);
      });

      body.append(list);
      section.append(header, body);
      linkGroupsEl.appendChild(section);
    });
    if(!total&&window.LinkLibrary?.filtering){const empty=document.createElement('p');empty.className='links-empty';empty.textContent='没有匹配的收藏，试试其他关键词或分组。';linkGroupsEl.append(empty);}
    window.LinkLibrary?.afterRender(total);
  }

  function addLink(rawValue, requestedGroupId = '', options = {}) {
    const normalized = Domain.normalizeHttpUrl(rawValue);
    if (!normalized) {
      if (!options.quiet) setLinksStatus('请输入有效的公开网址', 'error');
      return false;
    }
    const existingLink = allLinks().find((link) => link.url === normalized);
    if (existingLink) {
      if (!options.quiet) setLinksStatus('这个链接已经收藏过了', 'error');
      if (options.allowExisting) return existingLink;
      return false;
    }
    const previousGroups = linkGroups;
    const requestedTitle = String(options.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const requestedCategory = String(options.category || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const link = { id: uid('link'), url: normalized, title: requestedTitle || '未命名', icon: '', createdAt: Date.now(),...(options.note?{note:window.LinkLibraryModel.text(options.note,4000)}:{}) };
    const categoryGroup = requestedCategory && linkGroups.find((group) => group.name === requestedCategory);
    const preferredGroupId = requestedGroupId || categoryGroup?.id || Domain.preferredLinkGroupId(linkGroups, normalized);
    const preferredGroup = linkGroups.find((group) => group.id === preferredGroupId);
    if (preferredGroup) {
      linkGroups = linkGroups.map((group) => group.id === preferredGroup.id
        ? { ...group, collapsed: false, links: [...(group.links || []), link] }
        : group);
    } else {
      linkGroups = Domain.addLinkToGroups(
        linkGroups,
        link,
        requestedCategory || '未分组'
      );
    }
    try { localStorage.setItem(LINKS_KEY, JSON.stringify(linkGroups)); }
    catch { linkGroups=previousGroups;if(options.strict)throw Error('save_failed');setLinksStatus('保存失败，请重试','error');return false; }
    renderLinkGroups();
    if (!options.quiet) setLinksStatus('链接已保存');

    // 保存动作不等待网络或大模型，只补全预览，不改用户分组。
    Promise.resolve(window.notchAPI?.inspectLink?.(normalized)).then((inspected) => {
      if (!inspected?.ok) return;
      let sourceGroup = null;
      let savedLink = null;
      linkGroups.some((group) => {
        const found = (group.links || []).find((item) => item.id === link.id);
        if (!found) return false;
        sourceGroup = group;
        savedLink = found;
        return true;
      });
      if (!savedLink || !sourceGroup) return;
      savedLink.url = inspected.url || savedLink.url;
      savedLink.title = savedLink.titleUserSet?savedLink.title:requestedTitle || inspected.title || savedLink.title || '未命名';
      savedLink.icon = inspected.icon || savedLink.icon || '';
      savedLink.preview=inspected.preview||'';savedLink.description=inspected.description||'';savedLink.source=inspected.source||'metadata';savedLink.warning=inspected.warning||'';
      // Metadata may enrich a preview, but never silently move a user's bookmark.
      try{localStorage.setItem(LINKS_KEY,JSON.stringify(linkGroups));}catch{setLinksStatus('预览信息保存失败，链接仍保留。','error');}
      renderLinkGroups();
    }).catch(() => {});
    return link;
  }

  window.NotchWorkspaceTools = Object.freeze({
    saveLink(fields = {}) {
      return addLink(fields.url, '', {
        title: fields.title,
        category: fields.category,
        allowExisting: true,
        quiet: true,
      });
    },
  });

  if (linkInput) {
    linkInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const value = linkInput.value;
      if (addLink(value,window.LinkLibrary?.selectedGroup||'')) linkInput.value = '';
      linkInput.focus();
    });
  }

  function findLink(group, linkId) {
    return group && (group.links || []).find((link) => link.id === linkId);
  }

  if (linkGroupsEl) {
    linkGroupsEl.addEventListener('change', (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('.group-name-input')) {
        linkGroups = Domain.renameGroup(linkGroups, groupSection.dataset.groupId, event.target.value);
        persistLinks();
        renderLinkGroups();
      }
      if (event.target.matches('.link-title-edit')) {
        const row = event.target.closest('[data-link-id]');
        const group = linkGroups.find((item) => item.id === groupSection.dataset.groupId);
        const link = findLink(group, row && row.dataset.linkId);
        const value = event.target.value.trim();
        if (link && value){link.title=value;link.titleUserSet=true;}
        persistLinks();
        renderLinkGroups();
      }
    });

    linkGroupsEl.addEventListener('keydown', async (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('[data-group-link-input]')) {
        if (event.key === 'Escape') {
          addingLinkGroupId = '';
          renderLinkGroups();
        } else if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
          event.preventDefault();
          if (addLink(event.target.value, groupSection.dataset.groupId)) {
            addingLinkGroupId = '';
            renderLinkGroups();
          }
        }
        return;
      }
      if (event.target.matches('.group-name-input') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
      if (event.target.matches('.link-title-edit') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });

    linkGroupsEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      const groupId = groupSection.dataset.groupId;
      const group = linkGroups.find((item) => item.id === groupId);
      const row = event.target.closest('[data-link-id]');
      const link = findLink(group, row && row.dataset.linkId);
      if (event.shiftKey && link) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          allLinks().map((item) => item.id),
          [...linkSelection],
          link.id,
          linkSelectionAnchor,
          true
        );
        linkSelection = new Set(result.selected);
        linkSelectionAnchor = result.anchor;
        renderLinkGroups();
        return;
      }
      if (link) linkSelectionAnchor = link.id;
      if (!action) return;
      if (action.dataset.action === 'add-link-to-group') {
        addingLinkGroupId = groupId;
        group.collapsed = false;
        persistLinks();
        renderLinkGroups();
        requestAnimationFrame(() => linkGroupsEl.querySelector(
          `[data-group-id="${CSS.escape(groupId)}"] [data-group-link-input]`
        )?.focus());
      }
      if (action.dataset.action === 'cancel-group-link-add') {
        addingLinkGroupId = '';
        renderLinkGroups();
      }
      if (action.dataset.action === 'toggle-group') {
        group.collapsed = !group.collapsed;
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'delete-group') {
        askToRemoveLinks({groupId},`分组“${group.name}”及其中 ${group.links?.length||0} 条收藏`);
      }
      if (action.dataset.action === 'open-link' && link && window.notchAPI) {
        window.notchAPI.openExternal(link.url);
      }
      if (action.dataset.action === 'delete-link' && link) {
        askToRemoveLinks({ids:[link.id]},`收藏“${link.title||link.url}”`);
      }
      if (action.dataset.action === 'edit-link' && link && row) {
        const openButton = row.querySelector('.link-open');
        const input = document.createElement('input');
        input.className = 'link-title-edit';
        input.value = link.title;
        openButton.replaceWith(input);
        input.focus();
        input.select();
      }
    });

    // ============ 链接长按拖拽：组内排序 + 跨组搬运 ============
    // 不用 HTML5 拖拽有两个原因：一是行中间那一大块是 <button class="link-open">，
    // Chromium 里从 button 上按下不会触发祖先的 dragstart，标题区域整块拖不动；
    // 二是原生拖拽一按就走，没法和「点击打开链接」区分。改成指针事件 + 长按门槛。
    const LINK_DRAG_HOLD_MS = 340;
    const LINK_DRAG_MOVE_CANCEL = 8;
    let linkDrag = null;
    let suppressLinkClick = false;

    function clearLinkDropMarks() {
      linkGroupsEl.querySelectorAll('.drop-before, .drop-after, .drop-target').forEach((item) => {
        item.classList.remove('drop-before', 'drop-after', 'drop-target');
      });
    }

    function cancelLinkDrag() {
      if (!linkDrag) return;
      clearTimeout(linkDrag.holdTimer);
      if (linkDrag.active) {
        linkDrag.row.classList.remove('dragging');
        linkGroupsEl.classList.remove('link-dragging');
        clearLinkDropMarks();
      }
      try { linkDrag.row.releasePointerCapture(linkDrag.pointerId); } catch (error) {}
      linkDrag = null;
    }

    // 落点有两种：压在某一行上就按该行中线决定插到它前面还是后面；
    // 压在分组的空白或标题上就追加到该组末尾（index 为 null）。
    function updateLinkDropTarget(clientX, clientY) {
      clearLinkDropMarks();
      linkDrag.target = null;
      const under = document.elementFromPoint(clientX, clientY);
      if (!under || !linkGroupsEl.contains(under)) return;
      const overRow = under.closest('.link-item[data-link-id]');
      // 压在被拖那一行自己身上 = 放回原处，目标留空，松手什么都不做。
      // 少了这一步，长按后原地松手会落到「自己所在的分组」上，被当成追加到组末尾。
      if (overRow === linkDrag.row) return;
      if (overRow) {
        const rect = overRow.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        overRow.classList.add(after ? 'drop-after' : 'drop-before');
        const rows = Array.from(overRow.parentElement.children)
          .filter((item) => item.dataset && item.dataset.linkId);
        linkDrag.target = {
          groupId: overRow.dataset.groupId,
          index: rows.indexOf(overRow) + (after ? 1 : 0),
        };
        return;
      }
      const overGroup = under.closest('.link-group[data-group-id]');
      if (!overGroup) return;
      overGroup.classList.add('drop-target');
      linkDrag.target = { groupId: overGroup.dataset.groupId, index: null };
    }

    function linkOrderFingerprint() {
      return linkGroups
        .map((group) => `${group.id}:${(group.links || []).map((link) => link.id).join(',')}`)
        .join('|');
    }

    linkGroupsEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const row = event.target.closest('.link-item[data-link-id]');
      // 编辑 / 删除按钮和标题输入框保持原有点击语义，不参与拖拽。
      if (!row || event.target.closest('input, textarea, select, .ll-detail, .link-actions')) return;
      // 上一次拖拽后若没有等到那个补发的 click（比如在列表外松手），标志会留着，
      // 否则它会把下一次正常点击吞掉，链接就打不开了。
      suppressLinkClick = false;
      cancelLinkDrag();
      linkDrag = {
        row,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        holdTimer: setTimeout(() => {
          if (!linkDrag) return;
          linkDrag.active = true;
          row.classList.add('dragging');
          linkGroupsEl.classList.add('link-dragging');
          try { row.setPointerCapture(linkDrag.pointerId); } catch (error) {}
          updateLinkDropTarget(linkDrag.startX, linkDrag.startY);
          setLinksStatus('拖到目标位置后松手');
        }, LINK_DRAG_HOLD_MS),
      };
    });

    // 这三个挂在 document 上（与窗口拖拽同一套写法）：长按还没满就快速划出列表时，
    // 挂在 linkGroupsEl 上收不到 move / up，计时器随后仍会启动一次拖拽。
    document.addEventListener('pointermove', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      if (!linkDrag.active) {
        // 长按还没满就移动，说明用户在滚动或只是手抖，放弃这次拖拽。
        const moved = Math.abs(event.clientX - linkDrag.startX) > LINK_DRAG_MOVE_CANCEL
          || Math.abs(event.clientY - linkDrag.startY) > LINK_DRAG_MOVE_CANCEL;
        if (moved) cancelLinkDrag();
        return;
      }
      event.preventDefault();
      updateLinkDropTarget(event.clientX, event.clientY);
    });

    document.addEventListener('pointerup', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      const wasActive = linkDrag.active;
      const target = linkDrag.target;
      const linkId = linkDrag.row.dataset.linkId;
      cancelLinkDrag();
      if (!wasActive) return;
      // 拖拽结束后浏览器仍会补一个 click，必须拦掉，否则松手即打开链接。
      suppressLinkClick = true;
      if (!target) {
        setLinksStatus('');
        return;
      }
      const before = linkOrderFingerprint();
      linkGroups = Domain.moveLinkToPosition(linkGroups, linkId, target.groupId, target.index);
      if (linkOrderFingerprint() === before) {
        setLinksStatus('');
        return;
      }
      persistLinks();
      renderLinkGroups();
      setLinksStatus('链接顺序已更新');
    });

    document.addEventListener('pointercancel', () => cancelLinkDrag());

    linkGroupsEl.addEventListener('click', (event) => {
      if (!suppressLinkClick) return;
      suppressLinkClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }

  linkBulkDelete?.addEventListener('click', () => {
    if (!linkSelection.size) return;
    askToRemoveLinks({ids:[...linkSelection]},`选中的 ${linkSelection.size} 条收藏`);
  });

  // ============ 录音与转写 ============
  const homeRecorder = document.getElementById('home-recorder');
  const recordingDot = document.getElementById('home-recording-dot');
  const recordingStateLabel = document.getElementById('home-recording-state');
  const recordingTime = document.getElementById('home-recording-time');
  const recordingStrands = document.getElementById('recording-strands');
  const liveTranscript = document.getElementById('home-live-transcript');
  const recordStart = document.getElementById('record-start');
  const recordPause = document.getElementById('record-pause');
  const recordStop = document.getElementById('record-stop');
  const recordingNew = document.getElementById('recording-new');
  const recordingConfigure = document.getElementById('recording-configure');
  const recordingList = document.getElementById('recording-list');
  const recordingDetail = document.getElementById('recording-detail');
  const recordingCount = document.getElementById('recording-count');
  const recordingBulkDelete = document.getElementById('recording-bulk-delete');
  const homeMicrophoneRecovery = document.getElementById('home-microphone-recovery');
  const recordingMicrophoneRecovery = document.getElementById('recording-microphone-recovery');
  const transcriptionSettingsBackdrop = document.getElementById('transcription-settings-backdrop');
  const transcriptionSettingsForm = document.getElementById('transcription-settings-form');
  const transcriptionSettingsClose = document.getElementById('transcription-settings-close');
  const transcriptionSettingsCancel = document.getElementById('transcription-settings-cancel');
  const transcriptionSettingsSave = document.getElementById('transcription-settings-save');
  const transcriptionApiKey = document.getElementById('transcription-api-key');
  const transcriptionApiStatus = document.getElementById('transcription-api-status');
  const transcriptionApiHelp = document.getElementById('transcription-api-help');
  const transcriptionRegion = document.getElementById('transcription-region');
  const transcriptionWorkspace = document.getElementById('transcription-workspace');
  const llmApiKey = document.getElementById('llm-api-key');
  const llmApiStatus = document.getElementById('llm-api-status');
  const llmApiHelp = document.getElementById('llm-api-help');
  const llmBaseUrl = document.getElementById('llm-base-url');
  const llmModel = document.getElementById('llm-model');
  const transcriptionSettingsNote = document.getElementById('transcription-settings-note');
  const settingsApiConfigure = document.getElementById('settings-api-configure');
  const settingsTranscriptionStatus = document.getElementById('settings-transcription-status');
  const settingsLlmStatus = document.getElementById('settings-llm-status');
  const settingsFeatureList = document.getElementById('settings-feature-list');
  const settingsMirrorPreview = document.getElementById('settings-mirror-preview');
  const settingsMirrorPreviewAction = document.getElementById('settings-mirror-preview-action');
  const settingsMirrorEmpty = document.getElementById('settings-mirror-empty');
  const settingsMirrorCount = document.getElementById('settings-mirror-count');
  const settingsMirrorPrevious = document.getElementById('settings-mirror-previous');
  const settingsMirrorNext = document.getElementById('settings-mirror-next');
  const settingsMirrorChoose = document.getElementById('settings-mirror-choose');
  const settingsMirrorRemove = document.getElementById('settings-mirror-remove');
  const settingsShortcutValue = document.getElementById('settings-shortcut-value');
  const settingsShortcutChange = document.getElementById('settings-shortcut-change');
  const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
  const settingsWorkspacePath = document.getElementById('settings-workspace-path');
  const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
  const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
  const settingsAutoLaunch = document.getElementById('settings-auto-launch');
  const settingsInlineNote = document.getElementById('settings-inline-note');
  const settingsPermissionRefresh = document.getElementById('settings-permission-refresh');
  const settingsPermissionRelaunch = document.getElementById('settings-permission-relaunch');
  const settingsPermissionNote = document.getElementById('settings-permission-note');

  let recordings = loadJson(RECORDINGS_KEY, []).map(Domain.createRecording).filter(Boolean);
  let selectedRecordingId = recordings[0] && recordings[0].id;
  let recordingSelection = new Set();
  let recordingSelectionAnchor = selectedRecordingId || null;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let speechRecognition = null;
  let speechRecognitionBlocked = false;
  let speechRecognitionError = '';
  let recordingStatus = 'idle';
  let recordingStarting = false;
  let recordingStartedAt = 0;
  let pausedAt = 0;
  let pausedTotalMs = 0;
  let recordingTranscript = '';
  let interimTranscript = '';
  let recordingTimer = null;
  let recordingStopDurationMs = 0;
  let recordingCaptureIssue = '';
  let recordingDraftId = '';
  let recordingMarkers=[],pendingRecording=null;
  const VOICE_SETTINGS_KEY='notch-voice-settings-v1';
  let autoOrganize=loadJson(VOICE_SETTINGS_KEY,{autoOrganize:true}).autoOrganize!==false;
  const voiceJobs=new Map();
  for(const recording of recordings){if(recording.voice?.status==='running'){recording.voice.status='failed';recording.voice.error='interrupted';}}
  let currentAudioUrl = '';
  let transcriptionConfig = {
    configured: false,
    asrNeedsReentry: false,
    region: 'beijing',
    workspaceId: '',
    llmConfigured: false,
    llmNeedsReentry: false,
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-v4-flash',
  };
  let settingsAppSettings = null;
  let settingsWorkspace = null;
  let permissionStatuses = null;
  let transcriptionStatus = 'idle';
  let transcriptionStartPromise = null;
  let transcriptionAudioContext = null;
  let transcriptionAudioSource = null;
  let transcriptionAudioProcessor = null;
  let transcriptionAudioMute = null;
  let transcriptionPcmQueue = [];
  let transcriptionFinishPromise = null;
  let recordingPurpose = 'memo';
  let strandsAudioContext = null;
  let strandsAudioSource = null;
  let strandsAnalyser = null;
  let strandsFrame = null;
  let strandsSamples = null;
  let strandsLevel = 0;

  function stopRecordingStrands() {
    if (strandsFrame) cancelAnimationFrame(strandsFrame);
    strandsFrame = null;
    try { strandsAudioSource?.disconnect(); } catch (error) {}
    if (strandsAudioContext) strandsAudioContext.close().catch(() => {});
    strandsAudioContext = null;
    strandsAudioSource = null;
    strandsAnalyser = null;
    strandsSamples = null;
    strandsLevel = 0;
    const context = recordingStrands?.getContext('2d');
    context?.clearRect(0, 0, recordingStrands.width, recordingStrands.height);
  }

  function drawRecordingStrands(now) {
    if (!recordingStrands || !strandsAnalyser || !strandsSamples) {
      strandsFrame = null;
      return;
    }
    const bounds = recordingStrands.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (recordingStrands.width !== width || recordingStrands.height !== height) {
      recordingStrands.width = width;
      recordingStrands.height = height;
    }
    strandsAnalyser.getFloatTimeDomainData(strandsSamples);
    const measured = recordingStatus === 'recording' ? Domain.calculateAudioLevel(strandsSamples) : 0;
    strandsLevel += (measured - strandsLevel) * (measured > strandsLevel ? 0.34 : 0.08);
    const context = recordingStrands.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    context.globalCompositeOperation = 'lighter';
    const cssWidth = bounds.width;
    const cssHeight = bounds.height;
    const activeLevel = Math.min(1, strandsLevel * 6);
    const centerY = cssHeight * 0.55;
    const phase = now * 0.00115;
    const colors = [
      ['rgba(82, 224, 255, 0)', `rgba(82, 224, 255, ${0.2 + activeLevel * 0.44})`, 'rgba(82, 224, 255, 0)'],
      ['rgba(111, 128, 255, 0)', `rgba(111, 128, 255, ${0.22 + activeLevel * 0.5})`, 'rgba(111, 128, 255, 0)'],
      ['rgba(209, 96, 255, 0)', `rgba(209, 96, 255, ${0.19 + activeLevel * 0.46})`, 'rgba(209, 96, 255, 0)'],
      ['rgba(255, 102, 184, 0)', `rgba(255, 102, 184, ${0.17 + activeLevel * 0.4})`, 'rgba(255, 102, 184, 0)'],
      ['rgba(255, 210, 91, 0)', `rgba(255, 210, 91, ${0.14 + activeLevel * 0.34})`, 'rgba(255, 210, 91, 0)'],
    ];
    context.filter = `blur(${8 + activeLevel * 10}px)`;
    colors.forEach((palette, layer) => {
      const gradient = context.createLinearGradient(cssWidth * 0.08, 0, cssWidth * 0.92, 0);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(0.36 + layer * 0.025, palette[1]);
      gradient.addColorStop(0.72 - layer * 0.02, palette[1]);
      gradient.addColorStop(1, palette[2]);
      const heightScale = cssHeight * (0.06 + layer * 0.012 + activeLevel * (0.18 + layer * 0.014));
      const drift = Math.sin(phase + layer * 0.92) * cssHeight * 0.025;
      context.beginPath();
      context.moveTo(cssWidth * 0.04, centerY);
      for (let x = cssWidth * 0.04; x <= cssWidth * 0.96; x += 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.sin(progress * Math.PI * (2.2 + layer * 0.18) + phase + layer) * heightScale * 0.16;
        context.lineTo(x, centerY - envelope * heightScale - ripple + drift);
      }
      for (let x = cssWidth * 0.96; x >= cssWidth * 0.04; x -= 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.cos(progress * Math.PI * (2 + layer * 0.14) - phase - layer) * heightScale * 0.14;
        context.lineTo(x, centerY + envelope * heightScale + ripple + drift);
      }
      context.closePath();
      context.fillStyle = gradient;
      context.globalAlpha = 0.58 - layer * 0.055;
      context.fill();
    });
    context.filter = 'blur(2px)';
    const core = context.createLinearGradient(cssWidth * 0.16, 0, cssWidth * 0.84, 0);
    core.addColorStop(0, 'rgba(66, 191, 255, 0)');
    core.addColorStop(0.34, `rgba(172, 238, 255, ${0.3 + activeLevel * 0.55})`);
    core.addColorStop(0.58, `rgba(255, 209, 255, ${0.38 + activeLevel * 0.58})`);
    core.addColorStop(0.78, `rgba(255, 213, 117, ${0.24 + activeLevel * 0.5})`);
    core.addColorStop(1, 'rgba(255, 130, 196, 0)');
    context.globalAlpha = 1;
    context.fillStyle = core;
    context.fillRect(cssWidth * 0.08, centerY - 1.3 - activeLevel, cssWidth * 0.84, 2.6 + activeLevel * 2);
    context.restore();
    homeRecorder?.style.setProperty('--recording-level', strandsLevel.toFixed(3));
    strandsFrame = requestAnimationFrame(drawRecordingStrands);
  }

  function startRecordingStrands(stream) {
    stopRecordingStrands();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream || !recordingStrands) return;
    try {
      strandsAudioContext = new AudioContext();
      strandsAudioSource = strandsAudioContext.createMediaStreamSource(stream);
      strandsAnalyser = strandsAudioContext.createAnalyser();
      strandsAnalyser.fftSize = 512;
      strandsAnalyser.smoothingTimeConstant = 0.72;
      strandsSamples = new Float32Array(strandsAnalyser.fftSize);
      strandsAudioSource.connect(strandsAnalyser);
      strandsFrame = requestAnimationFrame(drawRecordingStrands);
    } catch (error) {
      stopRecordingStrands();
    }
  }

  function updateTranscriptionConfigUi() {
    const statuses = Domain.apiCredentialStatuses(transcriptionConfig);
    if (transcriptionApiStatus) {
      transcriptionApiStatus.textContent = statuses.transcription.label;
      transcriptionApiStatus.dataset.state = statuses.transcription.state;
    }
    if (llmApiStatus) {
      llmApiStatus.textContent = statuses.llm.label;
      llmApiStatus.dataset.state = statuses.llm.state;
    }
    if (transcriptionRegion) transcriptionRegion.value = transcriptionConfig.region || 'beijing';
    if (transcriptionWorkspace) transcriptionWorkspace.value = transcriptionConfig.workspaceId || '';
    if (llmBaseUrl) llmBaseUrl.value = transcriptionConfig.llmBaseUrl || 'https://api.deepseek.com';
    if (llmModel) llmModel.value = transcriptionConfig.llmModel || 'deepseek-v4-flash';
  }

  function setSettingsNote(message, error = false) {
    if (!settingsInlineNote) return;
    settingsInlineNote.textContent = message || '';
    settingsInlineNote.classList.toggle('error', error);
  }

  const PERMISSION_LABELS = {
    granted: '已授权',
    denied: '未授权',
    restricted: '受限制',
    'not-determined': '待确认',
    unknown: '未知',
  };

  function renderPermissionStatuses() {
    document.querySelectorAll('[data-permission-status]').forEach((status) => {
      const key = status.dataset.permissionStatus;
      const value = permissionStatuses?.[key] || 'unknown';
      status.dataset.state = value;
      status.textContent = PERMISSION_LABELS[value] || PERMISSION_LABELS.unknown;
    });
    const result = permissionStatuses;
    const location = document.getElementById('settings-app-location');
    const reveal = document.getElementById('settings-reveal-app');
    if (reveal) reveal.disabled = !result?.bundlePath;
    if (location) location.textContent = !result ? '暂时无法确认应用位置，请重新检测。'
      : !result.bundlePath ? '当前是开发预览，不能代替正式安装版授权。'
      : result.installed ? `当前应用：${result.bundlePath}。系统列表没有 Handy 时，可从“＋”选择此应用。`
      : `尚未安装到应用程序目录。请先将访达中的 Handy 拖入“应用程序”，再打开安装版授权。当前位置：${result.bundlePath}`;
  }

  async function refreshPermissionStatuses({ announce = false } = {}) {
    if (!window.notchAPI?.getPermissionStatuses) {
      if (announce && settingsPermissionNote) {
        settingsPermissionNote.textContent = '权限查询接口不可用；请确认正在使用正式安装版，而不是旧开发预览。';
        settingsPermissionNote.classList.add('error');
      }
      return null;
    }
    if (settingsPermissionRefresh) {
      settingsPermissionRefresh.disabled = true;
      settingsPermissionRefresh.setAttribute('aria-busy', 'true');
    }
    const result = await window.notchAPI.getPermissionStatuses().catch(() => null);
    if (settingsPermissionRefresh) {
      settingsPermissionRefresh.disabled = false;
      settingsPermissionRefresh.removeAttribute('aria-busy');
    }
    permissionStatuses = result;
    renderPermissionStatuses();
    if (announce && settingsPermissionNote) {
      const identity = result?.executable ? ` 当前运行：${result.packaged ? '安装版' : '开发预览'} ${result.appVersion || ''}，${result.executable}。` : '';
      settingsPermissionNote.textContent = result
        ? `${result.message || '已重新检测；权限按需开启，不用的功能无需授权。'}${identity}`
        : '查询未完成，状态暂时未知。请重新检测；这不代表权限被拒绝。';
      settingsPermissionNote.classList.toggle('error', !result);
    }
    return result;
  }

  function setMicrophoneRecoveryVisible(visible) {
    [homeMicrophoneRecovery, recordingMicrophoneRecovery].forEach((panel) => {
      if (panel) panel.hidden = !visible;
    });
  }

  let permissionRelaunchPending = false;
  async function relaunchForPermissions() {
    if (permissionRelaunchPending) return;
    if (recordingStarting || recordingStatus !== 'idle' || transcriptionFinishPromise || permissionRequestPending) {
      showStatusToast('请先结束并保存当前录音，再完全重启。');
      return;
    }
    permissionRelaunchPending = true;
    try {
      await window.Notebook?.flushForExit?.();
    } catch {
      permissionRelaunchPending = false;
      showStatusToast('笔记尚未保存，已取消重启。请先保存内容后重试。');
      return;
    }
    if (settingsPermissionNote) {
      settingsPermissionNote.textContent = '正在完全退出并重新打开 Handy…';
      settingsPermissionNote.classList.remove('error');
    }
    const ok = await window.notchAPI?.relaunchApp?.().catch(() => false);
    if (!ok) permissionRelaunchPending = false;
    if (!ok && settingsPermissionNote) {
      settingsPermissionNote.textContent = '无法自动重启，请从菜单栏退出 Handy 后重新打开。';
      settingsPermissionNote.classList.add('error');
    }
  }

  function applySettingsMirrorGallery(state = {}) {
    const gallery = state.gallery && typeof state.gallery === 'object'
      ? state.gallery
      : { activeId: '', items: [], maxItems: 12 };
    const items = Array.isArray(gallery.items) ? gallery.items : [];
    const index = items.findIndex((item) => item.id === gallery.activeId);
    const dataUrl = typeof state.dataUrl === 'string' && state.dataUrl.startsWith('data:image/') ? state.dataUrl : '';
    if (settingsMirrorPreview) {
      settingsMirrorPreview.hidden = !dataUrl;
      if (dataUrl) settingsMirrorPreview.src = dataUrl;
      else settingsMirrorPreview.removeAttribute('src');
    }
    if (settingsMirrorEmpty) settingsMirrorEmpty.hidden = Boolean(dataUrl);
    if (settingsMirrorCount) settingsMirrorCount.textContent = items.length ? `${index + 1} / ${items.length}` : '0 / 0';
    if (settingsMirrorPreviewAction) settingsMirrorPreviewAction.setAttribute('aria-label', items.length ? '更换当前图片' : '添加图片');
    if (settingsMirrorPrevious) settingsMirrorPrevious.disabled = items.length <= 1;
    if (settingsMirrorNext) settingsMirrorNext.disabled = items.length <= 1;
    if (settingsMirrorChoose) settingsMirrorChoose.disabled = items.length >= (Number(gallery.maxItems) || 12);
    if (settingsMirrorRemove) settingsMirrorRemove.disabled = !gallery.activeId;
  }

  function renderSettingsPanel() {
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: transcriptionConfig,
    });
    if (settingsTranscriptionStatus) {
      settingsTranscriptionStatus.textContent = summary.transcription.label;
      settingsTranscriptionStatus.dataset.state = summary.transcription.state;
    }
    if (settingsLlmStatus) {
      settingsLlmStatus.textContent = summary.llm.label;
      settingsLlmStatus.dataset.state = summary.llm.state;
    }
    if (settingsShortcutValue) settingsShortcutValue.textContent = summary.shortcutLabel;
    if (settingsWorkspaceKind) settingsWorkspaceKind.textContent = summary.workspaceLabel;
    if (settingsWorkspacePath) {
      settingsWorkspacePath.textContent = summary.workspacePath || '默认数据目录';
      settingsWorkspacePath.title = summary.workspacePath || '';
    }
    if (settingsAutoLaunch) settingsAutoLaunch.checked = summary.autoLaunch;
    settingsFeatureList?.querySelectorAll('input[data-settings-feature]').forEach((input) => {
      input.checked = settingsAppSettings?.features?.[input.dataset.settingsFeature] !== false;
    });
  }

  async function refreshSettingsPanel() {
    if (!window.notchAPI) return;
    const [appSettings, workspace, config, permissions] = await Promise.all([
      window.notchAPI.getAppSettings?.().catch(() => null),
      window.notchAPI.getWorkspace?.().catch(() => null),
      window.notchAPI.getTranscriptionConfig?.().catch(() => null),
      window.notchAPI.getPermissionStatuses?.().catch(() => null),
    ]);
    if (appSettings) settingsAppSettings = appSettings;
    if (workspace) settingsWorkspace = workspace;
    if (permissions) permissionStatuses = permissions;
    if (config) {
      transcriptionConfig = config;
      updateTranscriptionConfigUi();
      updateRecordingUi();
    }
    await window.NotchMirrorGallery?.refresh?.().catch(() => null);
    applySettingsMirrorGallery(window.NotchMirrorGallery?.getState?.());
    renderSettingsPanel();
    renderPermissionStatuses();
  }

  async function loadTranscriptionConfig() {
    if (!window.notchAPI || typeof window.notchAPI.getTranscriptionConfig !== 'function') return;
    try {
      const config = await window.notchAPI.getTranscriptionConfig();
      if (config) transcriptionConfig = config;
    } catch (error) {}
    updateTranscriptionConfigUi();
    updateRecordingUi();
    renderSettingsPanel();
  }

  function openTranscriptionSettings() {
    if (!transcriptionSettingsBackdrop) return;
    transcriptionSettingsBackdrop.hidden = false;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = transcriptionConfig.asrNeedsReentry || transcriptionConfig.llmNeedsReentry
      ? '检测到旧版加密密钥，但升级后无法解密。请重新输入通义百炼与 DeepSeek 两把 API Key。'
      : transcriptionConfig.configured || transcriptionConfig.llmConfigured
        ? '已配置的 API Key 可留空；新输入的密钥会覆盖对应旧值。'
        : '请分别配置通义百炼实时转写与 DeepSeek 两把 API Key。';
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    [transcriptionWorkspace, llmApiKey, llmBaseUrl, llmModel].forEach((field) => field?.removeAttribute('aria-invalid'));
    transcriptionSettingsNote.setAttribute('role', 'status');
    updateTranscriptionConfigUi();
    setTimeout(() => transcriptionApiKey?.focus(), 0);
  }

  function closeTranscriptionSettings() {
    if (transcriptionSettingsBackdrop) transcriptionSettingsBackdrop.hidden = true;
  }

  async function saveTranscriptionSettings() {
    if (!window.notchAPI || !transcriptionSettingsSave) return;
    if (
      !transcriptionConfig.configured
      && !transcriptionApiKey.value.trim()
      && !transcriptionConfig.llmConfigured
      && !llmApiKey.value.trim()
    ) {
      transcriptionSettingsNote.classList.remove('success');
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '请至少配置一个 API Key。';
      transcriptionSettingsNote.setAttribute('role', 'alert');
      transcriptionSettingsNote.focus();
      return;
    }
    transcriptionSettingsSave.disabled = true;
    transcriptionSettingsSave.textContent = '保存中…';
    transcriptionSettingsSave.setAttribute('aria-busy', 'true');
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.setAttribute('role', 'status');
    transcriptionSettingsNote.textContent = '正在安全保存…';
    [transcriptionWorkspace, llmApiKey, llmBaseUrl, llmModel].forEach((field) => field?.removeAttribute('aria-invalid'));
    let result;
    let saveTimeoutId = null;
    try {
      const saveRequest = window.notchAPI.setTranscriptionConfig({
        apiKey: transcriptionApiKey.value,
        region: transcriptionRegion.value,
        workspaceId: transcriptionWorkspace.value,
        llmApiKey: llmApiKey.value,
        llmBaseUrl: llmBaseUrl.value,
        llmModel: llmModel.value,
      });
      const timeout = new Promise((resolve) => {
        saveTimeoutId = setTimeout(() => resolve({ ok: false, error: 'save_timeout' }), 12000);
      });
      result = await Promise.race([saveRequest, timeout]);
    } catch (error) {
      result = { ok: false, error: 'save_failed' };
    } finally {
      if (saveTimeoutId) clearTimeout(saveTimeoutId);
    }
    transcriptionSettingsSave.disabled = false;
    transcriptionSettingsSave.textContent = '保存';
    transcriptionSettingsSave.removeAttribute('aria-busy');
    if (!result || !result.ok) {
      const errorCode = result?.error || 'save_failed';
      transcriptionSettingsNote.classList.remove('success');
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.setAttribute('role', 'alert');
      transcriptionSettingsNote.textContent = errorCode === 'invalid_workspace'
        ? 'Workspace ID 格式不正确。'
        : errorCode === 'invalid_llm_url'
          ? '大语言模型 Base URL 必须是有效的 HTTPS 地址。'
        : errorCode === 'secure_storage_unavailable'
          ? 'macOS 安全存储当前不可用。请先解锁登录钥匙串，再重新打开应用。'
        : errorCode === 'secure_storage_failed' || errorCode === 'secure_storage_verify_failed'
          ? '密钥未能安全写入或读回。请解锁登录钥匙串并重试；原配置没有被覆盖。'
        : errorCode === 'save_timeout'
          ? '安全存储 12 秒内没有响应。请检查是否有被遮挡的 macOS 钥匙串确认窗口，然后重试。'
          : '配置文件写入失败。原配置没有被覆盖，请重新打开应用后再试。';
      if (errorCode === 'invalid_workspace') transcriptionWorkspace?.setAttribute('aria-invalid', 'true');
      if (errorCode === 'invalid_llm_url') llmBaseUrl?.setAttribute('aria-invalid', 'true');
      transcriptionSettingsNote.focus();
      return;
    }
    transcriptionConfig = result;
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.classList.add('success');
    transcriptionSettingsNote.setAttribute('role', 'status');
    transcriptionSettingsNote.textContent = '已安全保存。为保护密钥，输入框不会回显明文；上方状态可确认是否已配置。';
    transcriptionSettingsSave.textContent = '已保存';
    setTimeout(() => {
      if (transcriptionSettingsSave) transcriptionSettingsSave.textContent = '保存';
    }, 1200);
    if (
      transcriptionConfig.configured
      && ['recording', 'paused'].includes(recordingStatus)
      && !transcriptionStartPromise
    ) {
      stopSpeechRecognition();
      transcriptionStatus = 'idle';
      transcriptionStartPromise = startCloudTranscription();
    }
    updateRecordingUi();
    renderSettingsPanel();
  }

  function persistRecordings() {
    return saveJson(RECORDINGS_KEY, recordings.filter((recording) => !recording.isDraft));
  }

  const voiceCaptureErrors=new Map();
  function voiceFor(recording){return recording.voice ||= window.VoiceMemoModel.normalize({rawTranscript:recording.transcript});}
  function captureVoice(recording){
    if(!recording.quickCapture||recording.isDraft)return {ok:false,error:'not_ready'};
    const v=voiceFor(recording),organized=v.status==='done'&&!!v.cleaned.trim();
    const result=window.QuickRecords?.command({action:'capture',recordingId:recording.id,content:organized?v.cleaned:(v.rawTranscript||recording.transcript||'暂无转写，可回听原音频后补充。'),organized});
    if(!result?.ok){voiceCaptureErrors.set(recording.id,result?.error||'storage_failed');showStatusToast('录音已保留，但随手记尚未保存。请在录音结果中重试存入随手记。');}
    else voiceCaptureErrors.delete(recording.id);
    return result||{ok:false,error:'storage_failed'};
  }
  async function organizeVoice(recording){
    if(!recording||recording.isDraft||voiceJobs.has(recording.id))return;
    const v=voiceFor(recording),source=recording.transcript;
    v.status='running';v.error='';
    if(!persistRecordings()){v.status='failed';v.error='storage_failed';if(selectedRecordingId===recording.id)renderRecordingDetail();return;}
    if(selectedRecordingId===recording.id)renderRecordingDetail();
    const token={};voiceJobs.set(recording.id,token);
    let result;try{result=await window.notchAPI?.organizeVoice({id:recording.id,text:source,markers:v.markers});}catch{result={ok:false,error:'request_failed'};}
    if(voiceJobs.get(recording.id)!==token)return;voiceJobs.delete(recording.id);
    if(!recordings.includes(recording))return;
    if(recording.transcript!==source){v.status='failed';v.error='source_changed';}
    else if(result?.ok){v.cleaned=result.cleaned;v.summary=result.summary;v.uncertainties=result.uncertainties;v.status='done';v.error='';v.updatedAt=Date.now();}
    else{v.status=result?.error==='cancelled'?'cancelled':'failed';v.error=result?.error||'request_failed';}
    if(!persistRecordings()){v.status='failed';v.error='storage_failed';}
    if(recording.quickCapture)captureVoice(recording);
    if(selectedRecordingId===recording.id)renderRecordingDetail();
    updateRecordingUi();
  }
  function markRecording(){
    if(!['recording','paused'].includes(recordingStatus)||recordingMarkers.length>=100)return;
    recordingMarkers.push({offsetMs:currentDuration(),context:currentRecordingText().slice(-180)});
    updateRecordingUi();
  }
  function setAutoOrganize(value){
    if(!saveJson(VOICE_SETTINGS_KEY,{autoOrganize:!!value})){showStatusToast('自动整理设置未保存，请重试。');return false;}
    autoOrganize=!!value;for(const box of document.querySelectorAll('[data-voice-auto]'))box.checked=autoOrganize;updateRecordingUi();return true;
  }

  function currentDuration() {
    return Domain.calculateRecordingDuration({
      startedAt: recordingStartedAt,
      status: recordingStatus,
      pausedAt,
      pausedTotalMs,
      now: Date.now(),
    });
  }

  function activeRecordingDraft() {
    return recordingDraftId && recordings.find((recording) => recording.id === recordingDraftId) || null;
  }

  function currentRecordingText() {
    return `${recordingTranscript} ${interimTranscript}`.trim();
  }

  function currentRecordingFeedback() {
    if (recordingCaptureIssue) return recordingCaptureIssue;
    if (recordingStatus === 'saving') return '正在保存录音…';
    if (transcriptionConfig.asrNeedsReentry) return '转写密钥已失效 · 请重新配置 API Key';
    if (transcriptionStatus === 'browser-error') return '未配置转写 API · 音频仍在录制';
    if (transcriptionStatus === 'error') return '转写连接失败 · 音频仍在录制';
    if (transcriptionStatus === 'connecting') return '正在连接转写服务';
    if (recordingStatus === 'paused') return '录音已暂停';
    if (!transcriptionConfig.configured && !currentRecordingText()) return '未配置转写 API · 音频仍会保存在本机';
    return '正在录音';
  }

  function beginRecordingDraft() {
    recordingDraftId = uid('recording');
    const draft = {
      ...Domain.createRecording({
        id: recordingDraftId,
        createdAt: recordingStartedAt,
        durationMs: 0,
        transcript: '',
      }),
      isDraft: true,
    };
    recordings.unshift(draft);
    selectedRecordingId = draft.id;
    recordingSelectionAnchor = draft.id;
    renderRecordings();
  }

  function discardRecordingDraft() {
    if (!recordingDraftId) return;
    recordings = recordings.filter((recording) => recording.id !== recordingDraftId);
    recordingSelection.delete(recordingDraftId);
    selectedRecordingId = recordings[0]?.id || '';
    recordingSelectionAnchor = selectedRecordingId || null;
    recordingDraftId = '';
    renderRecordings();
  }

  function syncRecordingDraftUi() {
    const draft = activeRecordingDraft();
    if (!draft) return;
    const durationMs = recordingStopDurationMs || currentDuration();
    const text = currentRecordingText();
    draft.durationMs = durationMs;
    draft.transcript = recordingTranscript;
    const row = recordingList?.querySelector(`.recording-item[data-id="${CSS.escape(draft.id)}"]`);
    const preview = row?.querySelector('[data-recording-preview]');
    const meta = row?.querySelector('[data-recording-meta]');
    if (preview) preview.textContent = text || currentRecordingFeedback();
    if (meta) meta.textContent = `${recordingStatus === 'saving' ? '保存中' : recordingStatus === 'paused' ? '已暂停' : '录音中'} · ${formatClock(durationMs)}`;
    if (selectedRecordingId !== draft.id) return;
    const detailState = recordingDetail?.querySelector('[data-recording-live-state]');
    const detailDot = recordingDetail?.querySelector('[data-recording-live-dot]');
    const detailTime = recordingDetail?.querySelector('[data-recording-live-time]');
    const detailTranscript = recordingDetail?.querySelector('[data-recording-live-transcript]');
    const detailFeedback = recordingDetail?.querySelector('[data-recording-live-feedback]');
    const detailConfigure = recordingDetail?.querySelector('[data-action="configure-transcription"]');
    const detailPause = recordingDetail?.querySelector('.recording-live-pause');
    const detailStop = recordingDetail?.querySelector('.recording-live-stop');
    if (detailState) detailState.textContent = recordingStatus === 'save-failed' ? '等待重试保存' : recordingStatus === 'saving' ? '正在保存' : recordingStatus === 'paused' ? '已暂停' : '正在录音';
    if (detailDot) detailDot.dataset.state = recordingStatus;
    if (detailTime) detailTime.textContent = formatClock(durationMs);
    if (detailTranscript && detailTranscript.value !== text) detailTranscript.value = text;
    if (detailFeedback) detailFeedback.textContent = recordingCaptureIssue || (text ? '转写内容会随录音实时更新' : currentRecordingFeedback());
    if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
    if (detailPause) {
      detailPause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      detailPause.disabled = !['recording','paused'].includes(recordingStatus);
    }
    if (detailStop) detailStop.disabled = !['recording','paused'].includes(recordingStatus);
    const mark=recordingDetail?.querySelector('[data-voice-mark]');
    if(mark){mark.textContent=`标记重点${recordingMarkers.length ? ` · ${recordingMarkers.length}` : ''}`;mark.disabled=!['recording','paused'].includes(recordingStatus)||recordingMarkers.length>=100;}
  }

  function stopTranscriptionAudioPipeline() {
    if (transcriptionAudioProcessor) {
      transcriptionAudioProcessor.onaudioprocess = null;
      try { transcriptionAudioProcessor.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioSource) {
      try { transcriptionAudioSource.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioMute) {
      try { transcriptionAudioMute.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioContext) transcriptionAudioContext.close().catch(() => {});
    transcriptionAudioContext = null;
    transcriptionAudioSource = null;
    transcriptionAudioProcessor = null;
    transcriptionAudioMute = null;
    transcriptionPcmQueue = [];
  }

  function sendTranscriptionPcm(buffer) {
    if (!buffer || !buffer.byteLength || !window.notchAPI) return;
    if (transcriptionStatus === 'connected') {
      window.notchAPI.sendTranscriptionAudio(buffer);
      return;
    }
    if (transcriptionStatus === 'connecting') {
      transcriptionPcmQueue.push(buffer);
      if (transcriptionPcmQueue.length > 120) transcriptionPcmQueue.shift();
    }
  }

  function startTranscriptionAudioPipeline(stream) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream) return false;
    try {
      transcriptionAudioContext = new AudioContext({ sampleRate: 16000 });
      transcriptionAudioSource = transcriptionAudioContext.createMediaStreamSource(stream);
      transcriptionAudioProcessor = transcriptionAudioContext.createScriptProcessor(2048, 1, 1);
      transcriptionAudioMute = transcriptionAudioContext.createGain();
      transcriptionAudioMute.gain.value = 0;
      transcriptionAudioProcessor.onaudioprocess = (event) => {
        if (recordingStatus !== 'recording') return;
        const source = event.inputBuffer.getChannelData(0);
        const pcm = Domain.resampleFloat32ToPcm16(source, transcriptionAudioContext.sampleRate, 16000);
        sendTranscriptionPcm(pcm.buffer);
      };
      transcriptionAudioSource.connect(transcriptionAudioProcessor);
      transcriptionAudioProcessor.connect(transcriptionAudioMute);
      transcriptionAudioMute.connect(transcriptionAudioContext.destination);
      return true;
    } catch (error) {
      stopTranscriptionAudioPipeline();
      return false;
    }
  }

  async function startCloudTranscription() {
    if (!transcriptionConfig.configured || !window.notchAPI || !mediaStream) return { ok: false, error: 'not_configured' };
    transcriptionStatus = 'connecting';
    transcriptionPcmQueue = [];
    startTranscriptionAudioPipeline(mediaStream);
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.startTranscription();
    } catch (error) {
      result = { ok: false, error: 'connection_failed' };
    }
    if (!result || !result.ok) {
      transcriptionStatus = 'error';
      stopTranscriptionAudioPipeline();
      updateRecordingUi();
      return result || { ok: false };
    }
    transcriptionStatus = 'connected';
    const queued = transcriptionPcmQueue;
    transcriptionPcmQueue = [];
    queued.forEach((buffer) => window.notchAPI.sendTranscriptionAudio(buffer));
    updateRecordingUi();
    return result;
  }

  async function finishCloudTranscription() {
    if (!transcriptionStartPromise) return { ok: false, error: 'not_active', transcript: recordingTranscript };
    const queued=transcriptionPcmQueue;
    stopTranscriptionAudioPipeline();
    // Retain the opening syllables if the user stops while the socket is connecting.
    transcriptionPcmQueue=queued;
    await transcriptionStartPromise;
    transcriptionStartPromise = null;
    if (transcriptionStatus !== 'connected') return { ok: false, error: 'not_connected', transcript: recordingTranscript };
    transcriptionStatus = 'finishing';
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.finishTranscription();
    } catch (error) {
      result = { ok: false, error: 'finish_failed', transcript: recordingTranscript };
    }
    if (result && result.transcript) recordingTranscript = result.transcript;
    else recordingTranscript=currentRecordingText();
    transcriptionStatus = result && result.ok ? 'idle' : 'error';
    interimTranscript = '';
    updateRecordingUi();
    return result;
  }

  if (window.notchAPI && typeof window.notchAPI.onTranscriptionEvent === 'function') {
    window.notchAPI.onTranscriptionEvent((event) => {
      if (!event || !['recording', 'paused', 'saving'].includes(recordingStatus)) return;
      if (event.type === 'transcript') {
        recordingTranscript = String(event.final || '').trim();
        interimTranscript = String(event.interim || '').trim();
      } else if (event.type === 'error') {
        transcriptionStatus = 'error';
      }
      updateRecordingUi();
    });
  }

  function updateRecordingUi() {
    const active = recordingStatus !== 'idle';
    if (homeRecorder) homeRecorder.dataset.state = recordingStatus;
    if (recordingDot) recordingDot.dataset.state = recordingStatus;
    if (recordingStateLabel) {
      recordingStateLabel.textContent = recordingStatus === 'recording'
        ? '正在录音'
        : recordingStatus === 'paused'
          ? '已暂停'
          : recordingStatus === 'saving'
            ? '正在保存'
            : recordingStatus === 'save-failed' ? '等待重试保存' : '快速录音';
    }
    if (recordingTime) recordingTime.textContent = formatClock(active ? recordingStopDurationMs || currentDuration() : 0);
    if (recordStart) recordStart.disabled = active;
    if (recordPause) {
      recordPause.disabled = !['recording', 'paused'].includes(recordingStatus);
      recordPause.setAttribute('aria-label', recordingStatus === 'paused' ? '继续录音' : '暂停录音');
      recordPause.classList.toggle('resume', recordingStatus === 'paused');
    }
    if (recordStop) recordStop.disabled = !['recording', 'paused'].includes(recordingStatus);
    if (recordingNew) {
      recordingNew.disabled = active;
      recordingNew.textContent = active ? '录制' : '录音';
      recordingNew.setAttribute('aria-label', active ? '录音进行中' : '开始录音');
    }
    if (liveTranscript && active) {
      const text = currentRecordingText();
      // asrNeedsReentry = 密文还在但当前应用解不开它。safeStorage 的密钥存在钥匙串里、
      // ACL 绑代码签名，所以开发版存的 Key 装成 DMG 后就读不出来（ad-hoc 签名每次打包
      // 都会换 cdhash，也是同样的结果）。这种情况下录音正常、只有转写不工作，
      // 原来只在设置面板里提示一行，录音的人看不到，表现就是「能录但不转写」。
      const fallback = currentRecordingFeedback();
      liveTranscript.textContent = text || fallback;
      liveTranscript.hidden = !(text || fallback);
    }
    syncRecordingDraftUi();
    window.notchAPI?.broadcastFloat?.({ kind: 'recorder', ...recordingSnapshot() });
  }

  function recordingSnapshot() {
    return { ok: true, recordingId:recordingDraftId||'', status: recordingStarting ? 'starting' : recordingStatus,
      time: formatClock(recordingStatus!=='idle' ? recordingStopDurationMs || currentDuration() : 0),
      feedback: recordingCaptureIssue || (recordingStatus==='idle' ? '原音频与转写先保存，整理失败可重试。' : currentRecordingFeedback()),
      transcript:currentRecordingText(),markers:recordingMarkers.length,autoOrganize,saveFailed:!!pendingRecording,
      theme: document.documentElement.dataset.theme };
  }

  // The hidden main renderer remains the sole audio owner. Satellite controls never create a second MediaRecorder.
  window.PanelRecording = Object.freeze({
    snapshot: recordingSnapshot,
    async open(id){
      if(!recordings.some(r=>r.id===id&&!r.isDraft))return {ok:false,error:'not_found'};
      selectedRecordingId=id;await setMode(true);await setActiveTab('recordings');renderRecordings();return {ok:true};
    },
    async command(action,expectedRecordingId) {
      if(action==='timer-stop'){
        if(!expectedRecordingId||recordingDraftId!==expectedRecordingId||!['recording','paused'].includes(recordingStatus))return {ok:false,error:'recording_changed'};
        stopRecording();return recordingSnapshot();
      }
      if(action==='planner-start'){
        if(recordingStarting||recordingStatus!=='idle')return {ok:false,error:'recording_busy'};
        await startRecording('planner');return {...recordingSnapshot(),ok:recordingStatus==='recording',recordingId:recordingDraftId};
      }
      if (action === 'start') await startRecording();
      else if (action === 'pause') togglePauseRecording();
      else if (action === 'stop') stopRecording();
      else if(action==='mark')markRecording();
      else if(action==='auto-on'||action==='auto-off')setAutoOrganize(action==='auto-on');
      else if(action==='retry-save'&&pendingRecording&&recordingStatus==='save-failed')await finalizeRecording(pendingRecording.blob,pendingRecording.durationMs);
      else if(action==='results'){await setMode(true);await setActiveTab('recordings');}
      else if(action==='planner-text'){
        const latest=recordings.find(r=>!r.isDraft);
        return {ok:true,...recordingSnapshot(),recordingId:latest?.id||'',savedText:latest?.voice?.rawTranscript||latest?.transcript||''};
      }
      else if (action === 'permissions') { await setMode(true); await setActiveTab('settings'); }
      else if (action !== 'get') return { ok: false, error: 'invalid_action' };
      return recordingSnapshot();
    },
  });

  function stopSpeechRecognition(preservePartial=false) {
    const recognition = speechRecognition;
    speechRecognition = null;
    if (recognition) {
      if(preservePartial){recordingTranscript=currentRecordingText();recognition.onresult=null;}
      try { recognition.stop(); } catch (error) {}
    }
    interimTranscript = '';
  }

  function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      transcriptionStatus = 'browser-error';
      updateRecordingUi();
      return;
    }
    if (speechRecognitionBlocked || recordingStatus !== 'recording') return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      interimTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0] && event.results[index][0].transcript || '').trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          recordingTranscript = `${recordingTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }
      updateRecordingUi();
    };
    recognition.onerror = (event) => {
      recordingTranscript=currentRecordingText();
      interimTranscript = '';
      speechRecognitionError = String(event && event.error || 'unknown');
      if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture'].includes(speechRecognitionError)) {
        speechRecognitionBlocked = true;
        transcriptionStatus = 'browser-error';
      }
      updateRecordingUi();
    };
    recognition.onend = () => {
      if (speechRecognition !== recognition) return;
      speechRecognition = null;
      if (recordingStatus === 'recording' && !speechRecognitionBlocked) setTimeout(startSpeechRecognition, 180);
    };
    speechRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      speechRecognition = null;
    }
  }

  function stopMediaTracks() {
    stopRecordingStrands();
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function chooseRecordingMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
  }

  async function finalizeRecording(blob, durationMs) {
    pendingRecording ||= {blob,durationMs,saved:null};
    recordingStatus = 'saving';
    updateRecordingUi();
    if (!blob || blob.size === 0) {
      recordingStatus='save-failed';recordingCaptureIssue='录音为空，转写仍在当前草稿中，请复制备份。';updateRecordingUi();renderRecordingDetail();
      return;
    }
    let saved;
    try {
      saved = pendingRecording.saved || window.notchAPI && await window.notchAPI.saveRecording({
        bytes: await blob.arrayBuffer(),
        mimeType: blob.type || 'audio/webm',
        metadata:{id:activeRecordingDraft()?.id,createdAt:recordingStartedAt,durationMs,voice:{rawTranscript:recordingTranscript,markers:recordingMarkers}},
      });
    } catch (error) {
      saved = null;
    }
    if (saved && saved.ok) {
      pendingRecording.saved=saved;
      const draft = activeRecordingDraft();
      const recording = Domain.createRecording({
        id: draft?.id || uid('recording'),
        createdAt: draft?.createdAt || Date.now(),
        durationMs,
        transcript: recordingTranscript,
        audioPath: saved.audioPath,
        mimeType: saved.mimeType || blob.type,
        voice:{rawTranscript:recordingTranscript,markers:recordingMarkers},
        quickCapture:recordingPurpose!=='planner',
      });
      const draftIndex = recordings.findIndex((item) => item.id === recording.id);
      if (draftIndex >= 0) recordings.splice(draftIndex, 1, recording);
      else recordings.unshift(recording);
      selectedRecordingId = recording.id;
      if(!persistRecordings()){
        recording.isDraft=true;recordingStatus='save-failed';recordingCaptureIssue='音频已写入，但记录索引保存失败。请重试保存；不要退出。';updateRecordingUi();renderRecordings();return;
      }
      recordingDraftId = '';
      pendingRecording=null;
      if(recording.quickCapture)captureVoice(recording);
      renderRecordings();
      if(autoOrganize&&recordingPurpose!=='planner')void organizeVoice(recording);
      if (liveTranscript) {
        liveTranscript.textContent = recording.transcript || (transcriptionConfig.configured
          ? '录音已保存 · 暂无转写'
          : '录音已保存 · 请配置转写 API');
        liveTranscript.hidden = false;
      }
    } else {
      recordingStatus='save-failed';recordingCaptureIssue='音频未能写入本机，当前音频与转写仍在内存中。请重试保存，不要退出。';updateRecordingUi();renderRecordingDetail();return;
    }
    recordingStatus = 'idle';
    recordingStartedAt = 0;
    pausedAt = 0;
    pausedTotalMs = 0;
    audioChunks = [];
    recordingTranscript = '';
    interimTranscript = '';
    recordingCaptureIssue = '';
    updateRecordingUi();
  }

  async function startRecording(purpose='memo') {
    if (recordingStarting || recordingStatus !== 'idle' || !navigator.mediaDevices || !window.MediaRecorder) return;
    recordingStarting = true;
    recordingPurpose=purpose==='planner'?'planner':'memo';
    updateRecordingUi();
    if (liveTranscript) {
      liveTranscript.textContent = '';
      liveTranscript.hidden = true;
    }
    try {
      if (window.notchAPI && !(await window.notchAPI.ensureMicrophone())) {
        recordingCaptureIssue='无法访问麦克风，请打开权限与设置进行检测。';
        setMicrophoneRecoveryVisible(true);
        if (liveTranscript) {
          liveTranscript.textContent = '无法访问麦克风 · 请在系统设置中授权';
          liveTranscript.hidden = false;
        }
        return;
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== 'live') throw new Error('audio_track_unavailable');
      setMicrophoneRecoveryVisible(false);
      recordingCaptureIssue = '';
      audioTrack.addEventListener('mute', () => {
        if (!['recording', 'paused'].includes(recordingStatus)) return;
        recordingCaptureIssue = '麦克风无输入 · 请检查系统音源';
        updateRecordingUi();
      });
      audioTrack.addEventListener('unmute', () => {
        recordingCaptureIssue = '';
        updateRecordingUi();
      });
      startRecordingStrands(mediaStream);
      const mimeType = chooseRecordingMimeType();
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      audioChunks = [];
      recordingMarkers=[];
      recordingTranscript = '';
      interimTranscript = '';
      speechRecognitionBlocked = false;
      speechRecognitionError = '';
      recordingStartedAt = Date.now();
      recordingStopDurationMs = 0;
      pausedTotalMs = 0;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) audioChunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        recordingCaptureIssue = '录音中断 · 请重新开始';
        updateRecordingUi();
      };
      mediaRecorder.onstop = async () => {
        const durationMs = recordingStopDurationMs || currentDuration();
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
        stopMediaTracks();
        if (transcriptionFinishPromise) {
          await transcriptionFinishPromise;
          transcriptionFinishPromise = null;
        }
        finalizeRecording(blob, durationMs);
      };
      mediaRecorder.start(1000);
      recordingStatus = 'recording';
      transcriptionStatus = 'idle';
      transcriptionStartPromise = null;
      transcriptionFinishPromise = null;
      beginRecordingDraft();
      if (transcriptionConfig.configured) {
        transcriptionStartPromise = startCloudTranscription();
      } else {
        startSpeechRecognition();
      }
      clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingUi, 500);
      updateRecordingUi();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      recordingCaptureIssue = '无法开始录音，请检查麦克风权限和系统音源。';
      discardRecordingDraft();
      setMicrophoneRecoveryVisible(true);
      if (liveTranscript) {
        liveTranscript.textContent = '无法开始录音 · 请检查麦克风权限';
        liveTranscript.hidden = false;
      }
      updateRecordingUi();
    } finally {
      recordingStarting = false;
      updateRecordingUi();
    }
  }

  function togglePauseRecording() {
    if (!mediaRecorder) return;
    if (recordingStatus === 'recording') {
      mediaRecorder.pause();
      pausedAt = Date.now();
      recordingStatus = 'paused';
      if (!transcriptionConfig.configured) stopSpeechRecognition(true);
    } else if (recordingStatus === 'paused') {
      pausedTotalMs += Date.now() - pausedAt;
      pausedAt = 0;
      mediaRecorder.resume();
      recordingStatus = 'recording';
      if (!transcriptionConfig.configured) startSpeechRecognition();
    }
    updateRecordingUi();
  }

  function stopRecording() {
    if (!mediaRecorder || !['recording', 'paused'].includes(recordingStatus)) return;
    recordingStopDurationMs = currentDuration();
    recordingStatus = 'saving';
    stopSpeechRecognition(true);
    transcriptionFinishPromise = transcriptionStartPromise
      ? finishCloudTranscription()
      : Promise.resolve({ ok: false, error: 'not_active', transcript: recordingTranscript });
    clearInterval(recordingTimer);
    recordingTimer = null;
    updateRecordingUi();
    try {
      mediaRecorder.stop();
    } catch (error) {
      stopMediaTracks();
      awaitRecordingStopFailure();
    }
  }

  function awaitRecordingStopFailure(){
    // Some recorders throw after delivering chunks; retain everything available.
    void finalizeRecording(new Blob(audioChunks,{type:mediaRecorder?.mimeType||'audio/webm'}),recordingStopDurationMs);
  }

  function saveTextOnly(){
    if(recordingStatus!=='save-failed'||pendingRecording?.blob?.size)return;
    const draft=activeRecordingDraft();if(!draft)return;
    const value=Domain.createRecording({...draft,quickCapture:recordingPurpose!=='planner',transcript:currentRecordingText(),voice:{rawTranscript:currentRecordingText(),markers:recordingMarkers}});
    const index=recordings.indexOf(draft);recordings[index]=value;
    if(!persistRecordings()){recordings[index]=draft;showStatusToast('转写也未能保存，请先复制备份后重试');return;}
    if(value.quickCapture){captureVoice(value);if(autoOrganize)void organizeVoice(value);}
    recordingDraftId='';pendingRecording=null;recordingStatus='idle';recordingTranscript='';interimTranscript='';audioChunks=[];recordingCaptureIssue='';
    updateRecordingUi();renderRecordings();showStatusToast('已仅保存转写；本次未获得可用音频');
  }

  if (recordStart) recordStart.addEventListener('click', startRecording);
  if (recordPause) recordPause.addEventListener('click', togglePauseRecording);
  if (recordStop) recordStop.addEventListener('click', stopRecording);
  if (recordingNew) recordingNew.addEventListener('click', startRecording);
  if (recordingConfigure) recordingConfigure.addEventListener('click', openTranscriptionSettings);
  const voiceAuto=document.getElementById('voice-auto');
  if(voiceAuto){voiceAuto.checked=autoOrganize;voiceAuto.addEventListener('change',()=>{if(!setAutoOrganize(voiceAuto.checked))voiceAuto.checked=autoOrganize;});}
  document.getElementById('voice-recover')?.addEventListener('click',async()=>{
    const result=await window.notchAPI?.recoverRecordings().catch(()=>null);
    if(!result?.ok){showStatusToast('备份读取失败，请稍后重试');return;}
    const ids=new Set(recordings.map(r=>r.id)),added=[];
    for(const value of result.recordings){const r=Domain.createRecording(value);if(r&&!ids.has(r.id)){ids.add(r.id);added.push(r);}}
    const before=recordings;recordings=[...recordings,...added];
    if(!persistRecordings()){recordings=before;showStatusToast('本机空间不足，恢复尚未写入，请清理空间后重试');return;}
    selectedRecordingId ||= added[0]?.id||'';renderRecordings();showStatusToast(added.length?`已恢复 ${added.length} 条本机录音`:'没有需要恢复的新记录');
  });
  if (settingsApiConfigure) settingsApiConfigure.addEventListener('click', openTranscriptionSettings);
  if (transcriptionSettingsClose) transcriptionSettingsClose.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsCancel) transcriptionSettingsCancel.addEventListener('click', closeTranscriptionSettings);
  transcriptionSettingsForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveTranscriptionSettings();
  });
  if (transcriptionApiHelp) {
    transcriptionApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key');
    });
  }
  if (llmApiHelp) {
    llmApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://platform.deepseek.com/api_keys');
    });
  }
  if (transcriptionSettingsBackdrop) {
    transcriptionSettingsBackdrop.addEventListener('click', (event) => {
      if (event.target === transcriptionSettingsBackdrop) closeTranscriptionSettings();
    });
  }
  if (window.notchAPI && typeof window.notchAPI.onOpenApiSettings === 'function') {
    window.notchAPI.onOpenApiSettings(async () => {
      if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
      openTranscriptionSettings();
    });
  }
  settingsFeatureList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-feature]');
    if (!input || !window.notchAPI?.setFeature) return;
    input.disabled = true;
    const result = await window.notchAPI.setFeature(input.dataset.settingsFeature, input.checked)
      .catch(() => ({ ok: false }));
    input.disabled = false;
    if (!result?.ok) {
      input.checked = !input.checked;
      setSettingsNote('功能显示设置保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote('显示功能已更新。');
  });
  async function addSettingsMirrorImages() {
    if (!window.NotchMirrorGallery?.addImages) return;
    const result = await window.NotchMirrorGallery.addImages();
    if (result?.canceled) return;
    if (!result?.ok) {
      setSettingsNote('图片添加失败，请选择有效且尺寸适中的图片。', true);
      return;
    }
    applySettingsMirrorGallery(window.NotchMirrorGallery.getState());
    setSettingsNote(`已添加 ${result.addedCount} 张图片。`);
  }
  async function replaceSettingsMirrorImage() {
    if (!window.NotchMirrorGallery?.replaceActive) return addSettingsMirrorImages();
    const result = await window.NotchMirrorGallery.replaceActive();
    if (result?.canceled) return result;
    if (!result?.ok) {
      setSettingsNote('图片更换失败，请选择有效且尺寸适中的图片。', true);
      return result;
    }
    applySettingsMirrorGallery(window.NotchMirrorGallery.getState());
    setSettingsNote('当前图片已更换。');
    return result;
  }
  settingsMirrorPreviewAction?.addEventListener('click', () => { void replaceSettingsMirrorImage(); });
  settingsMirrorChoose?.addEventListener('click', () => { void addSettingsMirrorImages(); });
  settingsMirrorPrevious?.addEventListener('click', async () => {
    const result = await window.NotchMirrorGallery?.previous?.();
    if (!result?.ok) setSettingsNote('无法切换图片。', true);
  });
  settingsMirrorNext?.addEventListener('click', async () => {
    const result = await window.NotchMirrorGallery?.next?.();
    if (!result?.ok) setSettingsNote('无法切换图片。', true);
  });
  settingsMirrorRemove?.addEventListener('click', async () => {
    const result = await window.NotchMirrorGallery?.removeActive?.();
    if (result?.canceled) return;
    if (!result?.ok) {
      setSettingsNote('图片移除失败。', true);
      return;
    }
    setSettingsNote('图片已移到系统废纸篓。');
  });
  settingsShortcutChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('notch:record-shortcut'));
  });
  document.querySelectorAll('[data-permission-pane]').forEach((button) => {
    button.addEventListener('click', async () => {
      const opened = await window.notchAPI?.openPrivacySettings?.(button.dataset.permissionPane).catch(() => false);
      if (settingsPermissionNote) {
        settingsPermissionNote.textContent = opened
          ? '已打开系统设置。允许 Handy 后回到这里重新检测；若系统要求退出，请选择“退出并重新打开”。列表没有时，可在下方定位当前应用再添加。'
          : '未能打开设置。请手动进入“系统设置 → 隐私与安全性”选择对应权限，或再次尝试。';
        settingsPermissionNote.classList.toggle('error', !opened);
      }
    });
  });
  let permissionRequestPending = false;
  document.querySelectorAll('[data-permission-request]').forEach(button => {
    button.addEventListener('click', async () => {
      if (permissionRequestPending) return;
      permissionRequestPending = true;
      const buttons = document.querySelectorAll('[data-permission-request]');
      buttons.forEach(item => { item.disabled = true; });
      button.setAttribute('aria-busy', 'true');
      if (settingsPermissionNote) settingsPermissionNote.textContent = '正在向系统请求；如有系统提示，请在那里确认。';
      try {
        const result = await window.notchAPI?.requestPermission?.(button.dataset.permissionRequest);
        await refreshPermissionStatuses();
        if (settingsPermissionNote) {
          settingsPermissionNote.textContent = result?.message || '请求未完成，请重试或打开系统设置。';
          settingsPermissionNote.classList.toggle('error', !result?.ok);
        }
      } catch {
        if (settingsPermissionNote) { settingsPermissionNote.textContent = '请求未完成。可以重试或打开设置，不必清除已有授权。'; settingsPermissionNote.classList.add('error'); }
      } finally {
        permissionRequestPending = false;
        buttons.forEach(item => { item.disabled = false; });
        button.removeAttribute('aria-busy');
      }
    });
  });
  document.getElementById('settings-reveal-app')?.addEventListener('click', async () => {
    const shown = await window.notchAPI?.revealCurrentApp?.().catch(() => false);
    if (settingsPermissionNote) {
      settingsPermissionNote.textContent = shown ? '已在访达选中当前 Handy。授权时请选择这个应用；不要选择 Electron 或其他助手应用。' : '未能定位正式应用。请重新检测安装状态；开发预览不支持此操作。';
      settingsPermissionNote.classList.toggle('error', !shown);
    }
  });
  settingsPermissionRefresh?.addEventListener('click', () => {
    void refreshPermissionStatuses({ announce: true });
  });
  settingsPermissionRelaunch?.addEventListener('click', () => {
    void relaunchForPermissions();
  });
  document.querySelectorAll('[data-microphone-open]').forEach((button) => {
    button.addEventListener('click', () => window.notchAPI?.openPrivacySettings?.('microphone'));
  });
  document.querySelectorAll('[data-microphone-retry]').forEach((button) => {
    button.addEventListener('click', () => void startRecording());
  });
  document.querySelectorAll('[data-permission-relaunch]').forEach((button) => {
    button.addEventListener('click', () => void relaunchForPermissions());
  });
  settingsWorkspaceOpen?.addEventListener('click', () => {
    window.notchAPI?.openWorkspace?.().catch(() => setSettingsNote('无法打开数据文件夹。', true));
  });
  settingsWorkspaceChoose?.addEventListener('click', async () => {
    const changed = await window.notchAPI?.chooseWorkspace?.().catch(() => false);
    if (!changed) return;
    settingsWorkspace = await window.notchAPI?.getWorkspace?.().catch(() => settingsWorkspace);
    renderSettingsPanel();
    setSettingsNote('数据文件夹已更新。');
  });
  settingsAutoLaunch?.addEventListener('change', async () => {
    if (!window.notchAPI?.setAutoLaunch) return;
    settingsAutoLaunch.disabled = true;
    const result = await window.notchAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
    settingsAutoLaunch.disabled = false;
    if (!result?.ok) {
      settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
      setSettingsNote('开机启动设置失败。', true);
      return;
    }
    settingsAutoLaunch.checked = result.autoLaunch === true;
    if (settingsAppSettings) settingsAppSettings.autoLaunch = result.autoLaunch === true;
    setSettingsNote(result.autoLaunch ? '已开启开机自动启动。' : '已关闭开机自动启动。');
  });
  window.notchAPI?.onAppSettingsChanged?.((settings) => {
    settingsAppSettings = settings;
    renderSettingsPanel();
  });
  window.notchAPI?.onWorkspaceChanged?.(() => refreshSettingsPanel());
  document.addEventListener('notch:mirror-gallery-changed', (event) => {
    applySettingsMirrorGallery(event.detail || {});
  });

  async function loadRecordingAudio(recording, container) {
    if (!window.notchAPI || !recording.audioPath) return;
    const result = await window.notchAPI.readRecording(recording.audioPath);
    if (!result || selectedRecordingId !== recording.id || !container.isConnected) {
      container.textContent = '音频文件不可用';
      return;
    }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = currentAudioUrl;
    container.replaceChildren(audio);
  }

  function renderRecordingDetail() {
    if (!recordingDetail) return;
    const recording = recordings.find((item) => item.id === selectedRecordingId);
    recordingDetail.replaceChildren();
    if (!recording) {
      const empty = document.createElement('div');
      empty.className = 'recording-detail-empty';
      empty.textContent = '完成一次录音后，音频和转写文本会保存在这里。';
      recordingDetail.appendChild(empty);
      return;
    }
    if (recording.isDraft) {
      const liveHeader = document.createElement('header');
      liveHeader.className = 'recording-live-head';
      const liveState = document.createElement('div');
      liveState.className = 'recording-live-state';
      const liveDot = document.createElement('span');
      liveDot.className = 'recording-state-dot';
      liveDot.dataset.recordingLiveDot = '';
      liveDot.dataset.state = recordingStatus;
      const liveLabel = document.createElement('strong');
      liveLabel.dataset.recordingLiveState = '';
      const liveTime = document.createElement('time');
      liveTime.dataset.recordingLiveTime = '';
      liveState.append(liveDot, liveLabel);
      liveHeader.append(liveState, liveTime);

      const liveAudio = document.createElement('div');
      liveAudio.className = 'recording-live-audio';
      const liveAudioTitle = document.createElement('strong');
      liveAudioTitle.textContent = '音频正在本机录制';
      const liveAudioHint = document.createElement('span');
      liveAudioHint.textContent = '结束后会自动保存并出现播放器';
      const liveControls = document.createElement('div');
      liveControls.className = 'recording-live-controls';
      const pause = document.createElement('button');
      pause.type = 'button';
      pause.className = 'workspace-button compact recording-live-pause';
      pause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      pause.addEventListener('click', togglePauseRecording);
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'workspace-button compact primary recording-live-stop';
      stop.textContent = '结束并保存';
      stop.addEventListener('click', stopRecording);
      liveControls.append(pause, stop);
      const mark=document.createElement('button');mark.type='button';mark.className='workspace-button compact';mark.dataset.voiceMark='';mark.addEventListener('click',markRecording);liveControls.append(mark);
      if(recordingStatus==='save-failed'){
        liveAudioTitle.textContent='原始内容仍在，请先重试保存';liveAudioHint.textContent='保存成功前请勿退出应用';
        const retry=document.createElement('button');retry.type='button';retry.className='workspace-button compact';retry.textContent='重试保存';
        retry.onclick=()=>{retry.disabled=true;void window.PanelRecording.command('retry-save');};liveControls.append(retry);
        const copy=document.createElement('button');copy.type='button';copy.className='workspace-button compact';copy.textContent='复制转写备份';copy.onclick=()=>window.notchAPI?.writeClipboard({type:'text',text:currentRecordingText()});liveControls.append(copy);
        if(!pendingRecording?.blob?.size){const textOnly=document.createElement('button');textOnly.type='button';textOnly.className='workspace-button compact';textOnly.textContent='仅保存转写并结束';textOnly.onclick=saveTextOnly;liveControls.append(textOnly);}
      }
      liveAudio.append(liveAudioTitle, liveAudioHint, liveControls);

      const transcriptHead = document.createElement('div');
      transcriptHead.className = 'recording-transcript-head';
      const transcriptLabel = document.createElement('span');
      transcriptLabel.className = 'tile-label';
      transcriptLabel.textContent = '实时转写';
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.className = 'workspace-button compact recording-live-configure';
      configure.dataset.action = 'configure-transcription';
      configure.textContent = '配置 API';
      configure.addEventListener('click', openTranscriptionSettings);
      transcriptHead.append(transcriptLabel, configure);

      const transcript = document.createElement('textarea');
      transcript.className = 'recording-transcript-editor recording-live-transcript';
      transcript.readOnly = true;
      transcript.dataset.recordingLiveTranscript = '';
      transcript.placeholder = '开始说话后，转写内容会出现在这里。';
      transcript.setAttribute('aria-label', '实时转写文本');
      const feedback = document.createElement('p');
      feedback.className = 'recording-live-feedback';
      feedback.dataset.recordingLiveFeedback = '';
      feedback.setAttribute('aria-live', 'polite');
      recordingDetail.append(liveHeader, liveAudio, transcriptHead, transcript, feedback);
      syncRecordingDraftUi();
      return;
    }
    const header = document.createElement('header');
    header.className = 'recording-detail-head';
    const title = document.createElement('input');
    title.className = 'recording-title-input';
    title.value = recording.title;
    title.setAttribute('aria-label', '录音名称');
    const meta = document.createElement('span');
    meta.textContent = `${recording.category || '未分类'} · ${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
    header.append(title, meta);

    const audioWrap = document.createElement('div');
    audioWrap.className = 'recording-audio';
    audioWrap.textContent = '正在读取音频…';

    const transcriptHead = document.createElement('div');
    transcriptHead.className = 'recording-transcript-head';
    const label = document.createElement('span');
    label.className = 'tile-label';
    label.textContent = '转写文本';
    const actions = document.createElement('div');
    actions.append(
      createIconButton('copy-recording', '复制转写文本', COPY_ICON),
      createIconButton('reveal-recording', '在访达中显示', OPEN_ICON),
      createIconButton('delete-recording', '删除录音', DELETE_ICON, true)
    );
    transcriptHead.append(label, actions);

    label.textContent='本机录音';
    recordingDetail.append(header, audioWrap, transcriptHead);
    voiceFor(recording);
    window.VoiceMemoView.mount(recordingDetail,recording,{
      save:persistRecordings,
      captureError:()=>voiceCaptureErrors.get(recording.id),
      capture:()=>{recording.quickCapture=true;if(!persistRecordings())return {ok:false,error:'storage_failed'};const result=captureVoice(recording);renderRecordingDetail();return result;},
      quickRecord:()=>{try{return window.QuickRecords.snapshot().state.records.find(r=>r.sourceRecordingId===recording.id);}catch{return null;}},
      openQuick:async()=>{
        const r=window.QuickRecords.snapshot().state.records.find(r=>r.sourceRecordingId===recording.id&&!r.trashedAt);
        if(!r)return {ok:false,error:'not_found'};
        // Let the existing quick editor flush and select; never change its active ID behind it.
        return window.Notebook.openQuick({recordId:r.id});
      },
      copy:text=>window.notchAPI?.writeClipboard({type:'text',text}),
      organize:async(cancel)=>{
        if(cancel){await window.notchAPI?.cancelVoice(recording.id);return;}
        if(recording.voice.cleaned&&!window.confirm('重新整理会替换当前整理稿（包括手动修改），原始转写不会改变。继续吗？'))return;
        await organizeVoice(recording);
      },
      seek:async offset=>{const audio=audioWrap.querySelector('audio');if(!audio){showStatusToast('音频尚未加载，请稍后重试');return;}audio.currentTime=Math.max(0,(offset-3000)/1000);await audio.play().catch(()=>showStatusToast('音频暂时无法播放'));},
    });

    title.addEventListener('change', () => {
      if (title.value.trim()) recording.title = title.value.trim();
      title.value = recording.title;
      persistRecordings();
      renderRecordingList();
    });
    actions.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'copy-recording' && window.notchAPI && recording.transcript) {
        await window.notchAPI.writeClipboard({ type: 'text', text: recording.transcript });
      }
      if (action.dataset.action === 'reveal-recording' && window.notchAPI && recording.audioPath) {
        await window.notchAPI.revealRecording(recording.audioPath);
      }
      if (action.dataset.action === 'delete-recording') {
        await deleteSingleRecording(recording.id);
      }
    });
    loadRecordingAudio(recording, audioWrap);
  }

  async function deleteSingleRecording(recordingId) {
    const recording = recordings.find((item) => item.id === recordingId);
    if (!recording) return;
    voiceJobs.delete(recording.id);
    void window.notchAPI?.cancelVoice(recording.id);
    if (window.notchAPI && recording.audioPath) {
      const removed=await window.notchAPI.deleteRecording(recording.audioPath).catch(() => false);
      if(!removed){showStatusToast('音频删除失败，记录尚未移除，请稍后重试');return;}
    }
    const next = Domain.removeRecordingState(
      recordings,
      recording.id,
      [...recordingSelection],
      selectedRecordingId
    );
    recordings = next.recordings;
    recordingSelection = new Set(next.selection);
    selectedRecordingId = next.selectedId;
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
  }

  function renderRecordingList() {
    if (!recordingList) return;
    recordingList.replaceChildren();
    if (recordingBulkDelete) {
      recordingBulkDelete.hidden = recordingSelection.size === 0;
      recordingBulkDelete.textContent = '删除';
      recordingBulkDelete.setAttribute('aria-label', recordingSelection.size
        ? `删除 ${recordingSelection.size} 项`
        : '删除所选');
    }
    if (!recordings.length) {
      const empty = document.createElement('div');
      empty.className = 'recording-list-empty';
      empty.textContent = '还没有录音';
      recordingList.appendChild(empty);
      return;
    }
    recordings.forEach((recording) => {
      const row = document.createElement('div');
      row.className = `recording-item${recording.id === selectedRecordingId ? ' active' : ''}${recordingSelection.has(recording.id) ? ' multi-selected' : ''}${recording.isDraft ? ' is-live' : ''}`;
      row.dataset.id = recording.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recording-item-main';
      button.setAttribute('aria-label', `打开录音：${recording.title}`);
      const title = document.createElement('strong');
      title.textContent = recording.title;
      const preview = document.createElement('span');
      preview.dataset.recordingPreview = '';
      preview.textContent = recording.isDraft ? (currentRecordingText() || currentRecordingFeedback()) : (recording.transcript || '仅音频 · 暂无转写');
      const meta = document.createElement('time');
      meta.dataset.recordingMeta = '';
      meta.textContent = recording.isDraft
        ? `${recordingStatus === 'saving' ? '保存中' : recordingStatus === 'paused' ? '已暂停' : '录音中'} · ${formatClock(recording.durationMs)}`
        : `${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
      button.append(title, preview, meta);
      row.append(button);
      if (!recording.isDraft) {
        const remove = createIconButton('delete-recording-item', `删除录音：${recording.title}`, DELETE_ICON, true);
        remove.classList.add('recording-item-delete');
        row.append(remove);
      }
      recordingList.appendChild(row);
    });
  }

  function renderRecordings() {
    if (recordingCount) recordingCount.textContent = `${recordings.length} 条`;
    renderRecordingList();
    renderRecordingDetail();
  }

  if (recordingList) {
    recordingList.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-action="delete-recording-item"]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        const row = remove.closest('.recording-item[data-id]');
        if (row) await deleteSingleRecording(row.dataset.id);
        return;
      }
      const item = event.target.closest('.recording-item[data-id]');
      if (!item) return;
      const targetRecording = recordings.find((recording) => recording.id === item.dataset.id);
      if (event.shiftKey && targetRecording && !targetRecording.isDraft) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          recordings.filter((recording) => !recording.isDraft).map((recording) => recording.id),
          [...recordingSelection],
          item.dataset.id,
          recordingSelectionAnchor,
          true
        );
        recordingSelection = new Set(result.selected);
        recordingSelectionAnchor = result.anchor;
        renderRecordingList();
        return;
      }
      selectedRecordingId = item.dataset.id;
      recordingSelectionAnchor = selectedRecordingId;
      renderRecordings();
    });
  }

  recordingBulkDelete?.addEventListener('click', async () => {
    if (!recordingSelection.size) return;
    const targets = recordings.filter((recording) => !recording.isDraft && recordingSelection.has(recording.id));
    if (!targets.length) return;
    if (window.notchAPI) {
      await Promise.all(targets.map((recording) => recording.audioPath
        ? window.notchAPI.deleteRecording(recording.audioPath).catch(() => false)
        : Promise.resolve(true)));
    }
    const targetIds = new Set(targets.map((recording) => recording.id));
    recordings = recordings.filter((recording) => !targetIds.has(recording.id));
    recordingSelection.clear();
    selectedRecordingId = recordings[0] && recordings[0].id;
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
  });

  // ============ 当前窗口 ============
  let workspaceTab = document.querySelector('.tab.active')?.dataset.tab || 'home';
  let workspaceExpanded = document.getElementById('app')?.classList.contains('expanded') || false;
  async function refreshWindows(force = false) {
    if (!force && (!workspaceExpanded || workspaceTab !== 'home')) return;
    return window.WindowToolsHome?.refresh();
  }
  document.addEventListener('notch:tabchange', (event) => {
    workspaceTab = event.detail?.tab || 'home';
    if (workspaceTab === 'home') refreshWindows();
    if (workspaceTab === 'settings') refreshSettingsPanel();
  });
  document.addEventListener('notch:modechange', (event) => {
    workspaceExpanded = !!event.detail?.expanded;
    if (workspaceExpanded && workspaceTab === 'home') refreshWindows();
  });

  // ============ 本地汽水音乐 ============
  const homeMusic = document.getElementById('home-music');
  const musicArtwork = document.getElementById('music-artwork');
  const musicTitle = document.getElementById('music-title');
  const musicStatus = document.getElementById('music-status');
  const musicPlayToggle = document.getElementById('music-play-toggle');
  let musicPlaying = null;
  let musicSnapshot = {installed:false,running:false,playing:null};
  let musicStatusPending = null;
  // Presentation follows the surface, not a shared user preference.
  if(homeMusic)homeMusic.dataset.musicForm='cover';

  function renderMusicPlaybackState() {
    if (!homeMusic || !musicPlayToggle) return;
    homeMusic.classList.toggle('music-playing', musicPlaying === true);
    homeMusic.querySelectorAll('[data-music-action]').forEach(button=>{
      button.disabled=musicSnapshot.installed===false;
      button.setAttribute('aria-describedby','music-status');
    });
    musicPlayToggle.dataset.musicAction = 'toggle';
    musicPlayToggle.setAttribute('aria-label', '播放 / 暂停');
    musicPlayToggle.innerHTML = musicPlaying
      ? '<svg viewBox="0 0 24 24"><path d="M8 7h3v10H8zM14 7h3v10h-3z" /></svg>'
      : '<svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5z" /></svg>';
  }

  async function refreshMusicStatus() {
    if (!homeMusic || !window.notchAPI || typeof window.notchAPI.getMusicStatus !== 'function') return;
    if(musicStatusPending)return musicStatusPending;
    musicStatusPending=(async()=>{
    let status;
    try { status = await window.notchAPI.getMusicStatus(); } catch (error) { status = null; }
    musicSnapshot=status&&status.ok!==false?status:{playing:null,detail:'状态读取失败，请重新检测。'};
    homeMusic.classList.toggle('music-running', Boolean(status && status.running));
    {
      musicPlaying = typeof status?.playing === 'boolean' ? status.playing : null;
      renderMusicPlaybackState();
    }
    if (status && status.icon && musicArtwork) {
      musicArtwork.replaceChildren();
      const image = document.createElement('img');
      image.src = status.icon;
      image.alt = '';
      musicArtwork.appendChild(image);
    }
    if (musicTitle) musicTitle.textContent = status?.installed===false ? '汽水音乐' : status?.title || '汽水音乐';
    if (musicStatus) musicStatus.textContent = status?.installed===false ? '尚未安装客户端' : musicSnapshot.detail || (status?.running ? (musicPlaying===null?'已连接 · 播放状态未提供':musicPlaying?'正在播放':'已暂停') : status?.installed ? '汽水尚未运行' : '需要本地客户端');
    })();
    try { await musicStatusPending; } finally { musicStatusPending=null; }
  }

  document.getElementById('music-float-open')?.addEventListener('click',async(event)=>{
    event.stopPropagation();
    let result;try{result=await window.Notebook?.detach('module','music');}catch{}
    if(!result?.ok&&typeof showStatusToast==='function')showStatusToast('音乐悬浮窗未打开，请重试。');
  });

  homeMusic?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-widget-size-cycle]') || !window.notchAPI) return;
    const control = event.target.closest('[data-music-action]');
    if (!control) return;
    event.stopPropagation();
    control.disabled = true;
    const action = control.dataset.musicAction;
    let result;
    try { result = await window.notchAPI.controlMusic(action); } catch (error) { result = { ok: false }; }
    control.disabled = false;
    if (!result || !result.ok) {
      const needsSession = result && ['no_active_session', 'soda_session_inactive'].includes(result.error);
      const needsPermission = result && result.error === 'accessibility_permission_required';
      if (musicStatus) musicStatus.textContent = result && result.error === 'not_installed'
        ? '需要本地客户端'
        : needsPermission ? '需要辅助功能权限'
          : needsSession ? '请先点播放' : '控制暂不可用';
      if (typeof showStatusToast === 'function') {
        showStatusToast(result && result.error === 'not_installed'
          ? '未安装汽水音乐'
          : needsPermission ? '请在系统设置中允许 Handy 使用辅助功能'
            : needsSession ? '请先点击播放，再使用切歌控制' : '汽水音乐控制暂不可用');
      }
    } else {
      musicPlaying = typeof result.playing === 'boolean' ? result.playing : null;
      renderMusicPlaybackState();
      if (musicStatus) musicStatus.textContent = '控制已发送，实际播放状态未提供';
    }
    setTimeout(refreshMusicStatus, 500);
  });

  renderMusicPlaybackState();

  // ============ 本机加密密钥库 ============
  const credentialService = document.getElementById('credential-service');
  const credentialAccount = document.getElementById('credential-account');
  const credentialPassword = document.getElementById('credential-password');
  const credentialSave = document.getElementById('credential-save');
  const credentialList = document.getElementById('credential-list');
  const credentialCount = document.getElementById('credential-count');
  const credentialSearch = document.getElementById('credential-search');
  const credentialBulkDelete = document.getElementById('credential-bulk-delete');
  const credentialsNote = document.getElementById('credentials-note');
  let credentials = [];
  let credentialSelection = new Set();
  let credentialAnchor = null;
  let editingCredentialId = '';
  let editingCredential = null;

  function updateCredentialBulkAction() {
    if (!credentialBulkDelete) return;
    credentialBulkDelete.hidden = credentialSelection.size === 0;
    credentialBulkDelete.textContent = '删除';
    credentialBulkDelete.setAttribute('aria-label', credentialSelection.size
      ? `删除 ${credentialSelection.size} 项`
      : '删除所选');
  }

  function animateCredentialExpansion(originRect) {
    const row = credentialList?.querySelector(`.credential-item.editing[data-id="${CSS.escape(editingCredentialId)}"]`);
    if (!row || !originRect || typeof row.animate !== 'function') return;
    requestAnimationFrame(() => {
      const targetRect = row.getBoundingClientRect();
      const scaleX = Math.max(0.2, originRect.width / Math.max(1, targetRect.width));
      const scaleY = Math.max(0.2, originRect.height / Math.max(1, targetRect.height));
      row.animate([
        {
          opacity: .72,
          transform: `translate(${originRect.left - targetRect.left}px, ${originRect.top - targetRect.top}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
        },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', transformOrigin: 'top left' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' });
    });
  }

  function renderCredentials() {
    const visibleCredentials = Domain.filterCredentials(credentials, credentialSearch?.value || '');
    if (credentialCount) credentialCount.textContent = credentialSearch?.value.trim()
      ? `${visibleCredentials.length} / ${credentials.length} 项`
      : `${credentials.length} 项`;
    if (!credentialList) return;
    credentialList.replaceChildren();
    if (!visibleCredentials.length) {
      const empty = document.createElement('div');
      empty.className = 'credential-empty';
      empty.innerHTML = credentials.length
        ? '<strong>没有匹配的密钥</strong><span>可按名称或账号继续检索</span>'
        : '<strong>还没有保存密钥</strong><span>账号与密码会加密保存在这台 Mac</span>';
      credentialList.appendChild(empty);
      updateCredentialBulkAction();
      return;
    }
    visibleCredentials.forEach((credential) => {
      if (editingCredentialId === credential.id && editingCredential) {
        const form = document.createElement('form');
        form.className = 'credential-item editing';
        form.dataset.id = credential.id;
        form.innerHTML = `
          <div class="credential-edit-head"><strong>修改密钥</strong><span>回车保存</span></div>
          <label><span>服务</span><input name="service" maxlength="80" autocomplete="off" /></label>
          <label><span>账号</span><input name="account" maxlength="320" autocomplete="off" /></label>
          <label><span>密码</span><input name="password" type="text" maxlength="4096" autocomplete="off" spellcheck="false" /></label>
          <div class="credential-edit-actions"><button type="button" data-credential-cancel>取消</button><button type="submit">保存</button></div>
        `;
        form.elements.service.value = editingCredential.service || '';
        form.elements.account.value = editingCredential.account || '';
        form.elements.password.value = editingCredential.password || '';
        credentialList.appendChild(form);
        return;
      }
      const row = document.createElement('article');
      row.className = `credential-item${credentialSelection.has(credential.id) ? ' multi-selected' : ''}`;
      row.dataset.id = credential.id;
      row.tabIndex = 0;
      const copy = document.createElement('div');
      copy.className = 'credential-copy';
      const service = document.createElement('strong');
      service.textContent = credential.service;
      const account = document.createElement('span');
      account.textContent = credential.account;
      const password = document.createElement('code');
      password.textContent = credential.passwordMask || '**********';
      copy.append(service, account, password);
      const actions = document.createElement('div');
      actions.className = 'credential-actions';
      const accountCopy = document.createElement('button');
      accountCopy.type = 'button';
      accountCopy.dataset.credentialCopy = 'account';
      accountCopy.textContent = '账号';
      accountCopy.setAttribute('aria-label', '复制账号');
      const passwordCopy = document.createElement('button');
      passwordCopy.type = 'button';
      passwordCopy.dataset.credentialCopy = 'password';
      passwordCopy.textContent = '密码';
      passwordCopy.setAttribute('aria-label', '复制密码');
      const deleteAction = Domain.credentialRowAction({ requestedAction: 'delete' });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.credentialDelete = 'true';
      remove.textContent = deleteAction.label;
      remove.setAttribute('aria-label', deleteAction.ariaLabel);
      actions.append(accountCopy, passwordCopy, remove);
      row.append(copy, actions);
      credentialList.appendChild(row);
    });
    updateCredentialBulkAction();
  }

  async function loadCredentials() {
    if (!window.notchAPI || typeof window.notchAPI.listCredentials !== 'function') return;
    let result;
    try { result = await window.notchAPI.listCredentials(); } catch (error) { result = null; }
    credentials = result && Array.isArray(result.items) ? result.items : [];
    if (credentialsNote && result && !result.secureStorage) {
      credentialsNote.textContent = '当前 macOS 安全存储不可用，暂时无法保存密码。';
      credentialsNote.classList.add('error');
    }
    renderCredentials();
  }

  async function saveCredential() {
    if (!credentialSave || !window.notchAPI) return;
    const payload = {
      service: credentialService?.value || '',
      account: credentialAccount?.value || '',
      password: credentialPassword?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim() || !payload.password) {
      if (credentialsNote) {
        credentialsNote.textContent = '请完整填写软件、账号和密码。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    credentialSave.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    credentialSave.disabled = false;
    if (!result || !result.ok) {
      if (credentialsNote) {
        credentialsNote.textContent = '加密保存失败，请确认系统钥匙串可用。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    if (credentialService) credentialService.value = '';
    if (credentialAccount) credentialAccount.value = '';
    if (credentialPassword) {
      credentialPassword.value = '';
      credentialPassword.placeholder = '保存后才会加密';
    }
    if (credentialsNote) {
      credentialsNote.textContent = '已使用 macOS 安全存储加密保存。';
      credentialsNote.classList.remove('error');
    }
    await loadCredentials();
    credentialService?.focus();
  }

  credentialSave?.addEventListener('click', saveCredential);
  credentialSearch?.addEventListener('input', renderCredentials);
  [credentialService, credentialAccount, credentialPassword].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        saveCredential();
      }
    });
  });
  credentialList?.addEventListener('click', async (event) => {
    const row = event.target.closest('.credential-item[data-id]');
    if (!row) return;
    if (event.target.closest('[data-credential-cancel]')) {
      editingCredentialId = '';
      editingCredential = null;
      renderCredentials();
      return;
    }
    if (row.classList.contains('editing')) return;
    const copyField = event.target.closest('[data-credential-copy]')?.dataset.credentialCopy;
    const action = Domain.credentialRowAction({
      requestedAction: event.target.closest('[data-credential-delete]') ? 'delete' : '',
      copyField,
      rowBody: Boolean(event.target.closest('.credential-copy')),
      shiftKey: event.shiftKey,
    });
    if (action.type === 'delete') {
      const deleteButton = event.target.closest('[data-credential-delete]');
      if (deleteButton) deleteButton.disabled = true;
      const result = await window.notchAPI.deleteCredentials([row.dataset.id]).catch(() => ({ ok: false }));
      if (!result?.ok) {
        if (deleteButton) deleteButton.disabled = false;
        if (credentialsNote) {
          credentialsNote.textContent = '删除失败，请稍后重试。';
          credentialsNote.classList.add('error');
        }
        return;
      }
      credentialSelection.delete(row.dataset.id);
      if (editingCredentialId === row.dataset.id) {
        editingCredentialId = '';
        editingCredential = null;
      }
      await loadCredentials();
      if (credentialsNote) {
        credentialsNote.textContent = '密钥已删除。';
        credentialsNote.classList.remove('error');
      }
      return;
    }
    if (action.type === 'copy') {
      const copied = await window.notchAPI.copyCredential(row.dataset.id, action.field).catch(() => false);
      if (credentialsNote) credentialsNote.textContent = copied ? `${copyField === 'password' ? '密码' : '账号'}已复制` : '复制失败';
      return;
    }
    if (action.type === 'edit') {
      const originRect = row.getBoundingClientRect();
      const result = await window.notchAPI.getCredential(row.dataset.id).catch(() => ({ ok: false }));
      if (!result || !result.ok || !result.item) return;
      editingCredentialId = result.item.id;
      editingCredential = result.item;
      renderCredentials();
      animateCredentialExpansion(originRect);
      if (credentialsNote) {
        credentialsNote.textContent = '已展开当前密钥，回车即可保存。';
        credentialsNote.classList.remove('error');
      }
      credentialList.querySelector('.credential-item.editing input[name="service"]')?.focus();
      return;
    }
    const result = window.NotchDomain.updateRangeSelection(
      Domain.filterCredentials(credentials, credentialSearch?.value || '').map((item) => item.id),
      [...credentialSelection],
      row.dataset.id,
      credentialAnchor,
      event.shiftKey
    );
    credentialSelection = new Set(result.selected);
    credentialAnchor = result.anchor;
    renderCredentials();
  });
  credentialList?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.credential-item.editing[data-id]');
    if (!form) return;
    event.preventDefault();
    if (!editingCredentialId || !window.notchAPI) return;
    const payload = {
      id: editingCredentialId,
      service: form.elements.service?.value || '',
      account: form.elements.account?.value || '',
      password: form.elements.password?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim()) return;
    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton) saveButton.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    if (saveButton) saveButton.disabled = false;
    if (!result?.ok) return;
    editingCredentialId = '';
    editingCredential = null;
    await loadCredentials();
  });
  credentialBulkDelete?.addEventListener('click', async () => {
    if (!credentialSelection.size || !window.notchAPI) return;
    const result = await window.notchAPI.deleteCredentials([...credentialSelection]).catch(() => ({ ok: false }));
    if (!result || !result.ok) return;
    credentialSelection.clear();
    credentialAnchor = null;
    await loadCredentials();
  });

  document.addEventListener('notch:clear-selection', () => {
    commandSelection.clear();
    commandSelectionAnchor = null;
    linkSelection.clear();
    linkSelectionAnchor = null;
    recordingSelection.clear();
    recordingSelectionAnchor = selectedRecordingId || null;
    credentialSelection.clear();
    credentialAnchor = null;
    renderCommands();
    renderLinkGroups();
    renderRecordingList();
    renderCredentials();
  });

  // Satellite commands stay in the owning renderer; no second copy of business storage.
  window.WorkspaceModules = {
    async request(kind, operation='get', payload={}) {
      const api=window.notchAPI;
      if(kind==='commands') {
        let snap=await api.packsGet();if(!snap.ok)return snap;
        const item=snap.items.find(v=>v.id===payload.id);
        if(operation==='copy'&&item){const r=await api.packsCompose({id:item.id,values:{},documents:[]});return r.ok?api.packsCopy({text:r.text}):r;}
        if(operation==='add'||operation==='edit'){
          if(operation==='edit'&&!item)return {ok:false,error:'not_found'};
          snap=await api.packsCommand({action:'save',revision:snap.revision,id:item?.id,name:item?.name||String(payload.text||'').slice(0,80),text:String(payload.text||''),steps:item?.steps||'',shortcut:item?.shortcut||'',shortcutAction:item?.shortcutAction||'open',documentIds:item?.documentIds||[]});
        }else if(operation==='delete'){snap=await api.packsCommand({action:'delete',id:item?.id,revision:snap.revision,confirmed:payload.confirmed});}
        else if(operation!=='get')return {ok:false,error:'invalid_action'};
        if(!snap.ok)return snap;void window.MaterialPacksHome?.refresh();
        return {ok:true,items:snap.items.map(v=>({id:v.id,text:v.name}))};
      }
      if(kind==='links') {
        if(operation==='edit-state'){linkFloatDirty=payload.dirty===true;return {ok:true};}
        if(operation==='library-get')return librarySnapshot();
        if(operation==='library-command')return libraryCommand(payload);
        if(operation==='library-notes')return {ok:true,notes:window.LinkLibraryHost.notes()};
        if(operation==='library-open-note')return window.LinkLibraryHost.openNote(payload.id);
        const item=allLinks().find(v=>v.id===payload.id);
        if(operation==='add'){if(!addLink(String(payload.text||'').slice(0,2000),payload.groupId||'',{strict:true,quiet:true,note:payload.note||''}))return {ok:false,error:'invalid_or_duplicate_link'};}
        else if(operation==='edit'&&item){if(payload.text!==item.url)return {ok:false,error:'url_readonly'};return libraryCommand({action:'patch',id:item.id,revision:payload.libraryRevision??librarySnapshot().revision,groupId:payload.groupId,changes:{note:payload.note||''}});}
        else if(operation==='open'&&item)return {ok:!!await api.openExternal(item.url)};
        else if(operation==='delete'&&item){const result=removeLibraryLinks({ids:[item.id],revision:payload.libraryRevision,confirmed:payload.confirmed});if(!result.ok)return result;}
        else if(operation!=='get')return {ok:false,error:'invalid_action'};
        return {...librarySnapshot(),items:linkGroups.flatMap(g=>(g.links||[]).map(v=>({id:v.id,text:v.title||v.url,detail:g.name,url:v.url,note:v.note||'',pinned:!!v.pinned})))};
      }
      if(kind==='music') {
        if(['get','refresh'].includes(operation))await refreshMusicStatus();
        else if(['open','toggle','play','pause','next','previous'].includes(operation)){
          const result=await api.controlMusic(operation);if(!result?.ok)return result;
          musicPlaying=typeof result.playing==='boolean'?result.playing:null;renderMusicPlaybackState();
        }else return {ok:false,error:'invalid_action'};
        return {...musicSnapshot,ok:true,title:musicSnapshot.installed===false?'汽水音乐':musicSnapshot.title||musicTitle?.textContent||'汽水音乐',artist:musicSnapshot.artist||'',playing:musicPlaying,detail:musicStatus?.textContent||'播放需要已安装的汽水音乐客户端'};
      }
      if(kind==='windows') {
        if(operation==='open')return {ok:!!await api.focusWindow(payload.id)};
        if(!['get','refresh'].includes(operation))return {ok:false,error:'invalid_action'};
        return {ok:true,items:[],detail:'搜索窗口或展开工具组合'};
      }
      if(kind==='credentials') {
        if(operation==='refresh')await loadCredentials();
        else if(operation==='copy'){if(!credentials.some(v=>v.id===payload.id)||!['account','password'].includes(payload.field))return {ok:false,error:'invalid_action'};return {ok:!!await api.copyCredential(payload.id,payload.field)};}
        else if(operation==='add') {const result=await api.saveCredential({service:String(payload.service||'').slice(0,80),account:String(payload.account||'').slice(0,320),password:String(payload.password||'').slice(0,4096)});if(!result?.ok)return result;await loadCredentials();}
        else if(operation==='delete'){if(!credentials.some(v=>v.id===payload.id))return {ok:false,error:'not_found'};const result=await api.deleteCredentials([payload.id]);if(!result?.ok)return result;await loadCredentials();}
        else if(operation!=='get')return {ok:false,error:'invalid_action'};
        return {ok:true,items:credentials.map(v=>({id:v.id,text:v.service,detail:v.account})),detail:'不显示或广播密码；仅明确点击时复制。'};
      }
      return {ok:false,error:'invalid_module'};
    }
  };
  setInterval(() => refreshWindows(), 6000);

  window.addEventListener('beforeunload', (event) => {
    if(recordingStatus!=='idle'||pendingRecording){event.preventDefault();event.returnValue=false;showStatusToast('请先结束录音并保存；保存失败时请重试或复制备份。');return;}
    stopSpeechRecognition();
    stopTranscriptionAudioPipeline();
    if (transcriptionStartPromise && window.notchAPI) window.notchAPI.finishTranscription().catch(() => {});
    stopMediaTracks();
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  });

  renderCommands();
  renderLinkGroups();
  renderRecordings();
  updateRecordingUi();
  loadTranscriptionConfig();
  refreshSettingsPanel();
  refreshMusicStatus();
  loadCredentials();

  window.NotchWorkspace = {
    refreshWindows,
    relaunchForPermissions,
    startRecording,
  };
  window.addEventListener('DOMContentLoaded',()=>{
    // Index once; don't rewrite the full notebook for every already-saved recording on startup.
    let state;try{state=window.QuickRecords.snapshot().state;}catch{return;}
    const linked=new Map(state.records.filter(r=>r.sourceRecordingId).map(r=>[r.sourceRecordingId,r]));
    for(const recording of recordings){
      if(!recording.quickCapture||recording.isDraft)continue;
      const existing=linked.get(recording.id);
      const update=existing&&!existing.trashedAt&&existing.id!==state.activeId&&existing.revision===existing.captureRevision&&!existing.captureComplete&&recording.voice?.status==='done';
      if((!existing||update)&&!captureVoice(recording).ok)break;
    }
  },{once:true});
})();
