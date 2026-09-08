const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');

const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-panel-main-ai-'));
process.env.PANEL_TEST_MODE = '1';
process.env.PANEL_TEST_USER_DATA_PATH = testUserData;
delete process.env.NOTCH_LLM_API_KEY;

require('../main');

function waitForMainWindow(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const windows = BrowserWindow.getAllWindows();
      const window = windows.find((candidate) => (
        !candidate.isDestroyed() && candidate.webContents.getURL().includes('/renderer/index.html')
      ));
      if (window) return resolve(window);
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('main_window_timeout'));
      setTimeout(check, 40);
    };
    check();
  });
}

async function main() {
  await app.whenReady();
  const window = await waitForMainWindow();
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const startedAt = Date.now();
      while (!window.notchAPI) {
        if (Date.now() - startedAt > 8000) throw new Error('preload_bridge_timeout');
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const events = [];
      const unsubscribe = window.notchAPI.onAiRunChanged((run) => events.push(run.status));
      const created = await window.notchAPI.aiCreateProposal({ text: '测试未配置模型时的安全失败' });
      const listed = await window.notchAPI.aiListRuns(5);
      const fetched = created.run ? await window.notchAPI.aiGetRun(created.run.id) : null;
      const gallery = await window.notchAPI.getMirrorGallery();
      const missingImage = await window.notchAPI.getMirrorImage('11111111-1111-4111-8111-111111111111');
      unsubscribe();
      return {
        bridge: {
          create: typeof window.notchAPI.aiCreateProposal,
          list: typeof window.notchAPI.aiListRuns,
          subscribe: typeof window.notchAPI.onAiRunChanged,
        },
        nodeAccess: typeof window.require,
        created,
        listed,
        fetched,
        gallery,
        missingImage,
        events,
      };
    })()
  `);

  assert.deepEqual(result.bridge, { create: 'function', list: 'function', subscribe: 'function' });
  assert.equal(result.nodeAccess, 'undefined');
  assert.equal(result.created.ok, true);
  assert.equal(result.created.run.status, 'failed');
  assert.equal(result.created.run.errorCode, 'ai_not_configured');
  assert.equal(result.listed.ok, true);
  assert.equal(result.listed.runs.length, 1);
  assert.equal(result.fetched.run.id, result.created.run.id);
  assert.deepEqual(result.events, ['submitting', 'running', 'failed']);
  assert.deepEqual(result.gallery, { version: 1, activeId: '', items: [], maxItems: 12 });
  assert.equal(result.missingImage, null);

  const configSave = await window.webContents.executeJavaScript(`
    (async () => {
      const key = document.getElementById('llm-api-key');
      const baseUrl = document.getElementById('llm-base-url');
      const model = document.getElementById('llm-model');
      const note = document.getElementById('transcription-settings-note');
      const save = document.getElementById('transcription-settings-save');
      document.getElementById('transcription-settings-backdrop').hidden = false;
      key.value = 'sk-local-regression-only';
      baseUrl.value = 'https://api.deepseek.com';
      model.value = 'deepseek-v4-flash';
      save.click();
      const startedAt = Date.now();
      while ((save.disabled || note.textContent.includes('正在')) && Date.now() - startedAt < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return {
        note: note.textContent,
        noteClass: note.className,
        saveDisabled: save.disabled,
        keyCleared: key.value === '',
        config: await window.notchAPI.getTranscriptionConfig(),
      };
    })()
  `);
  assert.equal(configSave.note.includes('已安全保存'), true);
  assert.equal(configSave.noteClass.includes('success'), true);
  assert.equal(configSave.saveDisabled, false);
  assert.equal(configSave.keyCleared, true);
  assert.equal(configSave.config.llmConfigured, true);
  assert.equal(configSave.config.llmBaseUrl, 'https://api.deepseek.com');
  assert.equal(configSave.config.llmModel, 'deepseek-v4-flash');
  const storedSettings = fs.readFileSync(path.join(testUserData, 'transcription-settings.json'), 'utf8');
  assert.equal(storedSettings.includes('sk-local-regression-only'), false);

  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const sourceImage = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'app-logo-128.png'));
  assert.equal(sourceImage.isEmpty(), false);
  const jpeg = sourceImage.toJPEG(88);
  fs.writeFileSync(path.join(testUserData, 'mirror-cover.jpg'), jpeg);
  const migrated = await window.webContents.executeJavaScript(`window.notchAPI.getMirrorGallery()`);
  assert.equal(migrated.items.length, 1);
  assert.equal(migrated.activeId, migrated.items[0].id);
  assert.equal(fs.existsSync(path.join(testUserData, 'mirror-cover.jpg')), false);
  assert.equal(fs.existsSync(path.join(testUserData, 'mirror-images', `mirror-${migrated.activeId}.jpg`)), true);

  const imageDirectory = path.join(testUserData, 'mirror-images');
  fs.mkdirSync(imageDirectory, { recursive: true });
  fs.writeFileSync(path.join(imageDirectory, `mirror-${firstId}.jpg`), jpeg);
  fs.writeFileSync(path.join(imageDirectory, `mirror-${secondId}.jpg`), jpeg);
  fs.writeFileSync(path.join(testUserData, 'mirror-gallery.json'), JSON.stringify({
    version: 1,
    activeId: firstId,
    items: [
      { id: firstId, fileName: `mirror-${firstId}.jpg`, createdAt: 1 },
      { id: secondId, fileName: `mirror-${secondId}.jpg`, createdAt: 2 },
    ],
  }));

  const galleryLoop = await window.webContents.executeJavaScript(`
    (async () => {
      await window.NotchMirrorGallery.refresh();
      const first = window.NotchMirrorGallery.getState();
      await window.NotchMirrorGallery.next();
      const second = window.NotchMirrorGallery.getState();
      await window.NotchMirrorGallery.next();
      const looped = window.NotchMirrorGallery.getState();
      return {
        firstId: first.gallery.activeId,
        firstCount: first.gallery.items.length,
        firstHasImage: first.dataUrl.startsWith('data:image/'),
        secondId: second.gallery.activeId,
        loopedId: looped.gallery.activeId,
        position: document.getElementById('mirror-gallery-position')?.textContent,
      };
    })()
  `);
  assert.deepEqual(galleryLoop, {
    firstId,
    firstCount: 2,
    firstHasImage: true,
    secondId,
    loopedId: firstId,
    position: '1 / 2',
  });

  const stored = fs.readFileSync(path.join(testUserData, 'ai-runs.json'), 'utf8');
  assert.equal(stored.includes('测试未配置模型时的安全失败'), true);
  assert.equal(/(?:apiKey|Authorization|Bearer\s)/i.test(stored), false);
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
  });

app.once('quit', () => {
  try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch (error) {}
});
