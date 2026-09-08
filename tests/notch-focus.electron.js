const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function main() {
  await app.whenReady();
  const appRoot = process.env.PANEL_APP_ROOT || path.join(__dirname, '..');
  const window = new BrowserWindow({
    width: 200,
    height: 38,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // 使用一次性内存分区，避免上次测试遗留的 LocalStorage/SessionStorage 改变初始 Tab 与展开状态。
    webPreferences: { partition: `todo-panel-test-${process.pid}-${Date.now()}` },
  });
  window.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) console.error('[renderer]', message);
  });

  try {
    await window.loadFile(path.join(appRoot, 'renderer', 'index.html'));
    window.show();
    window.focus();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const focusStyle = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const notch = document.getElementById('notch');
        requestAnimationFrame(() => {
          const notchStyle = getComputedStyle(notch);
          const dotStyle = getComputedStyle(notch.querySelector('.notch-dot'));
          resolve({
            active: document.activeElement === notch,
            focusVisible: notch.matches(':focus-visible'),
            outlineStyle: notchStyle.outlineStyle,
            outlineWidth: notchStyle.outlineWidth,
            dotBoxShadow: dotStyle.boxShadow,
          });
        });
      })
    `);

    assert.equal(focusStyle.active, true, '折叠条应能通过键盘获得焦点');
    assert.equal(focusStyle.focusVisible, true, '键盘焦点应保持可见提示');
    assert.equal(
      focusStyle.outlineStyle,
      'none',
      `折叠外壳不能画焦点描边，当前为 ${focusStyle.outlineWidth} ${focusStyle.outlineStyle}`
    );
    assert.notEqual(focusStyle.dotBoxShadow, 'none', '焦点提示应转移到中间抓握条');

    window.setSize(1240, 616);
    const settingsSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.getElementById('tab-button-settings').click();
        setTimeout(() => {
          const page = document.getElementById('settings-page');
          resolve({
            rightmostTab: document.querySelector('.tab[data-tab]:last-of-type')?.dataset.tab,
            activePanel: document.getElementById('tab-settings')?.classList.contains('active'),
            display: getComputedStyle(page).display,
            columns: getComputedStyle(page).gridTemplateColumns.split(' ').filter(Boolean).length,
            api: Boolean(document.getElementById('settings-api-configure')),
            mirror: Boolean(document.getElementById('settings-mirror-choose')),
            features: document.querySelectorAll('[data-settings-feature]').length,
            shortcut: Boolean(document.getElementById('settings-shortcut-change')),
            workspace: Boolean(document.getElementById('settings-workspace-choose')),
            autoLaunch: Boolean(document.getElementById('settings-auto-launch')),
            permissions: document.querySelectorAll('[data-permission-pane]').length,
            deviceOverflow: getComputedStyle(document.querySelector('.settings-device-card')).overflowY,
            deviceScrollable: document.querySelector('.settings-device-card').scrollHeight > document.querySelector('.settings-device-card').clientHeight,
          });
        }, 620);
      })
    `);

    assert.deepEqual(settingsSurface, {
      rightmostTab: 'settings',
      activePanel: true,
      display: 'grid',
      columns: 2,
      api: true,
      mirror: true,
      features: 8,
      shortcut: true,
      workspace: true,
      autoLaunch: true,
      permissions: 4,
      deviceOverflow: 'auto',
      deviceScrollable: true,
    });

    if (process.env.PANEL_CAPTURE_SETTINGS_PATH) {
      const image = await window.capturePage();
      fs.writeFileSync(process.env.PANEL_CAPTURE_SETTINGS_PATH, image.toPNG());
    }

    const mirrorSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        document.getElementById('tab-button-home').click();
        setTimeout(() => {
          const photo = document.querySelector('.mirror-photo');
          const placeholder = document.getElementById('mirror-gallery-placeholder');
          resolve({
            stageTag: document.getElementById('mirror-stage')?.tagName,
            photoButton: document.getElementById('mirror-photo-action')?.tagName,
            photoSource: photo?.getAttribute('src'),
            photoHidden: photo?.hidden,
            placeholderHidden: placeholder?.hidden,
            position: document.getElementById('mirror-gallery-position')?.textContent,
            previousDisabled: document.getElementById('mirror-previous')?.disabled,
            nextDisabled: document.getElementById('mirror-next')?.disabled,
            cameraSeparate: document.getElementById('mirror-camera')?.parentElement !== document.getElementById('mirror-photo-action'),
          });
        }, 620);
      })
    `);
    assert.deepEqual(mirrorSurface, {
      stageTag: 'DIV',
      photoButton: 'BUTTON',
      photoSource: null,
      photoHidden: true,
      placeholderHidden: false,
      position: '0 / 0',
      previousDisabled: true,
      nextDisabled: true,
      cameraSeparate: true,
    });

    const mirrorControlSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const tile = document.querySelector('.home-mirror');
        const controls = document.querySelector('.mirror-gallery-controls');
        const add = document.getElementById('mirror-add');
        document.getElementById('panel').inert = false;
        document.getElementById('panel').setAttribute('aria-hidden', 'false');
        controls.style.transition = 'none';
        tile.classList.remove('empty-gallery');
        setTimeout(() => {
          const idleOpacity = getComputedStyle(controls).opacity;
          add.focus();
          setTimeout(() => {
          const focusedOpacity = getComputedStyle(controls).opacity;
          const focusedElement = document.activeElement?.id;
          const tileClass = tile.className;
          const result = {
              idleOpacity,
              focusedOpacity,
              focusedElement,
              tileClass,
            };
            document.getElementById('tab-button-home').focus();
            resolve(result);
          }, 220);
        }, 220);
      })
    `);
    assert.deepEqual(mirrorControlSurface, {
      idleOpacity: '0',
      focusedOpacity: '1',
      focusedElement: 'mirror-add',
      tileClass: 'tile home-mirror detach-surface',
    });

    if (process.env.PANEL_CAPTURE_MIRROR_PATH) {
      await window.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const tile = document.querySelector('.home-mirror');
          const photos = [...document.querySelectorAll('.mirror-photo')];
          tile.classList.remove('empty-gallery');
          document.getElementById('mirror-gallery-placeholder').hidden = true;
          document.querySelector('.mirror-gallery-controls').classList.remove('keyboard-active');
          photos.forEach((photo) => {
            photo.hidden = false;
            photo.src = 'assets/generated/music-bg-large.png';
          });
          Promise.all(photos.map((photo) => photo.decode().catch(() => null))).then(() => {
            document.getElementById('tab-button-home').focus();
            setTimeout(resolve, 220);
          });
        })
      `);
      const image = await window.capturePage();
      fs.writeFileSync(process.env.PANEL_CAPTURE_MIRROR_PATH, image.toPNG());
    }

    const aiSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        document.getElementById('tab-button-inbox').click();
        setTimeout(() => {
          const todo = window.NotchDataTools.saveTodo({ title: 'AI 待办测试', category: '日常', dueAt: '2030-01-01T08:00:00.000Z' });
          const note = window.NotchDataTools.saveNote({ title: 'AI 笔记测试', content: '本机确定性写入' });
          const link = window.NotchWorkspaceTools.saveLink({ title: 'OpenAI', url: 'https://openai.com/', category: '开发' });
          resolve({
            activePanel: document.getElementById('tab-inbox').classList.contains('active'),
            input: Boolean(document.getElementById('ai-inbox-input')),
            preview: Boolean(document.getElementById('ai-proposal-form')),
            confirm: document.getElementById('ai-confirm-proposal')?.textContent,
            todo: Boolean(todo?.id),
            note: Boolean(note?.id),
            link: Boolean(link?.id),
          });
        }, 80);
      })
    `);
    assert.deepEqual(aiSurface, {
      activePanel: true,
      input: true,
      preview: true,
      confirm: '确认并写入',
      todo: true,
      note: true,
      link: true,
    });

    await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        document.getElementById('tab-button-settings').click();
        document.getElementById('settings-shortcut-change').click();
        setTimeout(() => {
          const recorder = document.getElementById('shortcut-recorder');
          recorder.focus();
          window.__shortcutTestEvent = null;
          recorder.addEventListener('keydown', (event) => {
            window.__shortcutTestEvent = {
              key: event.key,
              altKey: event.altKey,
              shiftKey: event.shiftKey,
              target: event.target && event.target.id,
            };
          }, { once: true });
          resolve(!document.getElementById('shortcut-recorder-backdrop').hidden);
        }, 700);
      })
    `);
    const shortcutDefault = await window.webContents.executeJavaScript(`({
      candidate: document.getElementById('shortcut-recorder-value').textContent.trim(),
      canStart: !document.getElementById('shortcut-recorder-start').disabled,
      status: document.getElementById('shortcut-recorder-status').dataset.state,
    })`);
    assert.deepEqual(shortcutDefault, {
      candidate: 'Option + Shift + 空格键',
      canStart: true,
      status: 'ready',
    });

    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space', modifiers: ['alt', 'shift'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space', modifiers: ['alt', 'shift'] });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const shortcutSetup = await window.webContents.executeJavaScript(`({
      visible: !document.getElementById('shortcut-recorder-backdrop').hidden,
      dialog: document.getElementById('shortcut-recorder').getAttribute('role'),
      title: document.getElementById('shortcut-recorder-title').textContent.trim(),
      candidate: document.getElementById('shortcut-recorder-value').textContent.trim(),
      canStart: !document.getElementById('shortcut-recorder-start').disabled,
      status: document.getElementById('shortcut-recorder-status').dataset.state,
      received: window.__shortcutTestEvent,
    })`);

    assert.deepEqual(shortcutSetup, {
      visible: true,
      dialog: 'dialog',
      title: '选一组你顺手的按键',
      candidate: 'Option + Shift + 空格键',
      canStart: true,
      status: 'ready',
      received: { key: ' ', altKey: true, shiftKey: true, target: 'shortcut-recorder' },
    });

    if (process.env.PANEL_CAPTURE_PATH) {
      const image = await window.capturePage();
      fs.writeFileSync(process.env.PANEL_CAPTURE_PATH, image.toPNG());
    }

    await window.webContents.executeJavaScript(`document.getElementById('shortcut-recorder-cancel').click()`);
    await window.reload();
    await new Promise((resolve) => setTimeout(resolve, 120));

    const numberNavigation = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (!document.getElementById('app').classList.contains('expanded')) {
          document.getElementById('notch').click();
        }
        setTimeout(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
          setTimeout(() => {
            const afterNumber = document.getElementById('tab-notes').classList.contains('active');
            const input = document.getElementById('notes-search');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
            setTimeout(() => resolve({
              afterNumber,
              typingDidNotNavigate: document.getElementById('tab-notes').classList.contains('active'),
              panelTransform: getComputedStyle(document.getElementById('panel'), '::before').transform,
              panelBackdropFilter: getComputedStyle(document.getElementById('panel'), '::before').backdropFilter,
            }), 20);
          }, 20);
        }, 320);
      })
    `);

    assert.equal(numberNavigation.afterNumber, true, '数字 3 应切到笔记');
    assert.equal(numberNavigation.typingDidNotNavigate, true, '输入框聚焦后数字不应切 Tab');
    assert.equal(numberNavigation.panelBackdropFilter, 'none', '大面积面板不应持续背景模糊');

    const todoCalendarNavigation = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        document.getElementById('tab-button-todo').click();
        const trigger = document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]');
        trigger.click();
        const previous = document.getElementById('todo-calendar-previous');
        const next = document.getElementById('todo-calendar-next');
        if (!previous || !next) {
          resolve({ controls: false });
          return;
        }
        const base = new Date();
        const popover = document.getElementById('todo-date-popover');
        const previousRect = previous.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        const clicksToJanuary = 12 - base.getMonth();
        for (let index = 0; index < clicksToJanuary; index += 1) next.click();
        const expectedYear = base.getFullYear() + 1;
        const januaryLabel = document.getElementById('todo-editor-month').textContent.trim();
        const day = [...document.querySelectorAll('#todo-calendar-grid [data-day]')]
          .find((button) => button.dataset.day === '2');
        day.click();
        const selected = new Date(trigger.dataset.deadline);
        previous.click();
        resolve({
          controls: true,
          popoverVisible: !popover.hidden && getComputedStyle(popover).display !== 'none',
          controlsUsable: [previousRect.width, previousRect.height, nextRect.width, nextRect.height]
            .every((size) => size >= 18),
          januaryLabel,
          decemberLabel: document.getElementById('todo-editor-month').textContent.trim(),
          selected: [selected.getFullYear(), selected.getMonth(), selected.getDate()],
          expectedYear,
        });
      })
    `);

    assert.deepEqual(todoCalendarNavigation, {
      controls: true,
      popoverVisible: true,
      controlsUsable: true,
      januaryLabel: `${new Date().getFullYear() + 1}年 1月`,
      decemberLabel: `${new Date().getFullYear()}年 12月`,
      selected: [new Date().getFullYear() + 1, 0, 2],
      expectedYear: new Date().getFullYear() + 1,
    });
  } finally {
    window.destroy();
  }
}

main().then(
  () => app.quit(),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);
