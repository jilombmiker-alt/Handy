'use strict';
// Explicit local overwrite only. Never invoked by npm build or a release workflow.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const { assertSigningContinuity } = require('./install-identity');
const { signingEnvironment, selectSigningIdentity } = require('../build/signing-policy');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),version=pkg.version;
const product=pkg.build.productName;
if(!['TO-DO Panel','随手台','Handy'].includes(product)||pkg.build.appId!=='com.dynamicpanel.app')throw Error('未知安装身份，已停止。');
const source=path.resolve(process.env.PANEL_INSTALL_SOURCE||path.join(root,'dist.noindex/mac-arm64',`${product}.app`)),target=`/Applications/${product}.app`;
const predecessors=[...new Set([target,'/Applications/TO-DO Panel.app','/Applications/随手台.app'])];
const backupRoot=path.resolve(process.env.PANEL_INSTALL_BACKUP_ROOT||path.join(os.homedir(),'Library/Application Support/TO-DO Panel Backups'));
const installOnly=process.argv.includes('--install-only');
let migration=null;
if(process.argv.includes('--migrate-local-signing')){
  const signing=selectSigningIdentity(signingEnvironment());
  if(!signing.local||!/^[a-f0-9]{40}$/i.test(process.env.PANEL_MIGRATE_FROM_CDHASH||''))throw Error('首次迁移必须指定当前临时签名 CDHash，并配置明确的本机证书。');
  migration={fromAdhocHash:process.env.PANEL_MIGRATE_FROM_CDHASH,toCertificate:signing.identity};
}
function identity(app){const id=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();if(id!==pkg.build.appId)throw Error('安装目标不是本产品，未覆盖。');}
function verify(app){identity(app);execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});const actual=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();if(actual!==version)throw Error(`版本不符 ${actual}`);}
function ensureStopped(){
  const developmentExecutable=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const running=execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8'}).split('\n').map(v=>v.trim()).filter(v=>v.endsWith('/Contents/MacOS/TO-DO Panel')||v.endsWith('/Contents/MacOS/随手台')||v.endsWith('/Contents/MacOS/Handy')||v===developmentExecutable);
  // Install-only may replace the inactive official bundle while a separate backup
  // runs. Never touch live userData, the running bundle, or launch a second app.
  if(running.some(v=>!installOnly||!v.startsWith(backupRoot+path.sep)))throw Error('请正常退出正式版与测试版后再安装，不会强制结束进程。');
  return running;
}
verify(source);
for(const old of predecessors)if(fs.existsSync(old))identity(old);
const signingContinuity=predecessors.filter(old=>fs.existsSync(old)).map(old=>({path:old,...assertSigningContinuity(old,source,undefined,migration)}));
// Read-only preflight and identical-build installs do not relocate the live app
// into a backup (or create another same-name bundle for macOS to discover).
if(process.argv.includes('--check')){
  console.log(JSON.stringify({target,version,signingContinuity,readOnly:true}));process.exit(0);
}
if(fs.existsSync(target)&&predecessors.filter(old=>fs.existsSync(old)).length===1){
  let identical=false;try{execFileSync('/usr/bin/diff',['-qr',source,target],{stdio:'pipe'});identical=true;}catch(error){if(error.status!==1)throw error;}
  if(identical){console.log(JSON.stringify({installed:target,version,unchanged:true,signingContinuity,launched:false}));process.exit(0);}
}
const runningBackups=ensureStopped();
fs.mkdirSync(backupRoot,{recursive:true});
const backup=fs.mkdtempSync(path.join(backupRoot,`pre-v${version}-`));fs.chmodSync(backup,0o700);
const data=path.join(os.homedir(),'Library/Application Support/Dynamic Panel');
const dataSnapshot=!installOnly&&fs.existsSync(data);
if(dataSnapshot)execFileSync('/usr/bin/ditto',[data,path.join(backup,'Dynamic Panel')]);
const stageRoot=fs.mkdtempSync('/Applications/.TO-DO-Panel-install-'),stage=path.join(stageRoot,`${product}.app`);
execFileSync('/usr/bin/ditto',[source,stage]);verify(stage);
for(const old of predecessors)if(fs.existsSync(old))assertSigningContinuity(old,stage,undefined,migration);
ensureStopped();
const moved=[];let placed=false;
try{
  for(const original of predecessors)if(fs.existsSync(original)){const saved=path.join(backup,`${path.basename(original,'.app')}.bundle-backup`);fs.renameSync(original,saved);moved.push({original,saved});}
  fs.renameSync(stage,target);placed=true;verify(target);
  execFileSync('/usr/bin/diff',['-qr',source,target],{stdio:'pipe'});
}catch(error){
  if(placed&&fs.existsSync(target))fs.renameSync(target,path.join(backup,'failed-new.bundle-backup'));
  for(const {original,saved} of moved.reverse())fs.renameSync(saved,original);
  throw error;
}
fs.rmdirSync(stageRoot); // only the verified empty temporary staging directory
execFileSync('/usr/bin/diff',['-qr',source,target],{stdio:'pipe'});
console.log(JSON.stringify({installed:target,version,backup,replaced:moved.map(v=>v.original),userDataPreserved:data,dataSnapshot,runningBackups,launched:false}));
