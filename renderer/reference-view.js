(() => {
  window.ReferenceView={mount(root,api){
    root.replaceChildren();root.classList.add('reference-view');let state=null,disposed=false,busy=false,compare=false,epoch=0;
    const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
    const toolbar=node('div'),panes=node('div'),status=node('p','拖入或粘贴图片，也可以选择已有画廊图片。');toolbar.className='ref-toolbar';panes.className='ref-panes';status.setAttribute('role','status');root.append(toolbar,panes,status);
    const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;toolbar.append(b);return b;};
    button('添加图片',async()=>{if(busy)return;busy=true;try{const r=await api.referenceChoose();if(!r.ok)throw Error();await refresh();status.textContent=r.canceled?'已取消。':'已添加到本机画廊。';}catch{status.textContent='添加失败，原图保留，请重试。';}finally{busy=false;}});
    const toggle=button('双图对照',()=>{compare=!compare;toggle.textContent=compare?'单图查看':'双图对照';toggle.setAttribute('aria-pressed',String(compare));render();});toggle.setAttribute('aria-pressed','false');
    const selected=['',''];
    function render(){epoch++;panes.replaceChildren();panes.classList.toggle('ref-compare',compare);if(!state?.items.length){panes.append(node('p','还没有参考图。添加后可缩放、拖动查看。'));return;}
      for(let n=0;n<(compare?2:1);n++){
        const pane=node('section'),controls=node('div'),choose=node('select'),zoom=node('input'),stage=node('div'),image=node('img'),label=node('label',`参考图 ${n+1}`),zoomLabel=node('label','缩放');pane.className='ref-pane';controls.className='ref-controls';stage.className='ref-stage';stage.tabIndex=0;stage.setAttribute('aria-label',`参考图 ${n+1}，可拖动或用方向键滚动`);zoom.type='range';zoom.min='1';zoom.max='4';zoom.step='.25';zoom.value='1';label.append(choose);zoomLabel.append(zoom);controls.append(label,zoomLabel);pane.append(controls,stage);stage.append(image);panes.append(pane);image.draggable=false;
        state.items.forEach((d,i)=>{const o=node('option',`图片 ${i+1}`);o.value=d.id;choose.append(o);});if(!state.items.some(d=>d.id===selected[n]))selected[n]=state.items[n]?.id||state.activeId||state.items[0].id;choose.value=selected[n];
        let load=0;async function show(){const id=choose.value,ticket=++load,version=epoch;selected[n]=id;image.removeAttribute('src');image.alt=`参考图 ${state.items.findIndex(d=>d.id===id)+1}`;try{const source=await api.referenceImage(id);if(disposed||ticket!==load||version!==epoch)return;if(source)image.src=source;else status.textContent='这张图片无法读取，请重新添加。';}catch{status.textContent='图片读取失败，请重试。';}}
        choose.onchange=()=>{zoom.value='1';zoom.oninput();void show();};zoom.oninput=()=>{image.style.width=`${Number(zoom.value)*100}%`;image.style.height=`${Number(zoom.value)*100}%`;};zoom.oninput();void show();
        let drag=null;stage.onpointerdown=e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop};stage.setPointerCapture(e.pointerId);};stage.onpointermove=e=>{if(drag){stage.scrollLeft=drag.left+drag.x-e.clientX;stage.scrollTop=drag.top+drag.y-e.clientY;}};stage.onpointerup=stage.onpointercancel=()=>{drag=null;};
      }
    }
    async function refresh(){try{const r=await api.referenceGet();if(!r.ok)throw Error();state=r;render();}catch{status.textContent='画廊读取失败，请重新打开。';}}
    async function importFile(file){if(busy)return;if(!['image/png','image/jpeg','image/webp'].includes(file?.type)||file.size>10*1024*1024){status.textContent='请选择 10 MB 内的 PNG、JPEG 或 WebP 图片。';return;}busy=true;status.textContent='正在添加到本机画廊…';try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const r=await api.referenceImport(data);if(!r.ok)throw Error();state=r;selected[0]=r.activeId;render();status.textContent='已添加；原文件未修改。';}catch{status.textContent='添加失败，原图片保留。可能画廊已满，请检查后重试。';}finally{busy=false;}}
    root.ondragover=e=>{e.preventDefault();};root.ondrop=e=>{e.preventDefault();void importFile(e.dataTransfer.files[0]);};const paste=e=>{const file=[...e.clipboardData.items].find(v=>v.kind==='file')?.getAsFile();if(file){e.preventDefault();void importFile(file);}};root.addEventListener('paste',paste);root.tabIndex=-1;root.focus();void refresh();
    return {refresh,async flush(){if(busy)throw Error('import_busy');},destroy(){disposed=true;epoch++;root.removeEventListener('paste',paste);root.ondrop=root.ondragover=null;}};
  }};
})();
