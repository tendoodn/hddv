/* AutoTax v1.1.27 - signed-in team-member invoice cache invalidation.
 * No billing records, package balances, passwords, SKU catalogs or other accounts are modified.
 * Each browser origin deletes only invoice payloads scoped to the authenticated user.
 */
(()=>{
 'use strict';
 const API="https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/rpc/autotax_my_invoice_cache_reset_v122";
 const KEY="sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ";
 const prefix="autotax_member_invoice_cache_epoch_v122:";
 const inFlight=new Map();
 const userOk=v=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(v||''));
 async function check({userId,token}={}){
  if(!userOk(userId)||!token)return {cleared:false,reason:"missing_session"};
  if(inFlight.has(userId))return inFlight.get(userId);
  const task=(async()=>{
   const response=await fetch(API,{
    method:"POST",cache:"no-store",
    headers:{apikey:KEY,Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:"{}"
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data?.message||data?.error||"Không đọc được thông báo xóa cache nhóm.");
   const epoch=typeof data?.reset_at==="string"?data.reset_at:"";
   if(!epoch)return {cleared:false,reason:"not_reset"};
   const key=prefix+userId;
   let previous="";
   try{previous=localStorage.getItem(key)||""}catch{}
   if(previous===epoch)return {cleared:false,reason:"already_applied"};
   const cache=window.AutoTaxInvoiceCache;
   if(typeof cache?.clearForAccount!=="function")return {cleared:false,reason:"cache_unavailable"};
   const deleted=await cache.clearForAccount(userId);
   try{localStorage.setItem(key,epoch)}catch{ /* Retry on next launch if storage is blocked. */ }
   document.dispatchEvent(new CustomEvent("autotax-member-invoice-cache-reset",{
    detail:{userId,deleted:Number(deleted)||0,resetAt:epoch}
   }));
   return {cleared:true,deleted:Number(deleted)||0,resetAt:epoch};
  })();
  inFlight.set(userId,task);
  try{return await task}finally{inFlight.delete(userId)}
 }
 window.AutoTaxMemberCacheReset=Object.freeze({check});
 // Extension session events are emitted after login/license refresh and also
 // on initial sidebar recovery. This invalidates cache before a new scan.
 document.addEventListener("autotax-license-change",event=>{
  const session=event.detail?.session;
  if(!session?.access_token||!session?.user?.id)return;
  void check({userId:session.user.id,token:session.access_token})
   .catch(error=>console.warn("AutoTax member cache reset:",error.message));
 });
})();
