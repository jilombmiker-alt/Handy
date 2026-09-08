window.quickReviewAPI.onContent(({count,theme,mode})=>{
  document.documentElement.dataset.theme=theme==='obsidian'?'obsidian':'white';
  document.getElementById('review-title').textContent=mode==='weekly'?`本周有 ${count} 个想法值得回看`:`有 ${count} 条随手记还没确认`;
  document.getElementById('review-copy').textContent=mode==='weekly'?'还不完整也没关系。周末或下周想试试哪个？':'内容已在本机，不急着整理完。';
});
window.quickReviewAPI.onError(()=>{document.getElementById('review-copy').textContent='设置未保存，请重试；记录不会丢失。';});
document.addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(action)window.quickReviewAPI.action(action);});
