/* AutoTax 1.1.8 – account-scoped encrypted MST password sync.
 * The server stores AES-GCM ciphertext ONLY. CryptoKey is non-exportable and
 * cached in this device's IndexedDB; other devices derive it at AutoTax login.
 * The Supabase table uses owner-only RLS; no service keys in clients.
 */
(()=>{
 'use strict';
 const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/addon_mst_password_v118';
 const APIKEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
 const DB='autotax_cloud_key_v118';
 const VALID=/^(?:\d{10}|\d{12}|\d{13})$/;
 const enc=new TextEncoder(),dec=new TextDecoder();
 const mstOf=v=>String(v||'').replace(/\D/g,'');
 const bytesToBase64=a=>{let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)};
 const base64ToBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 let provider=null,opening=null;
 function db(){
  if(!opening)opening=new Promise((resolve,reject)=>{
   const r=indexedDB.open(DB,1);
   r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('keys'))r.result.createObjectStore('keys')};
   r.onsuccess=()=>resolve(r.result);
   r.onerror=()=>reject(r.error||Error('Không mở được bộ nhớ khóa đồng bộ.'));
  }).catch(e=>{opening=null;throw e});
  return opening;
 }
 async function keyOp(user,action,value){
  const d=await db();
  return new Promise((resolve,reject)=>{
   const tx=d.transaction('keys',action==='get'?'readonly':'readwrite');
   const store=tx.objectStore('keys');
   const req=action==='get'?store.get(user):action==='set'?store.put(value,user):store.delete(user);
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error);
   tx.onerror=()=>reject(tx.error);
  });
 }
 async function derive(user,password){
  const base=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  const salt=enc.encode('AutoTax:cross-device:tax-mst:v118:'+user);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},base,
   {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 }
 async function crypt(key,password){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(password)));
  return {iv:bytesToBase64(iv),ciphertext:bytesToBase64(ciphertext),key_version:1};
 }
 async function uncrypt(key,row){
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(row.iv)},
   key,base64ToBytes(row.ciphertext));
  return dec.decode(plain);
 }
 function setAuthProvider(fn){if(typeof fn!=='function')throw TypeError('auth provider');provider=fn}
 async function context(){
  const obj=await provider?.();
  const userId=String(obj?.userId||''),token=String(obj?.token||'');
  if(!/^[0-9a-f-]{36}$/i.test(userId)||!token)throw Error('Vui lòng đăng nhập tài khoản AutoTax.');
  return {userId,token};
 }
 function headers(token){return {apikey:APIKEY,Authorization:'Bearer '+token,'Content-Type':'application/json'}}
 async function cloud(ctx,method,query='',body=null,extra={}){
  const url=BASE+(query?'?'+query:'');
  const r=await fetch(url,{method,cache:'no-store',headers:{...headers(ctx.token),...extra},...(body!==null?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('Không đồng bộ được MST với Supabase (HTTP '+r.status+').');
  return r.status===204?null:r.json();
 }
 const ownerFilter=(user)=>'user_id=eq.'+encodeURIComponent(user);
 async function getRows(ctx,mst){
  const conditions=ownerFilter(ctx.userId)+(mst?'&mst=eq.'+encodeURIComponent(mst):'');
  return cloud(ctx,'GET',conditions+'&select=mst,iv,ciphertext,key_version,updated_at&order=mst.asc');
 }
 async function requireKey(user){
  const key=await keyOp(user,'get');
  if(!key)throw Error('Kho đồng bộ chưa mở khóa. Hãy đăng nhập AutoTax bằng email và mật khẩu của tài khoản này một lần.');
  return key;
 }
 async function unlock(user,password){
  if(!/^[0-9a-f-]{36}$/i.test(user)||typeof password!=='string'||!password)throw Error('Tài khoản không hợp lệ.');
  const ctx=await context();
  if(ctx.userId!==user)throw Error('Bạn đang đăng nhập tài khoản khác.');
  const newKey=await derive(user,password),cached=await keyOp(user,'get');
  const rows=await getRows(ctx);
  if(rows?.length){
   try{await uncrypt(newKey,rows[0]);}
   catch{
    if(cached){
     try{await uncrypt(cached,rows[0]);return {unlocked:true,needsRekey:true};}
     catch{/* Neither key matches existing cloud data. */}
    }
    throw Error('Mật khẩu đồng bộ đã thay đổi, không thể giải mã dữ liệu cũ. Hãy đăng nhập trên thiết bị từng lưu MST để khôi phục và cập nhật khóa.');
   }
  }
  await keyOp(user,'set',newKey);
  return {unlocked:true,needsRekey:false};
 }
 async function get(mst){
  const m=mstOf(mst);
  if(!VALID.test(m))throw Error('MST không hợp lệ.');
  const ctx=await context(),key=await requireKey(ctx.userId);
  const rows=await getRows(ctx,m);
  if(!rows?.length)return null;
  try{return await uncrypt(key,rows[0]);}
  catch{throw Error('Mật khẩu MST đã mã hóa bằng khóa khác. Vui lòng kiểm tra mật khẩu tài khoản AutoTax.')}
 }
 async function save(mst,password){
  const m=mstOf(mst);
  if(!VALID.test(m)||typeof password!=='string'||!password||password.length>256)
   throw Error('MST hoặc mật khẩu Thuế không hợp lệ.');
  const ctx=await context(),key=await requireKey(ctx.userId);
  const payload={user_id:ctx.userId,mst:m,...await crypt(key,password),updated_at:new Date().toISOString()};
  await cloud(ctx,'POST','',payload,{Prefer:'resolution=merge-duplicates,return=minimal'});
  return {stored:true};
 }
 async function remove(mst){
  const ctx=await context(),m=mstOf(mst);
  if(!VALID.test(m))return;
  await cloud(ctx,'DELETE',ownerFilter(ctx.userId)+'&mst=eq.'+encodeURIComponent(m),null,{Prefer:'return=minimal'});
 }
 async function importLocal(mst,localPassword){
  if(!localPassword)return false;
  if(await get(mst))return false;
  await save(mst,localPassword);
  return true;
 }
 async function rekey(newPassword){
  const ctx=await context(),old=await requireKey(ctx.userId);
  const rows=await getRows(ctx);
  const newKey=await derive(ctx.userId,newPassword);
  const payload=[];
  for(const row of rows||[]){
   const password=await uncrypt(old,row);
   payload.push({user_id:ctx.userId,mst:row.mst,...await crypt(newKey,password),updated_at:new Date().toISOString()});
  }
  if(payload.length)await cloud(ctx,'POST','',payload,{Prefer:'resolution=merge-duplicates,return=minimal'});
  await keyOp(ctx.userId,'set',newKey);
  return {updated:payload.length};
 }
 async function unlocked(){try{const ctx=await context();return !!await keyOp(ctx.userId,'get')}catch{return false}}
 window.AutoTaxSharedMstVault=Object.freeze({setAuthProvider,unlock,get,save,remove,importLocal,rekey,unlocked});
})();