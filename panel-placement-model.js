'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(n,b));
function normalizePlacement(p) {
  if(!p||p.version!==1||!Number.isFinite(p.displayId)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||![null,'left','right','top'].includes(p.edge))return null;
  return {version:1,displayId:p.displayId,x:clamp(p.x,0,1),y:clamp(p.y,0,1),edge:p.edge};
}
function fitPanel(bounds,area) {
  const width=Math.round(Math.min(bounds.width,area.width-24)),height=Math.round(Math.min(bounds.height,area.height-24));
  return {width,height,x:Math.round(clamp(bounds.x,area.x+12,area.x+area.width-width-12)),y:Math.round(clamp(bounds.y,area.y+12,area.y+area.height-height-12))};
}
function placementFromBounds(b,d,edge=null) {
  const a=d.workArea;return {version:1,displayId:d.id,edge,x:clamp((b.x+b.width/2-a.x)/a.width,0,1),y:clamp((b.y+b.height/2-a.y)/a.height,0,1)};
}
function placementBounds(p,d,size) {
  const a=d.workArea;
  const b=fitPanel({...size,x:a.x+p.x*a.width-size.width/2,y:a.y+p.y*a.height-size.height/2},a);
  if(p.edge==='left')b.x=a.x+12;
  if(p.edge==='right')b.x=a.x+a.width-b.width-12;
  if(p.edge==='top')b.y=a.y+12;
  return b;
}
function edgeAt(c,a) {
  const distances=[['left',Math.abs(c.x-a.x)],['right',Math.abs(c.x-(a.x+a.width))],['top',Math.abs(c.y-a.y)]];
  distances.sort((a,b)=>a[1]-b[1]);return distances[0][1]<=36?distances[0][0]:null;
}
function handleBounds(p,d) {
  const a=d.workArea,top=p.edge==='top',width=top?80:16,height=top?16:80;
  return {width,height,x:Math.round(p.edge==='left'?a.x:p.edge==='right'?a.x+a.width-width:clamp(a.x+p.x*a.width-width/2,a.x,a.x+a.width-width)),
    y:Math.round(top?a.y:clamp(a.y+p.y*a.height-height/2,a.y,a.y+a.height-height))};
}
module.exports={normalizePlacement,fitPanel,placementBounds,edgeAt,placementFromBounds,handleBounds};
