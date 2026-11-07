(()=>{
'use strict';
if(window.__AutoTaxExtensionAuthBridge)return;
window.__AutoTaxExtensionAuthBridge=true;
const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const SOURCE='autotax-web-auth-v1';
const EXT_SOURCE='autotax-extension-auth-v1';
const WEB_AT='autotax_auth_web_sync_at_v1';
const client=window.AutoTaxSharedClient||(window.AutoTaxSharedClient=window.supabase?.createClient(BASE,KEY));
if(!client)return;
let applying=false,resolved=false,lastSent='';
let resolveReady;
window.AutoTaxAuthBridgeReady=new Promise(resolve=>{resolveReady=resolve});
const finish=()=>{if(resolved)return;resolved=true;resolveReady?.()};
const validSession=s=>!!(s&&typeof s.access_token==='string'&&typeof s.refresh_token==='string'&&s.user?.id);
const compact=s=>validSession(s)?{
 access_token:s.access_token,refresh_token:s.refresh_token,token_type:s.token_type||'bearer',
 expires_in:Number(s.expires_in||0)||undefined,expires_at:Number(s.expires_at||0)||undefined,user:s.user
}:null;
const webAt=()=>{try{return Number(localStorage.getItem(WEB_AT)||0)||0}catch{return 0}};
const setWebAt=value=>{try{localStorage.setItem(WEB_AT,String(value))}catch{}};
const post=(type,data={})=>window.postMessage({source:SOURCE,type,...data},location.origin);
function pushState(state,session,syncedAt=Date.now()){
 const payload={state,session:state==='signed_in'?compact(session):null,syncedAt};
 const fp=JSON.stringify([payload.state,payload.session?.access_token||'',payload.session?.refresh_token||'',payload.syncedAt]);
 if(fp===lastSent)return;
 lastSent=fp;setWebAt(syncedAt);post('push',payload);
}
async function applyExtensionState(msg){
 const extAt=Number(msg.syncedAt)||0,currentAt=webAt();
 const {data:{session:current}}=await client.auth.getSession();
 // No shared timestamp yet: only import a valid Add-on session. Never let an
 // old browser session overwrite an explicit Add-on logout marker.
 if(extAt===0){
  if(msg.state==='signed_in'&&validSession(msg.session)&&!current){
   applying=true;
   try{await client.auth.setSession({access_token:msg.session.access_token,refresh_token:msg.session.refresh_token})}
   finally{queueMicrotask(()=>{applying=false})}
  }else if(current)pushState('signed_in',current,Date.now());
  finish();return;
 }
 if(extAt>currentAt){
  applying=true;
  try{
   if(msg.state==='signed_in'&&validSession(msg.session)){
    await client.auth.setSession({access_token:msg.session.access_token,refresh_token:msg.session.refresh_token});
   }else{
    await client.auth.signOut({scope:'local'}).catch(()=>null);
   }
   setWebAt(extAt);
  }finally{queueMicrotask(()=>{applying=false})}
 }else if(currentAt>extAt){
  pushState(current?'signed_in':'signed_out',current,currentAt);
 }else if(msg.state==='signed_out'&&current){
  applying=true;
  try{await client.auth.signOut({scope:'local'}).catch(()=>null)}
  finally{queueMicrotask(()=>{applying=false})}
 }
 finish();
}
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin)return;
 const msg=event.data;
 if(!msg||msg.source!==EXT_SOURCE||msg.type!=='state')return;
 void applyExtensionState(msg).catch(()=>finish());
});
client.auth.onAuthStateChange((event,session)=>{
 queueMicrotask(()=>{
  if(!resolved||applying)return;
  if(['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)&&session)
   pushState('signed_in',session,Date.now());
  else if(event==='SIGNED_OUT')pushState('signed_out',null,Date.now());
 });
});
post('pull');
setTimeout(finish,250);
})();