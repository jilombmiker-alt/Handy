(function(root,factory){const value=factory();if(typeof module==='object')module.exports=value;else root.ClipboardModel=value;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  const DEFAULT_SHORTCUT='Alt+V', SNIPPETS_KEY='notch-clip-snippets-v1';
  function shortcut(value){
    if(typeof value!=='string'||value.length>70)return null;
    const parts=value.split('+'), key=parts.pop();
    if(!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key))return null;
    if(parts.some(p=>!['Command','Control','Alt','Shift'].includes(p))||new Set(parts).size!==parts.length)return null;
    if(!parts.length&&!/^F\d+$/.test(key))return null;
    if(parts.length&&parts.every(p=>p==='Shift'))return null;
    const normalized=[...['Command','Control','Alt','Shift'].filter(p=>parts.includes(p)),key].join('+');
    if(/^Command\+[ACVXZQWHM]$/.test(normalized)||/^Command\+Shift\+[345]$/.test(normalized)||normalized==='Command+Control+Q')return null;
    return normalized;
  }
  function fromKey(e){
    if(e.isComposing||e.repeat)return null;
    const key=/^Key[A-Z]$/.test(e.code)?e.code.slice(3):/^Digit\d$/.test(e.code)?e.code.slice(5):e.key;
    return shortcut([e.metaKey&&'Command',e.ctrlKey&&'Control',e.altKey&&'Alt',e.shiftKey&&'Shift',key].filter(Boolean).join('+'));
  }
  function label(value){return String(value).replaceAll('Command','⌘').replaceAll('Control','⌃').replaceAll('Alt','⌥').replaceAll('Shift','⇧').replaceAll('+',' ');}
  function rows(history,snippets,query='',mode='all'){
    const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const result=[...(mode==='snippets'?[]:history.map(v=>({...v,source:'history',key:'h:'+v.id}))),...(mode==='history'?[]:snippets.map(v=>({...v,source:'snippet',key:'s:'+v.id})))];
    return result.filter(v=>terms.every(t=>[v.name,v.text,...(v.fileNames||[]),v.type==='image'?'图片':''].join(' ').toLocaleLowerCase().includes(t)));
  }
  function snippet(input,id){
    const name=typeof input.name==='string'?input.name.trim():'';
    if(!name||name.length>80)throw Error('name_required');
    if(!['text','url','file'].includes(input.type))throw Error('unsupported');
    if(input.type==='file'&&(!input.fileId||!Array.isArray(input.fileNames)))throw Error('missing_file');
    if(input.type!=='file'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>100000))throw Error('invalid_text');
    return {id,name,type:input.type,text:input.type==='file'?null:input.text,fileId:input.fileId||null,fileNames:input.fileNames||[],timestamp:Date.now()};
  }
  return {DEFAULT_SHORTCUT,SNIPPETS_KEY,shortcut,fromKey,label,rows,snippet};
});
