const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../renderer/clipboard-model'),{createShortcutController,safePaste}=require('../main-clipboard');
test('clipboard shortcut accepts modifiers and function keys, rejects bare letters and injected syntax',()=>{
  assert.equal(M.DEFAULT_SHORTCUT,'Alt+V');for(const k of ['Alt+V','Command+Shift+C','F8','Control+Alt+1'])assert.equal(M.shortcut(k),k);
  for(const k of ['v','V','Shift+V','Alt+Alt+V','Meta+V','Alt+Space;','F25','Command+V','Command+Q','Command+Shift+4',''])assert.equal(M.shortcut(k),null);
  assert.equal(M.fromKey({code:'KeyV',key:'√',altKey:true}),'Alt+V');assert.equal(M.fromKey({code:'KeyV',isComposing:true}),null);
});
test('registration is opt-in, changes persist, occupied/failed saves preserve the old shortcut, disable unregisters',()=>{
  const registered=new Set(['Alt+Q']);let saved={},fail=false;
  const controller=createShortcutController({registry:{isRegistered:k=>registered.has(k),register:k=>{registered.add(k);return true;},unregister:k=>registered.delete(k)},read:()=>({}),write:v=>{if(fail)return false;saved=v;return true;},invoke(){}});
  assert.equal(controller.snapshot().active,'');controller.enable(true);assert(registered.has('Alt+V'));
  assert.equal(controller.configure({shortcut:'Alt+Q'}).error,'occupied');assert(registered.has('Alt+V'));
  assert.equal(controller.configure({shortcut:'F8'}).ok,true);assert(!registered.has('Alt+V'));assert(registered.has('F8'));assert.equal(saved.shortcut,'F8');
  fail=true;assert.equal(controller.configure({shortcut:'Alt+J'}).error,'save_failed');assert(registered.has('F8'));assert(!registered.has('Alt+J'));
  controller.enable(false);assert(!registered.has('F8'));fail=false;controller.configure({shortcut:'Alt+V'});assert(!registered.has('Alt+V'));controller.enable(true);assert(registered.has('Alt+V'));
  assert.equal(controller.configure({shortcut:'V'}).error,'invalid_shortcut');controller.dispose();assert.deepEqual([...registered],['Alt+Q']);
});
test('scene snippets preserve full whitespace and history-first search matches name, text, and file names',()=>{
  const text='  你好\n\n1. 确认需求\n2. 回复\n  ',snippet=M.snippet({type:'text',name:'客服 SOP',text},'s');assert.equal(snippet.text,text);
  const history=[{id:'h',text:'项目进展',type:'text'},{id:'f',type:'file',fileNames:['合同.pdf']}];
  assert.equal(M.rows(history,[snippet])[0].key,'h:h');assert.equal(M.rows(history,[snippet],'客服 确认')[0].key,'s:s');assert.equal(M.rows(history,[snippet],'pdf')[0].key,'h:f');assert.equal(M.rows(history,[snippet],'','snippets').length,1);
  assert.throws(()=>M.snippet({type:'text',name:'',text:'a'},'x'));assert.throws(()=>M.snippet({type:'image',name:'x'},'x'));
});
test('paste falls back without native permissions or a verified target; no focus changes',async()=>{
  let hidden=0;const base={write:()=>true,hide:async()=>{hidden++;return true;}};
  assert.equal((await safePaste(base)).pasted,false);assert.equal((await safePaste({...base,native:{ready:()=>false}})).pasted,false);assert.equal(hidden,0);
  assert.equal((await safePaste({...base,write:()=>false})).ok,false);
});
test('paste only dispatches after collapse, target validation and unchanged clipboard; cancellation wins',async()=>{
  let pasted=0,activated=0,valid=true;
  const base={native:{ready:()=>true,activate:()=>{activated++;return true;},paste:()=>{pasted++;return true;}},write:()=>true,hide:async()=>true,valid:()=>valid,delay:async()=>{}};
  assert.equal((await safePaste(base)).pasted,true);assert.equal(pasted,1);
  assert.equal((await safePaste({...base,hide:async()=>false})).pasted,false);assert.equal(activated,1);
  assert.equal((await safePaste({...base,unchanged:()=>false})).pasted,false);assert.equal(pasted,1);
  assert.equal((await safePaste({...base,delay:async()=>{valid=false;}})).pasted,false);assert.equal(pasted,1);
});
