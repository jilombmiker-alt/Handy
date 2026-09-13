const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
process.env.PANEL_TEST_MODE='1';
process.env.PANEL_TEST_USER_DATA_PATH=fs.mkdtempSync(path.join(os.tmpdir(),'panel-voice-'));
delete process.env.NOTCH_LLM_API_KEY;delete process.env.DASHSCOPE_API_KEY;
const timerRuntime=require('../main');
const wait=async(check)=>{const start=Date.now();while(Date.now()-start<12000){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,35));}throw Error('wait_timeout');};
const run=async(w,s)=>{try{return await w.webContents.executeJavaScript(s,true);}catch(e){throw Error(`${e.message} [fixture: ${s.slice(0,90)}]`);}};
const getRows=w=>run(w,`JSON.parse(localStorage.getItem('notch-recordings')||'[]')`);
const source='嗯，可能周五完成，不对，暂定周六完成，预算 120 元。';
async function main(){
  await app.whenReady();
  const host=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')));
  await wait(()=>run(host,'!!window.PanelRecording && !!window.Notebook'));
  const failures=[];host.webContents.on('console-message',(_e,level,msg)=>{if(level===3&&!msg.includes('Autofocus')&&!msg.includes('MEDIA_ELEMENT_ERROR'))failures.push(msg);});
  assert.equal((await run(host,`notchAPI.organizeVoice({id:'recording-no-key',text:'合成测试'})`)).error,'not_configured');
  let mode='hold',resolveResult,calls=0;
  ipcMain.removeHandler('voice:organize');
  ipcMain.handle('voice:organize',async(_e,p)=>{
    calls++;
    const rows=await getRows(host),row=rows.find(r=>r.id===p.id);
    assert.ok(row,'source persisted before AI');
    assert.ok(fs.existsSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,row.audioPath)));
    assert.ok(fs.existsSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,row.audioPath)+'.json'));
    if(mode==='hold')return new Promise(r=>{resolveResult=r;});
    if(mode==='fail')return {ok:false,error:'timeout'};
    return {ok:true,cleaned:'暂定周六完成，预算 120 元。',summary:['暂定周六完成，预算 120 元。'],uncertainties:[]};
  });
  await run(host,`(()=>{
    window.SpeechRecognition=class {start(){window.testRecognition=this;}stop(){} };
    navigator.mediaDevices.getUserMedia=async()=>{
      window.testAudioContext=new AudioContext();const output=testAudioContext.createMediaStreamDestination();
      const oscillator=testAudioContext.createOscillator(),gain=testAudioContext.createGain();gain.gain.value=0;oscillator.connect(gain);gain.connect(output);oscillator.start();void testAudioContext.resume();return output.stream;
    };
    window.say=()=>{const result=[{transcript:${JSON.stringify(source)}}];result.isFinal=true;testRecognition.onresult({resultIndex:0,results:[result]});};
  })()`);
  async function record(useTimer=false){
    await run(host,`PanelRecording.command('start')`);
    assert.equal((await run(host,'PanelRecording.snapshot()')).status,'recording');
    await run(host,`say();PanelRecording.command('mark')`);
    if(useTimer){
      assert.equal((await run(host,`PanelRecording.command('timer-stop','recording-wrong')`)).error,'recording_changed');
      assert.equal((await run(host,'PanelRecording.snapshot()')).status,'recording');
      assert.equal((await run(host,`(async()=>{const s=await notchAPI.timerGet();return notchAPI.timerCommand({action:'start',mode:'countdown',seconds:1,stopRecording:true,revision:s.revision});})()`)).ok,true);
    }
    await new Promise(r=>setTimeout(r,1100));
    if(useTimer)await timerRuntime.simpleTimer.tick();else await run(host,`PanelRecording.command('stop')`);
    await wait(async()=>['idle','save-failed'].includes((await run(host,'PanelRecording.snapshot()')).status));
    await run(host,'testAudioContext.close()');
    if(useTimer)await run(host,`(async()=>{const s=await notchAPI.timerGet();return notchAPI.timerCommand({action:'finish',id:s.active.id,revision:s.revision});})()`);
  }
  await record(true);await wait(()=>resolveResult);
  const captures=()=>run(host,`QuickRecords.snapshot().state.records.filter(r=>r.sourceRecordingId)`);
  assert.equal((await captures()).length,1);assert.equal((await captures())[0].content,source);
  assert.notEqual(await run(host,'QuickRecords.snapshot().state.activeId'),(await captures())[0].id);
  let row=(await getRows(host))[0];
  assert.equal(row.transcript,source);assert.equal(row.voice.rawTranscript,source);assert.equal(row.voice.status,'running');assert.equal(row.voice.markers.length,1);
  const backup=JSON.parse(fs.readFileSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,row.audioPath)+'.json','utf8'));assert.equal(backup.voice.rawTranscript,source);
  resolveResult({ok:false,error:'timeout'});
  await wait(async()=>(await getRows(host))[0]?.voice.status==='failed');
  assert.equal((await getRows(host))[0].voice.rawTranscript,source);
  assert.equal((await captures())[0].content,source,'AI failure retains the raw quick record');
  mode='success';
  await run(host,`window.quickStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===QuickRecordModel.KEY)throw Error('quota');return quickStorageSet.call(this,k,v);};void 0;`);
  await run(host,`document.querySelector('.voice-actions button').click()`);
  await wait(async()=>(await getRows(host))[0]?.voice.status==='done');
  row=(await getRows(host))[0];assert.equal(row.voice.cleaned,'暂定周六完成，预算 120 元。');assert.equal(row.transcript,source);
  assert.equal((await captures())[0].content,source,'failed quick update retains previous text');
  await run(host,`Storage.prototype.setItem=quickStorageSet;[...document.querySelectorAll('.voice-actions button')].find(b=>b.textContent==='重试存入随手记').click()`);
  assert.equal((await captures()).length,1);assert.equal((await captures())[0].content,row.voice.cleaned);
  await run(host,`document.querySelector('.voice-cleaned').value='手动补充';document.querySelector('.voice-cleaned').dispatchEvent(new Event('input'))`);
  assert.equal((await getRows(host))[0].voice.cleaned,'手动补充');
  await run(host,`PanelRecording.command('auto-off')`);const before=calls;
  await record();assert.equal(calls,before);assert.equal((await getRows(host))[0].voice.status,'idle');
  assert.equal((await captures()).length,2);assert.equal((await captures())[0].content,source,'auto-off saves unchanged dictation');
  assert.equal(await run(host,`document.querySelector('[aria-label="原始转写"]').value`),source);
  // Index quota failure retains the blob and the existing audio path for a retry.
  await run(host,`window.storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='notch-recordings')throw new DOMException('quota','QuotaExceededError');return storageSet.call(this,k,v);};void 0;`);
  await record();assert.equal((await run(host,'PanelRecording.snapshot()')).status,'save-failed');
  const filesBefore=fs.readdirSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,'recordings')).filter(n=>!n.endsWith('.json')).length;
  assert.ok(await run(host,`Array.from(document.querySelectorAll('#recording-detail button')).some(b=>b.textContent==='重试保存')`));
  await run(host,`Storage.prototype.setItem=storageSet;PanelRecording.command('retry-save')`);
  assert.equal((await run(host,'PanelRecording.snapshot()')).status,'idle');
  assert.equal(fs.readdirSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,'recordings')).filter(n=>!n.endsWith('.json')).length,filesBefore);
  const originalWrite=fs.promises.writeFile;
  fs.promises.writeFile=async function(file,...args){if(/recording-[\w-]+\.webm$/.test(String(file)))throw Object.assign(Error('synthetic disk failure'),{code:'ENOSPC'});return originalWrite.call(this,file,...args);};
  try{await record();assert.equal((await run(host,'PanelRecording.snapshot()')).status,'save-failed');}
  finally{fs.promises.writeFile=originalWrite;}
  assert.equal((await run(host,'PanelRecording.snapshot()')).transcript,source);
  await run(host,`PanelRecording.command('retry-save')`);assert.equal((await run(host,'PanelRecording.snapshot()')).status,'idle');
  // Recovery restores source without requiring the model and does not duplicate indexed rows.
  const recovered=await run(host,'notchAPI.recoverRecordings()');assert.equal(recovered.recordings.length,4);
  await run(host,`localStorage.setItem('notch-recordings','[]')`);host.webContents.reload();
  await wait(()=>run(host,'!!window.PanelRecording'));
  await run(host,`document.getElementById('voice-recover').click()`);await wait(async()=>(await getRows(host)).length===4);
  await run(host,`document.getElementById('voice-recover').click()`);assert.equal((await getRows(host)).length,4);
  await run(host,`Notebook.detach('recorder')`);
  // The current product opens tools inline; the old satellite expectation is obsolete.
  await wait(()=>run(host,`ToolLauncher.current==='recorder'`));
  assert.equal((await run(host,'PanelRecording.snapshot()')).autoOrganize,false);
  await run(host,`PanelRecording.command('auto-on')`);assert.equal((await run(host,'PanelRecording.snapshot()')).autoOrganize,true);
  assert.equal((await run(host,`PanelRecording.command('results')`)).ok,true);
  await run(host,`setMode(true);setActiveTab('recordings')`);host.setBounds({x:40,y:60,width:1288,height:680});host.show();
  await run(host,`document.querySelector('.voice-actions button').click()`);await wait(()=>run(host,`document.querySelector('.voice-cleaned')?.value==='暂定周六完成，预算 120 元。'`));
  const evidence=process.env.PANEL_VOICE_CAPTURE_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'panel-voice-evidence-'));fs.mkdirSync(evidence,{recursive:true});
  // These are synthetic fixtures, never user audio or a claim of live AI quality.
  for(const theme of ['white','obsidian']){
    await run(host,`PanelAppearance.setTheme('${theme}')`);await new Promise(r=>setTimeout(r,500));
    fs.writeFileSync(path.join(evidence,`voice-${theme}.png`),(await host.webContents.capturePage()).toPNG());
  }
  host.setSize(760,580);
  assert.equal(await run(host,'document.documentElement.scrollWidth>innerWidth'),false);
  fs.writeFileSync(path.join(evidence,'recorder-inline.png'),(await host.webContents.capturePage({},{stayHidden:true})).toPNG());
  if(!process.argv.includes('--preview')){
    const remove=(await getRows(host))[0];
    assert.equal(await run(host,`notchAPI.deleteRecording(${JSON.stringify(remove.audioPath)})`),true);
    assert.equal(fs.existsSync(path.join(process.env.PANEL_TEST_USER_DATA_PATH,remove.audioPath)+'.json'),false);
    assert.equal((await run(host,'notchAPI.recoverRecordings()')).recordings.length,3);
    await run(host,`(async()=>{
      await PanelRecording.command('auto-off');
      window.MediaRecorder=class {static isTypeSupported(){return true;}constructor(){this.mimeType='audio/webm';}start(){}stop(){void this.onstop();}};
      window.SpeechRecognition=class {start(){window.testRecognition=this;}stop(){}};
      navigator.mediaDevices.getUserMedia=async()=>{window.emptyAudio=new AudioContext();return emptyAudio.createMediaStreamDestination().stream;};
      await PanelRecording.command('start');const item=[{transcript:'只有原始文字'}];item.isFinal=true;testRecognition.onresult({resultIndex:0,results:[item]});await PanelRecording.command('stop');
    })()`);
    await wait(async()=>(await run(host,'PanelRecording.snapshot()')).status==='save-failed');
    await run(host,`Array.from(document.querySelectorAll('#recording-detail button')).find(b=>b.textContent==='仅保存转写并结束').click();emptyAudio.close()`);
    assert.equal((await run(host,'PanelRecording.snapshot()')).status,'idle');
    assert.equal((await getRows(host))[0].voice.rawTranscript,'只有原始文字');
    assert.equal((await getRows(host))[0].audioPath,'');
  }
  assert.deepEqual(failures,[]);
  console.log('PASS voice Electron: synthetic audio/transcript saved BEFORE AI; fail/retry; raw/edit isolation; auto-off; quota retry reuses audio; sidecar recovery/dedupe; float actions/theme/narrow. No physical microphone or real model request.');
  if(process.argv.includes('--preview')){console.log('Isolated preview ready');return;}
  app.quit();
}
main().catch(e=>{console.error(e);app.exit(1);});
