/* AutoTax V1.1.3 Web: encrypted device-local catalog; paid cloud copy with Supabase RLS. */
(()=>{
'use strict';
const DB='autotax_web_stock_catalog_v113';
let dbPromise;
function db(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{
   const database=req.result;
   database.createObjectStore('keys');
   database.createObjectStore('catalogs');
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('IndexedDB không sẵn sàng'));
 });
 return dbPromise;
}
async function tx(store,mode,method,key,value){
 const d=await db();
 return new Promise((resolve,reject)=>{
  const transaction=d.transaction(store,mode);
  const request=method==='get'?transaction.objectStore(store).get(key):
   transaction.objectStore(store).put(value,key);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
async function cryptoKey(){
 let key=await tx('keys','readonly','get','main');
 if(!key){
  key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  await tx('keys','readwrite','put','main',key);
 }
 return key;
}
const keyOf=(user,platform)=>user+':'+platform;
const valid=v=>!!v&&Array.isArray(v.products)&&v.products.length>0&&
 typeof v.updatedAt==='string'&&v.products.every(x=>x&&typeof x.sku==='string'&&typeof x.name==='string');
async function saveLocal(user,platform,value){
 if(!user||!['misa','tendoo'].includes(platform)||!valid(value))throw Error('Dữ liệu danh mục không hợp lệ.');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptoKey(),
  new TextEncoder().encode(JSON.stringify(value)));
 await tx('catalogs','readwrite','put',keyOf(user,platform),
  {iv:Array.from(iv),data:bytes});
 return value;
}
async function loadLocal(user,platform){
 if(!user)return null;
 const saved=await tx('catalogs','readonly','get',keyOf(user,platform));
 if(!saved)return null;
 try{
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(saved.iv)},
   await cryptoKey(),saved.data);
  const value=JSON.parse(new TextDecoder().decode(bytes));
  return valid(value)?value:null;
 }catch{return null}
}
async function entitled(client){
 if(!client)return false;
 const {data,error}=await client.rpc('addon_has_data_storage');
 return !error&&data===true;
}
async function loadCloud(user,platform,client){
 if(!client||!await entitled(client))return null;
 const {data,error}=await client.from('addon_user_stock_catalogs')
  .select('catalog').eq('user_id',user).eq('platform',platform).maybeSingle();
 if(error)throw Error(error.message);
 return valid(data?.catalog)?data.catalog:null;
}
async function saveCloud(user,platform,value,client){
 if(!client||!await entitled(client))return false;
 const {error}=await client.from('addon_user_stock_catalogs')
  .upsert({user_id:user,platform,catalog:value,updated_at:new Date().toISOString()},
   {onConflict:'user_id,platform'});
 if(error)throw Error(error.message);
 return true;
}
async function restore(user,platform,client){
 const local=await loadLocal(user,platform);
 try{
  const remote=await loadCloud(user,platform,client);
  if(!remote)return {catalog:local,source:local?'local':'none'};
  if(!local||Date.parse(remote.updatedAt)>Date.parse(local.updatedAt)){
   await saveLocal(user,platform,remote);
   return {catalog:remote,source:'online'};
  }
  if(Date.parse(local.updatedAt)>Date.parse(remote.updatedAt))
   await saveCloud(user,platform,local,client);
  return {catalog:local,source:'local'};
 }catch(error){
  return {catalog:local,source:local?'local':'none',warning:error.message};
 }
}
window.AutoTaxWebStockCache=Object.freeze({
 saveLocal,loadLocal,saveCloud,loadCloud,restore,entitled,
 makePayload:(name,products)=>({
  filename:String(name||'catalog.xlsx').slice(0,180),products,
  updatedAt:new Date().toISOString()
 })
});
})();
