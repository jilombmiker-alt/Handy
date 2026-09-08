(() => {
  'use strict';
  const M = window.NotebookModel;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const errors = { not_configured: '尚未配置文本 AI。打开模型设置，或继续手动准备。', unauthorized: '模型密钥无效或权限不足，请检查设置后重试。',
    timeout: '整理超时了，材料已保留。可重试或直接手动准备。', cancelled: '已取消整理，原笔记没有改变。', rate_limited: '模型服务繁忙，请稍后重试。',
    invalid_response: '模型返回的草案不完整，未写入笔记。请重试。', invalid_input: '请输入会议背景，材料合计不超过 30000 字符。',
    request_failed: '暂时无法连接模型，请检查地址、模型名称和网络后重试。', conflict: '这篇笔记已在其他位置更新。当前输入已保留，请复制备份后重新打开。',
    storage_failed: '本机保存失败，输入仍在窗口中。请复制备份并重试，不要退出应用。', host_timeout: '主界面暂未响应，请保留此窗口并重试。',
    file_too_large: 'Word／PDF 单个不超过 10 MB，文本文件不超过 120 KB。', materials_too_large: '最多 5 个文件，提取文字合计不超过 24000 字符；请精简后重试。',
    unsupported_file: '请选择 Word（.docx／.doc）、PDF、TXT 或 Markdown 文件。',
    unsupported_encoding: '文本编码无法识别，请另存为 UTF-8 后重试。',
    file_unreadable: '文件无法读取或已损坏。请用原应用重新导出，再选择文件重试。',
    parser_unavailable: '此系统暂不能解析该格式，请先粘贴文字。',
    no_text: '未找到可提取的文字。扫描版和图片暂不支持识别，请先转成可选中文字的文件。',
    pdf_encrypted: '该 PDF 已加密，请自行提供无密码、允许读取的副本。',
    pdf_too_many_pages: 'PDF 超过 100 页，请先选取本次会议相关页面。',
    import_timeout: '文件解析超时，请换成较小的文件重试，或直接粘贴文字。',
    import_busy: '另一个窗口正在选择或解析材料，请稍后重试。' };
  class NotebookEditor {
    constructor(root, note, api) {
      this.root = root; this.note = structuredClone(note); this.api = api; this.revision = M.version(note);
      this.dirty = 0; this.saved = 0; this.timer = null; this.saving = null; this.generating = false;
      this.proposed = null; this.files = []; this.references = []; this.selectedRefs = new Set(); this.destroyed = false;
      if (note.meeting) this.note.meeting = M.meeting(note.meeting);
      this.files = this.note.meeting?.materials || [];
      this.selectedRefs = new Set(this.note.meeting?.referenceIds || []);
      this.render();
    }
    status(message, error = false) {
      const node = this.root.querySelector('.nb-footer .nb-status');
      if (node) { node.textContent = message; node.classList.toggle('error', error); }
    }
    importStatus(message, error = false) {
      this.materialStatus = message; this.materialError = error;
      const node = this.root.querySelector('.nb-import-status');
      if (node) { node.textContent = message; node.classList.toggle('error', error); node.hidden = !message; }
    }
    async refreshLinks(){
      if(!this.api.linkedResources||this.destroyed)return;
      const serial=this.linksSerial=(this.linksSerial||0)+1,section=this.root.querySelector('.nb-linked');if(!section)return;
      try{
        const result=await this.api.linkedResources();if(this.destroyed||serial!==this.linksSerial||!section.isConnected)return;
        if(!result?.ok)throw Error('unavailable');
        const links=result.links||[],signature=JSON.stringify(links);if(this.linksSignature===signature)return;this.linksSignature=signature;
        section.hidden=!links.length;section.querySelector('summary').textContent=`关联资料 · ${links.length}`;
        const list=section.querySelector('.nb-linked-list');list.replaceChildren();
        for(const link of links){const row=document.createElement('div'),button=document.createElement('button');button.type='button';button.textContent=link.title||'打开链接';button.dataset.linkId=link.id;
          button.onclick=async()=>{button.disabled=true;try{const r=await this.api.openResource(link.id);if(!r?.ok){this.status('链接已变化或暂时无法打开，请刷新资料后重试。',true);this.refreshLinks();}}catch{this.status('暂时无法打开链接，请重试。',true);}finally{button.disabled=false;}};
          row.append(button);if(link.note){const note=document.createElement('p');note.textContent=link.note;row.append(note);}list.append(row);}
      }catch{
        if(this.destroyed||serial!==this.linksSerial)return;this.linksSignature=null;section.hidden=false;section.querySelector('summary').textContent='关联资料 · 暂未读取';
        const list=section.querySelector('.nb-linked-list');list.replaceChildren();const retry=document.createElement('button');retry.type='button';retry.textContent='重新读取资料';retry.onclick=()=>this.refreshLinks();list.append(retry);
      }
    }
    async flush() {
      clearTimeout(this.timer);
      if (this.saving) { await this.saving; if (this.saved < this.dirty) return this.flush(); return; }
      if (this.saved === this.dirty) return;
      const serial = this.dirty, copy = structuredClone(this.note);
      if (copy.meeting) copy.content = M.toText(copy.meeting);
      this.status('正在保存…');
      this.saving = (async () => {
        const result = await this.api.save(copy, this.revision);
        if (!result?.ok) { const error = result?.error || 'storage_failed'; this.status(errors[error] || '保存失败，请重试。', true); throw Error(error); }
        this.revision = M.version(result.note); this.note.updatedAt = result.note.updatedAt; this.saved = serial;
        this.status('已自动保存');
      })();
      try { await this.saving; } finally { this.saving = null; }
      if (this.saved < this.dirty) return this.flush();
    }
    changed() {
      if (this.note.meeting) this.note.meeting.confirmedAt = 0;
      this.dirty++; this.status('正在保存…'); clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush().catch(() => {}), 180);
    }
    destroy() { this.destroyed = true; this.handleCleanup?.(); clearTimeout(this.timer); if (this.generating) this.api.cancel?.(); this.root.onclick = null; this.root.oninput = null; this.root.onchange = null; }
    field(label, value, path, { multi = false, max = 16000, placeholder = '' } = {}) {
      return `<label class="nb-field"><span>${esc(label)}</span>${multi
        ? `<textarea data-field="${path}" maxlength="${max}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input data-field="${path}" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>`;
    }
    render() {
      this.handleCleanup?.();
      const n = this.note, m = n.meeting;
      this.root.classList.add('nb-editor');
      this.root.innerHTML = `<div class="nb-toolbar"><span>${m ? '会议笔记' : this.api.quick ? '随手记' : '笔记'}</span><div>
        ${this.api.quick ? '<button type="button" data-nb="archive">存为新笔记</button>' : ''}
        ${this.api.remove ? '<button type="button" data-nb="delete">删除</button>' : ''}
        <button type="button" data-nb="save">立即保存</button></div></div>
        ${this.api.quick ? '' : this.field('标题', n.title, 'title', { max: 80, placeholder: '未命名笔记' })}
        ${m ? `<nav class="nb-stages" aria-label="会议阶段">${[['prep','会前准备'],['live','会中记录'],['review','会后核对']].map(([stage,label]) => `<button type="button" data-stage="${stage}" aria-pressed="${m.stage === stage}">${label}</button>`).join('')}</nav>` : ''}
        <div class="nb-body">${m ? this.meetingBody(m) : this.field(this.api.quick ? '随时写下，不必先起标题' : '正文', n.content, 'content', { multi: true, max: 60000, placeholder: '从这里开始写…' })}</div>
        <div class="nb-footer"><span class="nb-status" role="status" aria-live="polite" tabindex="-1">${m?.confirmedAt ? '会议结果已核对' : '本机自动保存'}</span></div>`;
      this.root.oninput = (event) => this.input(event);
      if(this.api.linkedResources){
        const section=document.createElement('details');section.className='nb-linked';section.open=true;section.hidden=true;section.innerHTML='<summary>关联资料</summary><div class="nb-linked-list"></div>';
        this.root.querySelector('.nb-footer').before(section);this.linksSignature=null;void this.refreshLinks();
      }
      this.root.onchange = (event) => { if (event.target.matches('select,[type="checkbox"]')) this.input(event); };
      this.root.onclick = (event) => { const button = event.target.closest('button'); if (button) this.click(button).catch(() => {}); };
      if (this.api.mountHandle) this.handleCleanup = this.api.mountHandle(this.root);
      if (this.proposed && m?.stage === 'prep') this.renderProposal();
      if (this.generating) this.showGenerating();
      if (this.importing) { const upload = this.root.querySelector('[data-nb="upload"]'); if (upload) upload.disabled = true; }
    }
    meetingBody(m) {
      if (m.stage === 'prep') return `<p class="nb-intro">会前 5 分钟，先确定今天值得讨论什么。</p>
        ${this.field('这次要解决什么', m.objective, 'meeting.objective', { multi: true, max: 2000, placeholder: '一句话也可以，AI 会帮你整理方向' })}
        <div class="nb-ai-actions"><button type="button" class="nb-primary" data-nb="generate">AI 整理讨论方向</button><button type="button" data-nb="cancel" hidden>取消整理</button><button type="button" data-nb="settings">模型设置</button></div>
        <p class="nb-help">点击后才发送本次材料给模型；生成可编辑草案，不连续追问。</p>
        ${this.field('背景与材料', m.background, 'meeting.background', { multi: true, placeholder: '粘贴背景、已有约定或零散想法…' })}
        <div class="nb-materials"><button type="button" data-nb="references">选择参考笔记</button><button type="button" data-nb="upload">导入 Word / PDF</button><span>${this.files.length ? `${this.files.length} 个文件 · ` : ''}${this.selectedRefs.size ? `${this.selectedRefs.size} 篇参考笔记` : ''}</span></div>
        <p class="nb-import-status nb-status ${this.materialError ? 'error' : ''}" role="status" aria-live="polite" ${this.materialStatus ? '' : 'hidden'}>${esc(this.materialStatus || '')}</p>
        <p class="nb-help">支持 DOCX、DOC、文字型 PDF、TXT / Markdown；最多 5 个，合计 24000 字符。仅提取文字，不识别图片或保留排版，请核对后再整理。</p>
        <div class="nb-attachments">${this.files.map((f,i) => `<div><details><summary>${esc(f.name)} · ${f.text.length} 字符 · 查看文字</summary><pre class="nb-material-text nb-preserve">${esc(f.text)}</pre></details><button type="button" data-remove-file="${i}" aria-label="移除材料 ${esc(f.name)}">移除</button></div>`).join('')}</div>
        <div class="nb-reference-picker" hidden></div>
        <p class="nb-help">仅在点击整理后，将本次草稿、勾选笔记和导入材料发送给已配置的模型。不读取其他资料。</p>
        <div class="nb-proposal" hidden></div>
        <h3>讨论议题</h3>${this.topics(m, true)}<button type="button" data-nb="add-topic">添加议题</button>
        ${this.field('待确认的问题', m.questions, 'meeting.questions', { multi: true, max: 4000 })}
        <button type="button" data-nb="copy">复制讨论提纲</button><button type="button" data-stage="live">开始记录会议</button>`;
      if (m.stage === 'live') return `<p class="nb-intro">${esc(m.objective || '先记录，方向可以随后补充。')}</p>
        <div class="nb-modes" role="group" aria-label="记录方式"><button type="button" data-mode="topics" aria-pressed="${m.mode === 'topics'}">按议题记录</button><button type="button" data-mode="free" aria-pressed="${m.mode === 'free'}">整页自由记录</button></div>
        ${m.mode === 'topics' ? `${this.topics(m, false)}<button type="button" data-nb="add-topic">添加临时议题</button>`
          : this.field('自由记录（切换方式不会丢失）', m.freeText, 'meeting.freeText', { multi: true, max: 60000, placeholder: '先连续记下来，会后再核对…' })}
        <button type="button" data-stage="review">结束并核对</button>`;
      return `<p class="nb-intro">记录不必重抄，逐项确认结论与下一步。可随时存草稿。</p>
        ${m.topics.map((t,i) => `<section class="nb-topic"><h3>${esc(t.title || `议题 ${i+1}`)}</h3>
          <label class="nb-field"><span>讨论结果</span><select data-field="meeting.topics.${i}.status">${[['unchecked','待核对'],['decided','有结论'],['pending','讨论后待定'],['skipped','未讨论']].map(([v,label]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          ${this.field('结论、原因或记录', t.notes, `meeting.topics.${i}.notes`, { multi: true, max: 12000 })}</section>`).join('')}
        ${m.freeText ? `<details><summary>查看整页自由记录</summary><p class="nb-preserve">${esc(m.freeText)}</p></details>` : ''}
        <h3>后续事项</h3>${m.tasks.map((t,i) => `<section class="nb-task">${this.field('要做什么',t.text,`meeting.tasks.${i}.text`,{ max:2000 })}<div class="nb-two">${this.field('负责人',t.owner,`meeting.tasks.${i}.owner`,{ max:200 })}${this.field('跟进时间（可后补）',t.due,`meeting.tasks.${i}.due`,{ max:200 })}</div><button type="button" data-remove-task="${i}">移除事项</button></section>`).join('')}
        <button type="button" data-nb="add-task">添加后续事项</button>
        ${!m.tasks.length ? `<label class="nb-check"><input type="checkbox" data-field="meeting.noTasks" ${m.noTasks ? 'checked' : ''}>已核对，本次没有后续任务</label>` : ''}
        <button type="button" class="nb-primary" data-nb="confirm">完成核对</button><button type="button" data-nb="copy">复制会议结果</button>`;
    }
    topics(m, prep) {
      if (!m.topics.length) return '<p class="nb-help">还没有议题。可以手动添加，也可以在会前让 AI 整理。</p>';
      return m.topics.map((t,i) => `<section class="nb-topic">${this.field(`议题 ${i+1}`, t.title, `meeting.topics.${i}.title`, { max:300 })}
        ${prep ? this.field('讨论重点 / 希望得到什么',t.focus,`meeting.topics.${i}.focus`,{ multi:true,max:2000 })
          : `<p class="nb-help">${esc(t.focus || '自由补充重点')}</p>${this.field('记录、决定与待确认',t.notes,`meeting.topics.${i}.notes`,{ multi:true,max:12000 })}`}
        <button type="button" data-remove-topic="${i}">移除议题</button></section>`).join('');
    }
    input(event) {
      const el = event.target, key = el.dataset.field;
      if (this.proposed) {
        if (['objective','questions'].includes(el.dataset.proposal)) this.proposed[el.dataset.proposal] = el.value;
        if (el.dataset.proposalTitle !== undefined && this.proposed.topics[Number(el.dataset.proposalTitle)]) this.proposed.topics[Number(el.dataset.proposalTitle)].title = el.value;
        if (el.dataset.proposalFocus !== undefined && this.proposed.topics[Number(el.dataset.proposalFocus)]) this.proposed.topics[Number(el.dataset.proposalFocus)].focus = el.value;
      }
      if (!key || !/^(title|content|meeting\.(objective|background|questions|freeText|noTasks|topics\.\d+\.(title|focus|notes|status)|tasks\.\d+\.(text|owner|due)))$/.test(key)) return;
      const parts = key.split('.'); let object = this.note;
      for (const part of parts.slice(0,-1)) object = object[part];
      object[parts.at(-1)] = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'title') this.note.titleSource = 'user';
      this.changed();
    }
    async click(button) {
      const action = button.dataset.nb, m = this.note.meeting;
      if (action === 'save') return this.flush();
      if (action === 'delete') { if (window.confirm('删除这篇会议笔记及其记录？')) { await this.flush(); await this.api.remove(); } return; }
      if (action === 'copy') {
        const result = await this.api.copy(`${this.note.title}\n\n${M.toText(m)}`);
        this.status(result?.ok ? '已复制，可粘贴到其他应用' : '复制失败，请选中文字手动复制。', !result?.ok); return;
      }
      if (action === 'float') { await this.flush(); return this.api.detach?.(); }
      if (action === 'archive') { await this.flush(); const result = await this.api.archive(); this.status(result.ok ? '已存为新笔记，随手记原文保留' : '归档失败，请重试。', !result.ok); return; }
      if (action === 'settings') return this.api.settings();
      if (action === 'cancel') return this.api.cancel();
      if (action === 'generate') return this.generate();
      if (action === 'references') {
        const result = await this.api.references(); this.references = result.notes || [];
        const picker = this.root.querySelector('.nb-reference-picker'); picker.hidden = false;
        picker.innerHTML = this.references.filter((n) => n.id !== this.note.id).map((n) => `<label class="nb-check"><input type="checkbox" data-reference="${esc(n.id)}" ${this.selectedRefs.has(n.id) ? 'checked' : ''}>${esc(n.title || '未命名笔记')}</label>`).join('') || '<p class="nb-help">没有其他笔记可选。</p>';
        picker.onchange = (event) => {
          const id = event.target.dataset.reference;
          if (id) { event.target.checked ? this.selectedRefs.add(id) : this.selectedRefs.delete(id); this.note.meeting.referenceIds = [...this.selectedRefs]; this.changed(); }
        };
        return;
      }
      if (action === 'upload') {
        if (this.importing) return;
        this.importing = true; button.disabled = true;
        this.importStatus('正在本机提取文字，单个文件最多等待 15 秒…');
        const result = await this.api.importFiles().catch(() => ({ ok:false }));
        this.importing = false; button.disabled = false;
        if (this.destroyed) return;
        if (!result?.ok) { this.importStatus(`${result?.name ? `${result.name}：` : ''}${errors[result?.error] || '无法导入文件，请重试。'}`, true); return; }
        if (!result.files.length) { this.importStatus('已取消选择，原材料没有改变。'); return; }
        if (this.files.length + result.files.length > 5 || [...this.files,...result.files].reduce((n,f) => n + f.text.length,0) > 24000) return this.importStatus('最多 5 个材料文件，合计不超过 24000 字符。',true);
        this.importStatus('已在本机提取文字。展开文件名可核对，尚未发送给 AI。');
        this.files.push(...result.files); this.note.meeting.materials = this.files; this.changed(); this.render(); return;
      }
      if (button.dataset.removeFile !== undefined) { this.files.splice(Number(button.dataset.removeFile),1); this.note.meeting.materials = this.files; this.changed(); this.render(); return; }
      if (!m) return;
      if (button.dataset.stage) { await this.flush(); m.stage = button.dataset.stage; this.changed(); this.render(); return; }
      if (button.dataset.mode) { m.mode = button.dataset.mode; this.changed(); this.render(); return; }
      if (action === 'add-topic') {
        if (m.topics.length >= 40) return this.status('每篇最多 40 个议题，可另建会议笔记。', true);
        m.topics.push({ id:M.uid(),title:'',focus:'',notes:'',status:'unchecked' });
      } else if (action === 'add-task') {
        if (m.tasks.length >= 60) return this.status('每篇最多 60 条后续事项。', true);
        m.tasks.push({ id:M.uid(),text:'',owner:'',due:'' });
      } else if (button.dataset.removeTopic !== undefined) {
        if (!window.confirm('移除这项议题及它的记录？')) return;
        m.topics.splice(Number(button.dataset.removeTopic),1);
      } else if (button.dataset.removeTask !== undefined) {
        if (!window.confirm('移除这条后续事项？')) return;
        m.tasks.splice(Number(button.dataset.removeTask),1);
      } else if (action === 'confirm') {
        const issues = M.reviewErrors(m); if (issues.length) { this.status(issues.join(' '),true); this.root.querySelector('.nb-footer .nb-status')?.focus(); return; }
        this.dirty++; m.confirmedAt = Date.now(); await this.flush(); this.status('会议结果已核对'); return;
      } else if (action === 'adopt') {
        let p;
        try { p = this.readProposal(); } catch { this.status('请填写会议目标和每项议题名称，再采用草案。', true); return; }
        if (m.topics.length + p.topics.length > 40) return this.status('议题已达上限，请先精简。',true);
        m.objective = p.objective; m.questions = p.questions;
        m.topics.push(...p.topics.map((t) => ({ ...t,id:M.uid(),notes:'',status:'unchecked' })));
        this.proposed = null;
      } else if (action === 'discard') { this.proposed = null; this.render(); return; }
      else return;
      this.changed(); this.render();
    }
    showGenerating() {
      const generate = this.root.querySelector('[data-nb="generate"]'), cancel = this.root.querySelector('[data-nb="cancel"]');
      if (generate) { generate.disabled = this.generating; generate.textContent = this.generating ? '正在整理方向…' : 'AI 整理讨论方向'; }
      if (cancel) cancel.hidden = !this.generating;
    }
    async generate() {
      if (this.generating) return;
      await this.flush();
      const m = this.note.meeting;
      const refs = this.selectedRefs.size ? await this.api.references([...this.selectedRefs]) : { notes:[] };
      const input = [`会议标题：${this.note.title}`, `目标与背景：${m.objective}\n${m.background}`,
        ...m.topics.map((t) => `已有议题：${t.title}；重点：${t.focus}`),
        ...this.files.map((f) => `参考文件「${f.name}」：\n${f.text}`),
        ...(refs.notes || []).map((n) => `选中笔记「${n.title}」：\n${n.content}`)].join('\n\n');
      if (!m.objective.trim() && !m.background.trim() && !m.topics.length && !this.files.length && !this.selectedRefs.size) return this.status('先写一句目标或粘贴背景，就可以开始整理。',true);
      if (input.length > 30000) return this.status(errors.invalid_input,true);
      this.generating = true; this.showGenerating(); this.status('正在整理；无需继续回答问题，最多等待约 25 秒。');
      try {
        const result = await this.api.prepare(input);
        if (this.destroyed) return;
        if (!result?.ok) { this.status(errors[result?.error] || '整理失败，请重试。',true); return; }
        this.proposed = result.proposal;
        if (this.note.meeting.stage === 'prep') this.renderProposal();
        this.status('方向草案已生成，尚未写入笔记。可编辑后采用。');
      } catch { this.status(errors.request_failed,true); }
      finally { this.generating = false; if (!this.destroyed) this.showGenerating(); }
    }
    renderProposal() {
      const box = this.root.querySelector('.nb-proposal'); if (!box) return;
      const p = this.proposed; box.hidden = false;
      box.innerHTML = `<h3>讨论方向草案</h3><p class="nb-help">可直接修改。采用后更新目标和待确认问题，并追加议题；不会删掉已有记录。</p>
        <label class="nb-field"><span>会议目标</span><textarea data-proposal="objective" maxlength="1000">${esc(p.objective)}</textarea></label>
        ${p.topics.map((t,i) => `<label class="nb-field"><span>议题 ${i+1}</span><input data-proposal-title="${i}" maxlength="300" value="${esc(t.title)}"></label><label class="nb-field"><span>议题 ${i+1} 的讨论重点</span><textarea data-proposal-focus="${i}" maxlength="1500">${esc(t.focus)}</textarea></label>`).join('')}
        <label class="nb-field"><span>待确认问题</span><textarea data-proposal="questions" maxlength="4000">${esc(p.questions)}</textarea></label>
        <button type="button" class="nb-primary" data-nb="adopt">采用方向并追加议题</button><button type="button" data-nb="discard">暂不采用</button>`;
    }
    readProposal() {
      const box = this.root.querySelector('.nb-proposal');
      return M.proposal({ objective:box.querySelector('[data-proposal="objective"]').value,
        topics:this.proposed.topics.map((_t,i) => ({ title:box.querySelector(`[data-proposal-title="${i}"]`).value,focus:box.querySelector(`[data-proposal-focus="${i}"]`).value })),
        questions:box.querySelector('[data-proposal="questions"]').value });
    }
  }
  window.NotebookEditor = NotebookEditor;
})();
