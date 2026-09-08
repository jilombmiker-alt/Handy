'use strict';
const http=require('node:http'),https=require('node:https'),dns=require('node:dns'),net=require('node:net'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {isPrivateAddress}=require('./main-services');
function publicUrl(value){
  const u=new URL(value),host=u.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||host==='localhost'||host.endsWith('.local')||host.endsWith('.localhost')||net.isIP(host)&&isPrivateAddress(host))throw Error('unsafe_url');
  return u;
}
// Validate DNS answers inside the actual socket lookup, avoiding a validate/fetch DNS race.
function requestPublic(url,maxBytes=700000){return new Promise((resolve,reject)=>{
  let request;const timer=setTimeout(()=>request?.destroy(Error('timeout')),6000);
  const finish=(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);};
  request=(url.protocol==='https:'?https:http).get(url,{headers:{'User-Agent':'TO-DO-Panel/1.0 (+bookmark preview)','Accept':'text/html,image/png,image/jpeg,image/webp;q=0.9','Accept-Encoding':'identity'},lookup(host,opts,cb){dns.lookup(host,{all:true,verbatim:true},(error,rows)=>{if(error)return cb(error);if(!rows.length||rows.some(r=>isPrivateAddress(r.address)))return cb(Error('unsafe_url'));if(opts.all)cb(null,rows);else cb(null,rows[0].address,rows[0].family);});}},response=>{
    const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy(Error('too_large'));return;}chunks.push(chunk);});
    response.on('error',error=>finish(error));response.on('end',()=>finish(null,{status:response.statusCode,headers:response.headers,bytes:Buffer.concat(chunks)}));
  });request.on('error',error=>finish(error));
});}
function decode(v){return String(v||'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function extract(html,url){
  const meta={};for(const tag of html.match(/<meta\b[^>]{0,4000}>/gi)||[]){const attrs={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);const key=attrs.property||attrs.name;if(key)meta[key.toLowerCase()]=attrs.content||'';}
  const title=(meta['og:title']||decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])||new URL(url).hostname).trim().slice(0,200);
  const description=(meta.description||meta['og:description']||'').trim().slice(0,1200);
  const video=/video/i.test(meta['og:type']||'')||/(^|\.)(youtube\.com|youtu\.be|bilibili\.com|douyin\.com)$/.test(new URL(url).hostname);
  const body=video?'':decode(html.replace(/<(script|style|noscript|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,9000);
  let image='';try{if(meta['og:image'])image=publicUrl(new URL(meta['og:image'],url).toString()).toString();}catch{}
  return {title,description,text:body.length>120?body:'',image,source:video?'video-metadata':body.length>120?'page-excerpt':'metadata',warning:video?'仅视频页面信息，未读取视频内容或字幕。':body.length>120?'仅公开页面文字片段，不保证正文完整。':'信息有限：没有可用正文。'};
}
function createLinkContent({directory,nativeImage,requestImpl=requestPublic}){
  const cache=new Map(),pending=new Map();
  async function fetchSafe(value,max){let u=publicUrl(value);for(let n=0;n<4;n++){const r=await requestImpl(u,max);if([301,302,303,307,308].includes(r.status)){if(!r.headers.location||n===3)throw Error('unsafe_redirect');u=publicUrl(new URL(r.headers.location,u).toString());continue;}if(r.status<200||r.status>=300)throw Error('unavailable');return {...r,url:u.toString()};}throw Error('unavailable');}
  async function inspect(url){try{
    const key=publicUrl(url).toString();if(cache.has(key)&&Date.now()-cache.get(key).checkedAt<300000)return cache.get(key);if(pending.has(key))return pending.get(key);if(pending.size>=8)return {ok:false,error:'busy'};
    const task=(async()=>{try{const page=await fetchSafe(key,700000);if(!/html/i.test(page.headers['content-type']||''))return {ok:true,url:key,title:new URL(key).hostname,description:'',text:'',source:'metadata',warning:'未读取到公开网页正文。',preview:''};
      const result=extract(page.bytes.toString('utf8'),page.url);let preview='';
      if(result.image&&nativeImage)try{const image=await fetchSafe(result.image,1800000);if(!/^image\/(png|jpeg|webp)/i.test(image.headers['content-type']||''))throw Error('invalid_image');const decoded=nativeImage.createFromBuffer(image.bytes);if(decoded.isEmpty())throw Error('invalid_image');const size=decoded.getSize();if(size.width*size.height>30000000)throw Error('too_large');const bytes=decoded.resize({width:Math.min(size.width,640)}).toJPEG(75);preview=crypto.createHash('sha256').update(bytes).digest('hex');fs.mkdirSync(directory(),{recursive:true});fs.writeFileSync(path.join(directory(),preview+'.jpg'),bytes,{mode:0o600});}catch{}
      const output={ok:true,url:key,...result,image:undefined,preview,checkedAt:Date.now()};cache.set(key,output);if(cache.size>80)cache.delete(cache.keys().next().value);return output;
    }catch(e){return {ok:false,error:['unsafe_url','unsafe_redirect','too_large','timeout'].includes(e.message)?e.message:'unavailable'};}finally{pending.delete(key);}})();pending.set(key,task);return await task;
  }catch{return {ok:false,error:'unsafe_url'};}}
  function image(ref){try{if(!/^[a-f0-9]{64}$/.test(ref))return null;const bytes=fs.readFileSync(path.join(directory(),ref+'.jpg'));if(bytes.length>1800000)return null;return 'data:image/jpeg;base64,'+bytes.toString('base64');}catch{return null;}}
  return {inspect,image};
}
module.exports={publicUrl,extract,createLinkContent};
