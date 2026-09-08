const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../renderer/launcher-model');
test('launcher routes are stable and validate old tool requests',()=>{
  assert.equal(M.tools.filter(t=>t.primary).length,8);
  assert.equal(new Set(M.tools.map(t=>t.id)).size,M.tools.length);
  assert.equal(M.route({kind:'module',id:'pomodoro'}),'pomodoro');
  assert.equal(M.route({kind:'note',id:'test-note-1'}),'notes');
  assert.equal(M.route({kind:'note',id:'../private'}),null);
  assert.equal(M.route({kind:'module',id:'__proto__'}),null);
});
test('bottom geometry stays inside work area, including negative and small displays',()=>{
  for(const a of [{x:0,y:38,width:1512,height:880},{x:-1920,y:-1080,width:1920,height:1030},{x:0,y:25,width:390,height:500}]){
    for(const home of [true,false]){const b=M.bounds(a,home);assert.ok(b.x>=a.x);assert.ok(b.y>=a.y);assert.ok(b.x+b.width<=a.x+a.width);assert.equal(b.y+b.height,a.y+a.height-12);}
  }
});
