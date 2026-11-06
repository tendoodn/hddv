/* AutoTax 1.1.31 — tham chiếu nhà phát hành PDF gốc, dùng chung Web/Add-on.
 * Có thể ghi nhận hóa đơn đã đọc nhưng chưa xác định được MST của nhà cung cấp.
 * Danh sách NCC chỉ dùng MST thực từ XML/JSON; tuyệt đối không suy đoán theo MST người bán.
 * Máy chủ đối chiếu lại từng hóa đơn với lịch sử cấp quyền trước khi ghi.
 */
(()=>{
 'use strict';
 const API='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/rpc/autotax_issuer_reference_capture_v1';
 const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
 const digits=v=>String(v||'').replace(/\D/g,'');
 const mstValid=v=>/^(?:\d{10}|\d{12}|\d{13})$/.test(v);
 const safeHttps=value=>{
  try{const u=new URL(String(value||'').trim());return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2048?u.href:''}
  catch{return ''}
 };
 function issuerFromFields(detail){
  const aliases=new Set(['msttcgp','msttochuccungcap','mstdvcchddt','mstdvcungcaphddt',
   'msttochuccungcaphddt','mstdvphathanhddt','mstnccdvhoadondientu']);
  const fields=detail?.xmlFields||{};
  for(const [path,value] of Object.entries(fields)){
   const field=String(path).split('/').at(-1)?.replace(/\[\d+\]$/,'').trim().toLowerCase();
   if(!aliases.has(field))continue;
   const candidate=digits(value);
   if(mstValid(candidate))return candidate;
  }
  return '';
 }
 function sample(row,detail,sessionMst){
  if(!row||!mstValid(digits(sessionMst)))return null;
  const form=String(row.form||''),template=String(row.khmshdon||'');
  const series=String(row.khhdon||''),number=String(row.shdon??'');
  if(!['hddt','mtt'].includes(form)||!template||!number)return null;
  const head=detail?.head||{},lookup=head.lookup||{};
  const issuerCandidate=digits(head.msttcgp||row.msttcgp)||issuerFromFields(detail);
  const issuer=mstValid(issuerCandidate)?issuerCandidate:issuerFromFields(detail);
  return {
   issuer_mst:issuer,
   session_mst:digits(sessionMst),
   // Must exactly match autotax_claim_invoice_quota_v118 on both Web and Add-on.
   form_code:form+':'+template,series,invoice_number:number,
   seller_mst:digits(head.nbmst||row.nbmst),
   buyer_mst:digits(head.nmmst||row.nmmst),
   lookup_url:safeHttps(lookup.link),
   secret_code:String(lookup.secretCode||lookup.code||'').trim().slice(0,200),
   source_type:detail?.source==='xml'?'xml':detail?.source==='detail'?'json':'ledger'
  };
 }
 async function submit(records,session){
  const input=(records||[]).filter(Boolean);
  if(!input.length)return {received:0,registered:0,pending:0,rejected:0};
  if(!session?.access_token)throw Error('Phiên đăng nhập AutoTax đã hết hạn, chưa ghi mẫu nhà phát hành.');
  const result={received:0,registered:0,pending:0,rejected:0};
  for(let i=0;i<input.length;i+=100){
   const response=await fetch(API,{
    method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({p_records:input.slice(i,i+100)})
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error('Không lưu được mẫu nhà phát hành ('+response.status+'): '+String(body.message||body.error||'Lỗi kết nối'));
   result.received+=Number(body.received||0);
   result.registered+=Number(body.registered||0);
   result.pending+=Number(body.pending||0);
   result.rejected+=Number(body.rejected||0);
  }
  return result;
 }
 window.AutoTaxIssuerReference=Object.freeze({sample,submit});
})();
