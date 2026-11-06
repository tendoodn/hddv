/* AutoTax V1.1.32: Admin-only ledger of the five fields printed in reconstructed-PDF footers. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const keys=['provider_name','lookup_url','lookup_code','buyer_mst','seller_mst'];
let rows=[],active=null,loading=false;
function cell(tr,value){
 const td=document.createElement('td');
 td.textContent=String(value||'')||'—';
 tr.append(td);return td;
}
function urlCell(tr,value){
 const td=document.createElement('td');
 const raw=String(value||'').trim();
 let url='';
 try{
  const parsed=new URL(raw);
  if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)url=parsed.href;
 }catch{}
 if(url){
  const a=document.createElement('a');
  a.href=url;a.target='_blank';a.rel='noopener noreferrer';
  a.textContent=raw;
  a.style.overflowWrap='anywhere';
  td.append(a);
 }else td.textContent='—';
 tr.append(td);
}
function status(text,error=false){
 const el=$('issuerRegistryStatus');
 if(!el)return;
 el.textContent=text;
 el.style.color=error?'#b91c1c':'#475569';
}
function invoiceName(r){
 return [r.form_code,r.series,r.invoice_number].filter(Boolean).join(' / ');
}
async function load(){
 if(loading)return;
 loading=true;
 status('Đang tải thông tin chân PDF dựng…');
 try{
  const {data,error}=await client.rpc('autotax_issuer_footer_admin_list_v3');
  if(error)throw error;
  rows=Array.isArray(data)?data:[];
  const tbody=$('issuerRegistryRows');
  tbody.replaceChildren();
  for(const r of rows){
   const tr=document.createElement('tr');
   const td=document.createElement('td');
   const btn=document.createElement('button');
   btn.type='button';
   btn.className='secondary';
   btn.textContent=String(r.provider_name||'').trim()||'Chưa rõ nhà cung cấp';
   btn.title='Hóa đơn '+invoiceName(r)+' · Bấm để chỉnh sửa dòng này';
   btn.style.whiteSpace='normal';
   btn.style.textAlign='left';
   btn.addEventListener('click',()=>edit(r));
   td.append(btn);tr.append(td);
   urlCell(tr,r.lookup_url);
   cell(tr,r.lookup_code);
   cell(tr,r.buyer_mst);
   cell(tr,r.seller_mst);
   tbody.append(tr);
  }
  if(!rows.length){
   const tr=document.createElement('tr'),td=document.createElement('td');
   td.colSpan=5;
   td.textContent='Chưa có dữ liệu chân PDF dựng từ các hóa đơn đã đọc.';
   tr.append(td);tbody.append(tr);
  }
  const old=rows.filter(r=>r.source_kind==='legacy_reference').length;
  status('Đang lưu '+rows.length+' dòng theo hóa đơn.'+
    (old?' Có '+old+' dòng dữ liệu cũ; mã tra cứu còn thiếu sẽ bổ sung khi đọc lại XML/JSON.':'')+
    ' Chỉ bổ sung trường còn trống, không tự ghi đè.');
 }catch(error){status('Không tải được dữ liệu chân PDF: '+(error.message||error),true)}
 finally{loading=false}
}
function edit(record){
 active=record;
 for(const key of keys)$('issuerEdit_'+key).value=String(record[key]||'');
 $('issuerEditInvoice').textContent='Hóa đơn '+invoiceName(record)+
   ' · MST phiên tra cứu '+record.session_mst;
 $('issuerEditStatus').textContent='Chỉ Admin được sửa thông tin.';
 const dialog=$('issuerRegistryDialog');
 if(!dialog.open)dialog.showModal();
}
async function save(event){
 event.preventDefault();if(!active)return;
 const btn=$('issuerRegistrySave');btn.disabled=true;
 $('issuerEditStatus').textContent='Đang lưu…';
 try{
  const changes=Object.fromEntries(keys.map(key=>[key,$('issuerEdit_'+key).value.trim()]));
  // Provider MST is separate internal metadata, never overwrite it when editing the display name.
  changes.provider_mst=active.provider_mst||'';
  const {data,error}=await client.rpc('autotax_issuer_footer_admin_update_v3',{
   p_session_mst:active.session_mst,p_form_code:active.form_code,
   p_series:active.series,p_invoice_number:active.invoice_number,p_changes:changes
  });
  if(error)throw error;
  if(data!==true)throw Error('Không còn dòng hóa đơn này.');
  active=null;
  $('issuerRegistryDialog').close();
  await load();
  status('Đã lưu chỉnh sửa Admin. Các lần đọc sau chỉ bổ sung giá trị còn trống.');
 }catch(error){$('issuerEditStatus').textContent='Không lưu được: '+(error.message||error)}
 finally{btn.disabled=false}
}
function init(){
 const fold=$('issuerRegistryFold');if(!fold)return;
 fold.addEventListener('toggle',()=>{if(fold.open)void load()});
 $('issuerRegistryRefresh')?.addEventListener('click',()=>void load());
 $('issuerRegistryForm')?.addEventListener('submit',save);
 $('issuerRegistryCancel')?.addEventListener('click',()=>$('issuerRegistryDialog').close());
}
init();
window.AutoTaxIssuerRegistryAdmin=Object.freeze({load});
})();