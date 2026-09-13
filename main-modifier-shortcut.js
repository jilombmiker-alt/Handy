'use strict';
const path=require('node:path');
const MODIFIER_SHORTCUT='LeftOption+LeftCommand';
function keySpec(shortcut){
  if(shortcut===MODIFIER_SHORTCUT)return {};
  const parts=shortcut.split('+'),key=parts.pop();
  const codes={A:0,S:1,D:2,F:3,H:4,G:5,Z:6,X:7,C:8,V:9,B:11,Q:12,W:13,E:14,R:15,Y:16,T:17,'1':18,'2':19,'3':20,'4':21,'6':22,'5':23,'9':25,'7':26,'8':28,'0':29,O:31,U:32,I:34,P:35,Enter:36,L:37,J:38,K:40,N:45,M:46,Tab:48,Space:49,Backspace:51,Escape:53,F17:64,F18:79,F19:80,F20:90,F5:96,F6:97,F7:98,F3:99,F8:100,F9:101,F11:103,F13:105,F16:106,F14:107,F10:109,F12:111,F15:113,Home:115,PageUp:116,Delete:117,F4:118,End:119,F2:120,PageDown:121,F1:122,Left:123,Right:124,Down:125,Up:126};
  if(!Object.hasOwn(codes,key))return null;
  const flags={Command:1,CommandOrControl:1,Control:2,Alt:4,Option:4,Shift:8};
  if(parts.some(p=>!flags[p]))return null;
  return {keyCode:codes[key],modifiers:parts.reduce((n,p)=>n|flags[p],0)};
}
function createModifierShortcut(onTrigger) {
  let native=null,timer=null,error='';
  function stop(){clearInterval(timer);timer=null;native?.stop();}
  return {
    start(shortcut=MODIFIER_SHORTCUT){
      stop();
      try {
        const spec=keySpec(shortcut);if(!spec){error='gesture_unsupported';return false;}
        native ||= require(path.join(__dirname,'native/.build/modifier-shortcut.node'));
        if(!native.start(spec)){error='accessibility_required';return false;}
        timer=setInterval(()=>{for(const value of native.poll())onTrigger(value===2?'long':'short');},30);timer.unref();error='';return true;
      }catch{error='native_unavailable';return false;}
    },press(){native?.press?.();},stop,get error(){return error;}
  };
}
module.exports={MODIFIER_SHORTCUT,createModifierShortcut,keySpec};
