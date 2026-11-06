/* AutoTax V1.1.32 — ghi đúng các trường tại CHÂN PDF DỰNG của từng hóa đơn.
 * Giữ duy nhất: Nhà cung cấp HĐĐT | Tra cứu tại | Mã tra cứu | MST người mua | MST người bán.
 * Không suy đoán MST nhà cung cấp từ MST người bán.
 * Mã tra cứu ở máy chủ được mã hóa; chỉ Admin xem được.
 */
(()=>{
'use strict';
const API='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/rpc/autotax_pdf_footer_capture_v132';
const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const digits=v=>String(v||'').replace(/\D/g,'');
const mstValid=v=>/^(?:\d{10}|\d{12}|\d{13})$/.test(String(v||''));
const safeHttps=value=>{
 try{
  const u=new URL(String(value||'').trim());
  return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2048?u.href:'';
 }catch{return ''}
};
function sample(row,detail,sessionMst){
 if(!row||!detail||detail.error)return null;
 const session=digits(sessionMst);
 if(!mstValid(session))return null;
 const form=String(row.form||''),template=String(row.khmshdon??'').trim();
 const series=String(row.khhdon??'').trim(),number=String(row.shdon??'').trim();
 if(!['hddt','mtt'].includes(form)||!template||!number)return null;
 const head=detail.head||{};
 // Same exact lookup resolver used by Web/Addon PDF renderer for its footer.
 const lookup=window.HDDT?.originalLookup?.(row,head)||{};
 const provider=String(lookup.name||'').trim().slice(0,180);
 const link=safeHttps(lookup.link);
 const code=String(lookup.code||'').trim().slice(0,200);
 // A blank lookup footer is NOT a publisher reference (MST alone is insufficient).
 if(!provider&&!link&&!code)return null;
 const buyer=digits(head.nmmst||row.nmmst);
 const seller=digits(head.nbmst||row.nbmst);
 return {
  session_mst:session,
  form_code:form+':'+template,series,invoice_number:number,
  provider_name:provider,lookup_url:link,lookup_code:code,
  buyer_mst:mstValid(buyer)?buyer:'',
  seller_mst:mstValid(seller)?seller:''
 };
}
async function submit(records,authSession){
 const data=(records||[]).filter(Boolean);
 const status={received:0,updated:0,rejected:0};
 if(!data.length)return status;
 if(!authSession?.access_token)throw Error('Chưa có phiên AutoTax hợp lệ để ghi thông tin chân PDF.');
 for(let i=0;i<data.length;i+=100){
  const reply=await fetch(API,{method:'POST',headers:{
   apikey:KEY,Authorization:'Bearer '+authSession.access_token,
   'Content-Type':'application/json'
  },body:JSON.stringify({p_records:data.slice(i,i+100)})});
  const body=await reply.json().catch(()=>({}));
  if(!reply.ok)throw Error('Không đồng bộ chân PDF ('+reply.status+'): '+String(body.message||body.error||'Lỗi máy chủ'));
  status.received+=Number(body.received||0);
  status.updated+=Number(body.updated||0);
  status.rejected+=Number(body.rejected||0);
 }
 return status;
}
window.AutoTaxIssuerReference=Object.freeze({sample,submit});
})();