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
test('dialog stays centered inside work area, including negative and small displays',()=>{
  for(const a of [{x:0,y:38,width:1512,height:880},{x:-1920,y:-1080,width:1920,height:1030},{x:0,y:25,width:390,height:500}]){
    for(const mode of [true,false,'home','home-expanded','home-wide','notes','recorder']){const b=M.bounds(a,mode);assert.ok(b.x>=a.x);assert.ok(b.y>=a.y);assert.ok(b.x+b.width<=a.x+a.width);assert.ok(b.y+b.height<=a.y+a.height);assert.ok(Math.abs(b.x+b.width/2-(a.x+a.width/2))<=0.5);assert.ok(Math.abs(b.y+b.height/2-(a.y+a.height/2))<=0.5);}
  }
});
test('manual position survives layout changes but remains on screen',()=>{
  const a={x:-1920,y:38,width:1920,height:1042},p={x:-1800,y:90};
  for(const mode of ['home','home-reply','home-plan','home-expanded','settings']){
    const b=M.placedBounds(a,mode,p);assert.equal(b.x,p.x);assert.equal(b.y,p.y);
    const edge=M.placedBounds(a,mode,{x:99999,y:99999});
    assert.ok(edge.x+edge.width<=a.x+a.width-12);assert.ok(edge.y+edge.height<=a.y+a.height-12);
  }
  for(const p of [null,{}, {x:NaN,y:3}])assert.deepEqual(M.placedBounds(a,'home',p),M.bounds(a,'home'));
  for(const a of [{x:0,y:24,width:390,height:400},{x:0,y:0,width:10,height:10}]){
    const b=M.placedBounds(a,'settings',{x:-5000,y:-5000});assert.ok(b.x>=a.x&&b.y>=a.y);assert.ok(b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height);
  }
});
