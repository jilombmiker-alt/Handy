(() => {
  'use strict';
  const api=window.notchAPI;
  window.IdeaPlans=window.IdeaPlanModel.controller({
    getRecord:id=>window.QuickRecords.snapshot().state.records.find(r=>r.id===id),
    getPlanner:()=>api.plannerGet(),applyPlanner:command=>api.plannerCommand(command),
  });
  window.IdeaPlanNavigation={
    async source(itemId){
      const result=await api.plannerGet();if(!result?.ok)return result;
      const item=result.state.items.find(r=>r.id===itemId);
      if(!item?.sourceIdea)return {ok:false,error:'not_found'};
      return window.Notebook.openQuick({recordId:item.sourceIdea.id});
    },
    async open(recordId){
      const result=await api.plannerGet();if(!result?.ok)return result;
      const item=result.state.items.find(r=>r.sourceIdea?.id===recordId);
      if(!item)return {ok:false,error:'not_found'};
      await window.PanelPlanner.view.flush();
      await setMode(true);await setActiveTab('todo');window.PanelPlanner.show(true);
      return window.PanelPlanner.view.reveal(item.id);
    },
  };
})();
