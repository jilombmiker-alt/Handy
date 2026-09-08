'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
function build() {
  if(process.platform!=='darwin')return;
  const root=path.resolve(__dirname,'..');
  const cache=path.join(os.homedir(),'Library/Caches/node-gyp');
  const candidates=[process.env.PANEL_NODE_HEADERS,path.join(path.dirname(process.execPath),'../include/node')];
  if(fs.existsSync(cache))for(const version of fs.readdirSync(cache).sort().reverse())candidates.push(path.join(cache,version,'include/node'));
  const headers=candidates.find(p=>p&&fs.existsSync(path.join(p,'node_api.h')));
  if(!headers)throw Error('需要 Node N-API 头文件；可通过 PANEL_NODE_HEADERS 指定 include/node 目录。');
  const output=path.join(root,'native/.build');fs.mkdirSync(output,{recursive:true});
  for(const moduleName of ['modifier-shortcut','clipboard-bridge','music-bridge'])execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-fblocks','-DNAPI_VERSION=8','-bundle','-undefined','dynamic_lookup','-mmacosx-version-min=11.0','-I',headers,'-framework','AppKit','-framework','ApplicationServices',path.join(root,'native',moduleName+'.mm'),'-o',path.join(output,moduleName+'.node')],{stdio:'inherit'});
}
if(require.main===module)build();module.exports={build};
