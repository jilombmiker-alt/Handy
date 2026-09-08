(() => {
  'use strict';
  const M=window.QuickRecordModel,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const errors={conflict:'这条记录已更新。输入仍在这里，请先复制备份，再重新打开。',storage_failed:'本机保存失败，请复制备份后重试，不要关闭窗口。',record_limit:'记录已达 1000 条，请先导出备份。',empty_text:'先写一点内容，再确认记完。',invalid_input:'提醒时间请选择 20:00 至 21:00。'};
  class QuickRecordEditor{
    constructor(root,result,api){
      this.root=root;this.api=api;this.state=result.state;this.record=structuredClone(M.active(this.state));this.dirty=0;this.saved=0;this.saving=null;this.busy=false;this.filter='all';this.query='';this.render();
    }
    status(message,error=false){const node=this.root.querySelector('.qr-status');if(node){node.textContent=message;node.classList.toggle('error',error);}}
    async flush(){
      if(this.planDraft&&!this.planDraft.saved){this.status('安排草稿尚未确认，请先确认加入或返回记录。',true);throw Error('unsaved_plan');}
      clearTimeout(this.timer);
      if(this.saving){await this.saving;if(this.saved<this.dirty)return this.flush();return;}
      if(this.saved===this.dirty)return;
      const serial=this.dirty,record=structuredClone(this.record);
      this.saving=(async()=>{
        const result=await this.api.command({action:'save',recordId:record.id,revision:record.revision,title:record.title,content:record.content});
        if(!result?.ok)throw Error(result?.error||'storage_failed');
        this.state=result.state;const committed=M.active(this.state);
        this.record.revision=committed.revision;this.record.updatedAt=committed.updatedAt;this.record.confirmedAt=committed.confirmedAt;this.saved=serial;
        this.status('已保存到本机');this.updateStateLabel();
      })();
      try{await this.saving;}catch(e){this.status(errors[e.message]||'保存暂未完成，请保留窗口并重试。',true);throw e;}finally{this.saving=null;}
      if(this.saved<this.dirty)return this.flush();
    }
    changed(event){
      if(event.target.matches('[data-field="content"],[data-field="title"]')){
        this.record[event.target.dataset.field]=event.target.value;this.record.confirmedAt=0;this.dirty++;this.status('正在保存…');this.updateStateLabel();
        clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(()=>{}),120);
      }
      if(event.target.matches('[data-qr-search]')){this.query=event.target.value;this.renderList();}
    }
    updateStateLabel(){const label=this.root.querySelector('.qr-state');if(label)label.textContent=this.record.confirmedAt?'已确认 · 仍可继续追加':this.record.confirmedLength?'有修改 / 追加待确认':'草稿 · 随时接着写';}
    async command(command){
      await this.flush();
      const result=await this.api.command({...command,...(command.action==='confirm'?{recordId:this.record.id,revision:this.record.revision}:{})});
      if(!result?.ok)throw Error(result?.error||'storage_failed');
      this.state=result.state;this.record=structuredClone(M.active(this.state));this.dirty=this.saved=0;
      return result;
    }
    async click(button){
      if(this.busy)return;
      if(button.dataset.qr==='retry'&&this.planDraft)return this.confirmPlan();
      if(button.dataset.qr==='plan')return this.beginPlan(button.dataset.recordId||this.record.id);
      if(button.dataset.qr==='plan-cancel')return this.cancelPlan();
      if(button.dataset.qr==='plan-open'){
        this.busy=true;try{const result=await this.api.openPlan(this.planDraft.recordId);if(!result?.ok)this.status('请先保存或放下待办里的编辑，再重试查看。',true);}catch{this.status('暂时无法打开待办，请重试。',true);}finally{this.busy=false;}return;
      }
      this.busy=true;
      // Switching/confirming is a short transaction: don't accept input that a
      // subsequent render could replace while its save acknowledgement is in flight.
      const inputs=[...this.root.querySelectorAll('[data-field]')];for(const input of inputs)input.readOnly=true;
      try{
        const action=button.dataset.qr;
        if(action==='finish'){
          await this.flush();
          if(!this.record.content.trim())throw Error('empty_text');
          this.root.querySelector('.qr-finish').hidden=false;
        }else if(action==='continue'||action==='later'){
          this.root.querySelector('.qr-finish').hidden=true;
          if(action==='continue')this.root.querySelector('[data-field="content"]').focus();
          else this.status('已保存，保留待确认；今天可以先到这里。');
        }else if(action==='library'){
          await this.flush();const result=await this.api.get?.();if(result?.ok)this.state=result.state;this.showLibrary=!this.showLibrary;this.render();
        }else if(action==='filter'){
          this.filter=button.dataset.filter;this.renderList();
        }else if(action==='archive'){
          await this.flush();const result=await this.api.archive();if(!result?.ok)throw Error(result?.error||'storage_failed');this.status(result.reused?'已经存过这篇笔记，没有重复创建或覆盖。':'已另存到笔记库，随手记仍保留并参与周回看。');
        }else if(action==='source'){
          await this.flush();const result=await this.api.source?.();if(!result?.ok)throw Error(result?.error||'not_found');
        }else if(action==='review-choice'){
          await this.flush();const record=this.state.records.find(r=>r.id===button.dataset.recordId);
          await this.command({action:'review',recordId:record.id,revision:record.revision,choice:button.dataset.choice});
          this.renderList();this.status('已记下你的决定，不会自动创建待办。');
        }else if(action==='retry'){await this.flush();this.status('已保存到本机');}
        else if(action==='settings'){
          const time=this.root.querySelector('[data-qr-time]').value,enabled=this.root.querySelector('[data-qr-enabled]').checked;
          const weeklyEnabled=this.root.querySelector('[data-qr-weekly]').checked;
          await this.command({action,time,enabled,weeklyEnabled});this.status('提醒设置已保存；每周回看仍可随时主动打开。');
        }else{
          const mapped=action==='back'?'select':action;
          await this.command({action:mapped,recordId:action==='back'?this.state.previousId:button.dataset.recordId});
          if(['new','select','back'].includes(action))this.showLibrary=false;
          this.render();
          if(action==='new')this.root.querySelector('[data-field="content"]').focus();
        }
      }catch(e){this.status(errors[e.message]||'暂时没有完成，请保留当前输入并重试。',true);}
      finally{this.busy=false;for(const input of inputs)input.readOnly=false;}
    }
    render(){
      this.planDraft=null;this.root.classList.remove('qr-planning');
      const r=this.record;
      this.root.classList.add('nb-editor','qr-editor');
      this.root.classList.toggle('qr-browsing',!!this.showLibrary);
      this.root.innerHTML=`<div class="qr-heading"><h1>随手记</h1><button type="button" data-qr="library" aria-expanded="${!!this.showLibrary}">${this.showLibrary?'回到正文':'记录本'}</button><button type="button" class="nb-primary" data-qr="new">新想法</button></div>
        <div class="qr-context"><span class="qr-state"></span><button type="button" data-qr="back" ${!this.state.records.some(n=>n.id===this.state.previousId&&!n.trashedAt)?'disabled':''}>返回上条</button></div>
        <section class="qr-library" ${this.showLibrary?'':'hidden'} aria-label="独立记录"><label class="nb-field"><span>搜索记录</span><input type="search" data-qr-search value="${esc(this.query)}" placeholder="关键词或主题"></label><div class="qr-filters">${[['all','最近'],['pending','待确认'],['weekly','每周回看'],['trash','回收站']].map(([value,label])=>`<button type="button" data-qr="filter" data-filter="${value}">${label}</button>`).join('')}</div><div class="qr-list"></div></section>
        <section class="qr-writing" ${this.showLibrary?'hidden':''}><label class="nb-field qr-title"><span>主题（可不填）</span><input data-field="title" maxlength="80" value="${esc(r.title)}" placeholder="不必先起标题"></label><label class="nb-field qr-content"><span class="qr-sr">记录正文</span><textarea data-field="content" maxlength="60000" placeholder="先记下来。一个关键词、一句话都可以。">${esc(r.content)}</textarea></label></section>
        <section class="qr-finish" hidden aria-label="结束本次记录"><p>这次记完了吗？内容已经保存在本机。</p><div><button type="button" data-qr="continue">继续补充</button><button type="button" class="nb-primary" data-qr="confirm">确认记完</button><button type="button" data-qr="later">稍后再看</button></div></section>
        <div class="qr-actions"><button type="button" data-qr="finish">结束本次记录</button><details><summary>更多</summary><div class="qr-more"><button type="button" data-qr="pin">${r.pinned?'取消置顶':'置顶这条'}</button><button type="button" data-qr="archive" data-nb="archive">存为新笔记</button><button type="button" data-qr="trash">移到回收站</button><label class="qr-setting"><input type="checkbox" data-qr-enabled ${this.state.settings.enabled?'checked':''}>每日轻提醒</label><label class="qr-setting">晚间时间 <input type="time" data-qr-time min="20:00" max="21:00" value="${esc(this.state.settings.time)}"></label><button type="button" data-qr="settings">保存提醒设置</button></div></details></div>
        <footer class="nb-footer qr-footer"><span class="qr-status nb-status" role="status" aria-live="polite">已保存到本机</span><button type="button" data-qr="retry">重试保存</button></footer>`;
      const more=this.root.querySelector('.qr-more');
      if(this.api.plan){const plan=document.createElement('button');plan.type='button';plan.dataset.qr='plan';plan.textContent='安排这件事';plan.title='先看草稿，确认后才加入待办';more.prepend(plan);}
      const setting=document.createElement('label');setting.className='qr-setting';setting.title='每周五 14:00 起，在使用空隙轻提醒；当天最多一次，21:00 后不补发。';setting.innerHTML=`<input type="checkbox" data-qr-weekly ${this.state.settings.weeklyEnabled!==false?'checked':''}>周五 14:00 想法回看`;
      more.querySelector('[data-qr="settings"]').before(setting);
      if(r.sourceRecordingId){const source=document.createElement('button');source.type='button';source.dataset.qr='source';source.textContent='查看原录音与整理稿';more.prepend(source);}
      if(r.reviewChoice==='dismiss'){const reset=document.createElement('button');reset.type='button';reset.dataset.qr='review-reset';reset.dataset.recordId=r.id;reset.textContent='重新加入每周回看';more.prepend(reset);}
      this.root.oninput=e=>this.changed(e);
      this.root.onclick=e=>{const b=e.target.closest('[data-qr]');if(b)void this.click(b);};
      this.updateStateLabel();this.renderList();
    }
    renderList(){
      if(this.planDraft)return;
      this.root.querySelector('.qr-heading h1').textContent=this.showLibrary?(this.filter==='weekly'?'每周回看':'记录本'):'随手记';
      for(const b of this.root.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b.dataset.filter===this.filter));
      if(this.filter==='weekly'){
        const now=Date.now(),rows=M.ideas(this.state).filter(r=>`${r.title}\n${r.content}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())).sort((a,b)=>Number(M.needsReview(b,now))-Number(M.needsReview(a,now))||b.updatedAt-a.updatedAt);
        const choices={'weekend':'周末看看','next-week':'下周再看',later:'先留着',dismiss:'不再回看'};
        this.root.querySelector('.qr-list').innerHTML=`<p class="nb-help qr-review-intro">${rows.length} 个想法 · ${rows.filter(r=>M.needsReview(r,now)).length} 个本周待回看<br>不完整也没关系。先记下意向，不自动加入待办。</p>`+(rows.length?rows.map(r=>{const excerpt=(r.content.startsWith(M.title(r))?r.content.slice(M.title(r).length):r.content).trim();return `<article class="qr-idea"><button type="button" class="qr-row" data-qr="select" data-record-id="${esc(r.id)}"><span>${esc(M.title(r))}</span><small>${M.needsReview(r,now)?'这周还没回看':`本周已看 · ${choices[r.reviewChoice]||'先留着'}`} · ${r.confirmedAt?'已记完':'仍是草稿'}</small></button>${excerpt?`<p class="qr-idea-excerpt">${esc(excerpt.slice(0,160))}${excerpt.length>160?'…':''}</p>`:''}<div class="qr-decisions">${Object.entries(choices).map(([choice,label])=>`<button type="button" data-qr="review-choice" data-record-id="${esc(r.id)}" data-choice="${choice}" aria-pressed="${!M.needsReview(r,now)&&r.reviewChoice===choice}">${label}</button>`).join('')}</div></article>`;}).join(''):'<p class="nb-help">暂时没有待回看的想法。记录不用完整，先留下来就好。</p>');
        if(this.api.plan)for(const article of this.root.querySelectorAll('.qr-idea')){const button=document.createElement('button');button.type='button';button.dataset.qr='plan';button.dataset.recordId=article.querySelector('[data-record-id]').dataset.recordId;button.className='qr-plan-entry';button.textContent='安排这件事';button.title='先看草稿，确认后才加入待办';article.querySelector('.qr-decisions').prepend(button);}
        return;
      }
      const rows=this.state.records.filter(r=>(this.filter==='trash'?!!r.trashedAt:!r.trashedAt)&&(this.filter!=='pending'||r.content.trim()&&!r.confirmedAt)&&`${r.title}\n${r.content}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt-a.updatedAt);
      this.root.querySelector('.qr-list').innerHTML=rows.length?rows.map(r=>`<button type="button" class="qr-row" data-qr="${this.filter==='trash'?'restore':'select'}" data-record-id="${esc(r.id)}"><span>${r.pinned?'置顶 · ':''}${esc(M.title(r))}</span><small>${this.filter==='trash'?'点击恢复':r.confirmedAt?'已确认':'待确认'} · ${esc(new Date(r.updatedAt).toLocaleDateString())}</small></button>`).join(''):'<p class="nb-help">这里暂时没有记录。新想法随时可以开始。</p>';
    }
    async refresh(){
      if(this.busy||this.planDraft||this.saving||this.dirty!==this.saved)return;
      const result=await this.api.get?.();if(result?.ok&&!this.busy&&!this.saving&&this.dirty===this.saved){this.state=result.state;this.renderList();}
    }
    async openRecord(id){
      if(this.busy)return;
      this.busy=true;
      const inputs=[...this.root.querySelectorAll('[data-field]')];for(const input of inputs)input.readOnly=true;
      try{await this.command({action:'select',recordId:id});this.showLibrary=false;this.render();}
      catch(e){this.status(errors[e.message]||'来源记录不存在或已在回收站，当前输入未改变。',true);throw e;}
      finally{this.busy=false;for(const input of inputs)input.readOnly=false;}
    }
    async review(mode='pending'){
      if(this.busy)return;this.busy=true;
      const inputs=[...this.root.querySelectorAll('[data-field]')];for(const input of inputs)input.readOnly=true;
      try{await this.flush();const result=await this.api.get?.();if(result?.ok)this.state=result.state;this.showLibrary=true;this.filter=mode==='weekly'?'weekly':'pending';this.query='';this.render();}
      finally{this.busy=false;for(const input of inputs)input.readOnly=false;}
    }
    planError(code){return ({source_changed:'原想法已有更新。草稿仍保留，请返回记录核对后重新安排。',draft_expired:'这份安排草稿已失效，请复制修改后的事项，再返回记录重新打开。',invalid_time:'请检查日期；填写时间段时，开始和结束都要填写，且结束须晚于开始。',invalid_text:'请填写事项，最多 200 字。',invalid_state:'分类已变化，请返回记录重新选择。',not_found:'来源已不存在或在回收站，当前记录未改变。',save_failed:'待办保存失败，草稿已保留，请重试确认。',conflict:'待办刚有更新，草稿已保留，请再次确认。',corrupt_store:'待办数据无法读取，未覆盖原文件，请先备份并恢复。',request_failed:'暂时没有收到保存结果。请重试确认，会先检查是否已保存，避免重复。'})[code]||'暂未完成，草稿已保留，请重试。';}
    async beginPlan(recordId){
      if(this.busy||this.planDraft)return;this.busy=true;
      const inputs=[...this.root.querySelectorAll('[data-field]')];for(const input of inputs)input.readOnly=true;
      try{
        await this.flush();const latest=await this.api.get?.();if(latest?.ok)this.state=latest.state;
        const record=this.state.records.find(r=>r.id===recordId);
        if(!record)throw Error('not_found');
        const result=await this.api.plan({operation:'prepare',recordId,revision:record.revision});
        if(!result?.ok)throw Error(result?.error||'request_failed');
        this.planDraft={...result,recordId};this.renderPlan();
      }catch(e){this.status(this.planError(e.message),true);}finally{this.busy=false;for(const input of inputs)input.readOnly=false;}
    }
    renderPlan(){
      const draft=this.planDraft;this.root.classList.add('qr-planning');this.root.querySelector('.qr-heading h1').textContent=draft.saved?'已经安排':'安排这件事';
      this.root.querySelector('.qr-plan')?.remove();const form=document.createElement('form');form.className='qr-plan';form.setAttribute('aria-label','确认安排草稿');
      if(draft.saved){
        const s=draft.saved,label={planned:'待进行',active:'进行中',waiting:'等待中',done:'已完成'}[s.status]||'已保存';
        form.innerHTML=`<h2>${esc(s.title)}</h2><p class="nb-help">${esc(s.date)} · ${s.archived?'已归档':label}</p><p class="nb-help">已经关联这条想法，不会重复添加。原随手记仍保留。</p><div class="qr-plan-actions"><button type="button" data-qr="plan-open">查看待办</button><button type="button" data-qr="plan-cancel">返回记录</button></div>`;
        this.status('待办已保存到本机。');
      }else{
        const v=draft.values;
        form.innerHTML=`<p class="nb-help">先确认要做什么。原想法保留在随手记，不会被改写。</p><label class="nb-field"><span>事项</span><textarea data-plan-field="title" maxlength="200" rows="3" required>${esc(v.title)}</textarea></label><label class="nb-field"><span>哪天</span><input type="date" data-plan-field="date" value="${esc(v.date)}" required></label><details class="qr-plan-options"><summary>时间段与分类（可不填）</summary><div class="qr-plan-times"><label class="nb-field"><span>开始</span><input type="time" data-plan-field="start"></label><label class="nb-field"><span>结束</span><input type="time" data-plan-field="end"></label></div><label class="nb-field"><span>分类</span><select data-plan-field="category">${Object.entries(draft.categories).map(([id,name])=>`<option value="${esc(id)}" ${id===v.category?'selected':''}>${esc(name)}</option>`).join('')}</select></label></details>${draft.longSource?'<p class="nb-help">原文超过 8000 字，不会截断搬入；完整内容可从待办的来源入口查看。</p>':''}<div class="qr-plan-actions"><button type="submit" class="nb-primary">确认加入待办</button><button type="button" data-qr="plan-cancel">先不安排</button></div>`;
        this.status('现在只是草稿，还没有创建待办。');
      }
      form.onsubmit=e=>{e.preventDefault();void this.confirmPlan();};
      this.root.querySelector('.qr-footer').before(form);form.querySelector('textarea,button')?.focus();
    }
    async confirmPlan(){
      if(this.busy||!this.planDraft||this.planDraft.saved)return;this.busy=true;
      const controls=[...this.root.querySelectorAll('.qr-plan input,.qr-plan textarea,.qr-plan select,.qr-plan button')],values=Object.fromEntries([...this.root.querySelectorAll('[data-plan-field]')].map(n=>[n.dataset.planField,n.value]));
      for(const control of controls)control.disabled=true;this.status('正在保存…');
      try{const result=await this.api.plan({operation:'confirm',token:this.planDraft.token,values});if(!result?.ok)throw Error(result?.error||'request_failed');this.planDraft.saved=result.saved;this.renderPlan();}
      catch(e){this.status(this.planError(e.message),true);}finally{this.busy=false;for(const control of controls)control.disabled=false;}
    }
    async cancelPlan(){
      if(this.busy||!this.planDraft)return;this.busy=true;
      try{if(this.planDraft.token)await this.api.plan({operation:'cancel',token:this.planDraft.token}).catch(()=>{});
        const latest=await this.api.get?.();if(latest?.ok){this.state=latest.state;this.record=structuredClone(M.active(this.state));this.dirty=this.saved=0;}
        this.planDraft=null;this.root.classList.remove('qr-planning');this.render();this.status(latest?.ok?'原随手记已保留，已读取最新内容。':'最新记录暂未读取，请重新打开后核对。',!latest?.ok);this.root.querySelector('[data-qr="library"]')?.focus();}
      catch{this.status('暂时无法读取记录，安排草稿仍保留，请重试返回。',true);}
      finally{this.busy=false;}
    }
    destroy(){clearTimeout(this.timer);this.root.onclick=null;this.root.oninput=null;}
  }
  window.QuickRecordEditor=QuickRecordEditor;
})();
