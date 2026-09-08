window.detachPreview.onState((state) => {
  document.documentElement.dataset.theme = state.theme === 'obsidian' ? 'obsidian' : 'white';
  document.getElementById('kind').textContent = ({ note: '笔记', quick: '随手记', recorder: '录音控制条' })[state.kind] || '悬浮模块';
  document.getElementById('hint').textContent = state.outside ? '松手悬浮 · Esc 取消' : '拖出面板后松手 · Esc 取消';
});
