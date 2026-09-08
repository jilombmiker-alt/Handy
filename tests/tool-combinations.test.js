'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCombinationStore,placeTool}=require('../main-tool-combinations');
const fixture=()=>{const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'tool-group-test-')),'groups.json');return {file,store:createCombinationStore(()=>file)};};
test('defaults, custom tools, rename, delete, durable restart and stale revision',()=>{
 const {file,store}=fixture();assert.deepEqual(store.snapshot().groups.map(g=>g.name),['临时讨论','写作','日常推进']);
 assert.equal(store.command({action:'save',revision:0,name:'阅读',tools:['quick','module:music']}).ok,true);
 const id=store.snapshot().groups.at(-1).id;
 assert.equal(store.command({action:'save',revision:1,id,name:'阅读资料',tools:['module:links']}).ok,true);
 assert.equal(store.command({action:'delete',revision:0,id}).error,'conflict');
 assert.equal(createCombinationStore(()=>file).snapshot().groups.at(-1).name,'阅读资料');
 assert.equal(store.command({action:'delete',revision:2,id}).ok,true);assert.equal(store.snapshot().groups.length,3);
});
test('untrusted tools, empty and duplicate tools, bad names, deleted ids rejected',()=>{
 const {store}=fixture();for(const tools of [[],['__proto__'],['module:credentials'],['quick','quick'],[['quick']]])assert.equal(store.command({action:'save',revision:0,name:'测试',tools}).error,'invalid_group');
 assert.equal(store.command({action:'save',revision:0,name:' ',tools:['quick']}).error,'invalid_group');
 assert.equal(store.command({action:'save',revision:0,id:'deleted',name:'测试',tools:['quick']}).error,'not_found');
 assert.equal(store.snapshot().revision,0);
});
test('corruption and failed writes preserve original data and revision',()=>{
 const {file,store}=fixture();const rename=fs.renameSync;fs.renameSync=()=>{throw Error('fixture');};
 try{assert.equal(store.command({action:'delete',revision:0,id:'daily'}).error,'save_failed');assert.equal(store.snapshot().groups.length,3);}finally{fs.renameSync=rename;}
 fs.writeFileSync(file,'broken fixture');const broken=createCombinationStore(()=>file);assert.equal(broken.snapshot().error,'corrupt_store');assert.equal(broken.command({}).error,'corrupt_store');assert.equal(fs.readFileSync(file,'utf8'),'broken fixture');
});
test('default placement finds free room and admits small-screen overlap',()=>{
 const area={x:0,y:0,width:1440,height:900},size={width:440,height:580};
 const a=placeTool(size,area,[]),b=placeTool(size,area,[a.bounds]);assert.equal(a.overlap,false);assert.equal(b.overlap,false);assert.ok(b.bounds.x>=a.bounds.x+size.width+12);
 assert.equal(placeTool(size,{...area,width:500,height:650},[a.bounds]).overlap,true);
});
