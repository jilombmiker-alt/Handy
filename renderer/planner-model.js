(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PlannerModel=api;})(globalThis,()=>{
  'use strict';
  const states=['planned','active','waiting','done'];
  const labels={planned:'待进行',active:'进行中',waiting:'等待中',done:'已完成'};
  const fail=code=>{throw Error(code);};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const text=(v,max)=>typeof v==='string'&&v.length<=max?v:fail('invalid_text');
  function day(ms=Date.now()){const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function local(ms){const d=new Date(ms);return `${day(ms)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
  const categories={P0:'课程',P1:'自媒体与写作',P2:'Web Coding 项目',P3:'日常事务'};
  function validDay(v){return typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&day(new Date(`${v}T12:00`).getTime())===v;}
  function itemDay(v){return v.scheduled===false?v.date:day(v.start);}
  function week(v){const d=new Date(`${v}T12:00`);d.setDate(d.getDate()-(d.getDay()+6)%7);const from=day(d.getTime());d.setDate(d.getDate()+6);return {from,to:day(d.getTime())};}
  function empty(){return {version:1,revision:0,items:[],events:[],claims:{},receipts:[],reminders:true,aiEnabled:false,categories:{...categories}};}
  function item(v){
    if(!v||typeof v.id!=='string'||!/^plan-[\w-]{1,120}$/.test(v.id))fail('invalid_id');
    const title=text(v.title,200).trim();if(!title)fail('invalid_text');
    const scheduled=v.scheduled!==false;
    if(scheduled){if(!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.end<=v.start||v.end-v.start>86400000||v.start<946684800000||v.end>4102444800000)fail('invalid_time');}
    else if(!validDay(v.date)||v.start!==null||v.end!==null)fail('invalid_time');
    if(v.until!==undefined&&v.until!==null&&(!validDay(v.until)||v.until<(scheduled?day(v.start):v.date)))fail('invalid_time');
    if(v.category!==undefined&&!/^(P[0-3]|cat-[\w-]{1,80})$/.test(v.category))fail('invalid_state');
    if(v.kind!==undefined&&!['task','goal'].includes(v.kind))fail('invalid_state');
    if(!states.includes(v.status)||!['work','life','learn'].includes(v.area))fail('invalid_state');
    const source={};
    if(v.sourceIdea!==undefined){const r=v.sourceIdea;if(!r||typeof r.id!=='string'||!r.id||r.id.length>200||!Number.isSafeInteger(r.revision)||r.revision<1)fail('invalid_state');source.sourceIdea={id:r.id,revision:r.revision,title:text(r.title,200)};}
    return {id:v.id,title,topic:text(v.topic||'',120),area:v.area,start:v.start,end:v.end,fixed:!!v.fixed,status:v.status,
      progress:text(v.progress||'',4000),next:text(v.next||'',1000),archived:!!v.archived,scheduled,date:scheduled?day(v.start):v.date,
      ...(v.until?{until:v.until}:{}),kind:v.kind||'task',category:v.category||'P3',body:text(v.body||'',8000),...source};
  }
  function validate(s){
    if(!s||s.version!==1||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.items)||s.items.length>2000||!Array.isArray(s.events)||s.events.length>20000||!Array.isArray(s.receipts)||!s.claims||typeof s.claims!=='object')fail('corrupt_store');
    if(typeof s.reminders!=='boolean'||Array.isArray(s.claims)||s.receipts.some(r=>typeof r!=='string')||s.receipts.length>100)fail('corrupt_store');
    if(s.aiEnabled!==undefined&&typeof s.aiEnabled!=='boolean')fail('corrupt_store');
    if(s.categories!==undefined){if(!s.categories||typeof s.categories!=='object'||Array.isArray(s.categories)||Object.keys(s.categories).length>40)fail('corrupt_store');for(const [id,name] of Object.entries(s.categories))if(!/^(P[0-3]|cat-[\w-]{1,80})$/.test(id)||typeof name!=='string'||!name.trim()||name.length>40)fail('corrupt_store');}
    const ids=new Set();for(const r of s.items){item(r);if(ids.has(r.id))fail('corrupt_store');ids.add(r.id);}
    for(const e of s.events){if(!e||!Number.isFinite(e.at)||typeof e.id!=='string')fail('corrupt_store');item(e.after);if(e.before)item(e.before);}
    return s;
  }
  function apply(state,changes,now=Date.now(),source=''){
    validate(state);if(!Array.isArray(changes)||!changes.length||changes.length>24)fail('invalid_changes');
    const next=clone(state),ids=new Set();
    for(const change of changes){
      if(!change||ids.has(change.id))fail('duplicate_change');ids.add(change.id);
      const index=next.items.findIndex(r=>r.id===change.id),before=index<0?null:next.items[index];
      if(change.mode==='update'&&!before)fail('not_found');
      if(change.mode==='add'&&before)fail('duplicate_id');
      if(!['add','update'].includes(change.mode))fail('invalid_changes');
      const after=item({...before,...change});
      if(!Object.hasOwn({...categories,...state.categories},after.category))fail('invalid_state');
      if(index<0)next.items.push(after);else next.items[index]=after;
      next.events.push({id:`${state.revision+1}:${after.id}`,at:now,itemId:after.id,before,after:clone(after),source:text(source||'',8000)});
    }
    next.revision++;validate(next);return next;
  }
  function conflicts(items){
    const out=[];const active=items.filter(r=>r.scheduled!==false&&!r.archived&&r.status!=='done');
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)if(active[i].start<active[j].end&&active[j].start<active[i].end)out.push([active[i].id,active[j].id]);return out;
  }
  function focus(items,now=Date.now()){
    const list=items.filter(r=>r.scheduled!==false&&!r.archived&&r.status!=='done').sort((a,b)=>a.start-b.start);
    return {current:list.find(r=>r.status==='active')||list.find(r=>r.start<=now&&r.end>now)||null,next:list.find(r=>r.start>now)||null};
  }
  function due(s,now=Date.now()){
    if(!s.reminders)return [];
    const found=[];
    for(const r of s.items){if(r.scheduled===false||r.archived||r.status==='done')continue;
      for(const phase of ['end','start']){const time=r[phase],key=`${r.id}:${phase}:${time}`;
        if(time<=now&&now-time<=30*60000&&day(time)===day(now)&&!s.claims[key]){
          if(phase==='start'&&r.end<=now)continue;
          found.push({key,id:r.id,title:r.title,phase,time});
        }
      }
    }
    return found.sort((a,b)=>b.time-a.time);
  }
  function query(s,{date=day(),range='day',search='',category='',topic=''}={}){
    const w=week(date),needle=search.trim().toLocaleLowerCase();
    return s.items.filter(r=>{const d=itemDay(r),end=r.until||d;return (!category||(r.category||'P3')===category)&&(!topic||r.topic===topic)&&(!needle||[r.title,r.body,r.topic,r.progress,r.next].join(' ').toLocaleLowerCase().includes(needle))&&
      (range==='all'||range==='history'&&(end<date||r.status==='done'||r.archived)||range==='future'&&d>date&&!r.archived||range==='week'&&d<=w.to&&end>=w.from&&!r.archived||range==='day'&&d<=date&&end>=date&&!r.archived);}).sort((a,b)=>itemDay(a).localeCompare(itemDay(b))||(a.start??Infinity)-(b.start??Infinity));
  }
  function eventLabel(e){const a=e.after,b=e.before;if(!b)return '建立安排';const out=[];if(a.status!==b.status)out.push(a.status==='done'?'标记完成':`改为${labels[a.status]}`);if(a.start!==b.start||a.end!==b.end||itemDay(a)!==itemDay(b)||a.until!==b.until)out.push('调整安排时间');if(a.progress!==b.progress)out.push('记录进展');if(a.next!==b.next)out.push('更新下一步');if(a.archived!==b.archived)out.push(a.archived?'归档':'恢复');return out.join(' · ')||'修改内容';}
  function history(s,id){return s.events.filter(e=>e.itemId===id).slice().reverse();}
  function habits(s,items){const done=items.filter(r=>r.status==='done').length,scheduled=items.filter(r=>r.scheduled!==false);const slots=[0,0,0];for(const r of scheduled){const h=new Date(r.start).getHours();slots[h<12?0:h<18?1:2]++;}return `此范围 ${items.length} 项，当前已完成 ${done} 项；有时段 ${scheduled.length} 项（上午 ${slots[0]} / 下午 ${slots[1]} / 晚间 ${slots[2]}）。这是安排记录，不代表实际用时或完成质量。`;}
  return {states,labels,clone,empty,item,validate,apply,conflicts,focus,due,day,local,categories,validDay,itemDay,week,query,eventLabel,history,habits};
});
