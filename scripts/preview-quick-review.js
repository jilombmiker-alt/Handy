// Isolated visual check; synthetic count only, never reads userData or credentials.
const {app,BrowserWindow}=require('electron');
const M=require('../renderer/quick-record-model');
const {createQuickReview}=require('../main-quick-review');
app.whenReady().then(async()=>{
  const now=new Date(2026,8,5,20,30).getTime();let state=M.initial('演示记录','preview',now);
  const review=createQuickReview({enabled:false,clock:()=>now,context:()=>({idleSeconds:10}),open:async()=>{},request:async p=>{
    if(p.action==='review-state')return {ok:true,state,recording:false,theme:'white'};
    state=M.change(state,p.command,now);return {ok:true,state};
  }});
  const shown=await review.tick();
  console.log('Preview shown:',shown);
  const window=BrowserWindow.getAllWindows()[0];
  setTimeout(async()=>{console.log('Visible:',window.isVisible());},4000);
  setTimeout(()=>{review.dispose();app.exit();},14000);
});
