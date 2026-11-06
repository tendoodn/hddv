/* AutoTax V1.1.31 — danh mục nhà phát hành và hóa đơn cần xác định.
 * Admin-only; only confirmed issuer MST enters the publisher registry.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const keys=['issuer_mst','lookup_url','seller_mst','buyer_mst','secret_code'];
const validMst=v=>/^(?:\d{10}|\d{12}|\d{13})$/.test(String(v||'').trim());
let rows=[],pending=[],active=null,resolving=null,busy=false;
function cell(row,value){
 const td=document.createElement('td');td.textContent=value||'—';row.append(td);return td;
}
function linkCell(row,value){
 const td=document.createElement('td');
 let href='';
 try{const u=new URL(String(value||''));if(u.protocol==='https:'&&!u.username&&!u.password)href=u.href}catch{}
 if(href){
  const a=document.createElement('a');a.href=href;a.textContent=href;
  a.target='_blank';a.rel='noopener noreferrer';td.append(a);
 }else td.textContent='—';
 row.append(td);
 return td;
}
function message(value,error=false){
 const el=$('issuerRegistryStatus');
 if(!el)return;
 el.textContent=value;el.style.color=error?'#b91c1c':'#475569';
}
const sourceLabel=value=>value==='xml'?'XML chưa ghi MST nhà phát hành':
 value==='json'?'JSON cổng Thuế chưa ghi MST nhà phát hành':
 'Đã đọc, cần lấy lại XML/JSON';
function loadPending(){
 const tbody=$('issuerPendingRows'),status=$('issuerPendingStatus');
 if(!tbody||!status)return;
 tbody.replaceChildren();
 for(const record of pending){
  const tr=document.createElement('tr');
  cell(tr,[record.form_code,record.series,record.invoice_number].filter(Boolean).join(' / '));
  cell(tr,record.session_mst);cell(tr,record.seller_mst);cell(tr,record.buyer_mst);
  linkCell(tr,record.lookup_url);cell(tr,sourceLabel(record.source_type));
  const td=document.createElement('td'),btn=document.createElement('button');
  btn.type='button';btn.className='secondary';btn.textContent='Xác nhận MST NCC';
  btn.addEventListener('click',()=>openResolve(record));td.append(btn);tr.append(td);tbody.append(tr);
 }
 if(!pending.length){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=7;td.textContent='Không có hóa đơn nào đang chờ xác định nhà phát hành.';
  tr.append(td);tbody.append(tr);
 }
 const onlyHistory=pending.filter(x=>x.source_type==='ledger').length;
 status.textContent='Đang chờ '+pending.length+' hóa đơn, trong đó '+onlyHistory+
  ' hóa đơn mới có lịch sử đọc (cần đọc lại chi tiết/XML). Không tự suy đoán MST nhà phát hành.';
}
async function load(){
 if(busy)return;
 busy=true;
 message('Đang tải dữ liệu nhà phát hành…');
 try{
  const [main,unresolved]=await Promise.all([
   client.rpc('autotax_issuer_reference_admin_list_v1'),
   client.rpc('autotax_issuer_reference_admin_pending_v2')
  ]);
  if(main.error)throw main.error;
  rows=Array.isArray(main.data)?main.data:[];
  const tbody=$('issuerRegistryRows');tbody.replaceChildren();
  for(const record of rows){
   const tr=document.createElement('tr');cell(tr,record.issuer_mst);
   linkCell(tr,record.lookup_url);cell(tr,record.seller_mst);
   cell(tr,record.buyer_mst);cell(tr,record.secret_code);
   const td=document.createElement('td'),btn=document.createElement('button');
   btn.type='button';btn.className='secondary';btn.textContent='Sửa';
   btn.addEventListener('click',()=>edit(record));td.append(btn);tr.append(td);
   tbody.append(tr);
  }
  if(!rows.length){
   const tr=document.createElement('tr'),td=document.createElement('td');
   td.colSpan=6;td.textContent='Chưa có MST nhà phát hành được xác minh. Xem hóa đơn đang chờ ở bảng bên dưới.';
   tr.append(td);tbody.append(tr);
  }
  pending=Array.isArray(unresolved.data)?unresolved.data:[];
  loadPending();
  message('Đang lưu '+rows.length+' nhà phát hành xác minh; '+
   pending.length+' hóa đơn đang chờ. Chỉ tự bổ sung trường còn trống; không ghi đè.');
  if(unresolved.error){
   $('issuerPendingStatus').textContent='Không tải được hóa đơn chờ: '+unresolved.error.message;
   message('Danh sách nhà phát hành đã tải; phần hóa đơn chờ gặp lỗi.',true);
  }
 }catch(error){message('Không đọc được danh sách: '+(error.message||error),true)}
 finally{busy=false}
}
function edit(record){
 active=record.issuer_mst;
 for(const key of keys)$('issuerEdit_'+key).value=record[key]||'';
 $('issuerEditStatus').textContent='Chỉ tài khoản Admin được sửa các trường hiện có.';
 const dialog=$('issuerRegistryDialog');if(!dialog.open)dialog.showModal();
}
async function save(event){
 event.preventDefault();if(!active)return;
 const btn=$('issuerRegistrySave');btn.disabled=true;
 $('issuerEditStatus').textContent='Đang lưu thay đổi…';
 try{
  const changes=Object.fromEntries(keys.map(key=>[key,$('issuerEdit_'+key).value.trim()]));
  const {data,error}=await client.rpc('autotax_issuer_reference_admin_update_v1',
   {p_original_mst:active,p_changes:changes});
  if(error)throw error;
  if(data!==true)throw Error('Không tìm thấy nhà phát hành cần sửa.');
  active=null;$('issuerRegistryDialog').close();await load();
  message('Đã lưu thay đổi theo xác nhận của Admin.');
 }catch(error){$('issuerEditStatus').textContent='Không lưu được: '+(error.message||error)}
 finally{btn.disabled=false}
}
function openResolve(record){
 resolving=record;
 $('issuerResolveInvoice').textContent='Hóa đơn '+[record.form_code,record.series,record.invoice_number].join(' / ')+
  ' · Hồ sơ '+record.session_mst;
 $('issuerResolveMst').value='';
 $('issuerResolveVerified').checked=false;
 $('issuerResolveStatus').textContent='Chỉ nhập MST của đơn vị cung cấp giải pháp HĐĐT đã được kiểm chứng.';
 const dlg=$('issuerResolveDialog');if(!dlg.open)dlg.showModal();
 $('issuerResolveMst').focus();
}
async function saveResolution(event){
 event.preventDefault();if(!resolving)return;
 const issuer=$('issuerResolveMst').value.trim();
 if(!validMst(issuer)){
  $('issuerResolveStatus').textContent='MST phải gồm 10, 12 hoặc 13 chữ số.';return;
 }
 if(!$('issuerResolveVerified').checked)return;
 const btn=$('issuerResolveSave');btn.disabled=true;
 $('issuerResolveStatus').textContent='Đang đối chiếu mẫu trên máy chủ…';
 try{
  const row=resolving;
  const {data,error}=await client.rpc('autotax_issuer_reference_admin_resolve_v2',{
   p_session_mst:row.session_mst,p_form_code:row.form_code,
   p_series:row.series,p_invoice_number:row.invoice_number,p_issuer_mst:issuer
  });
  if(error)throw error;
  if(data!==true)throw Error('Không còn bản ghi này trong danh sách chờ.');
  resolving=null;$('issuerResolveDialog').close();await load();
  message('Đã chuyển mẫu đã kiểm chứng vào danh sách nhà phát hành; không ghi đè dữ liệu cũ.');
 }catch(error){$('issuerResolveStatus').textContent='Không xác nhận được: '+(error.message||error)}
 finally{btn.disabled=false}
}
function init(){
 const box=$('issuerRegistryFold');if(!box)return;
 box.addEventListener('toggle',()=>{if(box.open)void load()});
 $('issuerRegistryRefresh')?.addEventListener('click',()=>void load());
 $('issuerRegistryForm')?.addEventListener('submit',save);
 $('issuerRegistryCancel')?.addEventListener('click',()=>$('issuerRegistryDialog').close());
 $('issuerResolveForm')?.addEventListener('submit',saveResolution);
 $('issuerResolveCancel')?.addEventListener('click',()=>$('issuerResolveDialog').close());
}
init();
window.AutoTaxIssuerRegistryAdmin=Object.freeze({load});
})();