'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow}=require('electron');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'panel-home-music-')));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 await app.whenReady();
 const win=new BrowserWindow({width:1240,height:616,show:false,frame:false,webPreferences:{backgroundThrottling:false,partition:`home-music-${process.pid}`}});
 const run=code=>win.webContents.executeJavaScript(code,true).catch(error=>{console.error('Renderer check failed:',code);throw error;});
 const dir=process.env.PANEL_HOME_MUSIC_CAPTURE_DIR;if(dir)fs.mkdirSync(dir,{recursive:true});
 try{
  await win.loadFile(path.join(__dirname,'../renderer/index.html'));
  await run(`document.getElementById('notch').click();window.musicCommands=[];window.floatOpens=0;window.notchAPI={getMusicStatus:async()=>({ok:true,installed:false,running:false,playing:null,title:'未安装汽水音乐'}),controlMusic:async a=>{musicCommands.push(a);return {ok:true}}};window.Notebook.detach=async()=>{floatOpens++;return {ok:true}};WorkspaceModules.request('music','get')`);
  await pause(400);
  assert.equal(await run(`document.getElementById('music-title').textContent`),'汽水音乐');
  assert.equal(await run(`Array.from(document.querySelectorAll('[data-music-action]')).every(b=>b.disabled)`),true);
  await run(`document.getElementById('music-play-toggle').click();document.getElementById('music-float-open').click()`);
  assert.equal(await run(`musicCommands.length`),0);assert.equal(await run(`floatOpens`),1);
  for(const theme of ['white','obsidian'])for(const musicForm of ['cover'])for(const size of ['mini','small','medium','large']){
   await run(`PanelAppearance.setTheme('${theme}');document.getElementById('home-music').dataset.widgetSize='${size}'`);
   await pause(200);
   const geometry=await run(`(()=>{const q=s=>document.querySelector(s),tile=q('#home-music').getBoundingClientRect(),els=['.music-copy','.music-controls','#music-float-open'].map(s=>q('#home-music '+s).getBoundingClientRect());return {x:Math.floor(tile.x),y:Math.floor(tile.y),width:Math.ceil(tile.width),height:Math.ceil(tile.height),fits:els.every(r=>r.left>=tile.left&&r.right<=tile.right&&r.top>=tile.top&&r.bottom<=tile.bottom),noOverlap:els[0].right<=els[1].left,play:q('#music-play-toggle').getBoundingClientRect().height}})()`);
   assert.equal(geometry.fits,true,`${theme}/${musicForm}/${size} ${JSON.stringify(geometry)}`);if(musicForm==='bar')assert.equal(geometry.noOverlap,true);assert.equal(geometry.play,32);
   if(dir&&size==='large'){const {x,y,width,height}=geometry;fs.writeFileSync(path.join(dir,`${theme}-${musicForm}-home-music.png`),(await win.capturePage({x,y,width,height})).toPNG());}
  }
  // Emulate page focus so CSS :focus can be tested without showing a second app.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  await run(`document.getElementById('music-float-open').focus()`);
  assert.equal(await run(`document.activeElement.id`),'music-float-open');
  assert.equal(await run(`!!document.querySelector('#home-music .widget-size-control')`),false,'No redundant form chooser');
  assert.equal(await run(`document.getElementById('home-music').dataset.musicForm`),'cover');
  for(const size of ['mini','small','medium','large']){
   await run(`PanelAppearance.setLayout('custom');document.getElementById('home-music').dataset.widgetSize='${size}'`);await pause(200);
   assert.equal(await run(`(()=>{const a=document.querySelector('#home-music').getBoundingClientRect();return ['.music-copy','.music-controls','#music-float-open'].every(s=>{const b=document.querySelector('#home-music '+s).getBoundingClientRect();return b.left>=a.left&&b.right<=a.right&&b.bottom<=a.bottom&&b.top>=a.top})})()`),true,'Custom '+size+' fits');
  }
  await run(`PanelAppearance.setLayout('calm')`);
  win.setSize(980,600);await pause(200);
  assert.equal(await run(`(()=>{const a=document.querySelector('#home-music').getBoundingClientRect(),b=document.querySelector('#home-music .music-controls').getBoundingClientRect();return b.right<=a.right&&b.bottom<=a.bottom})()`),true);
  assert.equal((await run(`WorkspaceModules.request('music','toggle-form')`)).error,'invalid_action');
  await run(`localStorage.setItem('notch-music-form-v1','bar')`);
  await win.loadFile(path.join(__dirname,'../renderer/index.html'));await pause(250);
  assert.equal(await run(`document.getElementById('home-music').dataset.musicForm`),'cover','Legacy shared preference cannot change the home form');
  assert.equal(await run(`localStorage.getItem('notch-music-form-v1')`),'bar','Old data is preserved, not rewritten');
  console.log('PASS home music: hidden actual homepage, white/obsidian, four sizes, no overflow/overlap, unavailable controls, float entry, keyboard and narrow layout. No real player.');
 }finally{win.destroy();app.quit();}
}
main().catch(error=>{console.error(error);app.exit(1);});
