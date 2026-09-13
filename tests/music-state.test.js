const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,clock}=require('../renderer/music-state');
const sample={installed:true,running:true,title:'测试歌曲',artist:'测试歌手',timeline:'02:56 / 04:28'};
test('actual player timeline normalizes without fabricating playback',()=>{
  const a=normalize(sample,null,1000);assert.equal(a.elapsed,176);assert.equal(a.duration,268);assert.equal(a.playing,null);assert.equal(a.metadataAvailable,true);assert.equal(clock(a.elapsed),'2:56');
  const b=normalize({...sample,timeline:'02:57 / 04:28'},a,2000);assert.equal(b.playing,true);assert.equal(b.playbackSource,'progress');
  assert.equal(normalize(sample,a,2000).playing,null,'stationary could mean buffering');
  assert.equal(normalize({...sample,timeline:'02:57 / 04:28'},a,9000).playing,null,'stale observation is not evidence');
  assert.equal(normalize({...sample,title:'下一首',timeline:'02:57 / 04:28'},a,2000).playing,null);
  assert.equal(normalize({...sample,playing:false},a,2000).playing,false);
});
test('missing, denied, invalid and stopped snapshots clear old metadata',()=>{
  const previous=normalize(sample);
  for(const raw of [{...sample,error:'accessibility_permission_required'},{...sample,installed:false},{...sample,running:false},{running:true},{...sample,timeline:'04:30 / 04:28'},{...sample,timeline:'02:99 / 04:28'},{...sample,timeline:'00:00 / 00:00'}]){
    const v=normalize(raw,previous);assert.equal(v.metadataAvailable,false);assert.equal(v.title,'');assert.equal(v.elapsed,null);
  }
});
