const test=require('node:test'),assert=require('node:assert/strict');
const {timerPresentation:p}=require('../main-timer');
test('tray countdown uses the live clock, pause and due states without restarting',()=>{
 assert.equal(p({ok:true,active:null}).title,'');
 assert.equal(p({ok:false}).active,false);
 const active={mode:'countdown',plannedMs:900000,currentMs:500,running:true};
 assert.equal(p({ok:true,active}).title,'◷ 15:00');
 active.currentMs=28000;assert.equal(p({ok:true,active}).title,'◷ 14:32');
 active.running=false;assert.match(p({ok:true,active}).menu,/已暂停 14:32/);
 active.currentMs=901000;assert.equal(p({ok:true,active}).title,'◷ 时间到');
 active.mode='countup';active.currentMs=3601000;assert.match(p({ok:true,active}).title,/01:00:01/);
});
