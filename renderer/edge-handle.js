const button=document.getElementById('edge-reveal');let hover;
button.onclick=()=>window.edgeAPI.reveal();
button.onpointerenter=()=>{clearTimeout(hover);hover=setTimeout(()=>window.edgeAPI.reveal(),300);};
button.onpointerleave=()=>clearTimeout(hover);
window.edgeAPI.onState(state=>{clearTimeout(hover);document.body.dataset.edge=state.edge;});
