/* AutoTax Web: retrieve an original VInvoice PDF previously captured by the
 * installed AutoTax Add-on during the user's legitimate Viettel portal session.
 * No CAPTCHA secrets or invoice bytes are sent to the AutoTax server. */
(() => {
 'use strict';
 const ORIGIN='https://tracuuhoadon.top';
 const REQUEST='AUTOTAX_VINVOICE_WEB_REQUEST_V1';
 const REPLY='AUTOTAX_VINVOICE_WEB_REPLY_V1';
 const PING='AUTOTAX_VINVOICE_WEB_PING_V1';
 const PONG='AUTOTAX_VINVOICE_WEB_READY_V1';
 const MAX=12*1024*1024;
 let available=null;
 const id=()=>crypto.randomUUID();
 const clean=v=>String(v??'').replace(/\D/g,'');
 const validPdf=b=>b?.length>=5&&b[0]===37&&b[1]===80&&b[2]===68&&b[3]===70&&b[4]===45;
 function matches(lookup,row,detail){
  try{if(new URL(String(lookup?.link||'')).hostname==='vinvoice.viettel.vn')return true}catch{}
  return /viettel|s[ -]?invoice/i.test(String(lookup?.name||''))||
   String(detail?.head?.msttcgp||row?.msttcgp||'')==='0100109106';
 }
 function exchange(source,expected,request,timeout){
  return new Promise(resolve=>{
   if(location.origin!==ORIGIN)return resolve(null);
   const timeoutId=setTimeout(()=>{removeEventListener('message',listen);resolve(null)},timeout);
   function listen(event){
    if(event.source!==window||event.origin!==ORIGIN||
       event.data?.source!==expected||event.data?.requestId!==request.requestId)return;
    clearTimeout(timeoutId);removeEventListener('message',listen);resolve(event.data);
   }
   addEventListener('message',listen);
   postMessage({source,...request},ORIGIN);
  });
 }
 async function hasAddon(){
  if(available!==null)return available;
  const probe=await exchange(PING,PONG,{requestId:id()},500);
  available=!!probe;
  return available;
 }
 async function retrieve(row,app=window.WebInvoiceApp){
  if(!await hasAddon())return null;
  const accountId=String(app?.getAccount?.()?.id||'');
  const ownerMst=clean(app?.getMst?.());
  const sellerMst=clean(row?.nbmst);
  const invoiceNumber=String(row?.shdon??'');
  const series=String(row?.khhdon||'');
  if(!/^[0-9a-f-]{36}$/i.test(accountId)||
     !/^(?:\d{10}|\d{12}|\d{13})$/.test(ownerMst)||
     !/^(?:\d{10}|\d{12}|\d{13})$/.test(sellerMst)||
     !invoiceNumber||!series)return null;
  const response=await exchange(REQUEST,REPLY,{
   requestId:id(),accountId,ownerMst,sellerMst,invoiceNumber,series
  },7000);
  const result=response?.result;
  if(!result?.ok||!result.found||typeof result.pdfBase64!=='string'||
      result.pdfBase64.length>Math.ceil(MAX/3)*4+8)return null;
  const decoded=atob(result.pdfBase64);
  if(decoded.length>MAX)return null;
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  return validPdf(bytes)?bytes:null;
 }
 window.AutoTaxVinvoiceBridge=Object.freeze({matches,retrieve,hasAddon});
})();