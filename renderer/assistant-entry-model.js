(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.AssistantEntryModel=value;})(globalThis,()=>{
  'use strict';
  const KEY='handy-assistant-entry-v1';
  function storageTarget(text,normalizeUrl){
    if(typeof text!=='string'||!text.trim()||text.length>12000)throw Error('invalid_input');
    const [first,...rest]=text.trim().split('\n');
    if(/^https?:\/\/\S+$/i.test(first.trim())){
      const url=normalizeUrl(first.trim());if(!url)throw Error('invalid_url');
      const note=rest.join('\n').trim();if(note.length>4000)throw Error('note_too_long');
      return {kind:'link',url,note};
    }
    return {kind:'note',text};
  }
  function localInstruction(text){
    // A narrow deterministic shortcut only; general intent understanding belongs to the model.
    const match=/^(?:记一下|帮我记一下|记录一下|帮我记录一下)[，,:：\s]*([^，,:：\s][\s\S]*)$/.exec(text.trim());
    return match?{kind:'note',text:match[1]}:null;
  }
  function documentText(text,attachments=[]){return [text,...attachments.map(f=>`参考材料：${f.title}\n${f.text}`)].filter(Boolean).join('\n\n');}
  function draftText(p){return p?.kind==='plan'?[p.reply,...(p.notes||[]),...(p.changes||[]).map(c=>`${c.title} ${c.scheduled===false?c.date:new Date(c.start).toLocaleString()} ${c.next||''}`)].filter(Boolean).join('\n'):p?.text||'';}
  return {KEY,storageTarget,localInstruction,documentText,draftText};
});
