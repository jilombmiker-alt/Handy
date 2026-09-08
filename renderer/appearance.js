/* Apply before CSS paints; only these two preferences are owned here. */
(() => {
  'use strict';
  const THEME_KEY = 'notch-appearance-v1';
  const LAYOUT_KEY = 'notch-home-presentation-v1';
  const read = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const root = document.documentElement;
  root.dataset.theme = read(THEME_KEY, 'white') === 'obsidian' ? 'obsidian' : 'white';
  root.dataset.homeLayout = read(LAYOUT_KEY, 'calm') === 'custom' ? 'custom' : 'calm';
  function sync() {
    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === root.dataset.theme));
    });
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(root.dataset.theme === 'obsidian'));
      toggle.setAttribute('aria-label', root.dataset.theme === 'white' ? '切换到黑曜石主题' : '切换到纯白主题');
      toggle.title = toggle.getAttribute('aria-label');
    }
    const layout = document.getElementById('appearance-layout');
    if (layout) layout.value = root.dataset.homeLayout;
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); }
    catch {
      const status = document.getElementById('appearance-status');
      if (status) status.textContent = '已在本次会话生效；本机存储不可用，重启后需重新选择。';
      if (typeof showStatusToast === 'function') showStatusToast('主题已切换，但无法保存，下次启动需重新选择');
    }
  }
  function setTheme(theme) {
    if (!['white', 'obsidian'].includes(theme)) return;
    root.dataset.theme = theme;
    save(THEME_KEY, theme);
    sync();
  }
  function setLayout(layout) {
    if (!['calm', 'custom'].includes(layout)) return;
    root.dataset.homeLayout = layout;
    save(LAYOUT_KEY, layout);
    sync();
  }
  window.PanelAppearance = Object.freeze({ setTheme, setLayout });
  document.addEventListener('DOMContentLoaded', () => {
    sync();
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      setTheme(root.dataset.theme === 'white' ? 'obsidian' : 'white');
    });
    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
    });
    document.getElementById('appearance-layout')?.addEventListener('change', (event) => setLayout(event.target.value));
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) root.dataset.theme = event.newValue === 'obsidian' ? 'obsidian' : 'white';
    if (event.key === LAYOUT_KEY) root.dataset.homeLayout = event.newValue === 'custom' ? 'custom' : 'calm';
    sync();
  });
})();
