(() => {
  'use strict';
  const M = window.NotebookModel, api = window.notchAPI;
  const ARCHIVE = 'notch-note-archive-v1', QUICK = 'notch-home-note';
  let floatingKeys = new Set(), current = null;
  const theme = () => document.documentElement.dataset.theme;
  function notes() { const raw=JSON.parse(localStorage.getItem(ARCHIVE)||'[]');if(!Array.isArray(raw))throw Error('storage_failed');return window.NotchDomain.normalizeNoteArchive(raw); }
  function get(id) { return notes().find((note) => note.id === id); }
  function quick() { return window.QuickRecords.snapshot().note; }
  function save(note, revision, isQuick = false) {
    try {
      const original = isQuick ? quick() : get(note.id);
      if (!original) return { ok:false,error:'not_found' };
      if (M.version(original) !== revision) return { ok:false,error:'conflict' };
      if (JSON.stringify(note).length > 180000) return { ok:false,error:'storage_failed' };
      if (isQuick) {
        return window.QuickRecords.command({action:'save',recordId:original.recordId,revision:original.revision,title:original.title,content:M.text(note.content,60000)});
      }
      const next = { ...original, title:M.text(note.title,80),titleSource:'user',content:M.text(note.content,60000),updatedAt:Math.max(Date.now(),original.updatedAt+1) };
      if (note.meeting) { next.meeting = M.meeting(note.meeting); next.content = M.toText(next.meeting); }
      const all = notes().map((item) => item.id === next.id ? next : item);
      localStorage.setItem(ARCHIVE,JSON.stringify(all));
      if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === next.id && !next.meeting && noteInput) {
        noteInput.value = next.content; localStorage.setItem(QUICK,next.content); renderNotePreview();
      }
      updateSavedNotePresentation(next);
      api?.broadcastFloat?.({ kind:'note',id:next.id });
      return { ok:true,note:next,theme:theme() };
    } catch { return { ok:false,error:'storage_failed' }; }
  }
  async function create(kind, content = '', source = null, meetingOptions = {}) {
    await current?.flush(); flushNotesEditorSave();
    const all = notes();
    const existing=source?.clipboardKey?all.find(n=>n.sourceClipboardKey===source.clipboardKey):source?.recordId?all.find(n=>n.sourceQuickRecordId===source.recordId):null;
    if(existing)return {ok:true,note:existing,reused:true};
    if (all.length >= 200) { showStatusToast('笔记库已达 200 篇，请先整理或备份旧笔记'); return { ok:false,error:'note_limit' }; }
    const now = Date.now(), note = { id:M.uid(),title:kind === 'meeting' ? '新会议' : '新笔记',titleSource:'user',content,createdAt:now,updatedAt:now };
    if (kind === 'meeting') note.meeting = M.meeting({mode:'free',stage:'live',...meetingOptions,...(content?{freeText:content}:{})});
    if(source?.recordId){note.sourceQuickRecordId=source.recordId;note.sourceRecordingId=source.sourceRecordingId||'';note.title=window.QuickRecordModel.title(source).slice(0,80);}
    if(source?.clipboardKey){if(!/^[a-f0-9]{64}$/.test(source.clipboardKey))return {ok:false,error:'invalid_input'};note.sourceClipboardKey=source.clipboardKey;note.title=content.trim().split('\n')[0].slice(0,80)||'新笔记';}
    try { localStorage.setItem(ARCHIVE,JSON.stringify([note,...all])); }
    catch { showStatusToast('保存失败，请检查本机存储'); return { ok:false,error:'storage_failed' }; }
    selectedNoteId = note.id; if (notesSearch) notesSearch.value = ''; renderNotesLibrary();
    return { ok:true,note };
  }
  async function prepareDetach() {
    await window.ToolLauncher?.flush();
    await window.CredentialCardsHome?.flush();
    window.LinkLibrary?.flush();
    await current?.flush(); flushNotesEditorSave();
    const plainEditor = document.getElementById('notes-editor');
    if (plainEditor) persistNotesEditor(plainEditor);
    if (noteInput && !noteInput.readOnly) {
      window.QuickRecords.saveHome();
      noteInput.dispatchEvent(new Event('blur'));
      if ((localStorage.getItem(QUICK) || '') !== noteInput.value) throw Error('save_failed');
    }
  }
  async function detach(kind, id, atCursor = false) {
    await prepareDetach();
    if (!api?.openFloat) return showStatusToast('当前环境不支持悬浮窗口');
    const result = await api.openFloat({ kind,id,atCursor,detached:true }).catch(() => null);
    if (!result?.ok) showStatusToast(result?.error === 'window_limit' ? '最多同时打开 12 个浮窗，请先收回一些' : result?.error === 'feature_disabled' ? '请先在设置中启用剪贴板，再打开悬浮窗。' : '无法打开浮窗，请重试');
    return result;
  }
  async function openQuick(payload={review:'weekly'}){
    const result=await detach('quick');
    if(result?.ok)api.broadcastFloat({kind:'quick',...payload});
    return result;
  }
  function mountHandle(surface, kind = 'note', id) {
    return window.PanelDetachHandles.attach(surface, { kind, id,
      label: kind==='module' ? window.PanelModuleCatalog?.[id]?.label || '功能模块' : kind === 'recorder' ? '录音控制条' : kind === 'quick' ? '随手记' : '当前笔记',
      prepare: prepareDetach, drag: (phase, payload) => api?.detachDrag?.(phase, payload), open: () => detach(kind, id),
      error: (code) => showStatusToast(code === 'save_failed' ? '保存尚未完成，未拖出。请先保存或复制内容后重试。' : '暂时无法拖出，请重试或点击把手悬浮。') });
  }
  function references(ids) {
    const rows = notes();
    return { ok:true,notes:Array.isArray(ids) ? rows.filter((n) => ids.includes(n.id)).map((n) => ({ id:n.id,title:n.title,content:n.content })) : rows.map((n) => ({ id:n.id,title:n.title })) };
  }
  function editorApi(note) {
    return { save, prepare:(text) => api.prepareMeeting(text),cancel:() => api.cancelMeetingPrep(),
      references,importFiles:() => api.importMeetingFiles(),copy:(text) => api.copyMeetingText(text),settings:() => document.getElementById('settings-api-configure')?.click(),
      remove:() => {
        try { localStorage.setItem(ARCHIVE,JSON.stringify(notes().filter((n) => n.id !== note.id))); }
        catch { showStatusToast('删除失败，原笔记仍保留'); return; }
        current?.destroy(); current = null; renderNotesLibrary(); showStatusToast('会议笔记已删除');
      },
      detach:() => detach('note',note.id),mountHandle:(surface) => mountHandle(surface,'note',note.id) };
  }
  function mount(root, note) {
    window.PanelDetachHandles.clear(root);
    current?.destroy(); current = null; root.classList.remove('nb-editor');
    if (!note) return false;
    if (floatingKeys.has(`note:${note.id}`)) {
      const box = document.createElement('div'); box.className = 'nb-detached';
      const title = document.createElement('h3'); title.textContent = note.title || '未命名笔记';
      const text = document.createElement('p'); text.textContent = '这篇笔记正在桌面悬浮，内容在同一处保存。';
      const locate = document.createElement('button'); locate.textContent = '定位浮窗'; locate.onclick = () => detach('note',note.id);
      const dock = document.createElement('button'); dock.textContent = '收回这里'; dock.onclick = () => api.dockFloat(`note:${note.id}`);
      box.append(title,text,locate,dock); root.append(box); return true;
    }
    if (note.meeting) { current = new window.NotebookEditor(root,note,editorApi(note)); return true; }
    return false;
  }
  function beforeRender(note) {
    if (!current) return true;
    if (current.note.id === note?.id && !floatingKeys.has(`note:${note.id}`)) {
      if(current.saved>=current.dirty&&!current.saving&&current.revision!==M.version(note)){current.destroy();current=null;return true;}
      return false;
    }
    if (current.saved < current.dirty) { current.flush().then(() => renderNotesLibrary()).catch(() => {}); return false; }
    current.destroy(); current = null; return true;
  }
  async function request(payload) {
    let result;
    try {
      const { kind,id,action } = payload;
      if(kind==='workspace'&&action==='prepare-combination'){await prepareDetach();result={ok:true};}
      else if(kind==='quick'&&action==='records')result=window.QuickRecords.command(payload.command||{});
      else if(kind==='quick'&&action==='review-state')result={...window.QuickRecords.snapshot(),recording:window.PanelRecording?.snapshot()?.status!=='idle'};
      else if(kind==='quick'&&action==='source')result=await window.PanelRecording.open(quick().sourceRecordingId);
      else if(kind==='quick'&&action==='idea-plan')result=await window.IdeaPlans.request(payload);
      else if(kind==='quick'&&action==='idea-plan-open')result=await window.IdeaPlanNavigation.open(payload.recordId);
      else if(kind==='module') result=await window.PanelModules?.request(id,payload) || {ok:false,error:'host_unavailable'};
      else if (kind === 'recorder') result = await window.PanelRecording?.command(action,payload.recordingId) || { ok:false,error:'host_unavailable' };
      else if (action === 'get') { if(kind==='quick')result=window.QuickRecords.snapshot();else{const note=get(id);result=note?{ok:true,note,theme:theme()}:{ok:false,error:'not_found'};} }
      else if (action === 'references') result = references(payload.ids);
      else if(kind==='note'&&['linked-resources','open-resource'].includes(action)){
        if(!get(id))result={ok:false,error:'not_found'};
        else{
          const rows=window.LinkLibraryHost.snapshot().groups.flatMap(g=>g.links||[]).filter(r=>r.noteIds?.includes(id));
          if(action==='linked-resources')result={ok:true,links:rows.map(r=>({id:r.id,title:r.title,note:r.note||''}))};
          else{const row=rows.find(r=>r.id===payload.linkId);if(!row||!/^https?:\/\//i.test(row.url))result={ok:false,error:'not_found'};else{await api.openExternal(row.url);result={ok:true};}}
        }
      }
      else if (action === 'save' && payload.note?.id === (kind === 'quick' ? 'quick' : id)) result = save(payload.note,payload.revision,kind === 'quick');
      else if (action === 'archive' && kind === 'quick') result = quick().content.trim() ? await create('note',quick().content,quick()) : { ok:false,error:'empty_text' };
      else result = { ok:false,error:'invalid_action' };
    } catch { result = { ok:false,error:'storage_failed' }; }
    return result;
  }
  api?.onFloatRequest?.(async payload=>api.floatResult(payload.requestId,await request(payload)));
  api?.onFloatList?.((keys) => {
    floatingKeys = new Set(keys);
    if (noteInput) noteInput.readOnly = floatingKeys.has('quick');
    if (noteSaveButton) noteSaveButton.disabled = floatingKeys.has('quick');
    if (current) current.flush().then(() => renderNotesLibrary()).catch(() => {});
    else renderNotesLibrary();
  });
  new MutationObserver(() => api?.broadcastFloat?.({ kind:'theme',theme:theme() })).observe(document.documentElement,{ attributes:true,attributeFilter:['data-theme'] });
  function addButton(parent, label, action) {
    if (!parent) return; const button = document.createElement('button'); button.type = 'button'; button.className = 'nb-entry'; button.textContent = label;
    button.addEventListener('click',() => void action()); parent.append(button); return button;
  }
  const toolbar = document.createElement('div'); toolbar.className = 'nb-library-actions';
  document.querySelector('.notes-library-head')?.after(toolbar);
  addButton(toolbar,'新笔记',() => create('note'));
  addButton(toolbar,'会议笔记',() => create('meeting'));
  addButton(toolbar,'随手记',() => detach('quick'),'quick');
  addButton(toolbar,'收回全部',async () => { for (const key of floatingKeys) await api.dockFloat(key); });
  mountHandle(document.querySelector('.home-note'),'quick');
  addButton(document.querySelector('.home-note'),'记录本 / 结束确认',() => detach('quick'));
  mountHandle(document.getElementById('home-recorder'),'recorder');
  mountHandle(document.querySelector('#tab-recordings .recordings-page'),'recorder');
  addButton(document.getElementById('recording-new')?.parentElement,'悬浮录音',() => detach('recorder'),'recorder');
  // Switching a meeting must wait for acknowledged saving. Failed saves leave its editor open.
  document.addEventListener('click',(event) => {
    const navigation = event.target.closest('#notes-list [data-note-id], .tab[data-tab]');
    if (!navigation || !current || current.saved === current.dirty || navigation.dataset.nbReplaying) return;
    event.preventDefault(); event.stopImmediatePropagation();
    current.flush().then(() => { navigation.dataset.nbReplaying = '1'; navigation.click(); delete navigation.dataset.nbReplaying; }).catch(() => {});
  },true);
  api?.onDetachCancelled?.(() => window.PanelDetachHandles.cancelActive());
  window.Notebook = { request,mount,beforeRender,detach,openQuick,mountHandle,create,save,get,flushForExit:prepareDetach,flush:() => current?.flush(),get current() { return current; },references };
  window.addEventListener('beforeunload', () => current?.flush().catch(() => {}));
  renderNotesLibrary();
})();
