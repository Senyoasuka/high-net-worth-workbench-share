/* Read-only chart/research/comment renderer. Only canonical snapshot values enter this module. */
(() => {'use strict';
const periods={'1min':'分时','5min':'5分钟','15min':'15分钟',daily:'日K',weekly:'周K',monthly:'月K'};
const n=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
let chart=null,host=null,current=null,period=null,zoom=null;
const ma=(a,w)=>a.map((_,i)=>i<w-1?null:a.slice(i-w+1,i+1).reduce((x,y)=>x+y,0)/w);
function clear(){chart?.dispose();chart=null;host?.replaceChildren();host=null;current=null;zoom=null;}
function draw(){
 if(!host||!current)return;const container=host.querySelector('.stock-chart');if(!container)return;
 const rows=current.charts[period],dark=document.documentElement.dataset.theme==='dark';chart?.dispose();chart=null;
 if(!window.echarts)container.textContent='图表组件未加载，请查看行情数值明细。';
 if(!container.dataset.wheelBound){container.addEventListener('wheel',e=>{if(!e.ctrlKey)e.stopImmediatePropagation();},{capture:true,passive:true});container.dataset.wheelBound='true';}
 if(window.echarts){
 chart=echarts.init(container,dark?'dark':null,{renderer:'canvas'});const intra=period==='1min',closes=rows.map(r=>r.close),dates=rows.map(r=>r.date),red=dark?'#ff9b9b':'#bf293e',green=dark?'#7dd8b0':'#168152';
 const start=zoom?.start??(intra?0:Math.max(0,100-100*95/rows.length));
 chart.setOption({animation:false,backgroundColor:'transparent',textStyle:{fontFamily:'system-ui'},tooltip:{trigger:'axis',renderMode:'richText',axisPointer:{type:'cross'}},legend:{top:4,data:intra?['价格','均价']:['K线','MA5','MA20','MA60'],textStyle:{fontSize:11}},grid:[{left:52,right:16,top:44,height:'57%'},{left:52,right:16,top:'74%',height:'12%'}],xAxis:[{type:'category',data:dates,boundaryGap:!intra,axisLabel:{fontSize:10,hideOverlap:true,formatter:value=>intra?String(value).slice(-5):String(value).slice(0,10)}},{type:'category',gridIndex:1,data:dates,axisLabel:{show:false}}],yAxis:[{scale:true},{gridIndex:1,scale:true,axisLabel:{show:false},splitLine:{show:false}}],dataZoom:[{type:'inside',xAxisIndex:[0,1],zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false,preventDefaultMouseMove:false,start,end:zoom?.end??100},{type:'slider',xAxisIndex:[0,1],height:22,bottom:7,start,end:zoom?.end??100}],series:[...(intra?[{name:'价格',type:'line',data:closes,showSymbol:false,lineStyle:{color:dark?'#9bbdff':'#245ac2'}},{name:'均价',type:'line',data:ma(closes,20),showSymbol:false}]:[{name:'K线',type:'candlestick',data:rows.map(r=>[r.open,r.close,r.low,r.high]),itemStyle:{color:red,color0:green,borderColor:red,borderColor0:green}},...[5,20,60].map(w=>({name:'MA'+w,type:'line',data:ma(closes,w),showSymbol:false,lineStyle:{width:1}}))]),{name:'成交量',type:'bar',xAxisIndex:1,yAxisIndex:1,data:rows.map(r=>r.volume??0),itemStyle:{color:'#8199b3'}}]});
 chart.on('dataZoom',()=>{const z=chart.getOption().dataZoom[0];zoom={start:z.start,end:z.end};});
 }
 const detail=host.querySelector('.stock-data'),tbody=detail.querySelector('tbody');
 tbody.replaceChildren();
 const rowsForTable=()=>{
  if(!detail.open||tbody.children.length)return;
  const body=document.createDocumentFragment();
  for(const row of rows){
   const tr=n('tr');
   for(const key of ['date','open','high','low','close','volume'])tr.append(n('td',row[key]??'—'));
   body.append(tr);
  }
  tbody.append(body);
 };
 detail.ontoggle=rowsForTable;
 rowsForTable();
 host.querySelector('.stock-period-note').textContent=periods[period]+' · '+rows.length+' 条行情记录；快照数据，非实时行情';
}
function render(stock,target){clear();host=target;current=stock;target.replaceChildren();
 const meta=n('p','行情快照 · '+stock.asOf,'stock-meta');target.append(meta);
 const quote=(stock.reports||[]).find(report=>report.title==='行情摘要');
 if(quote){
  const [heading,price,change,...metrics]=quote.text.split('\n');
  const quoteCard=n('section',undefined,'stock-quote');
  quoteCard.append(n('span','分享时价格','stock-meta'),n('strong',price||'—'),n('span',change||'','stock-meta'));
  if(metrics.length){
   const details=n('details');details.append(n('summary','行情指标'),n('p',metrics.join('\n'),'stock-copy'));quoteCard.append(details);
  }
  target.append(quoteCard);
 }
 if(Object.keys(stock.charts||{}).length){const top=n('div',undefined,'stock-toolbar');for(const p of Object.keys(periods)){if(!stock.charts[p]?.length)continue;const b=n('button',periods[p]);b.dataset.stockPeriod=p;b.onclick=()=>{period=p;zoom=null;top.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));draw();};top.append(b);}target.append(top,n('p','', 'stock-period-note'));const c=n('div',undefined,'stock-chart');c.setAttribute('role','img');c.setAttribute('aria-label','股票K线与成交量，可使用下方滑块调整区间；完整数值见行情明细');target.append(c,n('p','电脑普通滚轮滚动页面，Ctrl＋滚轮缩放；手机可使用下方滑块或双指缩放，左右拖动看历史。','stock-hint'));
 const detail=n('details',undefined,'stock-data'),summary=n('summary','行情数值明细'),wrap=n('div',undefined,'stock-table-wrap'),table=n('table'),head=n('thead'),tr=n('tr');for(const t of ['日期','开盘','最高','最低','收盘','成交量']){const th=n('th',t);th.scope='col';tr.append(th);}head.append(tr);table.append(head,n('tbody'));wrap.tabIndex=0;wrap.setAttribute('aria-label','行情明细，可左右滚动');wrap.append(table);detail.append(summary,wrap);target.append(detail);
 period=stock.charts[stock.period]?.length?stock.period:Object.keys(stock.charts)[0];top.querySelector('[data-stock-period="'+period+'"]').setAttribute('aria-pressed','true');}
 if(stock.source)target.append(n('p',stock.source,'stock-hint'));for(const w of stock.warnings||[])target.append(n('p',w,'stock-warning'));
 if(stock.chartImage){const d=n('details',undefined,'stock-annotated');d.open=true;d.append(n('summary','分享时的划线与文字标注原样图'));const image=n('img');image.src=stock.chartImage;image.alt='分享时当前周期图表，包括支撑压力趋势线和文字标注；此图保留分享时范围';d.append(image,n('p','原样图保留分享时的周期和缩放位置。上方交互K线用于查看其他区间，标注以此图为准。','stock-hint'));target.append(d);}
 const research=(stock.reports||[]).filter(report=>report!==quote);
 if(research.length){
  const shelf=n('section',undefined,'research');shelf.append(n('h2','个股研究资料'));
  for(const report of research){
   const panel=n('details',undefined,'stock-report');
   panel.append(n('summary',report.title),n('p',report.text,'stock-copy'));
   for(const rows of report.tables||[]){
    const wrap=n('div',undefined,'stock-table-wrap');wrap.tabIndex=0;
    const table=n('table');
    rows.forEach((row,i)=>{
     const tr=n('tr');
     for(const value of row){
      const cell=n(i?'td':'th',value);if(!i)cell.scope='col';tr.append(cell);
     }
     table.append(tr);
    });
    wrap.append(table);panel.append(wrap);
   }
   shelf.append(panel);
  }
  target.append(shelf);
 }
 const comments=n('section',undefined,'stock-comments');comments.append(n('h2','跟踪评论与回复（'+(stock.comments||[]).length+'条）'));for(const c of stock.comments||[]){const item=n('div',undefined,'stock-comment');item.append(n('p',[c.created_at,c.rating?'★'.repeat(c.rating):'',...(c.tags||[])].filter(Boolean).join(' / '),'stock-meta'),n('p',c.text,'stock-copy'));for(const src of c.images||[]){const img=n('img');img.src=src;img.alt='分享者选入的评论附图';img.loading='lazy';item.append(img);}for(const r of c.replies||[]){const reply=n('div',undefined,'stock-reply');reply.append(n('p',r.created_at+' '+({correct:'验证正确',partial:'部分正确',wrong:'已失效'}[r.verdict]||''),'stock-meta'),n('p',r.text,'stock-copy'));item.append(reply);}comments.append(item);}if(!stock.comments?.length)comments.append(n('p','本快照未包含评论。','stock-hint'));target.append(comments);
 requestAnimationFrame(draw);
}
addEventListener('resize',()=>chart?.resize(),{passive:true});window.HNWStockViewer={render,clear,theme:draw};
})();
