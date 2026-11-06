/* AutoTax V1.1.34: authorized invoice samples feed one best row per provider.
 * Uses exactly the lookup calculation used by PDF.buildInvoicePdf:
 * HDDT.originalLookup(row, detail.head), not arbitrary provider/secret codes.
 * Both Web and Chrome Add-on use this same module.
 */
(()=>{
 'use strict';
 const API='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/rpc/autotax_issuer_footer_capture_v3';
 const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
 const digits=v=>String(v||'').replace(/\D/g,'');
 const validMst=v=>/^(?:\d{10}|\d{12}|\d{13})$/.test(v);
 const safeHttps=value=>{
  try{const u=new URL(String(value||'').trim());return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2048?u.href:''}
  catch{return ''}
 };
 // In case an XML format contains MSTTCGP outside the parsed head.
 function providerFromXmlFields(detail){
  for(const [path,value] of Object.entries(detail?.xmlFields||{})){
   const field=String(path).split('/').at(-1)?.replace(/\[\d+\]$/,'').trim().toLowerCase();
   if(!['msttcgp','msttochuccungcap','mstdvcchddt','mstdvcungcaphddt','mstnccdvhoadondientu'].includes(field))continue;
   const mst=digits(value);if(validMst(mst))return mst;
  }
  return '';
 }
 function sample(row,detail,sessionMst){
  if(!row||!detail||!validMst(digits(sessionMst)))return null;
  const form=String(row.form||''),template=String(row.khmshdon||detail?.head?.khmshdon||'');
  const series=String(row.khhdon||detail?.head?.khhdon||''),number=String(row.shdon??detail?.head?.shdon??'');
  if(!['hddt','mtt'].includes(form)||!template||!number)return null;
  const head=detail.head||{};
  // Keep this identical to the lookup passed into the reconstructed PDF.
  const lookup=window.HDDT?.originalLookup?.(row,head)||{
   name:'',link:head.lookup?.link||'',code:head.lookup?.code||''};
  const providerName=String(lookup.name||'').trim().slice(0,180);
  const lookupCode=String(lookup.code||'').trim().slice(0,200);
  const lookupUrl=safeHttps(lookup.link);
  if(!providerName&&!lookupCode&&!lookupUrl)return null;
  const providerCandidate=digits(head.msttcgp||row.msttcgp)||providerFromXmlFields(detail);
  const providerMst=validMst(providerCandidate)?providerCandidate:'';
  return {
   session_mst:digits(sessionMst),
   form_code:form+':'+template,series,invoice_number:number,
   provider_name:providerName,
   provider_mst:providerMst,
   lookup_url:lookupUrl,
   lookup_code:lookupCode,
   buyer_mst:digits(head.nmmst||row.nmmst),
   seller_mst:digits(head.nbmst||row.nbmst)
  };
 }
 async function submit(records,session){
  const input=(records||[]).filter(Boolean);
  if(!input.length)return {received:0,registered:0,skipped:0,rejected:0,pending:0};
  if(!session?.access_token)throw Error('Phiên AutoTax đã hết hạn, không đồng bộ được thông tin chân PDF.');
  const result={received:0,registered:0,skipped:0,rejected:0,pending:0};
  for(let i=0;i<input.length;i+=100){
   const response=await fetch(API,{
    method:'POST',headers:{
     apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({p_records:input.slice(i,i+100)})
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error('Không lưu được thông tin chân PDF ('+response.status+'): '+String(body.message||body.error||'Lỗi kết nối'));
   result.received+=Number(body.received||0);
   result.registered+=Number(body.registered||0);
   result.skipped+=Number(body.skipped||0);
   result.rejected+=Number(body.rejected||0);
  }
  return result;
 }
 window.AutoTaxIssuerReference=Object.freeze({sample,submit});
})();
