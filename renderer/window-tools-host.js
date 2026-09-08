(() => {
  const root=document.getElementById('window-tools-root'),api=window.notchAPI;if(!root||!api)return;
  window.WindowToolsHome=window.WindowToolsView.mount(root,{...api,settings:pane=>api.openPrivacySettings(pane),restart:()=>window.NotchWorkspace.relaunchForPermissions()},{compact:!api.launcherLayout,manage:()=>window.Notebook.detach('module','windows'),hidden:{get(){try{const v=JSON.parse(localStorage.getItem('notch-hidden-windows')||'[]');return Array.isArray(v)?v.filter(k=>typeof k==='string'):[];}catch{return [];}},set:keys=>localStorage.setItem('notch-hidden-windows',JSON.stringify(keys))}});
})();
