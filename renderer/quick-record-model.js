(function(root,factory){const value=factory();if(typeof module==='object')module.exports=value;else root.QuickRecordModel=value;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const KEY='notch-quick-records-v1';
  const day=(time)=>{const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const nextMorning=(time)=>{const d=new Date(time);d.setDate(d.getDate()+1);d.setHours(6,0,0,0);return d.getTime();};
  const blank=(id,now,content='')=>({id,title:'',content,createdAt:now,updatedAt:now,revision:1,confirmedAt:0,confirmedLength:0,pinned:false,trashedAt:0});
  function initial(content,id,now){return {version:1,activeId:id,previousId:'',records:[blank(id,now,content)],settings:{enabled:true,time:'20:30'},ledger:{lastShownDay:'',snoozeUntil:0}};}
  function parse(raw){
    const s=JSON.parse(raw);
    if(s?.version!==1||!Array.isArray(s.records)||s.records.length>1001||!s.settings||!s.ledger||! /^(20:[0-5]\d|21:00)$/.test(s.settings.time)||typeof s.settings.enabled!=='boolean'||typeof s.ledger.lastShownDay!=='string'||!Number.isFinite(s.ledger.snoozeUntil))throw Error('invalid_store');
    if(s.settings.weeklyEnabled!==undefined&&typeof s.settings.weeklyEnabled!=='boolean')throw Error('invalid_store');
    const ids=new Set();
    for(const r of s.records){if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.content!=='string'||typeof r.title!=='string'||!Number.isSafeInteger(r.revision)||!Number.isFinite(r.updatedAt)||!Number.isFinite(r.createdAt))throw Error('invalid_store');
      if(r.sourceRecordingId!==undefined&&(typeof r.sourceRecordingId!=='string'||r.sourceRecordingId.length>200)||r.captureRevision!==undefined&&!Number.isSafeInteger(r.captureRevision)||r.reviewChoice!==undefined&&!['weekend','next-week','later','dismiss'].includes(r.reviewChoice))throw Error('invalid_store');
      ids.add(r.id);}
    if(!s.records.some(r=>r.id===s.activeId&&!r.trashedAt))throw Error('invalid_store');
    return s;
  }
  const active=s=>s.records.find(r=>r.id===s.activeId&&!r.trashedAt);
  const pending=s=>s.records.filter(r=>!r.trashedAt&&r.content.trim()&&!r.confirmedAt);
  const title=r=>r.title.trim()||r.content.trim().split('\n')[0].slice(0,40)||'新的想法';
  const week=time=>{const d=new Date(time);d.setDate(d.getDate()-((d.getDay()+6)%7));return day(d.getTime());};
  const ideas=s=>s.records.filter(r=>!r.trashedAt&&r.content.trim()&&r.reviewChoice!=='dismiss');
  const needsReview=(r,now)=>r.reviewWeek!==week(now)||r.reviewedRevision!==r.revision;
  function weeklyDue(s,now){
    const d=new Date(now),minutes=d.getHours()*60+d.getMinutes();
    if(s.settings.weeklyEnabled===false||d.getDay()!==5||minutes<840||minutes>1260||s.ledger.lastShownDay===day(now)||s.ledger.weeklyShownDay===day(now)||s.ledger.snoozeUntil>now)return 0;
    return ideas(s).filter(r=>needsReview(r,now)).length;
  }
  function reminder(s,now){
    const weekly=s.settings.weeklyEnabled!==false&&new Date(now).getDay()===5&&ideas(s).some(r=>needsReview(r,now));
    return weekly?{mode:'weekly',count:weeklyDue(s,now)}:{mode:'pending',count:due(s,now)};
  }
  function change(state,command,now,id){
    const s=structuredClone(state), r=active(s), action=command.action;
    if(action==='capture'){
      if(typeof command.recordingId!=='string'||!command.recordingId||command.recordingId.length>200||typeof command.content!=='string'||!command.content.trim()||command.content.length>60000)throw Error('invalid_input');
      const existing=s.records.find(n=>n.sourceRecordingId===command.recordingId);
      if(existing){
        // Never resurrect trash, steal the active editor, or replace a human edit.
        if(!existing.trashedAt&&existing.id!==s.activeId&&existing.revision===existing.captureRevision&&command.organized===true&&!existing.captureComplete){
          existing.content=command.content;existing.updatedAt=now;existing.revision++;existing.captureRevision=existing.revision;existing.captureComplete=true;
        }
      }else{
        if(s.records.length>=1000)throw Error('record_limit');
        s.records.unshift({...blank(id,now,command.content),sourceRecordingId:command.recordingId,captureRevision:1,captureComplete:command.organized===true});
      }
    }else if(action==='review'){
      const n=s.records.find(n=>n.id===command.recordId&&!n.trashedAt);
      if(!n)throw Error('not_found');
      if(n.revision!==command.revision)throw Error('conflict');
      if(!['weekend','next-week','later','dismiss'].includes(command.choice))throw Error('invalid_input');
      n.reviewChoice=command.choice;n.reviewWeek=week(now);n.reviewedRevision=n.revision;n.reviewedAt=now;
    }else if(action==='review-reset'){
      if(command.recordId!==r.id)throw Error('conflict');
      delete r.reviewChoice;delete r.reviewWeek;delete r.reviewedRevision;
    }else if(action==='save'){
      if(command.recordId!==r.id||command.revision!==r.revision)throw Error('conflict');
      if(typeof command.content!=='string'||command.content.length>60000||typeof command.title!=='string'||command.title.length>80)throw Error('invalid_input');
      if(r.content!==command.content||r.title!==command.title){r.content=command.content;r.title=command.title;r.updatedAt=Math.max(now,r.updatedAt+1);r.revision++;r.confirmedAt=0;}
    }else if(action==='new'){
      if(!r.content.trim()&&!r.title.trim())return s;
      if(s.records.length>=1000)throw Error('record_limit');
      s.previousId=r.id;s.activeId=id;s.records.unshift(blank(id,now));
    }else if(action==='select'){
      if(!s.records.some(n=>n.id===command.recordId&&!n.trashedAt))throw Error('not_found');
      if(s.activeId!==command.recordId){s.previousId=s.activeId;s.activeId=command.recordId;}
    }else if(action==='confirm'){
      if(command.recordId!==r.id||command.revision!==r.revision)throw Error('conflict');
      if(!r.content.trim())throw Error('empty_text');
      r.confirmedAt=now;r.confirmedLength=r.content.length;r.revision++;
    }else if(action==='pin')r.pinned=!r.pinned;
    else if(action==='trash'){
      if(!r.content.trim()&&!r.title.trim())return s;
      r.trashedAt=now;
      const replacement=s.records.find(n=>!n.trashedAt);
      if(!replacement){s.records.unshift(blank(id,now));s.activeId=id;}else s.activeId=replacement.id;
      s.previousId='';
    }else if(action==='restore'){
      const n=s.records.find(n=>n.id===command.recordId&&n.trashedAt);if(!n)throw Error('not_found');n.trashedAt=0;
    }else if(action==='settings'){
      if(!/^(20:[0-5]\d|21:00)$/.test(command.time)||typeof command.enabled!=='boolean')throw Error('invalid_input');
      if(command.weeklyEnabled!==undefined&&typeof command.weeklyEnabled!=='boolean')throw Error('invalid_input');
      s.settings={...s.settings,time:command.time,enabled:command.enabled,...(command.weeklyEnabled!==undefined?{weeklyEnabled:command.weeklyEnabled}:{})};
    }else if(action==='shown')s.ledger.lastShownDay=day(now);
    else if(action==='weekly-shown'){s.ledger.weeklyShownDay=day(now);s.ledger.lastShownDay=day(now);}
    else if(action==='tomorrow'){s.ledger.lastShownDay=day(now);s.ledger.snoozeUntil=nextMorning(now);}
    else throw Error('invalid_action');
    return s;
  }
  function due(s,now){
    const rows=pending(s), today=day(now), date=new Date(now), minutes=date.getHours()*60+date.getMinutes();
    if(!s.settings.enabled||!rows.length||s.ledger.lastShownDay===today||s.ledger.snoozeUntil>now||minutes<360)return 0;
    const [h,m]=s.settings.time.split(':').map(Number), at=h*60+m;
    // Missed evenings become a single morning catch-up; new notes wait until tonight.
    const overdue=rows.some(r=>day(r.updatedAt)<today);
    return (minutes>=at&&minutes<=1260||overdue&&minutes<1260)?rows.length:0;
  }
  const eligible=({idleSeconds,locked,suspended,fullscreen,recording})=>!locked&&!suspended&&!fullscreen&&!recording&&Number.isFinite(idleSeconds)&&idleSeconds>=5&&idleSeconds<=90;
  return {KEY,day,nextMorning,blank,initial,parse,active,pending,title,change,due,eligible,week,ideas,needsReview,weeklyDue,reminder};
});
