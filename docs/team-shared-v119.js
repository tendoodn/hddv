/* AutoTax shared team MST contract (Web + Chrome Add-on).
 * Shared MST passwords are returned only for active, explicitly authorized members.
 * Server encrypts each shared credential and verifies team permissions on every read.
 * Every request is authorized by the currently signed-in account on Supabase.
 */
(()=>{
 'use strict';
 const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/rpc/';
 const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
 const NORMAL=v=>String(v||'').replace(/\D/g,'');
 const VALID=v=>/^(?:\d{10}|\d{12}|\d{13})$/.test(NORMAL(v));
 let authProvider=null;
 function setAuthProvider(fn){if(typeof fn!=='function')throw TypeError('auth provider must be a function');authProvider=fn}
 async function context(){
  if(authProvider){
   const supplied=await authProvider();
   if(supplied?.token&&supplied?.userId)return supplied;
  }
  const client=window.AutoTaxSharedClient;
  if(client?.auth?.getSession){
   const {data,error}=await client.auth.getSession();
   if(error)throw error;
   const session=data?.session;
   if(session?.user?.id&&session.access_token)return {userId:session.user.id,token:session.access_token};
  }
  if(typeof chrome!=='undefined'&&chrome.storage?.local){
   // Chrome Extension private origin stores its own authenticated Supabase session.
   let session=(await chrome.storage.local.get('autotax_license_session_v1')).autotax_license_session_v1;
   if(session?.expires_at&&session.expires_at*1000<Date.now()+30000){
    await window.License?.check?.();
    session=(await chrome.storage.local.get('autotax_license_session_v1')).autotax_license_session_v1;
   }
   if(session?.user?.id&&session.access_token)return {userId:session.user.id,token:session.access_token};
  }
  throw Error('Vui lòng đăng nhập AutoTax trước khi sử dụng dữ liệu nhóm.');
 }
 async function rpc(name,args={}){
  const c=await context();
  const response=await fetch(BASE+name,{method:'POST',cache:'no-store',headers:{
   apikey:KEY,Authorization:'Bearer '+c.token,'Content-Type':'application/json'
  },body:JSON.stringify(args)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.message||data?.error||'Không truy cập được dữ liệu nhóm ('+response.status+').');
  return data;
 }
 async function list(){
  const rows=await rpc('autotax_team_shared_mst_profiles_v119');
  return Array.isArray(rows)?rows:[];
 }
 async function getPassword(mst){
  const id=NORMAL(mst);
  if(!VALID(id))throw Error('Mã số thuế không hợp lệ.');
  const result=await rpc('autotax_team_get_shared_mst_password_v119',{p_mst:id});
  return result?.available===true&&typeof result.password==='string'?result.password:null;
 }
 async function sharePassword(teamId,mst,password){
  const id=NORMAL(mst);
  if(!VALID(id)||!teamId||typeof password!=='string'||!password||password.length>256)
   throw Error('Thông tin chia sẻ mật khẩu MST không hợp lệ.');
  return rpc('autotax_team_share_mst_password_v119',{p_team:teamId,p_mst:id,p_password:password});
 }
 async function syncOwnedPassword(mst,password){
  const id=NORMAL(mst);
  if(!VALID(id)||typeof password!=='string'||!password||password.length>256)
   throw Error('MST hoặc mật khẩu HĐĐT không hợp lệ.');
  return rpc('autotax_team_sync_owner_mst_password_v121',{p_mst:id,p_password:password});
 }
 window.AutoTaxTeamShared=Object.freeze({setAuthProvider,context,list,getPassword,sharePassword,syncOwnedPassword});
})();