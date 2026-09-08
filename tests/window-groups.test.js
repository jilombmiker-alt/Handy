'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createWindowGroups}=require('../main-window-groups'),{normalizeWindowRows}=require('../main-services');
const row=(id,title='学习资料',appPath='/Applications/Browser.app')=>({id,title,appPath,appName:'浏览器'});
function fixture(){const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'window-groups-')),'groups.json');let source={items:[row('one'),row('two','写作资料')],error:null};const create=()=>createWindowGroups({file:()=>file,scan:()=>source});const store=create();return {file,store,create,source:v=>source=v,save:members=>store.command({action:'save',name:'学习',revision:store.snapshot().revision,members})};}
test('group uses server metadata, persists, renames and deletes without changing windows',()=>{
 const f=fixture();const r=f.save([{windowId:'one',title:'forged',appPath:'/tmp/forged.app'},{windowId:'two'}]);assert.equal(r.ok,true);assert.equal(r.groups[0].members[0].title,'学习资料');
 assert.equal(f.create().snapshot().groups[0].members[0].status,'open');const g=r.groups[0];assert.equal(f.store.command({action:'save',revision:1,id:g.id,name:'写作',members:[{refId:g.members[0].refId}]}).ok,true);
 assert.equal(f.store.command({action:'delete',revision:2,id:g.id}).ok,true);assert.equal(f.store.snapshot().groups.length,0);
});
test('runtime tracks renamed live id; restart only exact unique title, never fuzzy app fallback',()=>{
 const f=fixture();f.save([{windowId:'one'}]);f.source({items:[row('one','已经改名')],error:null});assert.equal(f.store.snapshot().groups[0].members[0].title,'已经改名');assert.equal(f.create().snapshot().groups[0].members[0].status,'closed');
 f.source({items:[row('different','学习资料')],error:null});assert.equal(f.store.snapshot().groups[0].members[0].id,'different');
});
test('closed stays in group; scan errors are unknown, duplicate exact titles ambiguous',()=>{
 const f=fixture();f.save([{windowId:'one'}]);f.source({items:[],error:null});assert.equal(f.store.snapshot().groups[0].members[0].status,'closed');
 f.source({items:[],error:'window_scan_timeout'});assert.equal(f.store.snapshot().groups[0].members[0].status,'unknown');
 f.source({items:[row('new1'),row('new2')],error:null});const m=f.store.snapshot().groups[0].members[0];assert.equal(m.status,'ambiguous');assert.equal(m.id,null);
 f.source({items:[row('other-app','学习资料','/Applications/Other.app')],error:null});assert.equal(f.store.snapshot().groups[0].members[0].status,'closed');
});
test('rejects forged/stale ids, duplicate selection, cross-group refs and revision conflicts',()=>{
 const f=fixture();assert.equal(f.save([{windowId:'forged'}]).error,'stale_window');assert.equal(f.save([{windowId:'one'},{windowId:'one'}]).error,'duplicate_window');
 const s=f.save([{windowId:'one'}]);assert.equal(f.save([{refId:s.groups[0].members[0].refId}]).error,'invalid_member');assert.equal(f.store.command({action:'delete',id:s.groups[0].id,revision:0}).error,'conflict');
 f.source({items:[],error:'denied'});assert.equal(f.save([{windowId:'one'}]).error,'scan_required');
});
test('replacement is explicit and unresolved original survives ordinary edits',()=>{
 const f=fixture(),s=f.save([{windowId:'one'}]),g=s.groups[0];f.source({items:[row('new','另一篇笔记')],error:null});
 let r=f.store.command({action:'save',id:g.id,revision:1,name:'学习',members:[{refId:g.members[0].refId}]});assert.equal(r.groups[0].members[0].status,'closed');
 r=f.store.command({action:'save',id:g.id,revision:2,name:'学习',members:[{windowId:'new'}]});assert.equal(r.groups[0].members[0].title,'另一篇笔记');
});
test('failed save and corruption preserve old data',()=>{
 const f=fixture();f.save([{windowId:'one'}]);const before=fs.readFileSync(f.file,'utf8'),rename=fs.renameSync;fs.renameSync=()=>{throw Error('fixture');};try{assert.equal(f.save([{windowId:'two'}]).error,'save_failed');assert.equal(f.store.snapshot().revision,1);}finally{fs.renameSync=rename;}assert.equal(fs.readFileSync(f.file,'utf8'),before);
 fs.writeFileSync(f.file,'broken');const bad=f.create();assert.equal(bad.snapshot().error,'corrupt_store');assert.equal(bad.command({}).error,'corrupt_store');assert.equal(fs.readFileSync(f.file,'utf8'),'broken');
});
test('window picker retains different CG ids sharing title',()=>{
 const rows=normalizeWindowRows([{pid:12,windowNumber:1,appName:'浏览器',title:'新标签页'},{pid:12,windowNumber:2,appName:'浏览器',title:'新标签页'}],{preserveDuplicates:true});assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);
});
