(() => {'use strict';
const $=s=>document.querySelector(s), labels={accountType:'账户类型',holdingNumber:'持仓数量',availableNumber:'可用数量',cost:'成本价(元)',presentPrice:'最新价(元)',marketValue:'市值(元)',profitAndLoss:'盈亏(元)'};
const sid=new URLSearchParams(location.search).get('s'), key=new URLSearchParams(location.hash.slice(1)).get('k');
let snapshot=null, expiryTimer=null, busy=false, attempts=0;
const format=t=>new Date(t).toLocaleString('zh-CN',{hour12:false});
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;}
function state(title,message,retry=false,loading=false){$('#content').hidden=true;$('#state').hidden=false;$('#stateTitle').textContent=title;$('#stateText').textContent=message;$('#retry').hidden=!retry;$('#state').classList.toggle('loading',loading);}
function decode(value){const s=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
function number(value){const s=String(value??'--'), normalized=s.replace(/,/g,'');return /^-?\d+(\.\d+)?$/.test(normalized)&&Number.isFinite(Number(normalized))?Number(normalized).toLocaleString('zh-CN',{maximumFractionDigits:4}):s;}
function render(data){
 if(data.schema!==1||!Array.isArray(data.holdings)||!Array.isArray(data.fields)||data.holdings.length>500||data.fields.some(k=>!Object.hasOwn(labels,k)))throw new Error('format');
 if(!Number.isFinite(data.expiresAt)||Date.now()>=data.expiresAt){snapshot=null;state('分享已到期','请联系分享者重新生成链接。');return;}
 snapshot=data;$('#title').textContent=data.title||'持仓资料';$('#created').textContent='快照时间 '+format(data.createdAt);$('#expires').textContent='有效至 '+format(data.expiresAt);
 const theme=['blue','sage','dark'].includes(data.theme)?data.theme:'blue';document.documentElement.dataset.theme=theme;$('#theme').value=theme;
 $('#holdingsSection').hidden=!data.holdings.length;$('#count').textContent=data.holdings.length+' 项';$('#holdings').replaceChildren();
 const wrap=node('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','持仓明细，可左右滚动');
 const table=node('table'),head=node('thead'),tr=node('tr');for(const title of ['名称','代码','快照',...data.fields.map(k=>labels[k])]){const th=node('th',title);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
 const body=node('tbody'),mobile=node('div',undefined,'mobile-holdings');
 for(const row of data.holdings){const line=node('tr');line.append(node('td',row.name??'--'),node('td',row.code??'--'),node('td',row.period??'当前'));
  const card=node('section',undefined,'holding-card'),name=node('header',undefined,'holding-name');name.append(node('h3',row.name??'--'),node('p',(row.code??'--')+' / '+(row.period??'当前')));card.append(name);const dl=node('dl');
  for(const field of data.fields){const value=field==='accountType'?String(row[field]??'--'):number(row[field]);line.append(node('td',value,field==='accountType'?'':'numeric'));const box=node('div');box.append(node('dt',labels[field]),node('dd',value));dl.append(box);}body.append(line);card.append(dl);mobile.append(card);
 }table.append(body);wrap.append(table);$('#holdings').append(wrap,mobile);
 $('#adviceSection').hidden=!data.advice;$('#advice').textContent=data.advice||'';$('#productsSection').hidden=!data.products?.length;$('#products').replaceChildren();
 for(const product of data.products||[]){const e=node('div',undefined,'product');e.append(node('h3',product.name),node('span',product.code+' / '+product.provider,'product-code'),node('p',product.summary),node('p',product.riskNote,'risk'));$('#products').append(e);}
 $('#state').hidden=true;$('#content').hidden=false;clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{snapshot=null;$('#holdings').replaceChildren();$('#products').replaceChildren();$('#advice').textContent='';state('分享已到期','请联系分享者重新生成链接。');},Math.min(data.expiresAt-Date.now(),2147483647));
}
async function load(background=false){
 if(busy)return;if(!sid||!key){state('打开专属资料页','请使用收到的完整分享链接。此处不会列出客户或其他分享记录。');return;}
 if(!/^[0-9a-f]{48}$/.test(sid)||!/^[A-Za-z0-9_-]{43}$/.test(key)){state('链接不完整','请向分享者索取完整链接，保留链接末尾的内容。');return;}
 if(!crypto?.subtle){state('当前浏览器不支持此页面','请复制完整链接，在最新版系统浏览器中打开。');return;}
 busy=true;if(!background)state('正在打开资料','正在读取并解密分享者选定的内容…',false,true);
 try{const response=await fetch('data/'+sid+'.json?t='+Date.now(),{cache:'no-store',referrerPolicy:'no-referrer'});
  if(!response.ok){if(response.status===404&&attempts++<24){state('资料正在同步','云端首次发布需要一点时间，正在重新读取…',true,true);setTimeout(()=>load(),2500);return;}throw new Error('network');}
  const envelope=await response.json();if(envelope.active===false){snapshot=null;$('#holdings').replaceChildren();$('#advice').textContent='';$('#products').replaceChildren();state('分享已撤销','分享者已停止展示这份资料。');return;}
  if(envelope.v!==1||!Number.isFinite(envelope.expiresAt))throw new Error('format');if(Date.now()>=envelope.expiresAt){snapshot=null;state('分享已到期','请联系分享者重新生成链接。');return;}
  const cryptoKey=await crypto.subtle.importKey('raw',decode(key),'AES-GCM',false,['decrypt']);
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:new TextEncoder().encode('HNWShare/1/'+sid)},cryptoKey,decode(envelope.ciphertext));
  const data=JSON.parse(new TextDecoder().decode(raw));if(data.expiresAt!==envelope.expiresAt)throw new Error('format');render(data);
 }catch(error){if(!background||!snapshot){const cryptographic=error.name==='OperationError'||error.message==='format';state(cryptographic?'无法解密这份资料':'暂时无法读取资料',cryptographic?'链接可能不完整，或资料已损坏。请联系分享者重新生成。':'网络连接或云端同步尚未完成，请稍后重新读取。',true);}}
 finally{busy=false;}
}
$('#theme').addEventListener('change',e=>{document.documentElement.dataset.theme=e.target.value;});$('#retry').addEventListener('click',()=>{attempts=0;load();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&snapshot)load(true);});setInterval(()=>{if(!document.hidden&&snapshot)load(true);},60000);load();
})();
