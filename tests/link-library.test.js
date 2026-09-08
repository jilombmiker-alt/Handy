const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../renderer/link-library-model'),C=require('../main-link-content'),{normalize,createLinkAI}=require('../ai/link-library');
const rows=[{id:'group-a',name:'参考',links:[{id:'link-a',title:'导航设计',url:'https://example.com/',createdAt:1} ]},{id:'group-b',name:'UI',links:[]}];
test('same-group saves keep original position and collapsed state',()=>{
  const source=[{id:'g',name:'参考',collapsed:true,links:[{id:'a',note:'原备注'},{id:'b'},{id:'c'}]}];
  const next=M.patch(source,'a',{note:'修改备注'},'g');assert.deepEqual(next[0].links.map(i=>i.id),['a','b','c']);assert.equal(next[0].collapsed,true);assert.equal(source[0].links[0].note,'原备注');
});
test('bookmark notes and user groups preserve original identity without duplicate copies',()=>{
  const raw='  看导航\n 不要改字  ';const next=M.patch(rows,'link-a',{note:raw,pinned:true,tags:['导航','导航'],noteIds:['note-a']},'group-b');assert.equal(rows[0].links.length,1);assert.equal(next[0].links.length,0);assert.equal(next[1].links[0].id,'link-a');assert.equal(next[1].links[0].note,raw);assert.deepEqual(next[1].links[0].tags,['导航']);assert.ok(M.matches(next[1].links[0],{search:'不要改字',view:'project'}));assert.ok(M.matches(next[1].links[0],{view:'pinned'}));assert.throws(()=>M.patch(rows,'link-a',{note:'a'.repeat(4001)}));assert.throws(()=>M.patch(rows,'link-a',{},'unknown'));
});
test('public metadata strips active content and labels videos as metadata, never transcripts',()=>{
  const html='<title>Demo &amp; UI</title><meta property="og:description" content="界面参考"><meta property="og:image" content="/cover.jpg"><script>secret()</script><main>'+('按钮导航信息 '.repeat(50))+'</main>';
  const page=C.extract(html,'https://example.com/a');assert.equal(page.title,'Demo & UI');assert.ok(!page.text.includes('secret()'));assert.equal(page.image,'https://example.com/cover.jpg');assert.equal(page.source,'page-excerpt');const video=C.extract(html,'https://www.bilibili.com/video/1');assert.equal(video.source,'video-metadata');assert.equal(video.text,'');assert.match(video.warning,/未读取/);
});
test('content reader rejects unsafe URLs and redirects, limits data and keeps images local',async()=>{
  for(const url of ['file:///etc/passwd','http://localhost/','http://127.0.0.1/','http://[::1]/','https://user:pass@example.com/'])assert.throws(()=>C.publicUrl(url));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'link-content-'));let calls=0;
  const blocked=C.createLinkContent({directory:()=>dir,requestImpl:async()=>{calls++;return {status:302,headers:{location:'http://127.0.0.1/'},bytes:Buffer.alloc(0)};}});assert.equal((await blocked.inspect('https://example.com/')).ok,false);assert.equal(calls,1);assert.equal(blocked.image('../../private'),null);
  const stub={createFromBuffer:()=>({isEmpty:()=>false,getSize:()=>({width:120,height:80}),resize:()=>({toJPEG:()=>Buffer.from('mock-jpeg')})})};
  const good=C.createLinkContent({directory:()=>dir,nativeImage:stub,requestImpl:async url=>({status:200,headers:{'content-type':url.pathname==='/image'?'image/jpeg':'text/html'},bytes:Buffer.from(url.pathname==='/image'?'mock-image':'<title>Preview</title><meta property="og:image" content="/image">')})});
  const result=await good.inspect('https://example.com/');assert.match(result.preview,/^[a-f0-9]{64}$/);assert.ok(fs.existsSync(path.join(dir,result.preview+'.jpg')));assert.match(good.image(result.preview),/^data:image\/jpeg;base64,/);assert.equal(result.text,'');
});
test('AI parses bounded extraction and recommendations only from supplied links',async()=>{
  const extraction=normalize({summary:'界面参考',use:'查找导航',scenario:'设计阶段',tags:['UI']},{mode:'analyze'});assert.equal(extraction.tags[0],'UI');assert.throws(()=>normalize({recommendations:[{id:'invented',reason:'fake'}]},{mode:'recommend',items:[{id:'real'}]}));assert.deepEqual(normalize({recommendations:[]},{mode:'recommend',items:[]}),{recommendations:[]});
  let called=false;const ai=createLinkAI({getConfig:()=>({}),validateEndpoint:async u=>u,fetchImpl:async()=>{called=true;}});assert.equal((await ai.generate(1,{mode:'analyze'})).error,'not_configured');assert.equal(called,false);
});
test('AI cancellation and timeout release the owner even when a provider stalls',async()=>{
  const options={getConfig:()=>({apiKey:'synthetic-only',model:'test',baseUrl:'https://example.com'}),validateEndpoint:async u=>u,fetchImpl:()=>new Promise(()=>{})};
  const ai=createLinkAI({...options,timeoutMs:1000});const pending=ai.generate(1,{mode:'analyze'});ai.cancel(1);assert.equal((await pending).error,'cancelled');
  const next=ai.generate(1,{mode:'analyze'});ai.dispose();assert.equal((await next).error,'cancelled');
  const timed=createLinkAI({...options,timeoutMs:10});assert.equal((await timed.generate(2,{mode:'analyze'})).error,'timeout');
});
