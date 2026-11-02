/* Web result selection, invoice detail viewer and MISA/Tendoo stock import UI.
   Reads canonical invoice rows and source-detail engine from WebInvoiceApp.
   Does not alter server entitlements, quota charging, or raw invoice files. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const money=n=>Number(n||0).toLocaleString('vi-VN')+' ₫';
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const app=()=>window.WebInvoiceApp;
const keyOf=r=>String(r.key||[r.kind,r.form,r.khhdon,r.shdon,r.nbmst,r.nmmst].join('|'));
const isActive=r=>![4,6].includes(Number(r.tthai));
const invoiceMonth=r=>{
 const s=String(r.tdlap||r.nlap||'').trim();
 if(/^\d{4}-\d{2}/.test(s))return s.slice(0,7);
 const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
 return m?m[3]+'-'+m[2].padStart(2,'0'):'';
};
let dataset=[],checked=new Set(),visible=[],catalog=[],skuLinks={},pendingSku={},catalogKey='';
let stockPlatform='tendoo',mappingReady=false;
const stockStatus=(text,error=false)=>{
 const el=$('stockStatus');el.textContent=text;el.style.color=error?'#ff8b94':'#b5efce';
};
const normalSku=product=>window.TendooImport.normalize(product.name);
const alertPref='autotax_web_disable_k_popup_v1';
const getPopupDisabled=()=>{try{return localStorage.getItem(alertPref)==='1'}catch{return false}};
const setPopupDisabled=value=>{try{localStorage.setItem(alertPref,value?'1':'0')}catch{}};
function pickedRows(){
 const scope=$('exportScope').value;
 if(scope==='selected')return dataset.filter(r=>checked.has(keyOf(r)));
 if(scope==='month'){
  const month=$('exportMonth').value;
  return dataset.filter(r=>invoiceMonth(r)===month);
 }
 return dataset.slice();
}
function exportSuffix(){
 const scope=$('exportScope').value;
 return scope==='month'?'_thang_'+$('exportMonth').value.replace('-',''):
   scope==='selected'?'_da_chon_'+checked.size:'';
}
function updateScope(){
 const scope=$('exportScope').value;
 $('exportMonthWrap').hidden=scope!=='month';
 const view=visible.map(keyOf),selectedCount=checked.size;
 $('selectAllInvoices').checked=!!view.length&&view.every(k=>checked.has(k));
 $('selectAllInvoices').indeterminate=!!view.length&&view.some(k=>checked.has(k))&&!view.every(k=>checked.has(k));
 $('selectionCount').textContent='Đã tick '+selectedCount+'/'+dataset.length+
   ' · phạm vi xuất '+pickedRows().length+' hóa đơn';
}
function totals(list){
 const active=list.filter(isActive);
 return {
  total:active.reduce((a,r)=>a+num(r.tgtttbso),0),
  vat:active.reduce((a,r)=>a+num(r.tgtthue),0),
  buy:active.filter(r=>r.kind==='purchase').reduce((a,r)=>a+num(r.tgtttbso),0),
  sold:active.filter(r=>r.kind==='sold').reduce((a,r)=>a+num(r.tgtttbso),0),
  excluded:list.length-active.length
 };
}
function kAlert(stats){
 const valid=app()?.searchedBothKinds?.()&&stats.buy>0&&stats.sold/stats.buy>2;
 const ratio=stats.buy>0?stats.sold/stats.buy:null;
 $('kRatio').textContent=ratio!==null?ratio.toFixed(2):'—';
 $('kRatio').classList.toggle('warning',!!valid);
 if(!valid||getPopupDisabled())return;
 $('disableKPopup').checked=false;
 $('kWarningText').textContent='Tổng bán ra '+money(stats.sold)+
  ' / tổng mua vào '+money(stats.buy)+' = K '+ratio.toFixed(2)+
  ', vượt ngưỡng cảnh báo 2. MST này có nguy cơ vượt hệ số K và nên rà soát chứng từ, hàng tồn và giá vốn thực tế.';
 if(!$('kWarningDialog').open)$('kWarningDialog').showModal();
}
function render(list,warnings=[]){
 dataset=Array.isArray(list)?list.slice():[];
 checked.clear();visible=dataset.slice(0,1500);
 $('results').hidden=false;
 $('exportMonth').value=$('fromDate').value.slice(0,7);
 $('exportScope').value='all';
 const st=totals(dataset);
 $('totalPayments').textContent=money(st.total);
 $('totalVat').textContent=money(st.vat);
 $('searchTotalPay').textContent=money(st.total);
 $('searchTotalVat').textContent=money(st.vat);
 $('searchTotals').hidden=false;
 $('purchaseSaleTotals').textContent=money(st.buy)+' / '+money(st.sold);
 $('resultSummary').textContent='Tìm thấy '+dataset.length+' hóa đơn · mua vào '+
  dataset.filter(r=>r.kind==='purchase').length+' · bán ra '+
  dataset.filter(r=>r.kind==='sold').length+
  (st.excluded?' · '+st.excluded+' HĐ hủy/thay thế không cộng tiền':'')+
  (warnings.length?' · có cảnh báo nguồn dữ liệu':'');
 const body=$('resultRows');body.replaceChildren();
 if(!dataset.length){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=9;td.textContent='Không có hóa đơn trong khoảng thời gian này.';
  tr.append(td);body.append(tr);
 }
 for(const r of visible){
  const tr=document.createElement('tr');tr.dataset.key=keyOf(r);
  const choice=document.createElement('td'),checkbox=document.createElement('input');
  checkbox.type='checkbox';checkbox.className='invoice-select';
  checkbox.dataset.key=keyOf(r);
  checkbox.setAttribute('aria-label','Chọn hóa đơn '+(r.shdon||''));
  choice.append(checkbox);tr.append(choice);
  const partner=r.kind==='purchase'?(r.nbten||r.nbmst):(r.nmten||r.nmmst);
  const d=r.tdlap?new Date(r.tdlap).toLocaleDateString('vi-VN'):'—';
  const values=[r.kind==='purchase'?'Mua vào':'Bán ra',d,
   [r.khhdon,r.shdon].filter(Boolean).join(' / '),partner||'—',
   money(r.tgtttbso),money(r.tgtthue),window.HDDT?.TTHAI?.[r.tthai]||'—'];
  values.forEach((value,i)=>{
   const td=document.createElement('td');td.textContent=value;
   if(i===4||i===5)td.className='money';tr.append(td);
  });
  const action=document.createElement('td'),button=document.createElement('button');
  button.type='button';button.className='table-detail-btn';button.dataset.detail=keyOf(r);
  button.textContent='Xem chi tiết';action.append(button);tr.append(action);body.append(tr);
 }
 if(dataset.length>1500)app()?.show('Hiển thị 1.500/'+dataset.length+' dòng để bảo đảm tốc độ. Chọn tất cả chỉ tick các dòng đang hiện; chế độ "Tất cả hóa đơn" vẫn xuất toàn bộ kết quả.',true);
 updateScope();
 kAlert(st);
}
function appendCells(row,values){
 for(const [i,v] of values.entries()){
  const td=document.createElement('td');td.textContent=String(v??'—');
  if(i>=7)td.className='money';row.append(td);
 }
}
function lineAmount(line){
 const pretax=line.thtien!==null&&line.thtien!==undefined?num(line.thtien):num(line.sl)*num(line.dgia);
 const stated=line.tthue===null||line.tthue===undefined?null:num(line.tthue);
 // Avoid guessing tax when the official line has no rate or the rate is nonstandard.
 const match=/(\d+(?:[.,]\d+)?)\s*%/.exec(String(line.tsuat||''));
 const inferred=match?Math.round(pretax*Number(match[1].replace(',','.'))/100):0;
 const tax=stated===null?inferred:stated;
 return {pretax,total:pretax+tax};
}
async function showDetail(row){
 const dlg=$('invoiceDetailDialog'),body=$('detailRows');
 body.replaceChildren();
 $('invoiceDetailTitle').textContent='Chi tiết hóa đơn '+String(row?.shdon||'');
 $('invoiceDetailMeta').textContent=[row?.khhdon,row?.tdlap,row?.nbmst].filter(Boolean).join(' · ');
 $('invoiceDetailStatus').textContent='Đang tải chi tiết từ cổng Thuế…';
 $('detailTax').textContent='—';$('detailTotal').textContent='—';
 if(!dlg.open)dlg.showModal();
 try{
  const detail=await app().fetchDetail(row);
  if(!dlg.open)return;
  const source=detail.head||{};
  const sellerMst=String(source.nbmst||row.nbmst||'');
  const sellerName=source.nbten||row.nbten||'';
  const lines=(detail.lines||[]);
  for(const [i,line] of lines.entries()){
   const tr=document.createElement('tr'),m=lineAmount(line);
   appendCells(tr,[i+1,sellerMst,sellerName,line.ma||'—',line.ten||'—',
    line.dvt||'—',line.tsuat||'—',money(m.pretax),money(m.total)]);body.append(tr);
  }
  if(!lines.length){
   const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=9;
   td.textContent='Cổng Thuế chưa cung cấp dòng hàng hóa cho hóa đơn này.';tr.append(td);body.append(tr);
  }
  $('detailTax').textContent=money(source.tgtthue??row.tgtthue);
  $('detailTotal').textContent=money(source.tgtttbso??row.tgtttbso);
  $('invoiceDetailStatus').textContent='Đã đọc '+lines.length+' dòng hàng. Tổng tiền lấy từ dữ liệu hóa đơn, có thể bao gồm giảm giá hoặc phí ngoài dòng hàng.';
 }catch(e){$('invoiceDetailStatus').textContent='Không thể tải chi tiết: '+(e.message||e)}
}
function mappingStorageKey(){
 const user=app()?.getAccount?.()?.id||'anonymous';
 return 'autotax_web_sku_map_v2_'+user+'_'+stockPlatform+'_'+catalogKey;
}
function fingerprint(items){
 let h=2166136261;
 for(const p of items){
  const text=p.sku+'|'+p.name+'\n';
  for(const ch of text)h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;
 }
 return stockPlatform+'-catalog-'+items.length+'-'+h.toString(16);
}
async function loadLinks(){
 skuLinks={};if(!catalog.length)return;
 const available=new Set(catalog.map(p=>p.sku));
 try{
  const value=JSON.parse(localStorage.getItem(mappingStorageKey())||'{}');
  skuLinks=Object.fromEntries(Object.entries(value).filter(([,sku])=>available.has(sku)));
 }catch{}
 const client=app()?.getClient?.(), userId=app()?.getAccount?.()?.id;
 if(!client||!userId)return;
 try{
  const {data,error}=await client.from('addon_user_sku_mappings')
   .select('product_key,sku').eq('user_id',userId).eq('platform',stockPlatform)
   .eq('catalog_key',catalogKey).limit(1000);
  if(error)throw error;
  for(const item of data||[]){
   if(item.product_key&&available.has(item.sku))skuLinks[item.product_key]=item.sku;
  }
  try{localStorage.setItem(mappingStorageKey(),JSON.stringify(skuLinks))}catch{}
 }catch(e){stockStatus('Đang dùng ánh xạ cục bộ: '+(e.message||e),true)}
}
async function saveLinks(){
 try{localStorage.setItem(mappingStorageKey(),JSON.stringify(skuLinks))}catch{}
 const client=app()?.getClient?.(), userId=app()?.getAccount?.()?.id;
 if(!client||!userId||!Object.keys(skuLinks).length)return;
 const data=Object.entries(skuLinks).map(([product_key,sku])=>({
  user_id:userId,platform:stockPlatform,catalog_key:catalogKey,product_key,sku,
  updated_at:new Date().toISOString()
 }));
 const {error}=await client.from('addon_user_sku_mappings').upsert(data,{onConflict:'user_id,platform,catalog_key,product_key'});
 if(error)throw new Error('Đã lưu cục bộ nhưng đồng bộ tài khoản lỗi: '+error.message);
}
async function loadCatalog(event){
 const file=event.target.files?.[0];
 catalog=[];catalogKey='';skuLinks={};mappingReady=false;
 if(!file){stockStatus('Chưa chọn danh mục sản phẩm.');return}
 stockStatus('Đang đọc file sản phẩm trên thiết bị…');
 try{
  catalog=await window.TendooImport.catalog(file);
  catalogKey=fingerprint(catalog);
  await loadLinks();
  stockStatus('Đã tải '+catalog.length+' SKU, '+Object.keys(skuLinks).length+' liên kết đã đồng bộ từ tài khoản AutoTax.');
 }catch(e){stockStatus(e.message,true)}
}
function updateStock(){
 stockPlatform=$('stockPlatform').value;
 $('warehouseWrap').hidden=stockPlatform!=='misa';
 $('stockDocWrap').hidden=stockPlatform!=='misa';
 catalog=[];catalogKey='';skuLinks={};
 $('stockCatalog').value='';
 stockStatus(stockPlatform==='misa'?'Tải danh sách hàng hóa MISA và nhập mã kho/số chứng từ.':
   'Tải BC_San_Pham_*.xlsx từ Tendoo để ánh xạ SKU.');
}
async function withPurchaseDetails(task){
 const target=pickedRows().filter(r=>r.kind==='purchase');
 if(!target.length)throw Error('Phạm vi xuất không có hóa đơn mua vào.');
 if(!catalog.length)throw Error('Chưa tải danh mục sản phẩm Tendoo/MISA.');
 if(app().busy())throw Error('Đang chạy tác vụ khác. Vui lòng thử sau.');
 app().startTask();
 try{
  const detailMap=await app().loadDetails(target);
  if(!detailMap.size)throw Error('Không tải được chi tiết hàng hóa của hóa đơn mua vào.');
  return await task(target,detailMap);
 }finally{app().busyState(false)}
}
function renderMappings(missing){
 const box=$('skuMapList');box.replaceChildren();pendingSku={...skuLinks};
 if(!missing.length){
  const p=document.createElement('p');p.textContent='Các sản phẩm trong phạm vi đã khớp với danh mục. Bạn có thể xuất phiếu.';box.append(p);
 }
 for(const entry of missing){
  const holder=document.createElement('section');holder.className='stock-map-entry';
  const title=document.createElement('strong');title.textContent=entry.name;
  const search=document.createElement('input');search.type='search';search.placeholder='Tìm tên hàng hoặc SKU…';
  search.setAttribute('aria-label','Tìm mã sản phẩm thay thế cho '+entry.name);
  const label=document.createElement('small');label.className='stock-map-selected';
  const options=document.createElement('div');options.className='stock-map-options';
  const describe=()=>{
   const match=catalog.find(p=>p.sku===pendingSku[entry.key]);
   label.textContent=match?'Đã chọn '+match.name+' ('+match.sku+')':'Chưa liên kết — sẽ ghi THIẾU MÃ';
  };
  const draw=q=>{
   options.replaceChildren();
   const matches=window.TendooImport.searchCatalog(catalog,q,10);
   for(const item of matches){
    const btn=document.createElement('button');btn.type='button';
    const text=document.createElement('span');text.textContent=item.name;
    const meta=document.createElement('small');meta.textContent='SKU: '+item.sku+(item.unit?' · '+item.unit:'');
    btn.append(text,meta);
    btn.addEventListener('click',()=>{
     pendingSku[entry.key]=item.sku;search.value=item.name+' · '+item.sku;
     describe();options.replaceChildren();
    });
    options.append(btn);
   }
  };
  search.addEventListener('input',()=>{delete pendingSku[entry.key];describe();draw(search.value)});
  search.addEventListener('focus',()=>draw(search.value));
  holder.append(title,search,label,options);box.append(holder);describe();
 }
}
async function openMapping(){
 try{
  stockStatus('Đang đọc chi tiết để xác định các SKU thiếu…');
  await withPurchaseDetails(async(target,detailMap)=>{
   const missing=window.TendooImport.missing(target,detailMap,catalog,skuLinks);
   renderMappings(missing);
   $('skuMapDialog').showModal();
   stockStatus('Cần ánh xạ '+missing.length+' tên sản phẩm; chưa khớp có thể bỏ qua.');
  });
 }catch(e){stockStatus(e.message,true)}
}
async function persistMappings(){
 const known=new Set(catalog.map(p=>p.sku));
 for(const [k,sku] of Object.entries(pendingSku))
  if(k&&sku&&known.has(sku))skuLinks[k]=sku;
 await saveLinks();
 stockStatus('Đã đồng bộ '+Object.keys(skuLinks).length+' liên kết SKU với tài khoản AutoTax.');
}
async function exportStock(){
 try{
  if(stockPlatform==='misa'){
   if(!$('stockWarehouse').value.trim())throw Error('Nhập mã kho MISA.');
   window.TendooImport.nextDocumentNumber($('stockLastDoc').value.trim(),1);
  }
  stockStatus('Đang tạo phiếu nhập kho theo phạm vi xuất…');
  await withPurchaseDetails(async(target,detailMap)=>{
   const tmpl=window.TendooImport.builtinTemplate(stockPlatform);
   const result=window.TendooImport.makePackage(target,detailMap,catalog,tmpl,skuLinks,
     {warehouse:$('stockWarehouse').value.trim(),lastDocNumber:$('stockLastDoc').value.trim()});
   const name='NhapKho_'+stockPlatform.toUpperCase()+'_'+
     (app().getMst()||'MST')+'_'+new Date().toISOString().slice(0,10)+exportSuffix()+'.zip';
   app().download(name,result.zip,'application/zip');
   stockStatus('Đã tạo '+result.count+' phiếu nhập kho; '+result.missing+' sản phẩm thiếu mã; '+
    result.skipped+' hóa đơn không đủ dòng chi tiết.');
  });
 }catch(e){stockStatus('Không xuất được: '+(e.message||e),true)}
}
function init(){
 $('resultRows').addEventListener('change',event=>{
  const box=event.target.closest('input.invoice-select');if(!box)return;
  if(box.checked)checked.add(box.dataset.key);else checked.delete(box.dataset.key);
  updateScope();
 });
 $('resultRows').addEventListener('click',event=>{
  const button=event.target.closest('[data-detail]');if(!button)return;
  const row=dataset.find(r=>keyOf(r)===button.dataset.detail);
  if(row)void showDetail(row);
 });
 $('selectAllInvoices').addEventListener('change',event=>{
  for(const row of visible){
   if(event.target.checked)checked.add(keyOf(row));else checked.delete(keyOf(row));
  }
  for(const node of document.querySelectorAll('input.invoice-select'))node.checked=event.target.checked;
  updateScope();
 });
 $('exportScope').addEventListener('change',updateScope);
 $('exportMonth').addEventListener('change',updateScope);
 $('closeInvoiceDetail').addEventListener('click',()=>$('invoiceDetailDialog').close());
 $('closeSkuMap').addEventListener('click',()=>$('skuMapDialog').close());
 $('saveSkuMap').addEventListener('click',async()=>{
  try{await persistMappings();$('skuMapDialog').close()}
  catch(e){stockStatus(e.message,true)}
 });
 $('downloadMappedStock').addEventListener('click',async()=>{
  try{await persistMappings();$('skuMapDialog').close();await exportStock()}
  catch(e){stockStatus(e.message,true)}
 });
 $('stockCatalog').addEventListener('change',loadCatalog);
 $('stockPlatform').addEventListener('change',updateStock);
 $('stockMapBtn').addEventListener('click',openMapping);
 $('stockDownloadBtn').addEventListener('click',exportStock);
 $('disableKPopup').checked=getPopupDisabled();
 $('closeKWarning').addEventListener('click',()=>{
  setPopupDisabled($('disableKPopup').checked);
  $('kWarningDialog').close();
 });
 updateStock();
}
window.WebResults={render,exportRows:pickedRows,exportSuffix,init};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();