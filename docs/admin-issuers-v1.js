/* AutoTax 1.1.32: Admin-only table for exact footer values shown on reconstructed PDFs. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
let loading=false;
function td(tr,value){
 const c=document.createElement('td');c.textContent=String(value??'').trim()||'—';
 tr.append(c);return c;
}
function linkTd(tr,url){
 const c=document.createElement('td');let dest='';
 try{const u=new URL(String(url||'').trim());if(u.protocol==='https:'&&!u.username&&!u.password)dest=u.href}catch{}
 if(dest){
  const a=document.createElement('a');a.href=dest;a.target='_blank';a.rel='noopener noreferrer';
  a.textContent=dest;a.style.overflowWrap='anywhere';c.append(a);
 }else c.textContent='—';
 tr.append(c);
}
function notice(text,error=false){
 const element=$('issuerRegistryStatus');if(!element)return;
 element.textContent=text;element.style.color=error?'#b91c1c':'';
}
async function load(){
 if(loading)return;
 loading=true;notice('Đang tải dữ liệu chân PDF dựng…');
 try{
  const {data,error}=await client.rpc('autotax_pdf_footer_admin_list_v132');
  if(error)throw error;
  const records=Array.isArray(data)?data:[];
  const body=$('issuerRegistryRows');body.replaceChildren();
  for(const r of records){
   const tr=document.createElement('tr');
   tr.title='Hóa đơn: '+String(r.invoice_key||'');
   td(tr,r.provider_name);
   linkTd(tr,r.lookup_url);
   td(tr,r.lookup_code);
   td(tr,r.buyer_mst);
   td(tr,r.seller_mst);
   body.append(tr);
  }
  if(!records.length){
   const tr=document.createElement('tr'),cell=document.createElement('td');
   cell.colSpan=5;
   cell.textContent='Chưa có thông tin chân PDF được thu thập. Hãy tra cứu hoặc đọc lại chi tiết hóa đơn trên Web/Add-on; các hóa đơn đã được khấu trừ trước đó không bị trừ lượt lần hai.';
   tr.append(cell);body.append(tr);
  }
  notice('Đã thu thập '+records.length+' dòng chân PDF dựng. Mỗi mã tra cứu thuộc một hóa đơn; chỉ tự điền trường còn trống.');
 }catch(error){notice('Không tải được bảng chân PDF: '+(error.message||error),true)}
 finally{loading=false}
}
function setup(){
 const fold=$('issuerRegistryFold');
 if(!fold)return;
 fold.addEventListener('toggle',()=>{if(fold.open)void load()});
 $('issuerRegistryRefresh')?.addEventListener('click',()=>void load());
}
setup();
window.AutoTaxIssuerRegistryAdmin=Object.freeze({load});
})();