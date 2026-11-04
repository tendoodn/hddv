/* The portal download button reads the current release URL from Supabase.
   Upload automation must update addon_public_settings.extension_download_url when a new ZIP is published. */
(()=>{
'use strict';
const buttons=['extensionDownloadBtn','extensionHeaderDownloadBtn'].map(id=>document.getElementById(id)).filter(Boolean);
if(!buttons.length||!window.supabase)return;
const client=window.supabase.createClient('https://ucqqjdsoyvvaxswzbhaw.supabase.co','sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ');
let lastCheck=0;
async function updateLink(){
 if(Date.now()-lastCheck<30000)return;
 lastCheck=Date.now();
 try{
  const {data,error}=await client.from('addon_public_settings').select('value').eq('setting_key','extension_download_url').maybeSingle();
  if(error)throw error;
  const url=String(data?.value||'').trim();
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!['drive.google.com','github.com'].includes(parsed.hostname))return;
  for(const button of buttons){
   button.href=parsed.href;
   button.title='Tải gói Extension AutoTax mới nhất từ '+parsed.hostname;
  }
 }catch(e){console.warn('AutoTax: không đồng bộ được link tải Extension',e)}
}
void updateLink();
window.addEventListener('focus',()=>void updateLink());
for(const button of buttons)button.addEventListener('pointerenter',()=>void updateLink());
// Keep an already-open account page in sync after an automated Drive release.
setInterval(()=>{if(!document.hidden)void updateLink()},60000);
})();