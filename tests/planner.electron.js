const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
process.env.PANEL_TEST_MODE='1';process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'planner-ui-'));
delete process.env.NOTCH_LLM_API_KEY;delete process.env.DASHSCOPE_API_KEY;
const runtime=require('../main');
const run=(w,s)=>w.webContents.executeJavaScript(s,true);
const wait=async(fn)=>{const start=Date.now();while(Date.now()-start<15000){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,50));}throw Error('wait_timeout');};
async function main(){
 await app.whenReady();const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
 await wait(()=>run(host,'!!window.PanelPlanner'));await run(host,`(async()=>{await setMode(true);await setActiveTab('todo');})()`);
 await wait(()=>run(host,`!!document.querySelector('.planner-form input[name="start"]').value`));
 assert.equal(await run(host,`document.querySelector('.planner-form').hidden`),true);
 assert.equal(await run(host,`document.querySelector('.planner-switch').hidden`),true);
 await run(host,`document.querySelector('.planner-more').open=true;Array.from(document.querySelectorAll('.planner-more button')).find(b=>b.textContent==='手动添加').click()`);
 const legacy=await run(host,`localStorage.getItem('notch-todo-data')`);
 const errors=[];host.webContents.on('console-message',(_e,level,msg)=>{if(level===3&&!msg.includes('Autofocus'))errors.push(msg);});
 await run(host,`(()=>{const f=document.querySelector('.planner-form');f.elements.title.value='与设计确认需求';f.elements.topic.value='产品上线';f.elements.progress.value='明确今天要核对异常状态';f.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();})()`);
 await wait(()=>run(host,`document.querySelectorAll('.planner-row').length===1`));
 let s=(await run(host,'notchAPI.plannerGet()')).state;assert.equal(s.items[0].title,'与设计确认需求');const first=s.items[0];
 await run(host,`Array.from(document.querySelectorAll('.planner-row button')).find(b=>b.textContent==='完成').click()`);
 await wait(async()=>(await run(host,'notchAPI.plannerGet()')).state.items[0].status==='done');
 await run(host,`Array.from(document.querySelectorAll('.planner-head button')).find(b=>b.textContent==='撤销').click()`);
 await wait(async()=>(await run(host,'notchAPI.plannerGet()')).state.items[0].status==='planned');
 await run(host,`Notebook.detach('module','todo')`);
 const float=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('floating.html')));await wait(()=>run(float,`document.querySelectorAll('.planner-row').length===1`));
 await run(float,`Array.from(document.querySelectorAll('.planner-row button')).find(b=>b.textContent==='等待').click()`);
 await wait(()=>run(host,`document.querySelector('.planner-meta').textContent.includes('等待中')`));
 assert.equal(await run(host,`localStorage.getItem('notch-todo-data')`),legacy);
 const forbidden=await run(float,`floatingAPI.plannerGet()`);assert.equal(forbidden.ok,true);
 assert.equal((await run(host,`notchAPI.plannerSuggest({day:PlannerModel.day(),text:'今天上午安排工作',mode:'discuss',scope:'day'})`)).error,'ai_disabled');
 await run(host,`document.querySelector('[aria-label="AI 协助"]').click()`);await wait(async()=>(await run(host,'notchAPI.plannerGet()')).state.aiEnabled===true);
 const noKey=await run(host,`notchAPI.plannerSuggest({day:PlannerModel.day(),text:'今天上午安排工作',mode:'discuss',scope:'day'})`);assert.equal(noKey.error,'not_configured');
 // Synthetic stream and transcript, never open the physical microphone.
 await run(host,`(()=>{
   PanelRecording.command('auto-on');
   window.SpeechRecognition=class {start(){window.plannerRecognition=this;}stop(){}};
   navigator.mediaDevices.getUserMedia=async()=>{window.plannerAudio=new AudioContext();const out=plannerAudio.createMediaStreamDestination(),osc=plannerAudio.createOscillator(),gain=plannerAudio.createGain();gain.gain.value=0;osc.connect(gain);gain.connect(out);osc.start();void plannerAudio.resume();return out.stream;};
   Array.from(document.querySelectorAll('.planner-ai button')).find(b=>b.textContent==='语音输入').click();
 })()`);
 await wait(()=>run(host,`PanelRecording.snapshot().status==='recording'`));
 assert.equal((await run(float,`floatingAPI.plannerVoice('start')`)).error,'recording_busy');
 await run(host,`(()=>{const r=[{transcript:'今天十点对需求，完成后补充方案。'}];r.isFinal=true;plannerRecognition.onresult({resultIndex:0,results:[r]});})()`);
 await new Promise(r=>setTimeout(r,1100));
 await run(host,`Array.from(document.querySelectorAll('.planner-ai button')).find(b=>b.textContent==='结束语音').click()`);
 await wait(()=>run(host,`document.querySelector('[name="instruction"]').value.includes('今天十点对需求')`));
 const recording=await run(host,`JSON.parse(localStorage.getItem('notch-recordings'))[0]`);assert.ok(fs.existsSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,recording.audioPath)));assert.equal(recording.transcript,'今天十点对需求，完成后补充方案。');await run(host,'plannerAudio.close()');
 assert.equal(recording.voice.status,'idle','planner capture skips redundant voice organization');assert.equal((await run(host,'PanelRecording.snapshot()')).autoOrganize,true,'memo preference unchanged');
 assert.equal(runtime.planner.store.snapshot().state.items[0].status,'waiting');
 // Local mock only. A proposal cannot mutate the store until the user confirms it.
 ipcMain.removeHandler('planner:suggest');ipcMain.handle('planner:suggest',()=>{const current=runtime.planner.store.snapshot().state;return {ok:true,revision:current.revision,notes:['合成测试：请核对时间'],changes:[{...first,mode:'update',status:'done',progress:'需求已对齐',next:'下午补充方案'}]};});
 await run(host,`document.querySelector('[name="instruction"]').value='需求已经对好了';Array.from(document.querySelectorAll('.planner-ai button')).find(b=>b.textContent==='提炼待确认草案').click()`);
 await wait(()=>run(host,`document.querySelectorAll('.planner-preview fieldset').length===1`));
 assert.equal(runtime.planner.store.snapshot().state.items[0].status,'waiting');
 assert.equal(await run(host,`document.querySelector('.planner-form').hidden`),true,'proposal never opens new form');
 assert.equal(await run(host,`document.querySelector('.planner-preview details').open`),false,'proposal details optional');
 host.show();await run(host,`document.querySelector('.planner-more').open=false;PanelAppearance.setTheme('white')`);await new Promise(r=>setTimeout(r,300));
 const evidence=process.env.PANEL_PLANNER_CAPTURE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'panel-planner-evidence-'));fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'proposal.png'),(await host.webContents.capturePage()).toPNG());
 async function captureExpanded(name){float.hide();await run(host,`(async()=>{await setMode(true);await setActiveTab('todo');})()`);host.setBounds({x:50,y:50,width:1288,height:680});host.show();host.focus();await new Promise(r=>setTimeout(r,400));const shot=await host.webContents.capturePage();assert.ok(shot.getSize().height>500,'evidence must show expanded content, not edge handle');fs.writeFileSync(path.join(evidence,name),shot.toPNG());}
 await run(host,`Array.from(document.querySelectorAll('.planner-preview button')).find(b=>b.textContent==='确认保存').click()`);
 await wait(()=>run(host,`document.querySelectorAll('.planner-preview fieldset').length===0`));
 assert.equal(runtime.planner.store.snapshot().state.items[0].status,'done');
 // A stale edit must not overwrite a concurrent floating-window change.
 await run(host,`document.querySelector('.planner-title').click();document.querySelector('.planner-form [name="title"]').value='尚未提交的编辑';document.querySelector('.planner-form').dispatchEvent(new Event('input'));`);
 s=runtime.planner.store.snapshot().state;runtime.planner.store.command({action:'apply',revision:s.revision,requestId:'other-window',changes:[{id:first.id,mode:'update',next:'新下一步'}]});
 await run(host,`document.querySelector('.planner-form').requestSubmit()`);await wait(()=>run(host,`document.querySelector('.planner-message').textContent.includes('其他窗口')`));
 assert.equal(runtime.planner.store.snapshot().state.items[0].title,first.title);
 await run(host,`Array.from(document.querySelectorAll('.planner-form button')).find(b=>b.textContent==='放下编辑').click()`);
 // Start and end reminders are persisted, delivered without focusing the notice, and never mark completion.
 s=runtime.planner.store.snapshot().state;const now=Date.now();runtime.planner.store.command({action:'apply',revision:s.revision,requestId:'reminder',changes:[{...first,id:'plan-reminder',mode:'add',title:'合成到点提醒',status:'planned',start:now-1000,end:now+60000}]});
 runtime.planner.tick();const notice=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('notification.html')&&w.isVisible()));
 assert.equal(notice.isFocused(),false);assert.equal(runtime.planner.store.snapshot().state.items.find(r=>r.id==='plan-reminder').status,'planned');
 assert.equal(Object.keys(runtime.planner.store.snapshot().state.claims).length,1);runtime.planner.tick();assert.equal(Object.keys(runtime.planner.store.snapshot().state.claims).length,1);
 await run(host,`(async()=>{await setMode(true);await setActiveTab('todo');PanelPlanner.show(true)})()`);host.setBounds({x:50,y:50,width:1288,height:680});host.show();
 await wait(()=>run(host,`getComputedStyle(document.querySelector('#tab-home')).visibility==='hidden'&&getComputedStyle(document.querySelector('#tab-todo')).opacity==='1'`));
 await run(host,`document.activeElement.blur();PanelPlanner.view.refresh(true)`);await new Promise(r=>setTimeout(r,1400));
 await run(host,`document.querySelector('.planner-more').open=false`);
 for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}')`);await new Promise(r=>setTimeout(r,500));fs.writeFileSync(path.join(evidence,`planner-${theme}.png`),(await host.webContents.capturePage()).toPNG());}
 float.setSize(360,640);float.show();await new Promise(r=>setTimeout(r,500));assert.equal(await run(float,'document.documentElement.scrollWidth>innerWidth'),false);fs.writeFileSync(path.join(evidence,'planner-float.png'),(await float.webContents.capturePage()).toPNG());
 // Raw entry works with AI off, without a required time form, and keeps every character.
 await run(host,`document.querySelector('[aria-label="AI 协助"]').click()`);await wait(async()=>!runtime.planner.store.snapshot().state.aiEnabled);
 await wait(()=>run(float,`document.querySelector('[aria-label="AI 协助"]').checked===false`));
 const raw='  本周先完成课程笔记\n  再核对知识点  ';
 await run(host,`(()=>{const scope=document.querySelector('[aria-label="规划范围"]');scope.value='week';scope.dispatchEvent(new Event('change'));document.querySelector('[name="instruction"]').value=${JSON.stringify(raw)};Array.from(document.querySelectorAll('.planner-ai button')).find(b=>b.textContent==='原样记下').click();})()`);
 await wait(()=>runtime.planner.store.snapshot().state.items.some(r=>r.body===raw));
 const goal=runtime.planner.store.snapshot().state.items.find(r=>r.body===raw);assert.equal(goal.kind,'goal');assert.equal(goal.scheduled,false);assert.ok(goal.until);assert.equal(goal.start,null);
 await run(host,`document.querySelector('.planner-body').scrollTop=0`);await captureExpanded('ai-off-raw.png');
 // Library uses the same tasks, can filter future items, and exposes before/after progress.
 s=runtime.planner.store.snapshot().state;runtime.planner.store.command({action:'apply',revision:s.revision,requestId:'future-stage20',changes:[{...goal,id:'plan-future',mode:'add',title:'下周提交课程练习',category:'P0',topic:'课程复习',date:'2027-01-05',until:'2027-01-10',body:''}]});
 await run(host,`document.activeElement.blur();PanelPlanner.view.refresh()`);
 await run(host,`Array.from(document.querySelectorAll('.planner-head button')).find(b=>b.textContent==='待办分类清单').click();document.querySelector('[name="range"]').value='future';document.querySelector('[name="range"]').dispatchEvent(new Event('change'));document.querySelector('.planner-body').scrollTop=0;`);
 await wait(()=>run(host,`document.querySelector('.planner-project')?.textContent.includes('下周提交课程练习')`));
 assert.equal(await run(host,`document.querySelector('.planner-compose').hidden`),true);
 await run(host,`document.querySelector('[name="search"]').value='不存在的任务';document.querySelector('[name="search"]').dispatchEvent(new Event('input'))`);assert.equal(await run(host,`document.querySelectorAll('.planner-row').length`),0);
 await run(host,`document.querySelector('[name="search"]').value='';document.querySelector('[name="range"]').value='all';document.querySelector('[name="range"]').dispatchEvent(new Event('change'));`);
 assert.ok(await run(host,`Array.from(document.querySelectorAll('.planner-item-history')).some(n=>n.textContent.includes('标记完成')&&n.textContent.includes('当时进展'))`));
 for(const theme of ['white','obsidian']){await run(host,`PanelAppearance.setTheme('${theme}');document.querySelector('.planner-body').scrollTop=0`);await captureExpanded(`library-${theme}.png`);}
 await run(host,`Array.from(document.querySelectorAll('.planner-head button')).find(b=>b.textContent==='返回安排').click()`);
 // An in-flight synthetic response cannot repopulate a proposal after switch-off.
 ipcMain.removeHandler('planner:suggest');let release;
 ipcMain.handle('planner:suggest',()=>new Promise(resolve=>{release=()=>resolve({ok:true,revision:runtime.planner.store.snapshot().state.revision,reply:'迟到结果',notes:[],changes:[{...first,mode:'update',status:'done'}]});}));
 await run(host,`document.querySelector('[aria-label="AI 协助"]').click()`);await wait(()=>runtime.planner.store.snapshot().state.aiEnabled);
 await run(host,`document.querySelector('[name="instruction"]').value='不要丢失这句话';Array.from(document.querySelectorAll('.planner-ai button')).find(b=>b.textContent==='提炼待确认草案').click()`);await wait(()=>release);
 await run(host,`document.querySelector('[aria-label="AI 协助"]').click()`);await wait(()=>!runtime.planner.store.snapshot().state.aiEnabled);release();await new Promise(r=>setTimeout(r,100));
 assert.equal(await run(host,`document.querySelectorAll('.planner-preview fieldset').length`),0);assert.equal(await run(host,`document.querySelector('[name="instruction"]').value`),'不要丢失这句话');
 assert.equal((await run(host,`notchAPI.plannerCommand({action:'apply',aiProposal:true,revision:${runtime.planner.store.snapshot().state.revision},requestId:'disabled-proposal',changes:[]})`)).error,'ai_disabled');
 assert.equal(await run(host,`localStorage.getItem('notch-todo-data')`),legacy);
 assert.deepEqual(errors,[]);
 console.log('PASS planner Electron: legacy unchanged, create/status/undo, host-float sync, no-key, AI preview before confirm, stale edit rejection, persistent non-focus reminder, themes and 360px float. Synthetic data, no real AI/microphone.');
 if(process.argv.includes('--preview')){console.log('Planner isolated preview ready');return;}app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
