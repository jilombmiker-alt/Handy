(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PanelModuleCatalog=value;})(typeof globalThis==='object'?globalThis:this,()=>Object.freeze({
  todo:{label:'待办',selector:'#tab-todo .sections'}, links:{label:'链接',selector:'#tab-links .links-page'},
  commands:{label:'快捷资料包',selector:'.home-commands'}, windows:{label:'当前窗口',selector:'.home-windows'},
  music:{label:'音乐',selector:'#home-music'}, pomodoro:{label:'计时',selector:'#home-pomodoro'},
  gallery:{label:'图片画廊',selector:'.home-mirror'}, clip:{label:'剪贴板',selector:'#tab-clip'},
  credentials:{label:'密钥',selector:'#tab-credentials'}
}));
