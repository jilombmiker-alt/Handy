const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, frame: false,
    webPreferences: { backgroundThrottling: false, partition: `appearance-test-${process.pid}-${Date.now()}` } });
  const errors = [];
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); });
  const run = (source) => win.webContents.executeJavaScript(source);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 650));
  const capture = async (name) => {
    if (process.env.PANEL_THEME_CAPTURE_DIR) {
      fs.mkdirSync(process.env.PANEL_THEME_CAPTURE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.PANEL_THEME_CAPTURE_DIR, name + '.png'), (await win.capturePage()).toPNG());
    }
  };
  try {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    await run(`document.getElementById('notch').click()`);
    await pause();
    assert.equal(await run(`document.documentElement.dataset.theme`), 'white');
    assert.equal(await run(`document.documentElement.dataset.homeLayout`), 'calm');
    await run(`localStorage.setItem('appearance-test-business-data', 'untouched'); document.getElementById('home-note').value = '主题切换不应丢失未保存文字';`);
    for (const theme of ['white', 'obsidian']) {
      await run(`window.PanelAppearance.setTheme('${theme}')`);
      await pause();
      const home = await run(`(() => {
        const q = (s) => document.querySelector(s);
        const r = q('.home-mirror').getBoundingClientRect();
        return { theme: document.documentElement.dataset.theme, square: Math.abs(r.width-r.height)<2,
          canvasHidden: getComputedStyle(q('.module-effect-canvas')).display === 'none',
          controls: q('#record-start').getBoundingClientRect().width >= 28,
          note: q('#home-note').value, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          background: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() };
      })()`);
      assert.equal(home.theme, theme);
      assert.equal(home.square, true, JSON.stringify(home));
      assert.equal(home.canvasHidden, true);
      assert.equal(home.controls, true);
      assert.equal(home.note, '主题切换不应丢失未保存文字');
      assert.equal(home.horizontalOverflow, false);
      assert.equal(home.background, theme === 'white' ? '#fff' : '#151618');
      assert.equal(await run(`(()=>{const s=getComputedStyle(document.querySelector('.panel'));return s.borderTopLeftRadius===s.borderBottomLeftRadius&&s.borderTopRightRadius===s.borderBottomRightRadius&&parseFloat(s.borderTopLeftRadius)>0;})()`),true,'All four panel corners must be rounded equally');
      assert.equal(await run(`getComputedStyle(document.querySelector('.panel'), '::before').backgroundImage`), 'none');
      assert.equal(await run(`getComputedStyle(document.getElementById('home-recorder')).borderLeftWidth`), '1px');
      assert.equal(await run(`getComputedStyle(document.getElementById('home-pomodoro')).borderLeftWidth`), '1px');
      await capture(theme + '-home');
      for (const page of ['settings', 'todo', 'notes', 'links', 'recordings', 'credentials', 'inbox']) {
        await run(`document.querySelector('[data-tab="${page}"]').click()`);
        await pause();
        assert.equal(await run(`document.querySelector('#tab-${page}').classList.contains('active')`), true);
        await capture(theme + '-' + page);
      }
      await run(`document.querySelector('[data-tab="home"]').click()`);
    }
    await run(`document.getElementById('theme-toggle').click()`);
    assert.equal(await run(`document.documentElement.dataset.theme`), 'white');
    await run(`document.querySelector('[data-tab="settings"]').click(); document.querySelector('[data-theme-choice="obsidian"]').click()`);
    assert.equal(await run(`document.querySelector('[data-theme-choice="obsidian"]').getAttribute('aria-pressed')`), 'true');
    assert.equal(await run(`localStorage.getItem('appearance-test-business-data')`), 'untouched');
    await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.reload(); });
    await pause();
    assert.equal(await run(`document.documentElement.dataset.theme`), 'obsidian');
    await run(`document.getElementById('notch').click(); document.querySelector('[data-tab="home"]').click()`);
    await pause();
    assert.equal(await run(`document.documentElement.dataset.homeLayout`), 'calm');
    assert.equal(await run(`document.getElementById('home-music').dataset.musicForm`), 'cover');
    await run(`window.PanelAppearance.setLayout('calm')`);
    await run(`window.resetPanelLayout()`);
    assert.equal(await run(`localStorage.getItem('appearance-test-business-data')`),'untouched','Layout reset must preserve business data');
    assert.equal(await run(`JSON.parse(localStorage.getItem('notch-home-widget-sizes-v2')).music`),'medium');
    assert.equal(await run(`localStorage.getItem('notch-home-presentation-v1')`), 'calm');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
    await run(`document.getElementById('theme-toggle').focus()`);
    assert.equal(await run(`document.activeElement.id`), 'theme-toggle');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await pause();
    assert.equal(await run(`document.documentElement.dataset.theme`), 'white');
    await run(`window.PanelAppearance.setTheme('obsidian')`);
    win.setSize(980, 600);
    await pause();
    await capture('obsidian-home-980');
    assert.equal(await run(`document.getElementById('theme-toggle').getBoundingClientRect().right <= innerWidth`), true);
    assert.deepEqual(errors, []);
    console.log('Appearance: both themes, all pages, persistence, draft preservation, custom layout and narrow viewport passed.');
  } finally { win.destroy(); app.quit(); }
}
main().catch((error) => { console.error(error); app.exit(1); });
