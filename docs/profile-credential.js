/* Customer portal: AES-GCM encrypted MST passwords using the SAME origin/database
 * and account-specific nonextractable key as docs/web/vault.js.
 * Never uploads passwords, keys, or ciphertext to Supabase.
 */
(()=>{
'use strict';
const DB='autotax_gdt_device_credentials_v2';
const normalize=v=>String(v||'').replace(/\D/g,'');
const valid=v=>/^(?:\d{10}|\d{12}|\d{13})$/.test(normalize(v));
let pendingDB=null;
function database(){
 if(pendingDB)return pendingDB;
 pendingDB=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains('keys'))db.createObjectStore('keys');
   if(!db.objectStoreNames.contains('credentials'))db.createObjectStore('credentials');
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Bộ nhớ mật khẩu không sẵn sàng.'));
 }).catch(e=>{pendingDB=null;throw e});
 return pendingDB;
}
async function key(user){
 const proposed=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('keys','readwrite'),obj=tx.objectStore('keys');
  const req=obj.get('account:'+user);let result;
  req.onsuccess=()=>{
   if(req.result)result=req.result;
   else{result=proposed;obj.put(proposed,'account:'+user)}
  };
  tx.oncomplete=()=>resolve(result);
  tx.onerror=()=>reject(tx.error);
 });
}
async function read(user,mst){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const q=db.transaction('credentials','readonly').objectStore('credentials').get(user+':'+normalize(mst));
  q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
 });
}
async function decrypt(user,record){
 if(!record?.iv||!record?.data)return null;
 const secret=await key(user);
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},
  secret,new Uint8Array(record.data));
 return new TextDecoder().decode(bytes);
}
async function save(user,mst,password){
 if(!user||!valid(mst)||typeof password!=='string'||!password||password.length>256)
  throw Error('Cần tài khoản, MST và mật khẩu hợp lệ.');
 let prior=null;
 try{prior=await decrypt(user,await read(user,mst))}catch{}
 if(prior===password){
  try{await window.AutoTaxSharedMstVault?.importLocal(mst,password);return {stored:true,changed:false,synced:true}}
  catch(e){return {stored:true,changed:false,synced:false,error:e.message}}
 }
 const secret=await key(user),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},
  secret,new TextEncoder().encode(password)));
 const db=await database();
 await new Promise((resolve,reject)=>{
  const tx=db.transaction('credentials','readwrite');
  tx.objectStore('credentials').put({v:2,iv:[...iv],data:[...data]},user+':'+normalize(mst));
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
 try{
  await window.AutoTaxSharedMstVault?.save(mst,password);
  return {stored:true,changed:true,synced:true};
 }catch(e){return {stored:true,changed:true,synced:false,error:e.message}}

}
async function forget(user,mst){
 if(!user||!valid(mst))return;
 const db=await database();
 await new Promise((resolve,reject)=>{
  const tx=db.transaction('credentials','readwrite');
  tx.objectStore('credentials').delete(user+':'+normalize(mst));
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
 await window.AutoTaxSharedMstVault?.remove(mst);
}
const migrationFinished=new Set(),migrationPending=new Map();
async function migrate(user,mst){
 const id=user+':'+normalize(mst);
 if(migrationFinished.has(id))return false;
 if(migrationPending.has(id))return migrationPending.get(id);
 const run=(async()=>{
  const record=await read(user,mst);
  if(!record){migrationFinished.add(id);return false}
  const imported=await window.AutoTaxSharedMstVault?.importLocal(mst,await decrypt(user,record));
  migrationFinished.add(id);
  return imported;
 })();
 migrationPending.set(id,run);
 try{return await run}finally{migrationPending.delete(id)}
}
async function transfer(user,mst){
 if(!user||!valid(mst))throw Error('Hồ sơ MST không hợp lệ.');
 const record=await read(user,mst);
 if(!record)throw Error('Mật khẩu MST chưa lưu trên trình duyệt này. Mở Sửa MST để nhập trước.');
 const password=await decrypt(user,record);
 if(!password)throw Error('Không giải mã được mật khẩu MST.');
 if(!window.chrome?.runtime?.sendMessage)
  throw Error('Cần dùng Chrome/Cốc Cốc với Add-on AutoTax 1.1.6 đã cài.');
 const extensionId='bmdhpbmibdgdhabaeoggkdcmpkdblbla';
 const response=await new Promise((resolve,reject)=>{
  try{
   chrome.runtime.sendMessage(extensionId,{
    type:'autotax-transfer-tax-password',userId:user,mst:normalize(mst),password
   },result=>{
    const e=chrome.runtime.lastError;
    if(e)reject(Error('Không kết nối được Add-on: '+e.message));
    else resolve(result);
   });
  }catch(e){reject(e)}
 });
 if(!response?.ok)throw Error(response?.error||'Add-on không nhận được mật khẩu.');
 return true;
}
window.AutoTaxProfileVault=Object.freeze({save,forget,migrate});
})();
