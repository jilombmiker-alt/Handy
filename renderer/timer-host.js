(() => {
  const api=window.notchAPI,root=document.getElementById('home-timer-body');if(!root||!api?.timerGet)return;
  window.TimerHome=window.SimpleTimer.mount(root,{get:api.timerGet,command:api.timerCommand},{compact:!api.launcherLayout,open:()=>window.Notebook?.detach('module','pomodoro')});
})();
