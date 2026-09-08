(() => {
  const api=window.notchAPI,root=document.querySelector('.home-commands');if(!api||!root)return;
  const old=[...root.children].filter(e=>!e.classList.contains('panel-detach-handle'));old.forEach(e=>e.hidden=true);
  const mount=document.createElement('div');mount.className='mp-home-root';root.prepend(mount);
  async function start(){
    const s=await api.packsGet();if(s.ok&&!s.migrated){let items;try{items=JSON.parse(localStorage.getItem('notch-home-commands')||'[]');}catch{mount.textContent='旧指令读取失败，未迁移或覆盖。';return;}
      const r=await api.packsCommand({action:'migrate',revision:s.revision,items});if(!r.ok){mount.textContent='旧指令迁移失败，原内容仍保留。重新展开后可重试。';return;}}
    window.MaterialPacksHome=window.MaterialPacks.mount(mount,api,{compact:!api.launcherLayout});
  }
  const credentialRoot=document.querySelector('.credentials-page');
  if(credentialRoot){[...credentialRoot.children].forEach(e=>e.hidden=true);const card=document.createElement('section');card.className='credential-cards-root';credentialRoot.prepend(card);window.CredentialCardsHome=window.CredentialCard.mount(card,api);}
  void start().catch(()=>{mount.textContent='资料包读取失败，请重启应用后重试。';});
})();
