(() => {
  'use strict';
  const api=window.notchAPI,root=document.getElementById('daily-planner'),legacy=document.querySelector('#tab-todo>.sections');
  if(!api?.plannerGet){root.hidden=true;root.previousElementSibling.hidden=true;return;}
  const view=window.PlannerView.mount(root,api,{float:()=>window.Notebook.detach('module','todo'),review:()=>window.Notebook.openQuick(),source:id=>window.IdeaPlanNavigation.source(id),legacy:()=>show(false)});
  let daily=true;
  function show(value){daily=value;root.hidden=!value;legacy.hidden=value;root.previousElementSibling.hidden=value;document.getElementById('show-daily-planner').textContent='返回今天';document.getElementById('show-legacy-todos').textContent='以前的分类清单';document.getElementById('show-daily-planner').setAttribute('aria-pressed',String(value));document.getElementById('show-legacy-todos').setAttribute('aria-pressed',String(!value));}
  document.getElementById('show-daily-planner').onclick=()=>show(true);document.getElementById('show-legacy-todos').onclick=()=>show(false);show(true);
  api.onPlannerOpen(async()=>{await setMode(true);await setActiveTab('todo');show(true);});
  window.addEventListener('beforeunload',event=>{if(window.PlannerUnsaved){event.preventDefault();event.returnValue=false;}});
  window.PanelPlanner={view,show,get daily(){return daily;}};
})();
