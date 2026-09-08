const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizePlacement,fitPanel,placementBounds,placementFromBounds,edgeAt,handleBounds}=require('../panel-placement-model');
const d={id:7,workArea:{x:-1920,y:30,width:1920,height:1050}};
test('placement validates saved data and clamps normalized coordinates',()=>{
  assert.equal(normalizePlacement({version:1,displayId:7,x:NaN,y:0,edge:'left'}),null);
  assert.equal(normalizePlacement({version:1,displayId:7,x:0,y:0,edge:'bottom'}),null);
  assert.deepEqual(normalizePlacement({version:1,displayId:7,x:-1,y:4,edge:null}),{version:1,displayId:7,x:0,y:1,edge:null});
});
test('placement round trips free positioning and fits narrow/negative displays',()=>{
  const b={x:-1680,y:200,width:1240,height:616};
  assert.deepEqual(placementBounds(placementFromBounds(b,d),d,b),b);
  assert.deepEqual(fitPanel({x:900,y:1000,width:1240,height:616},{x:0,y:24,width:800,height:600}),{x:12,y:36,width:776,height:576});
});
test('only top/left/right edges dock, with a 36px threshold',()=>{
  assert.equal(edgeAt({x:-1910,y:500},d.workArea),'left');
  assert.equal(edgeAt({x:-5,y:500},d.workArea),'right');
  assert.equal(edgeAt({x:-900,y:35},d.workArea),'top');
  assert.equal(edgeAt({x:-900,y:1080},d.workArea),null);
  assert.equal(edgeAt({x:-1870,y:500},d.workArea),null);
});
test('all handles and expanded panels stay within the selected work area',()=>{
  for(const edge of ['top','left','right'])for(const x of [0,0.5,1])for(const y of [0,1]){
    const p={version:1,displayId:d.id,x,y,edge};
    for(const b of [handleBounds(p,d),placementBounds(p,d,{width:1240,height:616})]){
      assert.ok(b.x>=d.workArea.x&&b.y>=d.workArea.y);
      assert.ok(b.x+b.width<=d.workArea.x+d.workArea.width&&b.y+b.height<=d.workArea.y+d.workArea.height);
    }
  }
});
