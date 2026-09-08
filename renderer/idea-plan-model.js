(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./planner-model'));else root.IdeaPlanModel=factory(root.PlannerModel);})(globalThis,M=>{
  'use strict';
  function dateFor(record,now){
    const d=new Date(now);d.setHours(12,0,0,0);
    if(record.reviewWeek===M.week(M.day(now)).from){
      if(record.reviewChoice==='weekend'&&![0,6].includes(d.getDay()))d.setDate(d.getDate()+(6-d.getDay()+7)%7);
      if(record.reviewChoice==='next-week')d.setDate(d.getDate()+8-(d.getDay()||7));
    }
    return M.day(d.getTime());
  }
  function fields(record,now){
    return {title:(record.title.trim()||record.content.trim().split('\n')[0]).slice(0,200),date:dateFor(record,now),start:'',end:'',category:'P3'};
  }
  function item(draft,values){
    if(!values||!M.validDay(values.date))throw Error('invalid_time');
    const scheduled=!!(values.start||values.end),time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if(scheduled&&(!time.test(values.start)||!time.test(values.end)))throw Error('invalid_time');
    const start=scheduled?new Date(`${values.date}T${values.start}`).getTime():null,end=scheduled?new Date(`${values.date}T${values.end}`).getTime():null;
    return M.item({id:draft.id,title:values.title,date:values.date,start,end,scheduled,category:values.category,area:'work',status:'planned',kind:'task',body:draft.body,sourceIdea:draft.sourceIdea});
  }
  function controller({getRecord,getPlanner,applyPlanner,uid=()=>crypto.randomUUID(),clock=Date.now}){
    const drafts=new Map();
    const existing=(state,id)=>state.items.find(r=>r.sourceIdea?.id===id);
    const describe=r=>({id:r.id,title:r.title,date:M.itemDay(r),status:r.status,archived:r.archived});
    async function prepare(recordId,revision){
      const record=await getRecord(recordId);
      if(!record||record.trashedAt)return {ok:false,error:'not_found'};
      if(record.revision!==revision)return {ok:false,error:'source_changed'};
      if(!record.content.trim())return {ok:false,error:'empty_text'};
      const result=await getPlanner();if(!result?.ok)return result||{ok:false,error:'request_failed'};
      const saved=existing(result.state,record.id);if(saved)return {ok:true,saved:describe(saved)};
      if(drafts.size>=32)drafts.delete(drafts.keys().next().value);
      const token=uid(),draft={id:`plan-${uid()}`,token,sourceIdea:{id:record.id,revision:record.revision,title:(record.title.trim()||record.content.trim().split('\n')[0]).slice(0,200)},body:record.content.length<=8000?record.content:'',values:fields(record,clock())};
      drafts.set(token,draft);
      return {ok:true,token,values:{...draft.values},sourceTitle:draft.sourceIdea.title,longSource:record.content.length>8000,categories:{...M.categories,...result.state.categories}};
    }
    async function confirm(token,values){
      const draft=drafts.get(token);if(!draft)return {ok:false,error:'draft_expired'};
      const result=await getPlanner();if(!result?.ok)return result||{ok:false,error:'request_failed'};
      const saved=existing(result.state,draft.sourceIdea.id);if(saved)return {ok:true,saved:describe(saved)};
      const record=await getRecord(draft.sourceIdea.id);
      if(!record||record.trashedAt||record.revision!==draft.sourceIdea.revision)return {ok:false,error:'source_changed'};
      const change=item(draft,values),response=await applyPlanner({action:'apply',requestId:`idea-${token}`,revision:result.state.revision,changes:[{...change,mode:'add'}],source:'从随手记确认加入'});
      if(!response?.ok)return response||{ok:false,error:'request_failed'};
      const committed=existing(response.state,draft.sourceIdea.id);
      return committed?{ok:true,saved:describe(committed)}:{ok:false,error:'request_failed'};
    }
    return {async request(payload){try{
      if(payload?.operation==='prepare')return await prepare(payload.recordId,payload.revision);
      if(payload?.operation==='confirm')return await confirm(payload.token,payload.values);
      if(payload?.operation==='cancel'){drafts.delete(payload.token);return {ok:true};}
      return {ok:false,error:'invalid_action'};
    }catch(e){return {ok:false,error:['invalid_time','invalid_text','invalid_state','storage_failed'].includes(e.message)?e.message:'request_failed'};}}};
  }
  return {dateFor,fields,item,controller};
});
