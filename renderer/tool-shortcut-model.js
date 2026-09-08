(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.ToolShortcutModel=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  const defaults={quick:'N',recorder:'R',currentNote:'',todo:'T',links:'L',music:'M',pomodoro:'',commands:'',windows:'',gallery:'',clip:'',credentials:''};
  const valid=key=>typeof key==='string'&&/^(?:(?:Command|Control|Alt|Shift)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key)&&!['Command+Q','Command+W','Command+H','Command+M'].includes(key);
  function normalize(raw){const out={...defaults};for(const id of Object.keys(out))if(raw&&Object.hasOwn(raw,id)&&(raw[id]===''||valid(raw[id])))out[id]=raw[id];return out;}
  function validate(map){const seen=new Set();for(const key of Object.values(map)){if(!key)continue;if(!valid(key))return 'invalid';if(seen.has(key))return 'duplicate';seen.add(key);}return '';}
  function fromEvent(event){
    let key=String(event.key||'').toUpperCase();
    if(/^Key[A-Z]$/.test(event.code||''))key=event.code.slice(3);
    if(/^Digit[0-9]$/.test(event.code||''))key=event.code.slice(5);
    const value=[event.metaKey?'Command':'',event.ctrlKey?'Control':'',event.altKey?'Alt':'',event.shiftKey?'Shift':'',key].filter(Boolean).join('+');
    return valid(value)?value:'';
  }
  function eligible(event,{expanded,focused,editing,modal,composing}){return expanded&&focused&&!editing&&!modal&&!composing&&!event.isComposing&&!event.repeat&&!event.defaultPrevented&&event.keyCode!==229;}
  return {defaults,normalize,validate,fromEvent,eligible};
});
