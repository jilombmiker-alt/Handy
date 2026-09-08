const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../renderer/appearance.js'), 'utf8');
function boot(entries = {}, unavailable = false) {
  const data = new Map(Object.entries(entries));
  const root = { dataset: {} };
  const status = { textContent: '' };
  const context = { document: { documentElement: root, querySelectorAll: () => [],
    getElementById: (id) => id === 'appearance-status' ? status : null, addEventListener() {} },
    localStorage: { getItem: (k) => { if (unavailable) throw Error('unavailable'); return data.get(k); },
      setItem: (k, v) => { if (unavailable) throw Error('unavailable'); data.set(k, v); } },
    window: { addEventListener() {} } };
  vm.runInNewContext(source, context);
  return { root, data, status, api: context.window.PanelAppearance };
}
test('appearance defaults to white and calm without writing business storage', () => {
  const { root, data } = boot({ 'notch-todo-data': 'keep' });
  assert.equal(root.dataset.theme, 'white'); assert.equal(root.dataset.homeLayout, 'calm');
  assert.equal(data.size, 1);
});
test('appearance restores only recognized preferences', () => {
  assert.equal(boot({ 'notch-appearance-v1': 'obsidian' }).root.dataset.theme, 'obsidian');
  const { root } = boot({ 'notch-appearance-v1': '<invalid>', 'notch-home-presentation-v1': 'bad' });
  assert.equal(root.dataset.theme, 'white'); assert.equal(root.dataset.homeLayout, 'calm');
});
test('theme changes persist without changing existing business or custom-layout data', () => {
  const { api, data } = boot({ 'notch-todo-data': 'keep', 'notch-home-order-v3': 'old order' });
  api.setTheme('obsidian'); api.setLayout('custom'); api.setTheme('invalid');
  assert.equal(data.get('notch-appearance-v1'), 'obsidian');
  assert.equal(data.get('notch-home-presentation-v1'), 'custom');
  assert.equal(data.get('notch-todo-data'), 'keep'); assert.equal(data.get('notch-home-order-v3'), 'old order');
});
test('unavailable storage still permits switching and reports session-only recovery', () => {
  const { api, root, status } = boot({}, true);
  api.setTheme('obsidian');
  assert.equal(root.dataset.theme, 'obsidian'); assert.match(status.textContent, /本次会话/);
});
