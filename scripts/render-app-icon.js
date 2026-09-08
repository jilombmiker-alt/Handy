// Render authored SVG into native icon sizes. Does not launch production code or read user data.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'handy-icon-render-')));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  app.dock?.hide();
  const win=new BrowserWindow({width:1024,height:1024,show:false,transparent:true,backgroundColor:'#00000000',webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const svg=fs.readFileSync(path.join(root,'build/handy-icon.svg'),'utf8');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<html><style>html,body{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}svg{display:block}</style>${svg}</html>`));
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const source=(await win.webContents.capturePage()).resize({width:1024,height:1024,quality:'best'});
  fs.writeFileSync(path.join(root,'build/to-do-panel-icon.png'),source.toPNG());
  fs.writeFileSync(path.join(root,'renderer/assets/app-logo-128.png'),source.resize({width:128,height:128,quality:'best'}).toPNG());
  const iconset=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'handy-iconset-')),'Handy.iconset');fs.mkdirSync(iconset);
  for(const logical of [16,32,128,256,512])for(const scale of [1,2]){
    const size=logical*scale;fs.writeFileSync(path.join(iconset,`icon_${logical}x${logical}${scale===2?'@2x':''}.png`),source.resize({width:size,height:size,quality:'best'}).toPNG());
  }
  execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(root,'build/to-do-panel-icon.icns')]);
  console.log('Handy SVG rendered to 1024 PNG, 128 PNG and 10-size ICNS. No production app launched.');
  win.destroy();app.quit();
}).catch(e=>{console.error(e.message);app.exit(1);});
