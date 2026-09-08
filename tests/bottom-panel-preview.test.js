'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../docs/prototypes/bottom-panel/model');
test('preview has eight stable direct tool routes', () => {
  assert.equal(M.tools.length, 8);
  for (const t of M.tools) assert.equal(M.shortcut({ key: t.key }, false), t.id);
  assert.equal(new Set(M.tools.map(t => t.id)).size, 8);
});
test('editing, IME, modifier combinations and held keys do not trigger tools', () => {
  for (const key of ['1', '8', ' ']) {
    assert.equal(M.shortcut({ key }, true), null);
    for (const flag of ['isComposing', 'repeat', 'metaKey', 'ctrlKey', 'altKey', 'shiftKey']) assert.equal(M.shortcut({ key, [flag]: true }, false), null);
  }
  assert.equal(M.shortcut({ key: 'Escape' }, true), 'hide');
  assert.equal(M.shortcut({ key: 'Escape', isComposing: true }, true), null);
});
test('notes retain draft between modes, require content, and finish independently', () => {
  const s = M.createState(); assert.equal(M.saveNote(s), false);
  s.draft = '第一条 123'; s.mode = 'panel'; s.tool = 'timer'; s.opened = false;
  assert.equal(s.draft, '第一条 123'); assert.equal(M.saveNote(s), true); assert.equal(s.draft, '');
  s.draft = '第二条'; M.saveNote(s); assert.deepEqual(s.notes, ['第二条', '第一条 123']);
});
test('timer and recorder keep running across hidden panel, pause and resume accurately', () => {
  const s = M.createState(); M.start(s.timer, 1000); s.opened = false;
  assert.equal(M.elapsed(s.timer, 5000), 4000); M.pause(s.timer, 6000);
  assert.equal(M.elapsed(s.timer, 9000), 5000); M.start(s.timer, 10000); M.start(s.timer, 11000);
  assert.equal(M.elapsed(s.timer, 12000), 7000);
  assert.equal(s.todos[0].done, false);
  M.start(s.record, 12000); assert.equal(M.elapsed(s.record, 14000), 2000);
});
test('todo adds once, preserves existing completion, and rejects blank text', () => {
  const s = M.createState(); assert.equal(M.addTodo(s), false);
  s.todoDraft = ' 新任务 '; assert.equal(M.addTodo(s), true); assert.equal(M.addTodo(s), false);
  assert.equal(s.todos[0].text, '新任务'); assert.equal(s.todos[3].done, true);
});
test('prototype cannot call live device, clipboard, network, or app bridge', () => {
  const base = path.join(__dirname, '../docs/prototypes/bottom-panel');
  const source = fs.readFileSync(path.join(base, 'preview.js'), 'utf8');
  assert.doesNotMatch(source, /getUserMedia|navigator\.clipboard|window\.open\(|fetch\(|XMLHttpRequest|localStorage|sessionStorage|electronAPI|ipcRenderer/);
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  assert.match(html, /connect-src 'none'/); assert.match(html, /media-src 'none'/);
  assert.equal((html.match(/id="surface"/g) || []).length, 1);
});
