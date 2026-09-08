const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {controlSodaMusic}=require('../main-services');
test('music navigation never launches a dormant client',async()=>{
  let launches=0,sends=0;
  const dependencies={isRunning:async()=>false,launch:async()=>{launches++;},sendShortcut:async()=>{sends++;}};
  for(const action of ['pause','next','previous'])assert.equal((await controlSodaMusic(action,dependencies)).error,'no_active_session');
  assert.equal(launches,0);assert.equal(sends,0);
});
test('music failures and invalid actions never turn into successful playback',async()=>{
  const dependencies={isRunning:async()=>true,launch:async()=>false,sendShortcut:async()=>({ok:false,error:'music_input_focused'})};
  assert.equal((await controlSodaMusic('toggle',dependencies)).error,'music_input_focused');
  assert.equal((await controlSodaMusic('toggle',dependencies)).playing,null);
  assert.equal((await controlSodaMusic('untrusted',dependencies)).error,'invalid_action');
  assert.equal((await controlSodaMusic('toggle',{...dependencies,isRunning:async()=>false})).error,'launch_failed');
});
test('background music bridge has a fixed target and no activation/global-post fallback',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../native/music-bridge.mm'),'utf8');
  assert.match(src,/com\.soda\.music/);assert.match(src,/CGEventPostToPid/);
  assert.doesNotMatch(src,/CGEventPost\(|activateWithOptions|frontmost\s*=/);
  assert.match(src,/music_input_focused/);
});
