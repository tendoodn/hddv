/* AutoTax Lite · read-only mobile presentation for the canonical Web invoice engine.
   Uses the same authenticated search, quota, encrypted vault and PDF preview.
   Never stores GDT passwords, session tokens, invoice contents or PDF bytes. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const takeKind=()=>[...document.querySelectorAll('input[name="kind"]:checked')].map(x=>x.value);
const keyPrefix='autotax_lite_recent_v1:';
let owner='',page=1,pageSize=10,kind='purchase',visible=[],pending=0,lastSummary='';
let detailEpoch=0,requestedDetails=new Set();
function getPreference(){
 if(!owner)return null;
 try{return JSON.parse(localStorage.getItem(keyPrefix+owner)||'null')}catch{return null}
}
function savePreference(){
 if(!owner)return;
 const item={kinds:takeKind(),from:$('fromDate').value,to:$('toDate').value};
 try{localStorage.setItem(keyPrefix+owner,JSON.stringify(item))}catch{}
}
function selectKinds(kinds){
 const wanted=new Set(kinds);
 const inputs=[...document.querySelectorAll('input[name="kind"]')];
 for(const input of inputs)input.checked=wanted.has(input.value);
 if(!inputs.some(x=>x.checked))inputs.find(x=>x.value==='purchase').checked=true;
 updateFilter(false);
}
function updateFilter(reset=true){
 const kinds=takeKind(),filter=$('liteResultKind');
 if(kinds.length===1)kind=kinds[0];
 else if(!kinds.includes(kind))kind='purchase';
 if(filter)filter.value=kind;
 if(reset)page=1;
 render();
}
const asMoney=value=>{
 const amount=Number(value);
 return Number.isFinite(amount)?amount.toLocaleString('vi-VN')+' ₫':'—';
};
function formatSign(raw){
 if(!raw)return '—';
 const value=String(raw).trim();
 let m=/^(\d{4})-(\d{2})-(\d{2})/.exec(value);
 if(m)return m[3]+'/'+m[2]+'/'+m[1];
 m=/^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
 if(m)return m[0];
 return '—';
}
function signedDate(row){
 const cached=window.WebInvoiceApp?.peekDetail?.(row);
 const head=cached?.head||{};
 // A signed date may not exist on unsigned invoices; do not use issue date.
 return formatSign(head.signatureTime||head.seller?.time||row.nky||row.ngayKy||'');
}
function partner(row){
 return String(row.kind==='purchase'?(row.nbten||row.nbmst||''):(row.nmten||row.nmmst||'')||'—');
}
function render(){
 const node=$('liteRows');
 if(!node)return;
 const source=window.WebInvoiceApp?.getRows?.()||[];
 const kinds=takeKind();
 const selected=kinds.length===1?kinds[0]:kind;
 visible=source.filter(x=>x.kind===selected);
 const count=visible.length;
 const max=Math.max(1,Math.ceil(count/pageSize));
 page=Math.max(1,Math.min(page,max));
 const display=visible.slice((page-1)*pageSize,page*pageSize);
 // Read details only for the displayed page; use canonical authenticated cache.
 const app=window.WebInvoiceApp;
 if(!app?.busy?.()&&display.length){
  const needed=display.filter(row=>{
   const id=JSON.stringify([row.kind,row.form,row.khhdon,row.shdon,row.nbmst,row.nmmst]);
   if(requestedDetails.has(id)||app.peekDetail?.(row))return false;
   requestedDetails.add(id);return true;
  });
  if(needed.length){
   const current=detailEpoch;
   void app.loadDetails(needed,{quiet:true}).then(()=>{
    if(current===detailEpoch)queueRender();
   }).catch(error=>console.warn('Không tải được ngày ký:',error.message));
  }
 }
 const frag=document.createDocumentFragment();
 for(let i=0;i<display.length;i++){
  const item=display[i],tr=document.createElement('tr');
  const pdf=document.createElement('td'),button=document.createElement('button');
  button.type='button';button.className='lite-pdf';button.dataset.row=String((page-1)*pageSize+i);
  button.textContent='Xem PDF';
  pdf.append(button);tr.append(pdf);
  for(const value of [signedDate(item),partner(item),asMoney(item.tgtttbso)]){
   const td=document.createElement('td');td.textContent=value;tr.append(td);
  }
  frag.append(tr);
 }
 if(!display.length){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=4;td.className='lite-empty';
  td.textContent='Chưa có hóa đơn '+(selected==='sold'?'bán ra':'mua vào')+' trong phiên này.';
  tr.append(td);frag.append(tr);
 }
 node.replaceChildren(frag);
 $('liteCount').textContent='Đang xem '+count+' hóa đơn '+(selected==='sold'?'bán ra':'mua vào')+
  ' · Trang '+page+'/'+max;
 $('litePageInfo').textContent=page+' / '+max;
 $('litePrev').disabled=page<=1;$('liteNext').disabled=page>=max;
}
function queueRender(){
 if(pending)return;
 pending=requestAnimationFrame(()=>{pending=0;render()});
}
function build(){
 const result=$('results');
 if(!result)return;
 const section=document.createElement('section');
 section.id='liteResults';
 section.innerHTML='<div class="lite-head"><h2>Kết quả tra cứu</h2><label class="lite-filter" for="liteResultKind">Lọc <select id="liteResultKind"><option value="purchase">Mua vào</option><option value="sold">Bán ra</option></select></label></div>'+
  '<p id="liteCount" class="lite-count"></p>'+
  '<div class="lite-scroll"><table><thead><tr><th>Xem PDF</th><th>Ngày ký</th><th>Tên đối tác</th><th>Tổng thanh toán</th></tr></thead><tbody id="liteRows"></tbody></table></div>'+
  '<nav class="lite-pages" aria-label="Phân trang hóa đơn"><label>Xem <select id="litePageSize" class="lite-page-size"><option value="10">10</option><option value="20">20</option><option value="30">30</option></select></label><button id="litePrev" type="button">‹ Trước</button><span id="litePageInfo">1 / 1</span><button id="liteNext" type="button">Sau ›</button></nav>';
 result.append(section);
 const btn=$('searchBtn');
 btn.textContent='Tra Cứu';
 const link=document.createElement('a');
 link.id='liteHome';link.href='/';link.textContent='Trở lại trang chủ';
 btn.insertAdjacentElement('afterend',link);
 const status=document.createElement('p');status.id='liteStatus';
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 link.insertAdjacentElement('afterend',status);
 $('liteResultKind').addEventListener('change',e=>{
  kind=e.target.value;page=1;queueRender();
 });
 $('litePageSize').addEventListener('change',e=>{
  pageSize=Number(e.target.value)||10;page=1;render();
 });
 $('litePrev').addEventListener('click',()=>{page--;render()});
 $('liteNext').addEventListener('click',()=>{page++;render()});
 $('liteRows').addEventListener('click',e=>{
  const button=e.target.closest('button[data-row]');
  if(!button)return;
  const item=visible[Number(button.dataset.row)];
  if(item&&window.WebPdfPreview?.open)void window.WebPdfPreview.open(item);
  else $('liteStatus').textContent='Không mở được trình xem PDF. Vui lòng tải lại trang.';
 });
 const checks=[...document.querySelectorAll('input[name="kind"]')];
 checks.forEach(el=>el.addEventListener('change',()=>{
  if(!checks.some(x=>x.checked))el.checked=true;
  updateFilter();savePreference();
 }));
 ['fromDate','toDate'].forEach(id=>$(id)?.addEventListener('change',savePreference));
 $('searchForm').addEventListener('submit',savePreference);
 document.addEventListener('autotax-lite-progress',e=>{
  const message=String(e.detail?.message||'').trim();
  if(message&&message!==lastSummary){
   lastSummary=message;$('liteStatus').textContent=message;
  }
 });
 document.addEventListener('autotax-lite-busy',e=>{
  btn.textContent=e.detail?.busy?'Dừng':'Tra Cứu';
  if(e.detail?.busy){page=1;detailEpoch++;requestedDetails.clear();lastSummary='';$('liteStatus').textContent='Đang bắt đầu tra cứu…'}
  else queueRender();
 });
 document.addEventListener('autotax-lite-results',queueRender);
 document.addEventListener('autotax-lite-details-ready',queueRender);
 document.addEventListener('autotax-web-user-ready',e=>{
  const next=String(e.detail?.userId||'');
  if(next===owner)return;
  owner=next;detailEpoch++;requestedDetails.clear();
  const remembered=getPreference();
  if(remembered){
   if(Array.isArray(remembered.kinds)&&remembered.kinds.length)
    selectKinds(remembered.kinds);
   const valid=/^\d{2}\/\d{2}\/\d{4}$/;
   if(valid.test(remembered.from||''))$('fromDate').value=remembered.from;
   if(valid.test(remembered.to||''))$('toDate').value=remembered.to;
  }
  queueRender();
 });
 updateFilter(false);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);
else build();
})();
