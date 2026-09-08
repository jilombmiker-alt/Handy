'use strict';
const path=require('node:path');
const MODIFIER_SHORTCUT='LeftOption+LeftCommand';
function createModifierShortcut(onTrigger) {
  let native=null,timer=null,error='';
  function stop(){clearInterval(timer);timer=null;native?.stop();}
  return {
    start(){
      stop();
      try {
        native ||= require(path.join(__dirname,'native/.build/modifier-shortcut.node'));
        if(!native.start()){error='accessibility_required';return false;}
        timer=setInterval(()=>{if(native.poll()>0)onTrigger();},40);timer.unref();error='';return true;
      }catch{error='native_unavailable';return false;}
    },stop,get error(){return error;}
  };
}
module.exports={MODIFIER_SHORTCUT,createModifierShortcut};
