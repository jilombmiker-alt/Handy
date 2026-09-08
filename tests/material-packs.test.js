'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPackStore,compose,variables,validShortcut}=require('../main-material-packs');
const {parseConfig}=require('../renderer/credential-card');
const {normalizeCredentialInput}=require('../main-services');
const fixture=()=>{const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'packs-unit-')),'packs.json');return {file,store:createPackStore(file)};};
const save=(store,extra={})=>store.command({action:'save',revision:store.snapshot().revision,name:'文章润色',text:'请以 {{风格}} 润色 {{原文}}',steps:'检查原意\n输出正文',shortcut:'',documentIds:[],...extra});
test('material packs preserve migration, persist independent data and reject stale edits',()=>{
 const {file,store}=fixture();const original=[{id:'old',text:'旧提示词'}];assert.equal(store.command({action:'migrate',revision:0,items:original}).ok,true);assert.equal(original[0].id,'old');
 const first=save(store);assert.equal(first.items.length,2);assert.equal(createPackStore(file).snapshot().items.length,2);
 assert.equal(store.command({action:'delete',id:first.items[0].id,revision:0,confirmed:true}).error,'conflict');
 assert.equal(store.command({action:'delete',id:first.items[0].id,revision:first.revision}).error,'confirmation_required');
 assert.equal(store.command({action:'migrate',revision:first.revision,items:[]}).items.length,2);
 first.items[0].name='外部修改';assert.notEqual(store.snapshot().items[0].name,'外部修改');
});
test('selected file capabilities cannot be forged; content sent only when selected',()=>{
 const {store}=fixture();assert.equal(save(store,{documentIds:['/etc/passwd']}).error,'invalid_document');
 const docs=store.addDocuments([{name:'说明.docx',text:'这是参考文字'}],['/tmp/user-chosen.docx']);const r=save(store,{documentIds:[docs[0].id]});assert.equal(r.ok,true);assert.equal(r.items[0].documents[0].source,undefined);
 const item=r.items[0];assert.deepEqual(variables(item.text),['风格','原文']);assert.throws(()=>compose(item,{},[]),/missing_variables/);
 assert.ok(!compose(item,{风格:'自然',原文:'草稿'},[]).includes('参考文字'));
 assert.ok(compose(item,{风格:'自然',原文:'草稿'},[docs[0].id]).includes('参考文字'));
 assert.throws(()=>compose(item,{风格:'自然',原文:'草稿'},['forged']),/invalid_document/);
 assert.equal(save(store,{name:'只有文档',text:'',documentIds:[docs[0].id]}).ok,true);
});
test('shortcut conflict and failed writes keep original configuration',()=>{
 const {file}=fixture(),keys=new Map([['Alt+X',()=>{}]]),registry={isRegistered:k=>keys.has(k),register:(k,fn)=>{keys.set(k,fn);return true;},unregister:k=>keys.delete(k)};
 const store=createPackStore(file,{registry});assert.equal(save(store,{shortcut:'Alt+P'}).ok,true);const before=fs.readFileSync(file,'utf8');
 assert.equal(save(store,{shortcut:'Alt+X'}).error,'shortcut_occupied');assert.equal(fs.readFileSync(file,'utf8'),before);assert.ok(keys.has('Alt+P'));
 for(const shortcut of ['P','Command+V','Alt+P+oops'])assert.equal(validShortcut(shortcut),false);
 const broken=createPackStore(path.join(file,'not-a-directory'),{registry});assert.equal(save(broken,{shortcut:'Alt+Y'}).ok,false);assert.equal(keys.has('Alt+Y'),false);
 store.dispose();assert.equal(keys.has('Alt+P'),false);assert.equal(keys.has('Alt+X'),true);
});
test('corrupt store is never replaced with an empty store',()=>{
 const {file}=fixture();fs.writeFileSync(file,'broken');const store=createPackStore(file);assert.equal(store.snapshot().error,'store_unreadable');assert.equal(save(store).ok,false);assert.equal(fs.readFileSync(file,'utf8'),'broken');
});
test('credential config extraction is local, optional account, URL schemes restricted',()=>{
 assert.deepEqual(parseConfig('API_KEY="sk-fixture"\nBASE_URL=https://example.com/v1'),{password:'sk-fixture',website:'https://example.com/v1'});
 assert.equal(parseConfig('x'.repeat(16001)),null);
 assert.equal(normalizeCredentialInput({service:'API',password:' key ',website:'https://example.com',note:'自己用'}).account,'');
 for(const website of ['javascript:alert(1)','file:///etc/passwd','https://user:pass@example.com'])assert.equal(normalizeCredentialInput({service:'API',password:'key',website}),null);
});
