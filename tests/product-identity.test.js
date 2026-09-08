const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),pkg=require('../package.json');
test('display rename preserves bundle, npm and historical data identity',()=>{
  assert.equal(pkg.build.productName,'Handy');assert.equal(pkg.build.appId,'com.dynamicpanel.app');assert.equal(pkg.name,'to-do-panel');
  assert.equal(pkg.build.mac.extendInfo.CFBundleDisplayName,'Handy');
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert.match(main,/app.setName\('Handy'\)/);
  assert.match(main,/app.getPath\('appData'\), 'Dynamic Panel'/);
  assert.match(main,/app.setPath\('userData', IS_TEST_RUNTIME \? TEST_USER_DATA_PATH : LEGACY_USER_DATA_PATH\)/);
});
test('local installer validates identity and backs up both renamed and legacy paths',()=>{
  const script=fs.readFileSync(path.join(root,'scripts/install-local.js'),'utf8');
  assert.match(script,/predecessors=.*target,'\/Applications\/TO-DO Panel.app'/);
  assert.match(script,/for\(const old of predecessors\)if\(fs.existsSync\(old\)\)identity\(old\)/);
  assert.match(script,/moved.push\(\{original,saved\}\)/);
  assert.match(script,/moved.reverse\(\)/);
  assert.match(script,/Contents\/MacOS\/随手台/);
  assert.match(script,/Contents\/MacOS\/Handy/);
  assert.ok(script.includes("'/Applications/随手台.app'"));
});
