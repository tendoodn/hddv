/* AutoTax — bảng tham chiếu nhà phát hành phục vụ PDF gốc (Admin only). */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const keys=['issuer_mst','lookup_url','seller_mst','buyer_mst','secret_code'];
let rows=[],active=null,busy=false;
const cell=(row,value)=>{
 const td=document.createElement('td');
 td.textContent=value||'—';row.append(td);return td;
};
function message(text,isError=false){
 const node=$('issuerRegistryStatus');
 node.textContent=text;node.style.color=isError?'#b91c1c':'#475569';
}
async function load(){
 if(busy)return;
 busy=true;
 message('Đang tải dữ liệu nhà phát hành…');
 try{
  const {data,error}=await client.rpc('autotax_issuer_reference_admin_list_v1');
  if(error)throw error;
  rows=Array.isArray(data)?data:[];
  const body=$('issuerRegistryRows');body.replaceChildren();
  for(const row of rows){
   const tr=document.createElement('tr');
   cell(tr,row.issuer_mst);
   const linkCell=document.createElement('td');
   if(row.lookup_url&&/^https:\/\//i.test(row.lookup_url)){
    const a=document.createElement('a');a.href=row.lookup_url;
    a.textContent=row.lookup_url;a.target='_blank';a.rel='noopener noreferrer';
    linkCell.append(a);
   }else linkCell.textContent='—';
   tr.append(linkCell);
   cell(tr,row.seller_mst);cell(tr,row.buyer_mst);
   cell(tr,row.secret_code);
   const action=document.createElement('td');
   const btn=document.createElement('button');btn.type='button';btn.className='secondary';
   btn.textContent='Sửa';btn.addEventListener('click',()=>edit(row));
   action.append(btn);tr.append(action);
   body.append(tr);
  }
  if(!rows.length){
   const tr=document.createElement('tr'),td=document.createElement('td');
   td.colSpan=6;td.textContent='Chưa có mẫu XML từ hóa đơn đã đọc.';
   tr.append(td);body.append(tr);
  }
  message('Đang lưu '+rows.length+' nhà phát hành. Chỉ tự bổ sung trường còn trống; không ghi đè dữ liệu cũ.');
 }catch(error){message('Không đọc được danh sách: '+(error.message||error),true)}
 finally{busy=false}
}
function edit(row){
 active=row.issuer_mst;
 for(const key of keys)$('issuerEdit_'+key).value=row[key]||'';
 $('issuerEditStatus').textContent='Các ô được sửa sẽ là giá trị chuẩn cho tham chiếu PDF gốc.';
 const dlg=$('issuerRegistryDialog');if(!dlg.open)dlg.showModal();
}
async function save(event){
 event.preventDefault();
 if(!active)return;
 const btn=$('issuerRegistrySave');btn.disabled=true;
 $('issuerEditStatus').textContent='Đang lưu thay đổi…';
 try{
  const changes=Object.fromEntries(keys.map(k=>[k,$('issuerEdit_'+k).value.trim()]));
  const {data,error}=await client.rpc('autotax_issuer_reference_admin_update_v1',
   {p_original_mst:active,p_changes:changes});
  if(error)throw error;
  if(data!==true)throw Error('Không tìm thấy nhà phát hành cần sửa.');
  active=null;$('issuerRegistryDialog').close();await load();
  message('Đã lưu chỉnh sửa năm trường nhà phát hành.');
 }catch(error){$('issuerEditStatus').textContent='Không lưu được: '+(error.message||error)}
 finally{btn.disabled=false}
}
function init(){
 const box=$('issuerRegistryFold');if(!box)return;
 box.addEventListener('toggle',()=>{if(box.open)void load()});
 $('issuerRegistryRefresh')?.addEventListener('click',()=>void load());
 $('issuerRegistryForm')?.addEventListener('submit',save);
 $('issuerRegistryCancel')?.addEventListener('click',()=>$('issuerRegistryDialog').close());
}
init();
window.AutoTaxIssuerRegistryAdmin=Object.freeze({load});
})();
