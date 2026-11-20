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
 for(const selector of ['#title','#created','#expires','#stockTitle','#reportTabs','#chapterProgress','#layoutInsights','#advice','#holdings','#products','#productReader','#stockBody'])$(selector).replaceChildren();
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
const reportLayouts=new Set(['classic','overview','letter','ledger','guided','market','brief']);
let reportLayout='classic',sections=[];
const continuous=()=>['overview','letter','brief'].includes(reportLayout);
const panelFor=id=>$('#'+id+'Section');

let briefScrollFrame=0;
function trackBriefChapter(){
 if(reportLayout!=='brief'||$('.report-body').hidden||$('#content').hidden||!sections.length)return;
 const threshold=Math.min(210,window.innerHeight*.34);
 let current=sections[0][0];
 for(const [id] of sections){
  if(panelFor(id).getBoundingClientRect().top<=threshold)current=id;
 }
 for(const [id] of sections){
  const link=$('#tab-'+id);
  link.toggleAttribute('data-current',id===current);
  if(id===current)link.setAttribute('aria-current','location');
  else link.removeAttribute('aria-current');
 }
}
addEventListener('scroll',()=>{
 if(reportLayout!=='brief'||briefScrollFrame)return;
 briefScrollFrame=requestAnimationFrame(()=>{briefScrollFrame=0;trackBriefChapter();});
},{passive:true});
function jumpToChapter(id){
 activate(id);
 const section=panelFor(id);
 section.focus({preventScroll:true});
 section.scrollIntoView({block:'start'});
}

function updateProgress(){
 const nav=$('#chapterProgress');
 nav.replaceChildren();
 nav.hidden=reportLayout!=='guided'||sections.length<2;
 if(nav.hidden)return;
 const index=sections.findIndex(([id])=>id===openTab);
 const when=(i,prefix)=>{
  const entry=sections[i];
  if(!entry)return node('span');
  const button=node('button',prefix+entry[1],'action');
  button.type='button';button.onclick=()=>jumpToChapter(entry[0]);return button;
 };
 nav.append(when(index-1,'‹ 上一章：'),node('span',(index+1)+' / '+sections.length,'chapter-number'),when(index+1,'下一章：'));
}

function activate(name,focus=false){
 stockGeneration++;
 window.HNWStockViewer.clear();
 $('#stockSection').hidden=true;$('.report-body').hidden=false;$('#reportTabs').hidden=!sections.length;
 openTab=name;
 const flow=continuous();
 for(const [id] of tabs){
  const visible=sections.some(([section])=>section===id);
  const selected=id===name;
  panelFor(id).hidden=!visible||(!flow&&!selected);
  const tab=$('#tab-'+id);
  if(!tab)continue;
  if(flow){
   tab.toggleAttribute('data-current',selected);
   if(reportLayout==='brief'){
    if(selected)tab.setAttribute('aria-current','location');
    else tab.removeAttribute('aria-current');
   }
  }
  else {
   tab.setAttribute('aria-selected',String(selected));
   tab.tabIndex=selected?0:-1;
  }
  if(selected&&focus)tab.focus();
 }
 updateProgress();
}
function buildTabs(visible){
 const nav=$('#reportTabs');
 nav.replaceChildren();
 sections=tabs.filter(([id])=>visible[id]);
 const flow=continuous(),guided=reportLayout==='guided';
 if(flow)nav.removeAttribute('role');else nav.setAttribute('role','tablist');
 nav.setAttribute('aria-label',flow?'报告目录':guided?'报告章节':'报告内容');
 for(const [index,[id,label,path]] of sections.entries()){
  const button=node('button');
  button.type='button';button.id='tab-'+id;button.dataset.section=id;
  button.setAttribute('aria-controls',id+'Section');
  const panel=panelFor(id);
  panel.tabIndex=0;
  panel.setAttribute('role',flow?'region':'tabpanel');
  panel.setAttribute('aria-labelledby',button.id);
  if(!flow)button.setAttribute('role','tab');
  button.append(guided?node('span',index+1,'chapter-step'):svg(path),node('span',reportLayout==='brief'&&id==='advice'?'本期建议':label));
  button.onclick=()=>{
   if(flow||guided){jumpToChapter(id);return;}
   activate(id);
   if(window.scrollY>nav.offsetTop)nav.scrollIntoView({block:'start'});
  };
  nav.append(button);
 }
}
$('#reportTabs').addEventListener('keydown',event=>{
 if(continuous())return;
 const buttons=[...event.currentTarget.querySelectorAll('button')];
 const index=buttons.indexOf(event.target);
 if(index<0)return;
 const offset={ArrowLeft:-1,ArrowRight:1,...(reportLayout==='ledger'?{ArrowUp:-1,ArrowDown:1}:{})}[event.key];
 const to=offset?(index+offset+buttons.length)%buttons.length:({Home:0,End:buttons.length-1})[event.key];
 if(to===undefined)return;
 event.preventDefault();
 activate(buttons[to].dataset.section,true);
});

function layoutDetails(data,products){
 const insights=$('#layoutInsights');insights.replaceChildren();
 insights.hidden=reportLayout!=='overview'||Boolean(data.stock);
 if(insights.hidden)return;
 const stocks=previewStocks.size||Object.keys(manifest?.stocks||{}).length;
 for(const [value,label] of [[data.holdings.length,'项持仓'],[stocks,'只含看盘'],[products.length,'份产品资料']]){
  if(!value)continue;
  const cell=node('div',undefined,'overview-count');
  cell.append(node('strong',value),node('span',label));
  insights.append(cell);
 }
 insights.hidden=!insights.children.length;
}


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
 $('.report-body').hidden=true;
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
  const detail=node('details'),dl=node('dl');detail.append(node('summary','全部持仓明细'),dl);
  const highlights=node('div',undefined,'holding-highlights');
  const featured=['marketValue','profitAndLoss','presentPrice','holdingNumber'].filter(k=>data.fields.includes(k)&&row[k]!==undefined&&!['—','--',''].includes(String(row[k]))).slice(0,2);
  for(const field of data.fields){
   const value=field==='accountType'?String(row[field]??'—'):number(row[field]);
   const signal=field==='profitAndLoss'?Number(String(row[field]).replace(/,/g,'')):0;
   const color=signal>0?'positive':signal<0?'negative':'';
   line.append(node('td',value,(field==='accountType'?'':'numeric ')+color));
   const pair=node('div');pair.append(node('dt',labels[field]),node('dd',value,color));dl.append(pair);
   if(featured.includes(field)){
    const metric=node('div');metric.append(node('span',labels[field]),node('strong',value,color));highlights.append(metric);
   }
  }
  if(hasStocks){
   const cell=node('td'),button=stockButton(row);
   if(button){cell.append(button);header.append(stockButton(row));}else cell.textContent='—';
   line.append(cell);
  }
  if(highlights.children.length)card.append(highlights);
  if(data.fields.some(field=>!featured.includes(field)))card.append(detail);
  body.append(line);mobile.append(card);
 }
 wrap.append(table);host.append(wrap,mobile);
}
const assetNames=/^(?:huatai|cms|southern)(?:-(?:cover|1|2))?\.(?:webp|pdf|jpg)$/;
function asset(name,product,original=false){
 if(typeof name!=='string'||!assetNames.test(name))return null;
 if(preview)return original?'/products/raw/'+product.id:'/products/assets/'+name;
 return 'product-media/'+name;
}
const originalMedia={
 huatai:{raw:'huatai.pdf',pages:['huatai-1.webp','huatai-2.webp']},
 cms:{raw:'cms.pdf',pages:['cms-1.webp','cms-2.webp']},
 southern:{raw:'southern.jpg',pages:['southern.jpg']}
};
function originalActions(product){
 const links=node('div',undefined,'material-files');
 const url=asset(product.raw,product,true);
 if(!url)return links;
 const isPdf=product.raw.endsWith('.pdf');
 const open=node('a','在浏览器打开原件','quiet-link');
 open.href=url;open.target='_blank';open.rel='noopener noreferrer';
 const save=node('a',isPdf?'下载原版 PDF':'保存原图','quiet-link');
 save.href=preview?url+'?download=1':url;save.download=product.raw;
 links.append(save,open);
 if(isPdf&&Object.hasOwn(originalMedia,product.id)){
  const archive=node('a','下载 ZIP 备用包','quiet-link');
  archive.href=preview?'/products/download/'+product.id:'product-media/'+product.id+'.zip';
  archive.download=product.id+'.zip';links.append(archive);
 }
 return links;
}

function openReader(product,trigger){
 const listing=$('#products'),reader=$('#productReader');
 listing.hidden=true;reader.hidden=false;reader.replaceChildren();
 $('#productsSection .section-head').hidden=true;
 const back=node('button','‹ 返回推荐产品','action back');back.type='button';
 const title=node('h2',product.name);title.tabIndex=-1;
 const label=node('p',product.raw?.endsWith('.pdf')?'产品材料 · PDF 原页':'产品材料 · 原始海报','stock-meta');
 const figure=node('figure',undefined,'material-figure'),message=node('p','','stock-meta material-status');
 message.setAttribute('role','status');
 const pager=node('div',undefined,'material-pager'),pageNumber=node('span');
 pageNumber.setAttribute('aria-live','polite');
 const prev=node('button','上一页','action'),next=node('button','下一页','action');
 prev.type=next.type='button';pager.append(prev,pageNumber,next);
 const files=(product.pages||[]).map(file=>{
  const standard=asset(file,product);
  const jpeg=asset(file.replace(/-(1|2)\.webp$/,'-$1.jpg'),product);
  return {primary:jpeg||standard,backup:jpeg!==standard?standard:null};
 }).filter(file=>file.primary);
 const count=files.length;
 let page=0,loadId=0;
 function draw(retryRequest=false){
  const id=++loadId;
  figure.replaceChildren();message.textContent='正在加载原始资料…';
  pageNumber.textContent='第 '+(page+1)+' / '+count+' 页';
  prev.disabled=page===0;next.disabled=page===count-1;
  const image=node('img');
  image.alt=product.name+'原始资料第 '+(page+1)+' 页';
  image.onload=()=>{if(id===loadId)message.textContent='';};
  const entry=files[page];
  const url=source=>source+(retryRequest?'?retry='+Date.now():'');
  let usedBackup=false;
  image.onerror=()=>{
   if(id!==loadId)return;
   if(entry.backup&&!usedBackup){usedBackup=true;image.src=url(entry.backup);return;}
   image.remove();
   const retry=node('button','重新加载本页','action');retry.type='button';retry.onclick=()=>draw(true);
   figure.append(retry);
   message.textContent='本页暂时无法加载，可重试或下载原文件。';
  };
  image.src=url(entry.primary);
  figure.append(image);
 }
 function flip(delta){
  const target=page+delta;
  if(target<0||target>=count)return;
  page=target;draw();
  pager.scrollIntoView({block:'nearest'});
 }
 prev.onclick=()=>flip(-1);next.onclick=()=>flip(1);
 back.onclick=()=>{
  reader.hidden=true;reader.replaceChildren();
  listing.hidden=false;$('#productsSection .section-head').hidden=false;trigger.focus();
 };
 reader.append(back,label,title,originalActions(product));
 if(product.raw?.endsWith('.pdf'))reader.append(node('p','微信里如未弹出保存，请点右上角在系统浏览器打开。本页原稿也可直接翻页。','stock-meta'));
 if(count){
  if(count>1)reader.append(pager);
  reader.append(message,figure);draw();
 }else reader.append(node('p','此产品暂无网页预览，可打开原文件。','stock-meta'));
 title.focus();
}

function products(items){
 const host=$('#products');host.replaceChildren();host.hidden=false;
 const reader=$('#productReader');reader.hidden=true;reader.replaceChildren();
 $('#productsSection .section-head').hidden=false;
 for(const product of items){
  const card=node('article',undefined,'product'),head=node('div',undefined,'product-heading');
  const cover=asset(product.cover||product.id+'-cover.webp',product);
  if(cover){
   const image=node('img');image.src=cover;image.alt='';image.loading='lazy';head.append(image);
  }
  const copy=node('div',undefined,'product-description');
  copy.append(node('p',product.provider+' · '+product.code,'product-byline'),node('h3',product.name),node('p',product.summary,'product-summary'));
  head.append(copy);
  card.append(head);
  if(product.pages?.length||asset(product.raw,product,true)){
   const read=node('button',product.raw?.endsWith('.pdf')?'阅读产品 PDF':'查看原始海报','action material-open');
   read.type='button';read.onclick=()=>openReader(product,read);card.append(read);
  }
  const details=node('details',undefined,'product-facts');
  details.append(node('summary','产品要点与风险'));
  const info=node('div',undefined,'product-detail');
  if(product.fullName)info.append(node('p',product.fullName,'stock-meta'));
  if(product.subscriptionCode)info.append(node('p','材料所列认购代码 '+product.subscriptionCode,'stock-meta'));
  if(product.points?.length){
   const list=node('ul');
   for(const point of product.points)list.append(node('li',point));
   info.append(list);
  }
  if(product.risk)info.append(node('p',product.risk,'stock-meta'));
  if(product.riskNote)info.append(node('p',product.riskNote,'risk'));
  if(product.sourceNote)info.append(node('p',product.sourceNote,'stock-meta'));
  details.append(info);card.append(details);
  host.append(card);
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
 const nextLayout=reportLayouts.has(data.layout)?data.layout:'classic';
 if(reportLayout!==nextLayout)openTab=null;
 reportLayout=nextLayout;
 document.querySelector(".brief-edition").textContent=data.holdings.length?'账户持仓快照':'客户报告快照';
 document.documentElement.dataset.layout=reportLayout;
 snapshot=data;$('#title').textContent=!data.title||data.title==='持仓资料'?(reportLayout==='brief'?'持仓简报':'账户持仓回顾'):data.title;$('#created').textContent='生成于 '+format(data.createdAt);$('#expires').textContent='有效至 '+format(data.expiresAt);
 const theme=['blue','sage','dark'].includes(data.theme)?data.theme:'blue';document.documentElement.dataset.theme=theme;$('#theme').value=theme;
 previewStocks=new Map((preview?data.stocks||[]:[]).map(s=>[s.code,s]));
 fillHoldings(data);
 const items=(data.products||[]).map(p=>typeof p==='string'?productCatalog.get(p):{...(Object.hasOwn(originalMedia,p.id)?originalMedia[p.id]:{}),...productCatalog.get(p.id),...p}).filter(Boolean);
 products(items);
 const visible={advice:!!data.advice?.trim(),holdings:!!data.holdings.length,products:!!items.length};
 const adviceParts=(data.advice||'').split(/\n\s*\n/).filter(Boolean);
 $('#advice').replaceChildren();
 if(reportLayout==='brief'&&adviceParts.length){
  const first=adviceParts[0];
  const clause=first.match(/^([^。！？\n]{8,96}[。！？])(?:\s|$)?/);
  if(clause&&clause[1].length<first.length){
   $('#advice').append(node('p',clause[1],'brief-lead'));
   const remainder=first.slice(clause[1].length).trimStart();
   if(remainder)$('#advice').append(node('p',remainder));
   adviceParts.shift();
  }else if(first.length<=120){
   $('#advice').append(node('p',adviceParts.shift(),'brief-lead'));
  }
 }
 $('#advice').append(...adviceParts.map(text=>node('p',text)));
 $('#adviceSection h2').textContent=reportLayout==='brief'?'本期建议':'持仓建议';
 $('#adviceHoldings').hidden=!visible.holdings;
 buildTabs(visible);
 layoutDetails(data,items);
 $('#state').hidden=true;$('#content').hidden=false;
 if(data.stock)openStock();
 else {
  const holdingsFirst=['ledger','market'].includes(reportLayout)&&visible.holdings;
  activate(visible[openTab]?openTab:holdingsFirst?'holdings':sections[0]?.[0]);
 }
 clearTimeout(expiryTimer);
 function expiry(){
  const remaining=data.expiresAt-Date.now();
  if(remaining>0){expiryTimer=setTimeout(expiry,Math.min(remaining,2147483647));return;}
  clearReport();state('分享已到期','请联系分享者重新生成链接。');
 }
 expiry();
}
$('#adviceHoldings').onclick=()=>continuous()||reportLayout==='guided'?jumpToChapter('holdings'):activate('holdings',true);
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
