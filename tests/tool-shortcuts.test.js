const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../renderer/tool-shortcut-model'),{isSafePanelShortcut}=require('../main-services');
test('panel permits left modifier gesture and function keys without permitting bare typing keys',()=>{
 for(const key of ['LeftOption+LeftCommand','F6','F24','Alt+Space','Control+K'])assert.equal(isSafePanelShortcut(key),true,key);
 for(const key of ['N','1','Space','Command+Space','F25'])assert.equal(isSafePanelShortcut(key),false,key);
});
test('tool bindings normalize, clear and reject duplicate chords',()=>{
 assert.equal(M.normalize({quick:''}).quick,'');assert.equal(M.normalize({unknown:'P',quick:'Escape'}).quick,'N');
 assert.equal(M.validate({...M.defaults,recorder:'N'}),'duplicate');assert.equal(M.validate(M.defaults),'');
 assert.equal(M.validate({...M.defaults,quick:'Command+Q'}),'invalid');
});
test('tool key identities work with Option-produced characters and function keys',()=>{
 assert.equal(M.fromEvent({key:'˜',code:'KeyN',altKey:true}),'Alt+N');
 assert.equal(M.fromEvent({key:'n',code:'KeyN'}),'N');
 assert.equal(M.fromEvent({key:'F8',code:'F8'}),'F8');
 assert.equal(M.fromEvent({key:'Escape'}),'');
});
test('editing, composition, repeats, hidden/unfocused panels and modals never launch tools',()=>{
 const s={expanded:true,focused:true,editing:false,modal:false,composing:false};
 assert.equal(M.eligible({},s),true);
 for(const key of ['editing','modal','composing'])assert.equal(M.eligible({},{...s,[key]:true}),false);
 for(const key of ['expanded','focused'])assert.equal(M.eligible({},{...s,[key]:false}),false);
 for(const key of ['isComposing','repeat','defaultPrevented'])assert.equal(M.eligible({[key]:true},s),false);
 assert.equal(M.eligible({keyCode:229},s),false);
});
