/* Deep links from the unified AutoTax Web account menu. */
(()=>{
'use strict';
const query=new URLSearchParams(location.search);
const panel=query.get('panel');
const requestedMst=/^(?:\d{10}|\d{12}|\d{13})$/.test(query.get('mst')||'')?query.get('mst'):'';
const action={feedback:'feedbackOpen',gift:'giftWebBtn',profile:'accountEditProfile'}[panel];
if(!action&&panel!=='mst')return;
const client=window.AutoTaxSharedClient;
let used=false;
async function openWhenSignedIn(){
 if(used||!client)return;
 const {data:{session}}=await client.auth.getSession();
 if(!session)return;
 used=true;
 setTimeout(()=>{
  if(panel==='mst'){
   const details=document.getElementById('mstProfilesWeb');
   if(details){
    details.open=true;
    details.scrollIntoView({behavior:'smooth',block:'start'});
    details.querySelector('summary')?.focus?.({preventScroll:true});
    if(requestedMst){
     // Navigating here only opens the editor; it never grants MST permission.
     // The user must still check a profile and explicitly save on Supabase.
     document.getElementById('mstGrantUnlock')?.click();
     const list=document.getElementById('mstList');
     const locate=()=>{
      const row=[...list?.querySelectorAll('.mst-row[data-mst]')||[]]
       .find(node=>node.dataset.mst===requestedMst);
      if(!row)return false;
      const next=document.getElementById('mstPageNext');
      // Advance pagination until the profile is actually on the visible page.
      for(let i=0;i<200&&row.hidden&&!next?.disabled;i++)next?.click();
      row.classList.add('mst-grant-target');
      row.scrollIntoView({behavior:'smooth',block:'center'});
      row.querySelector('.mst-allow-checkbox')?.focus?.({preventScroll:true});
      return true;
     };
     if(!locate()){
      const observer=new MutationObserver(()=>{if(locate())observer.disconnect()});
      if(list)observer.observe(list,{childList:true});
      setTimeout(()=>observer.disconnect(),12000);
     }
    }
   }
  }else document.getElementById(action)?.click();
  history.replaceState(null,'',location.pathname+location.hash);
 },180);
}
client?.auth.onAuthStateChange((event)=>{
 if(event==='SIGNED_IN'||event==='INITIAL_SESSION')queueMicrotask(()=>void openWhenSignedIn());
});
void openWhenSignedIn();
})();