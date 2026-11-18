(() => {
'use strict';
const $=s=>document.querySelector(s);
const labels={accountType:'账户类型',holdingNumber:'持仓数量',availableNumber:'可用数量',cost:'成本价（元）',presentPrice:'最新价（元）',marketValue:'市值（元）',profitAndLoss:'盈亏（元）'};
const page=new URLSearchParams(location.search);
const sid=page.get('s'), key=new URLSearchParams(location.hash.slice(1)).get('k');
const preview=location.pathname==='/ui/share-preview/';
const tabs=[
 ['advice','持仓建议','M5 3h14v18H5zM8 8h8m-8 4h8m-8 4h5'],
 ['holdings','持仓明细','M4 19h16M6 15V9m6 6V5m6 10v-4'],
 ['products','推荐产品','M4 7h16v13H4zM8 7V4h8v3M4 12h16']
];
let snapshot,cryptoKey,manifest,rootStamp,expiryTimer,busy=false,attempts=0,stockGeneration=0,stockFocus;
let openTab,previewStocks=new Map(),stockCache=new Map();
const format=t=>new Date(t).toLocaleString('zh-CN',{hour12:false});
function node(tag,text,cls){
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=String(text);
 if(cls)el.className=cls;
 return el;
}
function svg(path){
 const e=document.createElementNS('http://www.w3.org/2000/svg','svg');
 e.setAttribute('viewBox','0 0 24 24');e.setAttribute('aria-hidden','true');e.setAttribute('fill','none');
 const line=document.createElementNS(e.namespaceURI,'path');line.setAttribute('d',path);e.append(line);return e;
}
function clearReport(){
 stockGeneration++;window.HNWStockViewer.clear();
 for(const selector of ['#title','#created','#expires','#stockTitle','#reportTabs','#advice','#holdings','#products','#stockBody'])$(selector).replaceChildren();
 snapshot=null;stockFocus=null;manifest=null;rootStamp=null;stockCache.clear();previewStocks.clear();
}
function state(title,message,retry=false,loading=false){
 $('#content').hidden=true;$('#state').hidden=false;
 $('#stateTitle').textContent=title;$('#stateText').textContent=message;
 $('#retry').hidden=!retry;$('#state').classList.toggle('loading',loading);
}
function decode(str){
 const value=str.replace(/-/g,'+').replace(/_/g,'/');
 return Uint8Array.from(atob(value+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
}
async function decrypt(descriptor,ciphertext,name=''){
 const aad='HNWShare/1/'+sid+(name?'/'+name:'');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(descriptor.iv),additionalData:new TextEncoder().encode(aad)},cryptoKey,decode(ciphertext));
 return JSON.parse(new TextDecoder().decode(raw));
}
async function readParts(name,descriptor){
 if(!descriptor||!Number.isInteger(descriptor.parts)||descriptor.parts<1||descriptor.parts>200)throw new Error('format');
 const pieces=[];
 for(let base=0;base<descriptor.parts;base+=4){
  pieces.push(...await Promise.all(Array.from({length:Math.min(4,descriptor.parts-base)},async(_,i)=>{
   const response=await fetch('data/'+sid+'/'+name+'-'+(base+i)+'.txt',{referrerPolicy:'no-referrer'});
   if(!response.ok)throw new Error('network');
   const text=await response.text();
   if(text.length>600000||!/^[A-Za-z0-9_-]+$/.test(text))throw new Error('format');
   return text;
  })));
 }
 return decrypt(descriptor,pieces.join(''),name);
}
function number(value){
 const s=String(value??'—'),normalized=s.replace(/,/g,'');
 if(!/^-?\d+(\.\d+)?$/.test(normalized))return s;
 const [whole,fraction]=normalized.split('.');
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);
}
function activate(name,focus=false){
 stockGeneration++;window.HNWStockViewer.clear();$('#stockSection').hidden=true;$('#reportTabs').hidden=false;
 openTab=name;
 for(const [id] of tabs){
  const selected=id===name;
  $('#'+id+'Section').hidden=!selected;
  const tab=$('#tab-'+id);
  if(!tab)continue;
  tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
  if(selected&&focus)tab.focus();
 }
}
function buildTabs(visible){
 const nav=$('#reportTabs');nav.replaceChildren();
 for(const [id,label,path] of tabs){
  if(!visible[id])continue;
  const button=node('button');button.type='button';button.id='tab-'+id;button.dataset.section=id;
  button.setAttribute('role','tab');button.setAttribute('aria-controls',id+'Section');button.append(svg(path),node('span',label));
  const panel=$('#'+id+'Section');
  panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);panel.tabIndex=0;
  button.onclick=()=>activate(id);
  nav.append(button);
 }
}
$('#reportTabs').addEventListener('keydown',event=>{
 const buttons=[...event.currentTarget.querySelectorAll('button')];
 const index=buttons.indexOf(event.target);
 if(index<0)return;
 const offset={ArrowLeft:-1,ArrowRight:1}[event.key];
 let to=offset?(index+offset+buttons.length)%buttons.length:({Home:0,End:buttons.length-1})[event.key];
 if(to===undefined)return;
 event.preventDefault();activate(buttons[to].dataset.section,true);
});
function stockButton(row){
 if(!previewStocks.has(row.code)&&!manifest?.stocks?.[row.code])return null;
 const button=node('button','看盘','action');button.type='button';
 button.setAttribute('aria-label','查看 '+row.name+' '+row.code+' 看盘');
 button.onclick=()=>{stockFocus=button;openStock(row.code,row.name);};
 return button;
}
async function openStock(code,name){
 const generation=++stockGeneration;
 window.HNWStockViewer.clear();
 for(const [id] of tabs)$('#'+id+'Section').hidden=true;
 $('#reportTabs').hidden=true;$('#stockSection').hidden=false;$('#stockBack').hidden=!code;
 $('#stockTitle').textContent=code?name+'（'+code+'）':'个股看盘';
 const target=$('#stockBody');target.replaceChildren(node('p','正在打开个股快照…','stock-hint'));
 if(code)$('#stockTitle').focus();
 try{
  const stock=code?(previewStocks.get(code)||stockCache.get(code)||await readParts(code,manifest?.stocks?.[code])):snapshot.stock;
  if(generation!==stockGeneration)return;
  if(!stock||(code&&code!==stock.code))throw new Error('format');
  if(code)stockCache.set(code,stock);
  $('#stockTitle').textContent=stock.name+'（'+stock.code+'）';
  window.HNWStockViewer.render(stock,target);
 }catch{
  if(generation!==stockGeneration)return;
  const retry=node('button','重试打开看盘','action');
  retry.onclick=()=>openStock(code,name);
  target.replaceChildren(node('p','暂时无法读取这只股票的快照。','stock-hint'),retry);
 }
}
$('#stockBack').onclick=()=>{
 const button=stockFocus;activate('holdings');button?.focus();
};
function fillHoldings(data){
 const host=$('#holdings');host.replaceChildren();$('#count').textContent=data.holdings.length+' 项';
 const wrap=node('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','持仓明细，可左右滚动');
 const table=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');
 const hasStocks=previewStocks.size||Object.keys(manifest?.stocks||{}).length;
 for(const title of ['证券','持仓时间',...data.fields.map(k=>labels[k]),...(hasStocks?['个股行情']:[])]){
  const th=node('th',title);th.scope='col';tr.append(th);
 }
 head.append(tr);table.append(head,body);
 const mobile=node('div',undefined,'mobile-holdings');
 for(const row of data.holdings){
  const line=node('tr'),td=node('td',row.name,'holding-title');td.append(node('span',row.code,'holding-code'));
  line.append(td,node('td',row.period??'当前'));
  const card=node('section',undefined,'holding-card'),header=node('div',undefined,'holding-name'),name=node('div');
  name.append(node('h3',row.name),node('p',row.code+' · '+(row.period??'当前')));header.append(name);card.append(header);
  const detail=node('details'),dl=node('dl');detail.append(node('summary','展开持仓字段'),dl);
  for(const field of data.fields){
   const value=field==='accountType'?String(row[field]??'—'):number(row[field]);
   const signal=field==='profitAndLoss'?Number(String(row[field]).replace(/,/g,'')):0;
   const color=signal>0?'positive':signal<0?'negative':'';
   line.append(node('td',value,(field==='accountType'?'':'numeric ')+color));
   const pair=node('div');pair.append(node('dt',labels[field]),node('dd',value,color));dl.append(pair);
  }
  if(hasStocks){
   const cell=node('td'),button=stockButton(row);
   if(button){cell.append(button);header.append(stockButton(row));}else cell.textContent='—';
   line.append(cell);
  }
  if(data.fields.length)card.append(detail);
  body.append(line);mobile.append(card);
 }
 wrap.append(table);host.append(wrap,mobile);
}
const assetNames=/^(?:huatai|cms|southern)(?:-(?:cover|1|2))?\.(?:webp|pdf|jpg)$/;
function asset(name,product,original=false){
 if(!assetNames.test(name))return null;
 if(preview)return original?'/products/raw/'+product.id:'/products/assets/'+name;
 return 'product-media/'+name;
}
function products(items){
 const host=$('#products');host.replaceChildren();
 for(const product of items){
  const card=node('details',undefined,'product'),summary=node('summary'),main=node('span');
  const cover=asset(product.cover||product.id+'-cover.webp',product);
  if(cover){const img=node('img');img.src=cover;img.alt='';img.loading='lazy';summary.append(img);}else summary.append(node('span'));
  main.append(node('small',product.provider+' · '+product.code),node('strong',product.name));
  const arrow=node('span','›','product-chevron');arrow.setAttribute('aria-hidden','true');
  summary.append(main,arrow);card.append(summary);
  const detail=node('div',undefined,'product-detail');
  if(product.fullName)detail.append(node('p',product.fullName,'stock-meta'));
  detail.append(node('p',product.summary));
  if(product.subscriptionCode)detail.append(node('p','材料所列认购代码 '+product.subscriptionCode,'stock-meta'));
  if(product.points?.length){
   const list=node('ul');for(const point of product.points)list.append(node('li',point));detail.append(list);
  }
  if(product.risk)detail.append(node('p',product.risk,'stock-meta'));
  detail.append(node('p',product.riskNote,'risk'));
  if(product.sourceNote)detail.append(node('p',product.sourceNote,'stock-meta'));
  const original=asset(product.raw,product,true);
  if(original){
   const link=node('a',product.raw.endsWith('.pdf')?'打开原版 PDF':'打开原始海报','action');
   link.href=original;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);
  }
  if(product.pages?.length){
   const pages=node('details',undefined,'product-material');pages.append(node('summary','在本页查看原始资料'));
   pages.addEventListener('toggle',()=>{
    if(!pages.open||pages.children.length>1)return;
    product.pages.forEach((file,i)=>{
     const src=asset(file,product);if(!src)return;
     const img=node('img');img.src=src;img.alt=product.name+'资料第 '+(i+1)+' 页';img.loading='lazy';pages.append(img);
    });
   });
   detail.append(pages);
  }
  card.append(detail);host.append(card);
 }
}
const catalog=fetch(preview?'/api/products':'product-media/catalog.json').then(r=>{
 if(!r.ok)throw new Error('catalog');
 return r.json();
}).then(data=>new Map((data.products||data).map(p=>[p.id,p]))).catch(()=>new Map());
async function render(data){
 if(data.schema!==1||!Array.isArray(data.holdings)||!Array.isArray(data.fields)||data.holdings.length>500||data.fields.some(k=>!Object.hasOwn(labels,k)))throw new Error('format');
 if(!Number.isFinite(data.expiresAt)||Date.now()>=data.expiresAt){clearReport();state('分享已到期','请联系分享者重新生成链接。');return;}
 const productCatalog=await catalog;
 snapshot=data;$('#title').textContent=data.title||'持仓资料';$('#created').textContent='生成于 '+format(data.createdAt);$('#expires').textContent='有效至 '+format(data.expiresAt);
 const theme=['blue','sage','dark'].includes(data.theme)?data.theme:'blue';document.documentElement.dataset.theme=theme;$('#theme').value=theme;
 previewStocks=new Map((preview?data.stocks||[]:[]).map(s=>[s.code,s]));
 fillHoldings(data);
 const items=(data.products||[]).map(p=>typeof p==='string'?productCatalog.get(p):{...productCatalog.get(p.id),...p}).filter(Boolean);
 products(items);
 const visible={advice:!!data.advice?.trim(),holdings:!!data.holdings.length,products:!!items.length};
 $('#advice').textContent=data.advice||'';$('#adviceHoldings').hidden=!visible.holdings;
 buildTabs(visible);
 $('#state').hidden=true;$('#content').hidden=false;
 if(data.stock)openStock();else activate(visible[openTab]?openTab:tabs.find(([id])=>visible[id])?.[0]);
 clearTimeout(expiryTimer);
 function expiry(){
  const remaining=data.expiresAt-Date.now();
  if(remaining>0){expiryTimer=setTimeout(expiry,Math.min(remaining,2147483647));return;}
  clearReport();state('分享已到期','请联系分享者重新生成链接。');
 }
 expiry();
}
$('#adviceHoldings').onclick=()=>activate('holdings',true);
async function load(background=false){
 if(busy)return;
 if(!sid||!key){state('打开专属资料页','请使用收到的完整分享链接。');return;}
 if(!/^[0-9a-f]{48}$/.test(sid)||!/^[A-Za-z0-9_-]{43}$/.test(key)){state('链接不完整','请向分享者索取完整链接，保留链接末尾的内容。');return;}
 if(!globalThis.crypto?.subtle){state('当前浏览器无法解密','请在系统浏览器中打开完整链接。');return;}
 busy=true;if(!background)state('正在打开资料','正在读取并解密分享内容…',false,true);
 try{
  const response=await fetch('data/'+sid+'.json?t='+Date.now(),{cache:'no-store',referrerPolicy:'no-referrer'});
  if(!response.ok){
   if(response.status===404&&attempts++<24){state('资料正在同步','云端正在更新，请稍等。',true,true);setTimeout(()=>load(),2500);return;}
   throw new Error('network');
  }
  const stamp=await response.text(),envelope=JSON.parse(stamp);
  if(envelope.active===false){clearReport();state('分享已撤销','分享者已停止展示这份资料。');return;}
  if(![1,2].includes(envelope.v)||!Number.isFinite(envelope.expiresAt))throw new Error('format');
  if(Date.now()>=envelope.expiresAt){clearReport();state('分享已到期','请联系分享者重新生成链接。');return;}
  if(background&&snapshot&&stamp===rootStamp)return;
  cryptoKey=await crypto.subtle.importKey('raw',decode(key),'AES-GCM',false,['decrypt']);
  const data=await (envelope.v===1?decrypt(envelope,envelope.ciphertext):readParts('root',envelope.root));
  if(data.expiresAt!==envelope.expiresAt)throw new Error('format');
  manifest=envelope.v===2?envelope:null;rootStamp=stamp;stockCache.clear();await render(data);
 }catch(error){
  if(!background||!snapshot){
   const invalid=error.name==='OperationError'||error.message==='format';
   state(invalid?'无法解密这份资料':'暂时无法读取资料',invalid?'请确认使用了收到的完整分享链接。':'检查网络后可重新读取。',true);
  }
 }finally{busy=false;}
}
$('#theme').addEventListener('change',e=>{document.documentElement.dataset.theme=e.target.value;window.HNWStockViewer.theme();});
$('#retry').onclick=()=>{attempts=0;load();};
if(preview){
 addEventListener('message',e=>{
  if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='hnw-stock-preview')return;
  const data=e.data.payload,now=Date.now();
  render({...data,schema:1,createdAt:now,expiresAt:now+data.days*86400000}).catch(()=>state('预览失败','请重新生成快照预览。'));
 });
 return;
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&snapshot)load(true);});
setInterval(()=>{if(!document.hidden&&snapshot)load(true);},30000);
load();
})();
