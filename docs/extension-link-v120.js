/* AutoTax V1.2.0 — all public Extension download buttons resolve the same
 * verified latest ZIP setting, regardless of the last deployed HTML cache. */
(()=>{'use strict';
 const ENDPOINT='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/addon_public_settings?select=value&setting_key=eq.extension_download_url';
 const APIKEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
 const localSelector='#extensionHeaderDownloadBtn,#extensionDownloadBtn,[data-autotax-extension-latest]';
 async function refresh(){
  try{
   const response=await fetch(ENDPOINT,{headers:{apikey:APIKEY},cache:'no-store'});
   if(!response.ok)throw Error('HTTP '+response.status);
   const rows=await response.json();
   const link=new URL(String(rows?.[0]?.value||''));
   const isDrive=link.protocol==='https:'&&link.hostname==='drive.google.com'&&
     /^\/file\/d\/[A-Za-z0-9_-]+\//.test(link.pathname);
   if(!isDrive)throw Error('Link tải Extension không thuộc Google Drive đã xác minh');
   for(const el of document.querySelectorAll(localSelector)){
    el.href=link.href;el.title='Tải phiên bản AutoTax Extension hiện hành';
   }
  }catch(error){console.warn('Giữ liên kết Extension dự phòng:',error.message)}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});
 else void refresh();
})();
