const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readPermissionSnapshot, permissionMessage, windowScanFailure, createPermissionRelaunch, applicationLocation, shouldShowOnLaunch, createPermissionRequest } = require('../main-permissions');
const { selectSigningIdentity } = require('../build/signing-policy');

test('permission inspection is passive, handles API failure per field and never prompts', () => {
  const calls = [];
  const snapshot = readPermissionSnapshot({
    isTrustedAccessibilityClient(prompt) { assert.equal(prompt, false); calls.push('ax'); return true; },
    getMediaAccessStatus(type) { calls.push(type); if (type === 'screen') throw Error('unavailable'); return type === 'camera' ? 'not-determined' : 'granted'; },
  }, 'darwin');
  assert.deepEqual(calls, ['ax', 'screen', 'microphone', 'camera']);
  assert.equal(snapshot['screen-recording'], 'unknown');
  assert.equal(snapshot.microphone, 'granted');
  assert.equal(snapshot.camera, 'not-determined');
  assert.match(permissionMessage(snapshot), /不代表已拒绝/);
  assert.match(permissionMessage(snapshot), /不用的功能无需授权/);
});

test('current app location comes from its executable and supports nonstandard install paths', () => {
  const app = { isPackaged:true, isInApplicationsFolder:()=>true };
  assert.deepEqual(applicationLocation(app, '/Users/guest/Applications/Handy.app/Contents/MacOS/Handy', 'darwin'), { bundlePath:'/Users/guest/Applications/Handy.app', installed:true, packaged:true });
  app.isInApplicationsFolder=()=>false;
  assert.equal(applicationLocation(app, '/Volumes/Handy/Handy.app/Contents/MacOS/Handy', 'darwin').installed,false);
  assert.equal(applicationLocation(app, '/tmp/Handy', 'darwin').bundlePath,null);
  assert.equal(applicationLocation({isPackaged:false}, '/tmp/Electron.app/Contents/MacOS/Electron', 'darwin').bundlePath,null);
});

test('manual packaged launch is visible, login and isolated tests stay quiet', () => {
  assert.equal(shouldShowOnLaunch({packaged:true,testRuntime:false,openedAtLogin:false}),true);
  assert.equal(shouldShowOnLaunch({packaged:true,testRuntime:false,openedAtLogin:true}),false);
  assert.equal(shouldShowOnLaunch({packaged:true,testRuntime:true,openedAtLogin:false}),false);
  assert.equal(shouldShowOnLaunch({packaged:false,testRuntime:false,openedAtLogin:false}),false);
  assert.equal(require('../package.json').build.mac.extendInfo.LSUIElement,false);
});

test('explicit requests only prompt the chosen permission; denial, policy and screen use recovery', async () => {
  let status='not-determined';const calls=[];
  const request=createPermissionRequest({
    isTrustedAccessibilityClient(prompt){if(prompt)calls.push('ax');return false;},
    getMediaAccessStatus:()=>status,
    askForMediaAccess:async kind=>{calls.push(kind);return true;},
  },async kind=>{calls.push('settings:'+kind);return true;},'darwin');
  assert.equal((await request('invalid')).error,'invalid_permission');assert.deepEqual(calls,[]);
  assert.equal((await request('microphone')).status,'granted');assert.deepEqual(calls,['microphone']);
  await request('accessibility');await request('screen-recording');
  assert.deepEqual(calls,['microphone','ax','settings:screen-recording']);
  status='denied';await request('camera');assert.equal(calls.at(-1),'settings:camera');
  status='restricted';assert.equal((await request('microphone')).error,'restricted');
  status='granted';await request('microphone');assert.equal(calls.length,4);
});

test('request errors and overlap recover without losing the retry entry', async () => {
  let resolve;const preferences={isTrustedAccessibilityClient:()=>false,getMediaAccessStatus:()=>'not-determined',askForMediaAccess:()=>new Promise(r=>{resolve=r;})};
  const request=createPermissionRequest(preferences,async()=>false,'darwin');
  const pending=request('microphone');assert.equal((await request('camera')).error,'busy');resolve(false);assert.equal((await pending).status,'denied');
  preferences.askForMediaAccess=()=>{throw Error('system failure');};
  assert.equal((await request('microphone')).error,'request_failed');
  assert.equal((await request('screen-recording')).error,'settings_failed');
});

test('optional, denied and managed permissions do not default to repeated restart', () => {
  const snapshot = { accessibility:'granted', 'screen-recording':'granted', microphone:'granted', camera:'not-determined' };
  assert.doesNotMatch(permissionMessage(snapshot), /重启/);
  assert.match(permissionMessage({ ...snapshot, microphone:'restricted' }), /重启不能解除/);
  assert.match(permissionMessage({ ...snapshot, microphone:'denied' }), /不要反复重启/);
});

test('window failures distinguish timeout, Automation and unexpected errors from permissions', () => {
  assert.equal(windowScanFailure({ killed:true }, 'granted'), 'window_scan_timeout');
  assert.equal(windowScanFailure({ stderr:'Not authorized (-1743)' }, 'granted'), 'automation_permission_required');
  assert.equal(windowScanFailure(Error('bad JSON'), 'unknown'), 'window_scan_failed');
  assert.equal(windowScanFailure(Error('AX'), 'denied'), 'accessibility_permission_required');
});

test('relaunch schedules one graceful quit and never forces exit', () => {
  const calls = [], jobs = [];
  const request = createPermissionRelaunch({ relaunch:()=>calls.push('relaunch'), quit:()=>calls.push('quit'), exit:()=>assert.fail('forced exit') }, (fn)=>jobs.push(fn));
  assert.equal(request(), true); assert.equal(request(), true);
  assert.deepEqual(calls, ['relaunch']); assert.equal(jobs.length, 1);
  jobs[0](); assert.deepEqual(calls, ['relaunch', 'quit']);
});

test('failed relaunch can retry without force quitting', () => {
  let attempts = 0;
  const request = createPermissionRelaunch({ relaunch() { if (++attempts === 1) throw Error('launch'); }, quit() {} }, ()=>{});
  assert.equal(request(), false); assert.equal(request(), true);
});

test('packaging blocks silent ad-hoc fallback and accepts only an explicit valid Developer ID', () => {
  const hash = 'A'.repeat(40), name = 'Developer ID Application: Example (EXAMPLETEAM)';
  const list = () => `1) ${hash} "${name}"\n 1 valid identities found`;
  assert.throws(()=>selectSigningIdentity({}, list), /缺少稳定签名/);
  assert.deepEqual(selectSigningIdentity({ PANEL_ALLOW_ADHOC_SIGNING:'1' }, ()=>assert.fail()), { identity:'-', adhoc:true });
  assert.deepEqual(selectSigningIdentity({ PANEL_DEVELOPER_ID:name }, list), { identity:hash, adhoc:false });
  assert.throws(()=>selectSigningIdentity({ PANEL_DEVELOPER_ID:'missing', PANEL_ALLOW_ADHOC_SIGNING:'1' }, list), /不会退回/);
  assert.throws(()=>selectSigningIdentity({ PANEL_DEVELOPER_ID:hash }, ()=>'0 valid identities found'), /不可用/);
});

test('production gates include passive checks, save-before-restart and packaged permission module', () => {
  const root = path.join(__dirname,'..');
  const main = fs.readFileSync(path.join(root,'main.js'),'utf8');
  const renderer = fs.readFileSync(path.join(root,'renderer/workspace.js'),'utf8');
  assert.doesNotMatch(main, /desktopCapturer|promptForMissingPermissions|detectScreenRecordingStatus/);
  assert.match(renderer, /recordingStarting \|\| recordingStatus !== 'idle' \|\| transcriptionFinishPromise/);
  assert.match(renderer, /await window\.Notebook\?\.flushForExit/);
  assert.match(fs.readFileSync(path.join(root,'renderer/window-switcher.js'),'utf8'), /window_scan_failed/);
  assert.ok(require('../package.json').build.files.includes('main-permissions.js'));
});
