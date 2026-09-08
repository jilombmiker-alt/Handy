const { BrowserWindow, ipcMain, screen, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EXTENSIONS, importMaterials } = require('./ai/meeting-materials');
const moduleCatalog = require('./renderer/module-catalog');
const {createQuickReview}=require('./main-quick-review');
const {createCombinationStore,placeTool}=require('./main-tool-combinations');

function fitBounds(bounds, area, minHeight = 180) {
  const width = Math.round(Math.min(Math.max(320, Number(bounds.width) || 440), area.width - 24));
  const height = Math.round(Math.min(Math.max(minHeight, Number(bounds.height) || 560), area.height - 24));
  return { width, height, x: Math.round(Math.max(area.x + 12, Math.min(Number(bounds.x) || area.x + 24, area.x + area.width - width - 12))),
    y: Math.round(Math.max(area.y + 12, Math.min(Number(bounds.y) || area.y + 24, area.y + area.height - height - 12))) };
}

function createFloatingRuntime(options) {
  const windows = new Map(), pending = new Map();
  const combinations=createCombinationStore(()=>options.combinationFile());
  const sessions=new Map();
  let groupQueue=Promise.resolve(), recorderStatus='idle';
  let dockWindow = null, quitting = false, quitContinuation = null;
  let detachSession = null;
  const main = () => options.getMain();
  const mainSender = (event) => !!main() && !main().isDestroyed() && event.sender === main().webContents && event.senderFrame === event.sender.mainFrame;
  function satellite(event) {
    if (event.senderFrame !== event.sender.mainFrame) return null;
    return [...windows.values()].find((entry) => !entry.window.isDestroyed() && entry.window.webContents === event.sender) || null;
  }
  const allowed = (event) => mainSender(event) || !!satellite(event);
  const windowToolsSender=event=>mainSender(event)||satellite(event)?.key==='module:windows';
  function activity(){
    const labels=[];
    if(options.openInline){
      if(['recording','paused','saving','save-failed'].includes(recorderStatus))labels.push(({recording:'录音中',paused:'录音暂停',saving:'录音保存中','save-failed':'录音待保存'})[recorderStatus]);
      if(options.timerActive?.())labels.push('计时中');
      return labels.join(' · ');
    }
    if(windows.has('recorder')&&!windows.get('recorder').window.isVisible()&&['recording','paused','saving','save-failed'].includes(recorderStatus))labels.push(recorderStatus==='recording'?'录音中':recorderStatus==='paused'?'录音暂停':recorderStatus==='saving'?'录音保存中':'录音待保存');
    if(windows.has('module:pomodoro')&&!windows.get('module:pomodoro').window.isVisible()&&options.timerActive?.())labels.push('计时中');
    return labels.join(' · ');
  }
  function groupSnapshot(){return {...combinations.snapshot(),sessions:Object.fromEntries([...sessions].map(([id,keys])=>[id,keys.filter(k=>windows.has(k)).map(k=>({key:k,visible:windows.get(k).window.isVisible()}))])),activity:activity()};}
  ipcMain.handle('window-tools:get',event=>windowToolsSender(event)?groupSnapshot():{ok:false,error:'forbidden'});
  ipcMain.handle('window-tools:command',(event,c)=>{
    if(!windowToolsSender(event))return {ok:false,error:'forbidden'};
    const task=groupQueue.catch(()=>{}).then(async()=>{
      if(!windowToolsSender(event))return {ok:false,error:'forbidden'};
      if(['save','delete'].includes(c?.action))return combinations.command(c);
      const s=combinations.snapshot();if(!s.ok)return s;
      const group=s.groups.find(g=>g.id===c?.id);if(!group)return {ok:false,error:'not_found'};
      if(c.revision!==s.revision)return {ok:false,error:'conflict'};
      if(c.action==='hide'){
        for(const key of sessions.get(group.id)||[]){const entry=windows.get(key);if(entry&&!entry.window.isDestroyed()){persistPosition(entry);entry.window.hide();}}
        options.activityChanged?.(activity());return {ok:true};
      }
      if(c.action!=='open')return {ok:false,error:'invalid_action'};
      if(options.openInline)return options.openInline({kind:'group',label:group.name,tools:group.tools});
      const prepared=await forward({action:'prepare-combination',kind:'workspace'});
      if(!prepared?.ok)return {ok:false,error:'save_failed'};
      if(windows.size+group.tools.filter(k=>!windows.has(k)).length>12)return {ok:false,error:'window_limit'};
      const keys=[],failures=[];let overlap=false;
      for(const key of group.tools){
        const existing=windows.has(key),saved=safeLoad(options.positionFile())[key];
        const result=await openFloat({sender:main().webContents,senderFrame:main().webContents.mainFrame},key.startsWith('module:')?{kind:'module',id:key.slice(7)}:{kind:key});
        if(!result.ok){failures.push({key,error:result.error});continue;}
        keys.push(key);
        if(!existing&&!saved){
          const entry=windows.get(key),b=entry.window.getBounds(),area=screen.getDisplayMatching(b).workArea;
          const occupied=[...windows.values()].filter(e=>e!==entry&&e.window.isVisible()).map(e=>e.window.getBounds());
          const placed=placeTool({width:b.width,height:b.height},area,occupied);overlap ||= placed.overlap;
          entry.window.setBounds(placed.bounds);persistPosition(entry);
        }
      }
      sessions.set(group.id,keys);options.activityChanged?.(activity());
      return {ok:failures.length===0,error:failures.length?'partial_open':undefined,failures,overlap,opened:keys.length};
    });groupQueue=task;return task;
  });
  let lastActivity='';
  const activityTimer=setInterval(()=>{const text=activity();if(text!==lastActivity){lastActivity=text;options.activityChanged?.(text);}},1000);activityTimer.unref();
  function emitList() {
    if(main()&&!main().isDestroyed())main().webContents.setBackgroundThrottling(windows.size===0);
    if (main() && !main().isDestroyed()) main().webContents.send('floats:list', [...windows.keys()]);
  }
  function forward(payload) {
    return new Promise((resolve) => {
      if (!main() || main().isDestroyed()) return resolve({ ok: false, error: 'host_unavailable' });
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: 'host_timeout' }); }, 8000);
      pending.set(requestId, { resolve, timer });
      main().webContents.send('floats:host-request', { requestId, ...payload });
    });
  }
  ipcMain.on('floats:host-result', (event, payload) => {
    if (!mainSender(event)) return;
    const request = pending.get(payload?.requestId);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(payload.requestId); request.resolve(payload.result);
  });
  function safeLoad(file) {
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data && typeof data === 'object' ? data : {}; } catch { return {}; }
  }
  function persistPosition(entry) {
    const file = options.positionFile();
    const positions = safeLoad(file);
    positions[entry.key] = entry.window.getBounds();
    // Keep bounded history; no content or credentials are saved in this file.
    const bounded = Object.fromEntries(Object.entries(positions).slice(-210));
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(bounded), { mode: 0o600 }); } catch {}
  }
  function hideDock() { if (dockWindow && !dockWindow.isDestroyed()) dockWindow.hide(); }
  function showDock() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), area = display.workArea;
    if (!dockWindow || dockWindow.isDestroyed()) {
      dockWindow = new BrowserWindow({ width: 300, height: 44, frame: false, focusable: false, show: false, skipTaskbar: true,
        alwaysOnTop: true, resizable: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      dockWindow.setIgnoreMouseEvents(true);
      dockWindow.setAlwaysOnTop(true, 'floating', 1);
      dockWindow.loadFile(path.join(__dirname, 'renderer', 'float-dock.html'));
    }
    dockWindow.setBounds({ x: Math.round(area.x + (area.width - 300) / 2), y: area.y + 8, width: 300, height: 44 });
    dockWindow.showInactive();
  }
  function closeEntry(entry) { if (!entry.window.isDestroyed()) entry.window.close(); }
  async function openFloat(event, payload, dropPoint) {
    if (!mainSender(event)) return { ok: false, error: 'forbidden' };
    const kind = payload?.kind;
    if (!['note', 'quick', 'recorder','module'].includes(kind)) return { ok: false, error: 'invalid_kind' };
    const id = ['note','module'].includes(kind) ? String(payload.id || '') : '';
    if(kind==='module'&&!Object.hasOwn(moduleCatalog,id))return {ok:false,error:'invalid_module'};
    if (kind === 'note' && (!/^[\w-]{1,180}$/.test(id))) return { ok: false, error: 'invalid_id' };
    const key = ['note','module'].includes(kind) ? `${kind}:${id}` : kind;
    if(options.openInline)return options.openInline({kind,id,review:payload.review});
    if (windows.has(key)) { windows.get(key).window.show(); windows.get(key).window.focus(); return { ok: true, key }; }
    if (windows.size >= 12) return { ok: false, error: 'window_limit' };
    if (kind === 'note'||kind==='module') { const found = await forward({ action: 'get', kind, id }); if (!found?.ok) return found; }
    if (windows.has(key)) { windows.get(key).window.show(); windows.get(key).window.focus(); return { ok: true, key }; }
    if (windows.size >= 12) return { ok: false, error: 'window_limit' };
    const cursor = dropPoint || screen.getCursorScreenPoint(), area = screen.getDisplayNearestPoint(cursor).workArea;
    const saved = safeLoad(options.positionFile())[key];
    const music = kind === 'module' && id === 'music';
    const timer = kind === 'module' && id === 'pomodoro';
    const defaults = { x: payload.atCursor ? cursor.x - 100 : area.x + area.width - 470 - windows.size * 24,
      y: payload.atCursor ? cursor.y - 20 : area.y + 90 + windows.size * 24, width: 440, height: kind === 'recorder' ? 400 : 580 };
    const desired = payload.atCursor ? defaults : saved || defaults;
    const win = new BrowserWindow({ ...fitBounds(music ? {...desired,width:400,height:140} : timer ? {...desired,width:400,height:210} : desired, area, music ? 140 : timer ? 210 : 180), minWidth: music ? 380 : timer ? 360 : 320, minHeight: music ? 140 : timer ? 210 : kind === 'recorder' ? 280 : 360,
      frame: false, show: false, resizable: true, movable: true, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
      transparent: music, backgroundColor: music ? '#00000000' : '#ffffff', webPreferences: { preload: path.join(__dirname, 'renderer', 'floating-preload.js'),
        partition: 'floating-widgets', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const entry = { key, kind, id, window: win, dragging: null };
    windows.set(key, entry);
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.session.setPermissionRequestHandler((_web, _permission, cb) => cb(false));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('render-process-gone', () => { options.prep.cancel(win.webContents.id); win.destroy(); });
    win.on('close', (e) => {
      if (!quitting && !entry.canClose) {
        e.preventDefault();
        if (!entry.ready) entry.closeRequested = true;
        else win.webContents.send('floats:close-request');
      }
    });
    win.on('closed', () => {
      windows.delete(key); hideDock(); emitList();
      if (!windows.size && quitContinuation) { const resume = quitContinuation; quitContinuation = null; setImmediate(resume); }
    });
    win.on('move', () => { if (!entry.dragging) persistPosition(entry); });
    win.on('resize', () => persistPosition(entry));
    try { await win.loadFile(path.join(__dirname, 'renderer', 'floating.html')); }
    catch { if (!win.isDestroyed()) win.destroy(); return { ok: false, error: 'window_load_failed' }; }
    entry.ready = true;
    if (entry.closeRequested) win.close(); else win.show();
    emitList();
    return { ok: true, key };
  }
  ipcMain.handle('floats:open', openFloat);
  function cancelDetach(notify = false) {
    const session = detachSession; if (!session) return;
    detachSession = null; clearInterval(session.timer);
    if (!session.preview.isDestroyed()) session.preview.destroy();
    if (notify && main() && !main().isDestroyed()) main().webContents.send('floats:detach-cancelled');
  }
  function outsideMain(cursor) {
    const bounds = main().getBounds();
    return cursor.x < bounds.x || cursor.x >= bounds.x + bounds.width || cursor.y < bounds.y || cursor.y >= bounds.y + bounds.height;
  }
  ipcMain.handle('floats:detach-drag', async (event, phase, payload) => {
    if (!mainSender(event)) return { ok: false, error: 'forbidden' };
    if(options.openInline)return {ok:false,error:'launcher_fixed'};
    if (phase === 'start') {
      if (detachSession) return { ok: false, error: 'drag_busy' };
      if (!main().isVisible()) return { ok: false, error: 'host_unavailable' };
      if (!['note', 'quick', 'recorder','module'].includes(payload?.kind)) return { ok: false, error: 'invalid_kind' };
      if(payload.kind==='module'&&!Object.hasOwn(moduleCatalog,payload.id))return {ok:false,error:'invalid_module'};
      if (payload.kind === 'note' && !/^[\w-]{1,180}$/.test(String(payload.id || ''))) return { ok: false, error: 'invalid_id' };
      const preview = new BrowserWindow({ width: 244, height: 84, frame: false, transparent: true,
        backgroundColor: '#00000000', show: false, focusable: false, skipTaskbar: true, hasShadow: false,
        resizable: false, alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
          partition: 'floating-widgets', preload: path.join(__dirname, 'renderer', 'detach-preview-preload.js') } });
      preview.setIgnoreMouseEvents(true); preview.setAlwaysOnTop(true, 'screen-saver', 1);
      preview.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      preview.webContents.session.setPermissionRequestHandler((_web, _permission, cb) => cb(false));
      preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      preview.webContents.on('will-navigate', (e) => e.preventDefault());
      const session = { token: crypto.randomUUID(), kind: payload.kind, id: ['note','module'].includes(payload.kind) ? payload.id : '',
        theme: payload.theme === 'obsidian' ? 'obsidian' : 'white', preview, ready: false, startedAt: Date.now() };
      detachSession = session;
      function update() {
        if (detachSession !== session) return;
        if (!main() || main().isDestroyed() || !main().isVisible() || preview.isDestroyed() || Date.now() - session.startedAt > 30000) { cancelDetach(true); return; }
        const cursor = screen.getCursorScreenPoint(), area = screen.getDisplayNearestPoint(cursor).workArea;
        const x = Math.round(Math.max(area.x, Math.min(cursor.x - 122, area.x + area.width - 244)));
        const y = Math.round(Math.max(area.y, Math.min(cursor.y + 18, area.y + area.height - 84)));
        if (x !== session.x || y !== session.y) { preview.setPosition(x, y); session.x = x; session.y = y; }
        const outside = outsideMain(cursor);
        if (session.ready && (session.outside !== outside || !preview.isVisible())) {
          preview.webContents.send('detach:preview', { kind: session.kind, theme: session.theme, outside });
          preview.showInactive();
        }
        session.outside = outside;
      }
      session.timer = setInterval(update, 16);
      preview.webContents.on('render-process-gone', () => { if (detachSession === session) cancelDetach(true); });
      // Return the drag token immediately. Waiting for a new renderer to load used
      // to delay mouse-up until the pointer had already moved elsewhere.
      void preview.loadFile(path.join(__dirname, 'renderer', 'detach-preview.html')).then(() => {
        if (detachSession !== session) return;
        session.ready = true; update();
      }).catch(() => { if (detachSession === session) cancelDetach(true); });
      return { ok: true, token: session.token };
    }
    if (!['end', 'cancel'].includes(phase) || !detachSession || payload?.token !== detachSession.token) return { ok: false, error: 'invalid_drag_session' };
    const session = detachSession, cursor = screen.getCursorScreenPoint();
    const shouldOpen = phase === 'end' && main().isVisible() && outsideMain(cursor);
    cancelDetach();
    if (!shouldOpen) return { ok: true, cancelled: true };
    return openFloat(event, { kind: session.kind, id: session.id, atCursor: true }, cursor);
  });
  main()?.on('hide', () => cancelDetach(true));
  main()?.on('blur', () => cancelDetach(true));
  main()?.webContents.on('render-process-gone', () => cancelDetach());
  ipcMain.handle('floats:dock', (event, key) => {
    const entry = satellite(event) || (mainSender(event) ? windows.get(key) : null);
    if (!entry) return { ok: false, error: 'not_found' };
    if (mainSender(event)) { closeEntry(entry); return { ok: true }; }
    persistPosition(entry); entry.canClose = true; options.prep.cancel(event.sender.id); entry.window.close(); hideDock();
    return { ok: true };
  });
  ipcMain.handle('floats:request', async (event, payload) => {
    const entry = satellite(event);
    if (!entry || !payload || JSON.stringify(payload).length > 250000) return { ok: false, error: 'forbidden' };
    if (payload.action === 'identity') return { ok: true, kind: entry.kind, id: entry.id, key: entry.key };
    if(payload.action==='pin-state')return {ok:true,pinned:entry.window.isAlwaysOnTop()};
    if(payload.action==='pin'){
      if(typeof payload.pinned!=='boolean')return {ok:false,error:'invalid_action'};
      entry.window.setAlwaysOnTop(payload.pinned,'floating');return {ok:true,pinned:entry.window.isAlwaysOnTop()};
    }
    if (payload.action === 'settings') { options.openSettings(); return { ok: true }; }
    if(payload.action==='timer-layout'){
      if(entry.key!=='module:pomodoro'||typeof payload.expanded!=='boolean')return {ok:false,error:'invalid_action'};
      const height=payload.expanded?520:210;entry.window.setMinimumSize(360,210);
      const bounds=entry.window.getBounds();entry.window.setBounds(fitBounds({...bounds,height},screen.getDisplayMatching(bounds).workArea,210));return {ok:true};
    }
    if(payload.action==='music-layout'){
      if(entry.key!=='module:music'||payload.form!=='bar'||typeof payload.expanded!=='boolean')return {ok:false,error:'invalid_action'};
      const height=payload.expanded?180:100;
      entry.musicHeight=height;
      entry.window.setMinimumSize(380,height);
      const bounds=entry.window.getBounds();
      entry.window.setBounds(fitBounds({...bounds,height},screen.getDisplayMatching(bounds).workArea,height));
      return {ok:true};
    }
    const permitted = entry.kind==='module' ? ['get','command'] : entry.kind === 'recorder' ? ['get', 'start', 'pause', 'stop', 'permissions','mark','auto-on','auto-off','retry-save','results']
      : entry.kind==='quick' ? ['get','save','archive','references','records','source','idea-plan','idea-plan-open'] : ['get', 'save', 'archive', 'references','linked-resources','open-resource'];
    if (!permitted.includes(payload.action)) return { ok: false, error: 'invalid_action' };
    if(entry.kind==='recorder'&&['results','permissions'].includes(payload.action)){
      const result=await forward({...payload,kind:entry.kind,id:entry.id});
      if(result?.ok){main()?.show();main()?.focus();}return result;
    }
    return forward({ ...payload, kind: entry.kind, id: entry.id });
  });
  ipcMain.on('floats:broadcast', (event, payload) => {
    if (!mainSender(event)) return;
    if(payload?.kind==='recorder')recorderStatus=payload.status||'idle';
    if(options.openInline)main().webContents.send('launcher:changed',payload);
    if(payload?.kind==='recorder'&&payload.status!=='idle')review.hide();
    for (const entry of windows.values()) {
      if (!entry.window.isDestroyed() && (payload?.kind === 'theme' || payload?.kind === entry.kind && (!payload.id || payload.id === entry.id))) {
        entry.window.webContents.send('floats:changed', payload);
      }
    }
  });
  ipcMain.handle('meeting:prepare', (event, input) => {
    if (!allowed(event) || ['recorder','module'].includes(satellite(event)?.kind)) return { ok: false, error: 'forbidden' };
    return options.prep.generate(event.sender.id, input);
  });
  ipcMain.handle('meeting:cancel', (event) => { if (allowed(event)) options.prep.cancel(event.sender.id); return { ok: true }; });
  ipcMain.handle('meeting:config', (event) => allowed(event) ? options.publicConfig() : { ok: false });
  ipcMain.handle('meeting:copy', (event, text) => {
    if (!allowed(event) || typeof text !== 'string' || text.length > 180000) return { ok: false };
    clipboard.writeText(text); return { ok: true };
  });
  let importing = false;
  ipcMain.handle('meeting:import', async (event) => {
    if (!allowed(event) || ['recorder','module'].includes(satellite(event)?.kind)) return { ok: false, error: 'forbidden' };
    if (importing) return { ok: false, error: 'import_busy' };
    importing = true;
    try {
      const parent = satellite(event)?.window || main();
      const dialogOptions = { title: '选择会议参考材料', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Word、PDF 与文本材料', extensions: EXTENSIONS }] };
      const picked = mainSender(event) ? await options.openDialog(dialogOptions) : await dialog.showOpenDialog(parent, dialogOptions);
      if (picked.canceled) return { ok: true, files: [] };
      return await importMaterials(picked.filePaths);
    } catch { return { ok: false, error: 'file_unreadable' }; }
    finally { importing = false; }
  });
  ipcMain.handle('floats:drag', (event, phase) => {
    const entry = satellite(event); if (!entry) return false;
    const cursor = screen.getCursorScreenPoint();
    if (phase === 'start') { entry.dragging = { cursor, bounds: entry.window.getBounds() }; showDock(); return true; }
    if (!entry.dragging) return false;
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const overDock = cursor.y >= area.y - 20 && cursor.y < area.y + 70 && Math.abs(cursor.x - (area.x + area.width / 2)) < 180;
    if (phase === 'move') {
      const { bounds, cursor: start } = entry.dragging;
      entry.window.setPosition(Math.round(bounds.x + cursor.x - start.x), Math.round(bounds.y + cursor.y - start.y));
      return { overDock };
    }
    entry.dragging = null; hideDock();
    entry.window.setBounds(fitBounds(entry.window.getBounds(), area, entry.key === 'module:music' ? entry.musicHeight||140 : 180)); persistPosition(entry);
    return { overDock: phase === 'end' && overDock };
  });
  function recoverPositions() { for (const entry of windows.values()) { const bounds = entry.window.getBounds(); entry.window.setBounds(fitBounds(bounds, screen.getDisplayMatching(bounds).workArea, entry.key === 'module:music' ? entry.musicHeight||140 : 180)); } }
  screen.on('display-removed', recoverPositions); screen.on('display-metrics-changed', recoverPositions);
  const review=createQuickReview({request:forward,enabled:process.env.PANEL_TEST_MODE!=='1',open:async(mode)=>{
    const host=main();if(!host||host.isDestroyed())return;
    const result=await openFloat({sender:host.webContents,senderFrame:host.webContents.mainFrame},{kind:'quick',review:mode||'pending'});
    const entry=windows.get('quick');
    if(result.ok&&entry&&!entry.window.isDestroyed())entry.window.webContents.send('floats:changed',{kind:'quick',review:mode||'pending'});
  }});
  return {
    windowToolsSender,
    moduleSender(event,id){const entry=satellite(event);return !!entry&&entry.kind==='module'&&entry.id===id;},
    open(payload){const sender=main()?.webContents;return sender?openFloat({sender,senderFrame:sender.mainFrame},payload):Promise.resolve({ok:false,error:'host_unavailable'});},
    plannerSender(event){const entry=satellite(event);return !!entry&&entry.kind==='module'&&entry.id==='todo';},
    plannerLegacy(){return forward({action:'get',kind:'module',id:'todo'});},
    linkSender(event){const entry=satellite(event);return !!entry&&entry.kind==='module'&&entry.id==='links';},
    linkSnapshot(){return forward({action:'command',kind:'module',id:'links',operation:'library-get',values:{}});},
    recorderCommand(action,recordingId){return forward({kind:'recorder',action,recordingId});},
    timerSender(event){const entry=satellite(event);return !!entry&&entry.kind==='module'&&['pomodoro','todo'].includes(entry.id);},
    recallAll() { for (const entry of windows.values()) closeEntry(entry); },
    beginQuit(resume) {
      cancelDetach();
      if (!windows.size) return true;
      if (!quitContinuation) { quitContinuation = resume; for (const entry of windows.values()) closeEntry(entry); }
      return false;
    },
    dispose() { clearInterval(activityTimer);review.dispose();cancelDetach(); quitting = true; options.prep.dispose(); for (const p of pending.values()) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'host_unavailable' }); } pending.clear(); },
  };
}
module.exports = { fitBounds, createFloatingRuntime };
