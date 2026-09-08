const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
});

test('home scratch note keeps only the save action', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(html, /id="home-microphone-recovery"/);
  assert.match(html, /id="recording-microphone-recovery"/);
  assert.match(html, /data-microphone-open/);
  assert.match(html, /data-microphone-retry/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('plain Space is never registered globally and panel numbers route only after opening', () => {
  assert.doesNotMatch(mainJs, /globalShortcut\.register\(['"]Space['"]/);
  assert.doesNotMatch(mainJs, /shortcut:hover-space-status/);
  assert.match(appJs, /const PANEL_NUMBER_TABS = \{/);
  assert.match(appJs, /9: 'inbox'/);
  assert.match(appJs, /if \(!isExpanded \|\| event\.repeat \|\| event\.isComposing\) return/);
  assert.match(appJs, /closest\('input, textarea, select/);
});

test('shortcut setup requires an availability check, a real trigger, and explicit confirmation', () => {
  assert.match(html, /id="shortcut-recorder-backdrop"/);
  assert.match(html, /id="shortcut-recorder-start"/);
  assert.match(html, /id="shortcut-recorder-confirm"/);
  assert.match(html, /可选择左 Option \+ 左 Command/);
  assert.match(html, /F1–F24 功能键/);
  assert.match(html, /全局裸字母、数字和空格会抢走打字，不可使用/);
  assert.match(mainJs, /settings:begin-shortcut-test/);
  assert.match(mainJs, /shortcut:test-triggered/);
  assert.match(mainJs, /settings:confirm-shortcut-test/);
  assert.match(mainJs, /restoreShortcutAfterTest/);
  assert.match(appJs, /面板已成功唤回/);
  assert.match(appJs, /DEFAULT_SHORTCUT_TEST_CANDIDATE = 'Alt\+Shift\+Space'/);
  assert.match(appJs, /shortcutRecorderStart\.disabled = false/);
  assert.match(html, /原应用有没有误动作/);
});

test('permission recovery exposes status, settings, recheck, and full relaunch without resetting TCC', () => {
  assert.match(html, /id="settings-permission-refresh"/);
  assert.match(html, /id="settings-permission-relaunch"/);
  assert.match(html, /data-permission-pane="screen-recording"/);
  assert.match(preloadJs, /getPermissionStatuses/);
  assert.match(preloadJs, /relaunchApp/);
  assert.match(mainJs, /permissions:get-status/);
  assert.match(mainJs, /app:relaunch/);
  assert.match(mainJs, /readPermissionSnapshot/);
  assert.doesNotMatch(mainJs, /desktopCapturer\.getSources|promptForMissingPermissions/);
  assert.doesNotMatch(mainJs, /tccutil\s+reset/);
});

test('collapsed panel lives only in the macOS menu bar and cannot cover app content', () => {
  const applyModeBlock = mainJs.match(/function applyMode\(mode, display\) \{[\s\S]*?\n\}/)?.[0] || '';
  const readyBlock = mainJs.match(/mainWindow\.once\('ready-to-show',[\s\S]*?\n  \}\);/)?.[0] || '';
  const trayBlock = mainJs.match(/function createTray\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(applyModeBlock, /mainWindow\.setOpacity\(0\)/);
  assert.match(applyModeBlock, /mainWindow\.hide\(\)/);
  assert.doesNotMatch(readyBlock, /mainWindow\.show\(\)/);
  assert.doesNotMatch(trayBlock, /mainWindow\.show\(\)/);
  assert.match(mainJs, /label: '打开Handy'/);
  assert.match(mainJs, /openRendererPanel\('shortcut:toggle-panel'\)/);
  assert.match(mainJs, /mainWindow\.setOpacity\(0\);[\s\S]*?mainWindow\.show\(\)/);
});

test('panel motion avoids full-surface clip-path and continuous border repaint', () => {
  const panelBlock = styles.match(/\.panel \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(panelBlock, /clip-path/);
  assert.doesNotMatch(styles, /bento-border-breathe/);
  assert.match(styles, /#app\.expanded \.panel::before[\s\S]*?transform: scale\(1\)/);
});

test('home WebGL effects pause outside the visible expanded home surface and keep one frame loop', () => {
  assert.match(effectsJs, /function syncActivity\(\)/);
  assert.match(effectsJs, /if \(!isActive\(\)\) return/);
  assert.match(effectsJs, /document\.addEventListener\('notch:modechange', syncActivity\)/);
  assert.match(effectsJs, /document\.addEventListener\('notch:tabchange', syncActivity\)/);
  const restartBlock = effectsJs.match(/const restart = \(\) => \{[\s\S]*?\n    \};/)?.[0] || '';
  assert.match(restartBlock, /draw\(start, true\)/);
  assert.equal((restartBlock.match(/requestAnimationFrame\(draw\)/g) || []).length, 0);
  assert.match(effectsJs, /const resizeObserver = new ResizeObserver\(\(\) => \{\s*if \(isActive\(\)\) syncActivity\(\);/);
  assert.match(effectsJs, /redraw: syncActivity/);
  assert.doesNotMatch(effectsJs, /requestAnimationFrame\(\(\) => draw/);
});

test('clipboard history migrates hashes and exposes a compact repeat badge', () => {
  assert.match(mainJs, /clipboard:normalize-history/);
  assert.match(appJs, /compactStoredClipHistory/);
  assert.match(appJs, /class="clip-repeat"/);
});

test('home mirror has no bundled default and exposes a manual looping gallery separate from camera', () => {
  assert.doesNotMatch(html, /mirror-portrait\.jpg/);
  assert.match(html, /id="mirror-photo-action"/);
  assert.match(html, /id="mirror-previous"/);
  assert.match(html, /id="mirror-next"/);
  assert.match(html, /id="mirror-add"/);
  assert.match(html, /id="mirror-camera"/);
  assert.match(html, /class="mirror-gallery-hotzone"/);
  assert.match(styles, /home-mirror:not\(\.empty-gallery\) \.mirror-gallery-controls[\s\S]*?opacity: 0/);
  assert.match(styles, /mirror-gallery-controls:focus-within/);
  assert.match(styles, /home-mirror > \.widget-size-control:focus-visible/);
  assert.match(html, /id="settings-mirror-remove"/);
  assert.match(appJs, /const nextIndex = \(current \+ \(direction < 0 \? -1 : 1\) \+ count\) % count/);
  assert.match(mainJs, /properties: \['openFile', 'multiSelections'\]/);
  assert.match(mainJs, /ipcMain\.handle\('mirror:replace-image'/);
  assert.match(appJs, /mirrorPhotoAction\?\.addEventListener\('click', \(\) => \{ void replaceActiveMirrorImage\(\); \}\)/);
  assert.match(mainJs, /shell\.trashItem\(mirrorGalleryItemPath/);
  assert.match(mainJs, /\[RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME, MIRROR_IMAGES_DIR_NAME\]/);
  assert.match(mainJs, /\[WORKSPACE_DATA_FILE, AI_RUNS_FILE, MIRROR_GALLERY_FILE, MIRROR_LEGACY_IMAGE_FILE\]/);
  assert.doesNotMatch(appJs, /setInterval\([^\n]*mirror/i);
});

test('API settings save through a form with recoverable secure-storage feedback', () => {
  assert.match(html, /<form class="transcription-settings-card" id="transcription-settings-form"/);
  assert.match(html, /id="transcription-settings-note" role="status" aria-live="polite"/);
  assert.match(html, /id="transcription-settings-save" type="submit"/);
  assert.match(workspaceJs, /Promise\.race\(\[saveRequest, timeout\]\)/);
  assert.match(workspaceJs, /error: 'save_timeout'/);
  assert.match(workspaceJs, /密钥未能安全写入或读回/);
  assert.match(mainJs, /error: 'secure_storage_failed'/);
  assert.match(mainJs, /error: 'secure_storage_verify_failed'/);
  assert.match(mainJs, /writeJsonFile\(settingsPath, next\)/);
});
