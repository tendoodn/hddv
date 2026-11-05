/* Deep links from the unified AutoTax Web account menu. */
(()=>{
'use strict';
const action={feedback:'feedbackOpen',gift:'giftWebBtn',profile:'accountEditProfile'}[
 new URLSearchParams(location.search).get('panel')
];
if(!action)return;
const client=window.AutoTaxSharedClient;
let used=false;
async function openWhenSignedIn(){
 if(used||!client)return;
 const {data:{session}}=await client.auth.getSession();
 if(!session)return;
 used=true;
 setTimeout(()=>{
  document.getElementById(action)?.click();
  history.replaceState(null,'',location.pathname+location.hash);
 },180);
}
client?.auth.onAuthStateChange((event)=>{
 if(event==='SIGNED_IN'||event==='INITIAL_SESSION')queueMicrotask(()=>void openWhenSignedIn());
});
void openWhenSignedIn();
})();