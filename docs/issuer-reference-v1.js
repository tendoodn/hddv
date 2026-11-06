/* AutoTax — tham chiếu nhà phát hành PDF gốc.
 * Chỉ nhận hóa đơn đã được cấp quyền đọc; bảng lưu trên máy chủ là admin-only.
 * Không gửi XML gốc hoặc lưu mật khẩu HĐĐT vào bảng tham chiếu.
 */
(()=>{
 'use strict';
 const API='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/rpc/autotax_issuer_reference_capture_v1';
 const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
 const digits=s=>String(s||'').replace(/\D/g,'');
 function sample(row,detail,sessionMst){
  const head=detail?.head||{},lookup=head.lookup||{};
  const issuer=digits(head.msttcgp||row?.msttcgp);
  if(!/^(?:\d{10}|\d{12}|\d{13})$/.test(issuer)||!row||!sessionMst)return null;
  return {
   issuer_mst:issuer,session_mst:digits(sessionMst),
   form_code:String(row.khmshdon||''),series:String(row.khhdon||''),
   invoice_number:String(row.shdon||''),
   seller_mst:digits(head.nbmst||row.nbmst),
   buyer_mst:digits(head.nmmst||row.nmmst),
   lookup_url:lookup.link||'',
   // Prefer the explicit security code; XML FKey/lookup code is useful when
   // this publisher uses a single code for both verification operations.
   secret_code:lookup.secretCode||lookup.code||''
  };
 }
 async function submit(records,session){
  const input=(records||[]).filter(Boolean);
  if(!input.length||!session?.access_token)return {received:0};
  let total=0;
  for(let i=0;i<input.length;i+=100){
   const response=await fetch(API,{
    method:'POST',headers:{
     apikey:KEY,Authorization:'Bearer '+session.access_token,
     'Content-Type':'application/json'
    },body:JSON.stringify({p_records:input.slice(i,i+100)})
   });
   if(!response.ok)throw Error('Không thể cập nhật danh mục tham chiếu PDF gốc ('+response.status+').');
   const payload=await response.json();
   total+=Number(payload.inserted_or_completed||0);
  }
  return {received:input.length,inserted_or_completed:total};
 }
 window.AutoTaxIssuerReference=Object.freeze({sample,submit});
})();
