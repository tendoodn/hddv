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
const RESULT_PAGE_SIZES=new Set([10,20,30]);
let resultPageSize=10;
let currentResultPage=1;
let stockPlatform='tendoo',mappingReady=false,catalogRestoreSeq=0,catalogFilename='',catalogMst='',activeMst='';
let stagedCatalog=null,mismatchCheckSeq=0,mismatchCheckTimer=null,mstChangeTimer=null;
const currentMst=()=>String($('mstFree')?.value||app()?.getMst?.()||'').replace(/\D/g,'');
const validMst=mst=>/^(?:\d{10}|\d{12}|\d{13})$/.test(mst);
function skuFeedback(message='',error=false){
 const node=$('stockSkuFeedback');node.textContent=message;node.hidden=!message;
 node.classList.toggle('error',!!error);
}
function updateSkuDialog(){
 const user=app()?.getAccount?.()?.id,mst=currentMst();
 const platform=stockPlatform==='misa'?'MISA':'Tendoo';
 const has=!!catalogFilename&&catalogMst===mst;
 const label=has?'Tài khoản này đã tải lên SKU':'Tài khoản này chưa tải lên SKU';
 $('stockSkuState').textContent=label+' · '+platform+' · MST '+(validMst(mst)?mst:'chưa chọn');
 $('stockSkuMiniStatus').textContent=has?'Đã lưu '+catalog.length+' SKU · '+catalogFilename:'Chưa có file SKU cho hồ sơ MST này';
 const pending=stagedCatalog;
 $('stockSkuSelected').hidden=!pending;
 if(pending)$('stockSkuSelected').textContent='File mới: '+pending.file.name+' · '+pending.items.length+' mã hàng (bấm Lưu cấu hình để ghi đè)';
 $('stockSkuSave').disabled=!user||!validMst(mst)||!pending;
 $('stockSkuChoose').disabled=!user||!validMst(mst);
}
function openSkuConfig(){
 updateSkuDialog();skuFeedback();
 const dialog=$('stockSkuDialog');if(!dialog.open)dialog.showModal();
}
const cache=()=>window.AutoTaxWebStockCache;
const stockStatus=(text,error=false)=>{
 const el=$('stockStatus');el.textContent=text;el.style.color=error?'#ff8b94':'#b5efce';
};
const normalSku=product=>window.TendooImport.normalize(product.name);
let lastStats=null;
const alertPref='autotax_web_disable_k_popup_v1';
function bothKindsChecked(){
 const all=[...document.querySelectorAll('input[name="kind"]:checked')].map(x=>x.value);
 return all.includes('purchase')&&all.includes('sold');
}
function syncOpeningStock(){
 const on=bothKindsChecked(),wrap=$('openingStockControl');
 wrap.hidden=!on;
 if(!on){$('openingStockEditor').hidden=true;$('openingStockToggle').setAttribute('aria-expanded','false')}
 const first=$('fromDate').value;
 if(first&&/^\d{4}-\d{2}-\d{2}$/.test(first)){
  const [year,month,day]=first.split('-');
  $('openingStockHint').textContent='Gợi ý: nhập giá trị hàng còn tồn tại ngày '+day+'/'+month+'/'+year+
   ', tức ngày bắt đầu lấy hóa đơn.';
 }
}

const getPopupDisabled=()=>{try{return localStorage.getItem(alertPref)==='1'}catch{return false}};
const setPopupDisabled=value=>{try{localStorage.setItem(alertPref,value?'1':'0')}catch{}};
function filterRows(){
 const kind=$('visibleKind').value,month=$('visibleMonth').value;
 return dataset.filter(row=>(kind==='all'||row.kind===kind)&&(!month||invoiceMonth(row)===month));
}
function pickedRows(){
 const shown=filterRows();
 // Selection is preferred whenever the user ticked at least one currently visible invoice.
 const selected=shown.filter(r=>checked.has(keyOf(r)));
 return selected.length?selected:shown;
}
function exportSuffix(){
 const kind=$('visibleKind').value,month=$('visibleMonth').value;
 const amount=pickedRows().length<filterRows().length?
  '_da_chon_'+pickedRows().length:'';
 return (kind==='all'?'':'_'+kind)+(month?'_thang_'+month.replace('-',''):'')+amount;
}
function updateScope(){
 const shown=filterRows(),selected=shown.filter(r=>checked.has(keyOf(r))).length;
 const page=visible.map(keyOf);
 $('selectAllInvoices').checked=!!page.length&&page.every(k=>checked.has(k));
 $('selectAllInvoices').indeterminate=!!page.length&&page.some(k=>checked.has(k))&&!page.every(k=>checked.has(k));
 $('selectionCount').textContent='Đã tick '+selected+'/'+shown.length+
  ' · sẽ xuất '+pickedRows().length+' hóa đơn ('+
  (selected?'đã tick':'toàn bộ đang hiển thị')+')';
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
function kAlert(stats,allowPopup=true){
 lastStats=stats;
 const ready=bothKindsChecked()&&!!app()?.searchedBothKinds?.();
 const k=window.AutoTaxPeriodK?.calculate(stats.buy,stats.sold,$('openingStockInput').value);
 const industry=$('kIndustry').value;
 const threshold=window.AutoTaxPeriodK?.threshold(industry)||2;
 const warn=ready&&window.AutoTaxPeriodK?.shouldWarn(k,industry);
 $('kRatio').textContent=ready&&k?.value!==null&&Number.isFinite(k?.value)?k.value.toFixed(2):'—';
 $('kRatio').classList.toggle('warning',!!warn);
 $('kRatioSource').textContent=!ready?'Chỉ hiện khi tra cả Mua vào và Bán ra.':
  k?.mode==='invalid'?'Giá trị tồn đầu kỳ không hợp lệ.':
  'K = Bán ra / (Mua vào + Tồn đầu kỳ) · ngưỡng '+threshold+
  (k?.mode==='defaulted'?' · giá trị thiếu tính là 1':'');
 if(warn&&allowPopup&&!getPopupDisabled()){
  const txt='Bán ra: '+money(k.sales)+'; Mua vào: '+money(k.purchase)+
   '; Tồn đầu: '+money(k.stock)+'; K = '+k.value.toFixed(2)+
   '. Ngưỡng tham khảo '+(industry==='production'?'sản xuất':'thương mại')+
   ': K ≥ '+threshold+'. Chỉ số tham khảo, không phải kết luận vi phạm thuế.';
  $('kWarningText').textContent=txt;
  const dialog=$('kWarningDialog');
  if(!dialog.open)dialog.showModal();
 }
}
function render(list,warnings=[],options={}){
 syncOpeningStock();
 dataset=Array.isArray(list)?list.slice():[];
 if(!options.preserve){checked.clear();currentResultPage=1}
 visible=[];
 if(!options.preserve){$('visibleKind').value='all';$('visibleMonth').value='';}
 $('results').hidden=false;
 // Selection mode is automatic: checked visible rows, otherwise all filtered rows.
 const st=totals(dataset);
 $('totalPayments').textContent=money(st.total);
 $('totalVat').textContent=money(st.vat);
 $('purchaseSaleTotals').textContent=money(st.buy)+' / '+money(st.sold);
 $('resultSummary').textContent='Tìm thấy '+dataset.length+' hóa đơn · mua vào '+
  dataset.filter(r=>r.kind==='purchase').length+' · bán ra '+
  dataset.filter(r=>r.kind==='sold').length+
  (st.excluded?' · '+st.excluded+' HĐ hủy/thay thế không cộng tiền':'')+
  (warnings.length?' · có cảnh báo nguồn dữ liệu':'');
 if(options.partial)$('resultSummary').textContent='Đang nhận kết quả: '+dataset.length+
   ' hóa đơn đã xác nhận quyền; danh sách chưa đầy đủ…';
 renderVisible();
 kAlert(st,!options.partial);
}
function append(batch){
 if(!Array.isArray(batch)||!batch.length)return;
 const merged=new Map(dataset.map(row=>[keyOf(row),row]));
 for(const row of batch)merged.set(keyOf(row),row);
 render([...merged.values()],[],{preserve:true,partial:true});
}
function finish(list,warnings=[]){
 // Do not lose the checked rows while the next pages were arriving.
 const allowed=new Set((list||[]).map(keyOf));
 for(const key of checked)if(!allowed.has(key))checked.delete(key);
 render(list,warnings,{preserve:true});
}
function resetForSearch(){
 dataset=[];visible=[];checked.clear();currentResultPage=1;lastStats=null;
 $('visibleKind').value='all';$('visibleMonth').value='';
 $('results').hidden=true;
}
function renderVisible(){
 const filtered=filterRows(),totalPages=Math.max(1,Math.ceil(filtered.length/resultPageSize));
 currentResultPage=Math.max(1,Math.min(totalPages,currentResultPage));
 visible=filtered.slice((currentResultPage-1)*resultPageSize,currentResultPage*resultPageSize);
 const prev=$('resultPagePrev'),next=$('resultPageNext'),label=$('resultPageInfo');
 if(prev)prev.disabled=currentResultPage<=1;
 if(next)next.disabled=currentResultPage>=totalPages;
 if(label)label.textContent='Trang '+currentResultPage+'/'+totalPages+' · '+filtered.length+' hóa đơn';
 const body=$('resultRows');body.replaceChildren();
 if(!visible.length){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=9;td.textContent='Không có hóa đơn trong bộ lọc hiển thị.';
  tr.append(td);body.append(tr);
 }
 for(const r of visible){
  const tr=document.createElement('tr');tr.dataset.key=keyOf(r);
  const choice=document.createElement('td'),checkbox=document.createElement('input');
  checkbox.type='checkbox';checkbox.className='invoice-select';
  checkbox.dataset.key=keyOf(r);checkbox.checked=checked.has(keyOf(r));
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
  const action=document.createElement('td'),actionGroup=document.createElement('div');
  actionGroup.className='invoice-row-actions';
  const button=document.createElement('button');button.type='button';
  button.className='table-detail-btn';button.dataset.detail=keyOf(r);
  button.textContent='Chi tiết';actionGroup.append(button);
  const preview=document.createElement('button');preview.type='button';
  preview.className='table-detail-btn table-pdf-preview-btn';preview.dataset.previewPdf=keyOf(r);
  preview.textContent='Xem PDF';actionGroup.append(preview);
  const audit=document.createElement('button');audit.type='button';
  audit.className='table-detail-btn table-audit-btn';audit.dataset.audit=keyOf(r);
  audit.textContent='Tính hợp lệ';actionGroup.append(audit);
  const issuer=document.createElement('button');issuer.type='button';
  issuer.className='table-detail-btn table-issuer-btn';
  issuer.dataset.issuer=keyOf(r);issuer.textContent='PDF Gốc';actionGroup.append(issuer);
  action.append(actionGroup);tr.append(action);body.append(tr);
 }
 // All filtered rows remain available for ZIP/Excel export; only visible DOM is paged.
 updateScope();
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
  for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;
 }
 return stockPlatform+'-'+currentMst()+'-catalog-'+items.length+'-'+h.toString(16);
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
async function commitCatalogFile(file,prepared){
 const user=app()?.getAccount?.()?.id,client=app()?.getClient?.();
 const platform=stockPlatform,mst=currentMst();
 if(!user)throw Error('Đăng nhập AutoTax trước khi lưu danh mục.');
 if(!validMst(mst))throw Error('Vui lòng chọn MST hồ sơ (10, 12 hoặc 13 số) trước khi lưu SKU.');
 const items=prepared||await window.TendooImport.catalog(file,platform);
 if(user!==app()?.getAccount?.()?.id||platform!==stockPlatform||mst!==currentMst())
  throw Error('Tài khoản, MST hoặc phần mềm đã thay đổi. Vui lòng chọn file lại.');
 // One encrypted slot per user/software. A new file replaces the old catalog atomically.
 const payload=cache().makePayload(file.name,items,mst);
 await cache().saveLocal(user,platform,payload);
 catalog=items;catalogMst=mst;catalogFilename=payload.filename;catalogKey=fingerprint(items);
 skuLinks={};mappingReady=false;
 await loadLinks();
 let online=false;
 try{online=await cache().saveCloud(user,platform,payload,client)}
 catch(error){stockStatus('Đã lưu mã hóa trên máy, chưa đồng bộ online: '+error.message,true)}
 stagedCatalog=null;
 updateSkuDialog();scheduleMismatchCheck();
 return {count:items.length,online};
}
async function restoreCatalog(){
 const seq=++catalogRestoreSeq,user=app()?.getAccount?.()?.id,platform=stockPlatform,mst=currentMst();
 catalog=[];catalogKey='';catalogMst='';skuLinks={};mappingReady=false;catalogFilename='';
 scheduleMismatchCheck();
 updateSkuDialog();
 if(!user||!validMst(mst)){
  stockStatus(!user?'Hãy đăng nhập AutoTax trước khi quản lý SKU.':'Nhập MST hợp lệ để tải danh mục SKU theo hồ sơ.');
  return;
 }
 const result=await cache().restore(user,platform,app()?.getClient?.(),mst);
 if(seq!==catalogRestoreSeq||user!==app()?.getAccount?.()?.id||platform!==stockPlatform||mst!==currentMst())return;
 if(result.catalog){
  catalog=result.catalog.products;catalogMst=mst;catalogFilename=result.catalog.filename||'';
  catalogKey=fingerprint(catalog);
  await loadLinks();
  stockStatus('Đã khôi phục '+catalog.length+' SKU cho MST '+mst+' từ '+(result.source==='online'?'DATA365 online':'bộ nhớ mã hóa cục bộ')+
   (result.warning?'; '+result.warning:''));
 }else{
  stockStatus('MST '+mst+' chưa có mẫu SKU '+platform.toUpperCase()+'. File mới sẽ thay thế file cũ của phần mềm này trên tài khoản.');
 }
 updateSkuDialog();scheduleMismatchCheck();
}
async function loadCatalog(event){
 const file=event.target.files?.[0];
 event.target.value='';
 if(!file)return;
 const user=app()?.getAccount?.()?.id,mst=currentMst(),platform=stockPlatform;
 skuFeedback('Đang kiểm tra cấu trúc file SKU…');
 try{
  if(!user||!validMst(mst))throw Error('Đăng nhập và chọn hồ sơ MST trước khi cập nhật.');
  const items=await window.TendooImport.catalog(file,platform);
  if(user!==app()?.getAccount?.()?.id||platform!==stockPlatform||mst!==currentMst())
   throw Error('Đã đổi tài khoản, MST hoặc phần mềm. Hãy chọn file lại.');
  stagedCatalog={file,items,user,mst,platform};
  skuFeedback('Đã đọc '+items.length+' mã. Nhấn Lưu cấu hình để ghi đè file cũ.');
 }catch(error){stagedCatalog=null;skuFeedback(error.message||String(error),true)}
 updateSkuDialog();
}
function updateStock(){
 stockPlatform=$('stockPlatform').value;
 activeMst=currentMst();
 $('warehouseWrap').hidden=stockPlatform!=='misa';
 $('stockDocWrap').hidden=stockPlatform!=='misa';
 stagedCatalog=null;
 $('stockCatalog').value='';
 stockStatus('Đang tải danh mục đã lưu '+stockPlatform.toUpperCase()+'…');
 void restoreCatalog().catch(error=>{stockStatus('Chưa khôi phục được SKU: '+error.message,true);updateSkuDialog()});
}
async function saveSkuConfig(){
 const selected=stagedCatalog;
 if(!selected)return skuFeedback('Hãy bấm Cập nhật file mới và chọn file trước.',true);
 const button=$('stockSkuSave');button.disabled=true;
 skuFeedback('Đang lưu danh mục được mã hóa…');
 try{
  if(selected.user!==app()?.getAccount?.()?.id||selected.platform!==stockPlatform||selected.mst!==currentMst())
   throw Error('Tài khoản, MST hoặc phần mềm đã thay đổi. Hãy chọn file lại.');
  const result=await commitCatalogFile(selected.file,selected.items);
  const message='Đã lưu '+result.count+' SKU'+(result.online?' và đồng bộ DATA365 online.': ' cục bộ; cần gói DATA365 để đồng bộ máy khác.');
  skuFeedback(message);stockStatus(message);
 }catch(error){skuFeedback(error.message||String(error),true)}
 finally{updateSkuDialog()}
}
async function useData365(){
 const user=app()?.getAccount?.()?.id,client=app()?.getClient?.(),mst=currentMst();
 if(!user)return skuFeedback('Vui lòng đăng nhập AutoTax trước khi sử dụng DATA365.',true);
 try{
  const active=await cache().entitled(client);
  if(!active){
   skuFeedback('Chưa có DATA365 còn hạn. Mở trang tài khoản để mua theo giá Admin cấu hình.');
   window.open('/user/#planSection','_blank','noopener');
   return;
  }
  if(!validMst(mst)||!catalog.length||catalogMst!==mst)
   return skuFeedback('Hãy lưu cấu hình SKU cho hồ sơ MST hiện tại trước khi đồng bộ.',true);
  const payload=cache().makePayload(catalogFilename,catalog,mst);
  await cache().saveCloud(user,stockPlatform,payload,client);
  skuFeedback('Đã đồng bộ '+catalog.length+' SKU lên DATA365. Trên máy khác đăng nhập cùng tài khoản và chọn MST này.');
 }catch(error){skuFeedback('Không đồng bộ được DATA365: '+error.message,true)}
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
   if(!missing.length){$('stockMapBtn').hidden=true;stockStatus('Tất cả SKU đã khớp mã hàng.');return;}
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
 scheduleMismatchCheck();
}
async function exportStock(single=false){
 try{
  if(stockPlatform==='misa'){
   if(!$('stockWarehouse').value.trim())throw Error('Nhập mã kho MISA.');
   window.TendooImport.nextDocumentNumber($('stockLastDoc').value.trim(),1);
  }
  stockStatus('Đang tạo phiếu nhập kho theo phạm vi xuất…');
  const createFiles=()=>withPurchaseDetails(async(target,detailMap)=>{
   const tmpl=window.TendooImport.builtinTemplate(stockPlatform);
   const result=window.TendooImport.makePackage(target,detailMap,catalog,tmpl,skuLinks,
     {warehouse:$('stockWarehouse').value.trim(),lastDocNumber:$('stockLastDoc').value.trim()});
   const files=await window.Zip.readZip(result.zip);
   let count=0;
   for(const [name,data] of Object.entries(files)){
    if(!/\.xlsx$/i.test(name))continue;
    await app().saveFile('nhap_hang/'+name,data,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    count++;
   }
   if(!count)throw Error('Không có tệp nhập kho Excel trong kết quả.');
   stockStatus('Đã lưu riêng '+count+' phiếu vào nhap_hang/; '+result.missing+
     ' sản phẩm thiếu mã; '+result.skipped+' hóa đơn không đủ dòng chi tiết.');
  });
  if(single)await createFiles();
  else await window.AutoTaxZipExport.batch(createFiles,'NhapHang');
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
  return;
 });
 $('resultRows').addEventListener('click',event=>{
  const button=event.target.closest('[data-preview-pdf]');if(!button)return;
  const row=dataset.find(r=>keyOf(r)===button.dataset.previewPdf);
  if(row)void window.WebPdfPreview?.open(row);
 });
 $('resultRows').addEventListener('click',event=>{
  const button=event.target.closest('[data-audit]');if(!button)return;
  const row=dataset.find(r=>keyOf(r)===button.dataset.audit);
  if(row)void window.WebAudit?.open(row);
 });
 $('resultRows').addEventListener('click',event=>{
  const button=event.target.closest('[data-issuer]');if(!button)return;
  const row=dataset.find(r=>keyOf(r)===button.dataset.issuer);
  if(row)void window.IssuerPdf?.open(row);
 });
 $('selectAllInvoices').addEventListener('change',event=>{
  for(const row of visible){
   if(event.target.checked)checked.add(keyOf(row));else checked.delete(keyOf(row));
  }
  for(const node of document.querySelectorAll('input.invoice-select'))node.checked=event.target.checked;
  updateScope();
 });
 // No redundant export-scope selector: changes to filters/checkboxes update the export set.
 $('visibleKind').addEventListener('change',()=>{currentResultPage=1;renderVisible()});
 $('visibleMonth').addEventListener('change',()=>{currentResultPage=1;renderVisible()});
 $('clearVisibleMonth').addEventListener('click',()=>{$('visibleMonth').value='';currentResultPage=1;renderVisible()});
 $('resultPageSize')?.addEventListener('change',event=>{
  const next=Number(event.target.value);
  resultPageSize=RESULT_PAGE_SIZES.has(next)?next:10;
  event.target.value=String(resultPageSize);
  currentResultPage=1;
  renderVisible();
 });
 $('resultPagePrev')?.addEventListener('click',()=>{currentResultPage--;renderVisible()});
 $('resultPageNext')?.addEventListener('click',()=>{currentResultPage++;renderVisible()});
 $('closeInvoiceDetail').addEventListener('click',()=>$('invoiceDetailDialog').close());
 $('closeSkuMap').addEventListener('click',()=>$('skuMapDialog').close());
 $('saveSkuMap').addEventListener('click',async()=>{
  try{await persistMappings();$('skuMapDialog').close()}
  catch(e){stockStatus(e.message,true)}
 });
 $('downloadMappedStock').addEventListener('click',async()=>{
  try{await persistMappings();$('skuMapDialog').close();await exportStock(false)}
  catch(e){stockStatus(e.message,true)}
 });
 $('downloadSingleMappedStock').addEventListener('click',async()=>{
  try{await persistMappings();$('skuMapDialog').close();await exportStock(true)}
  catch(e){stockStatus(e.message,true)}
 });
 $('stockCatalog').addEventListener('change',loadCatalog);
 $('stockCatalogUpdate').addEventListener('click',()=>$('stockCatalogReplacement').click());
 $('stockCatalogReplacement').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
   const result=await commitCatalogFile(file);
   stockStatus('Đã ghi đè danh mục mới: '+result.count+' SKU'+(result.online?' · đồng bộ online':' · cục bộ'));
   if($('skuMapDialog').open){$('skuMapDialog').close();await openMapping()}
  }catch(error){stockStatus('Không cập nhật được: '+error.message,true)}
  finally{event.target.value=''}
 });
 document.addEventListener('autotax-web-user-ready',()=>void updateStock());
 $('stockPlatform').addEventListener('change',updateStock);
 $('stockMapBtn').addEventListener('click',openMapping);
 $('stockDownloadBtn').addEventListener('click',()=>void exportStock(false));
 $('stockSingleBtn').addEventListener('click',()=>void exportStock(true));
 syncOpeningStock();
 document.querySelectorAll('input[name="kind"]').forEach(el=>el.addEventListener('change',()=>{syncOpeningStock();if(lastStats)kAlert(lastStats,false)}));
 $('fromDate').addEventListener('change',()=>{$('openingStockInput').value='';syncOpeningStock();if(lastStats)kAlert(lastStats,false)});
 $('openingStockToggle').addEventListener('click',()=>{
  const input=$('openingStockEditor'),now=input.hidden;
  input.hidden=!now;$('openingStockToggle').setAttribute('aria-expanded',String(now));
  if(now)$('openingStockInput').focus();
 });
 $('openingStockInput').addEventListener('input',()=>{if(lastStats)kAlert(lastStats,false)});
 $('kIndustry').addEventListener('change',()=>{if(lastStats)kAlert(lastStats,true)});
  $('disableKPopup').checked=getPopupDisabled();
 $('closeKWarning').addEventListener('click',()=>{
  setPopupDisabled($('disableKPopup').checked);
  $('kWarningDialog').close();
 });
 updateStock();
}
window.WebResults={render,append,finish,resetForSearch,exportRows:pickedRows,filteredRows:filterRows,exportSuffix,init};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* 1.1.20a: construct the preview modal at startup; no template dependency. */
(()=>{
 const d=document.createElement('dialog');d.id='invoicePdfPreviewDialog';d.className='invoice-pdf-preview';
 d.setAttribute('aria-labelledby','invoicePdfPreviewTitle');
 const toolbar=document.createElement('div');toolbar.className='invoice-pdf-toolbar';
 const title=document.createElement('div');
 const heading=document.createElement('strong');heading.id='invoicePdfPreviewTitle';heading.textContent='Thông tin hóa đơn';
 const meta=document.createElement('small');meta.id='invoicePdfPreviewMeta';meta.textContent='Bản dựng từ dữ liệu Thuế · Không phải PDF gốc';
 title.append(heading,meta);toolbar.append(title);
 const actions=document.createElement('div');actions.className='invoice-pdf-buttons';
 const download=document.createElement('button');download.id='downloadInvoicePdfPreview';download.type='button';download.className='outline';download.disabled=true;download.textContent='↓ Tải PDF';
 const close=document.createElement('button');close.id='closeInvoicePdfPreview';close.type='button';close.className='outline';close.textContent='✕';close.setAttribute('aria-label','Đóng');
 actions.append(download,close);toolbar.append(actions);d.append(toolbar);
 const status=document.createElement('p');status.id='invoicePdfPreviewStatus';status.setAttribute('role','status');status.textContent='Đang dựng PDF…';d.append(status);
 const viewer=document.createElement('iframe');viewer.id='invoicePdfPreviewFrame';viewer.title='Thông tin hóa đơn PDF';viewer.referrerPolicy='no-referrer';viewer.hidden=true;d.append(viewer);
 document.body.append(d);
})();
