/* AutoTax Web v3.4: account-scoped MST picker and encrypted device credentials.
 * No vault passphrase UI. Credentials are encrypted with a non-extractable
 * WebCrypto AES-GCM key stored in IndexedDB on THIS device/browser only.
 * Profile names and MSTs come from Supabase; TAX PASSWORDS NEVER DO.
 * Legacy passphrase-protected localStorage data is intentionally left intact,
 * but cannot be decrypted without its original passphrase. Enter the GDT
 * password again once to save it in the new device-local scheme.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const normalize=v=>String(v||'').replace(/\D/g,'');
const MAX_PASS=256;
const DB_NAME='autotax_gdt_device_credentials_v2';
let owner='',profiles=[],dbPromise=null,deviceKey=null,requestSeq=0;
const lastKey=()=> 'autotax_last_mst_'+owner;
const entryKey=mst=>owner+':'+mst;
const asArray=v=>v instanceof Uint8Array?v:new Uint8Array(v);
function notify(message,error=false){
 const e=$('mstPickerNotice');
 if(e){e.textContent=message;e.classList.toggle('error',error)}
}
function openDB(){
 if(!dbPromise){
  dbPromise=new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB_NAME,1);
   req.onupgradeneeded=()=>{
    const db=req.result;
    if(!db.objectStoreNames.contains('keys'))db.createObjectStore('keys');
    if(!db.objectStoreNames.contains('credentials'))db.createObjectStore('credentials');
   };
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||Error('Không mở được bộ nhớ mã hóa.'));
   req.onblocked=()=>reject(Error('Bộ nhớ đang được sử dụng ở tab khác.'));
  }).catch(e=>{dbPromise=null;throw e});
 }
 return dbPromise;
}
async function readStore(store,key){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const req=db.transaction(store,'readonly').objectStore(store).get(key);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}
async function writeStore(store,key,value){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readwrite');
  tx.objectStore(store).put(value,key);
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(tx.error);
 });
}
async function deleteStore(store,key){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readwrite');
  tx.objectStore(store).delete(key);
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(tx.error);
 });
}
async function getDeviceKey(){
 if(!owner)throw Error('Chưa đăng nhập AutoTax.');
 if(deviceKey)return deviceKey;
 // Generate before opening transaction so it stays active, then serialize
 // competing tabs on the same database key with a read-write transaction.
 const proposed=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const db=await openDB(),keyName='account:'+owner;
 const result=await new Promise((resolve,reject)=>{
  const tx=db.transaction('keys','readwrite'),store=tx.objectStore('keys');
  const req=store.get(keyName);
  let stored;
  req.onsuccess=()=>{
   if(req.result)stored=req.result;
   else {stored=proposed;store.put(proposed,keyName)}
  };
  tx.oncomplete=()=>resolve(stored);
  tx.onerror=()=>reject(tx.error);
 });
 deviceKey=result;
 return result;
}
async function encryptPassword(pass){
 const key=await getDeviceKey(),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},
   key,new TextEncoder().encode(pass)));
 return {v:2,iv:Array.from(iv),data:Array.from(data)};
}
async function decryptPassword(record){
 if(record?.v!==2||!Array.isArray(record.iv)||!Array.isArray(record.data))
  throw Error('Định dạng mật khẩu lưu không hợp lệ.');
 const key=await getDeviceKey();
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:asArray(record.iv)},
  key,asArray(record.data));
 return new TextDecoder().decode(plain);
}
const mstName=profile=>profile.display_name||profile.name||'Chưa đặt tên hồ sơ';
function renderPicker(){
 const select=$('mst'),old=select.value;
 const remembered=owner?localStorage.getItem(lastKey()):null;
 select.replaceChildren();
 const empty=document.createElement('option');
 empty.value='';empty.textContent='Chọn MST';select.append(empty);
 const menu=$('mstPickerMenu');menu.replaceChildren();
 for(const p of profiles){
  const mst=p.mst;
  const opt=document.createElement('option');
  opt.value=mst;opt.textContent=mst+' — '+mstName(p);
  select.append(opt);
  const card=document.createElement('div');card.className='mst-picker-card';
  const pick=document.createElement('button');
  pick.type='button';pick.className='mst-picker-choice';
  const number=document.createElement('strong');number.textContent=mst;
  const alias=document.createElement('small');alias.textContent=mstName(p);
  pick.append(number,alias);
  pick.addEventListener('click',()=>{
   select.value=mst;select.dispatchEvent(new Event('change',{bubbles:true}));
   menu.hidden=true;$('mstPickerToggle').setAttribute('aria-expanded','false');
  });
  card.append(pick);
  const remove=document.createElement('button');remove.type='button';
  remove.className='mst-picker-remove';remove.textContent='♢';
  remove.title='Gỡ MST khỏi tài khoản (không xóa lịch sử hóa đơn)';
  remove.setAttribute('aria-label','Xóa hồ sơ '+mst);
  remove.addEventListener('click',async()=>{
   if(!confirm('Xóa hồ sơ '+mst+'? Hạn mức và lịch sử hóa đơn không bị xóa.'))return;
   remove.disabled=true;
   try{
    const client=window.WebInvoiceApp?.getClient?.();
    if(!client)throw Error('Chưa kết nối Supabase.');
    const {error}=await client.rpc('addon_remove_mst_profile_v33',{p_mst:mst});
    if(error)throw error;
    await deleteStore('credentials',entryKey(mst)).catch(()=>{});
    if(select.value===mst){select.value='';$('gdtPassword').value=''}
    await window.WebInvoiceApp?.refreshAccount?.();
    notify('Đã gỡ '+mst+' khỏi tài khoản AutoTax.');
   }catch(e){notify('Không gỡ được hồ sơ: '+(e.message||e),true);remove.disabled=false}
  });
  card.append(remove);menu.append(card);
 }
 const wanted=profiles.some(p=>p.mst===old)?old:
  profiles.some(p=>p.mst===remembered)?remembered:profiles[0]?.mst||'';
 select.value=wanted;
 $('mstProfileCount').textContent=profiles.length+' hồ sơ';
 updateChosen();
}
function updateChosen(){
 const mst=$('mst').value,p=profiles.find(x=>x.mst===mst);
 $('mstPickerToggle').textContent=p?
  p.mst+' · '+mstName(p)+' ▾':'Chọn hồ sơ MST ▾';
 for(const card of $('mstPickerMenu').children){
  const chosen=card.querySelector('.mst-picker-choice');
  const selected=!!chosen&&chosen.querySelector('strong')?.textContent===mst;
  card.classList.toggle('selected',selected);
  if(selected){
   const badge=document.createElement('span');badge.className='mst-picker-selected';
   badge.textContent='Đang chọn';
   chosen.append(badge);
  }else chosen?.querySelectorAll('.mst-picker-selected').forEach(el=>el.remove());
 }
}
async function select(mst){
 const input=$('gdtPassword');input.value='';
 const stamp=++requestSeq;
 updateChosen();
 if(!owner||!profiles.some(p=>p.mst===mst))return;
 try{localStorage.setItem(lastKey(),mst)}catch{}
 try{
  const record=await readStore('credentials',entryKey(mst));
  if(stamp!==requestSeq||$('mst').value!==mst)return;
  if(!record){
   notify('Chưa lưu mật khẩu cổng Thuế trên thiết bị này. Nhập một lần để tự ghi nhớ sau khi đăng nhập thành công.');
   return;
  }
  const password=await decryptPassword(record);
  if(stamp!==requestSeq||$('mst').value!==mst)return;
  input.value=password;
  notify('Đã tự điền mật khẩu mã hóa của MST '+mst+' trên thiết bị này.');
 }catch(e){if(stamp===requestSeq)notify('Không đọc được mật khẩu đã lưu. Hãy nhập lại: '+(e.message||e),true)}
}
async function setUser(userId,rows){
 const changed=(userId||'')!==owner;
 if(changed){
  owner=userId||'';deviceKey=null;requestSeq++;$('gdtPassword').value='';
  $('mstPickerMenu').hidden=true;$('mstPickerToggle').setAttribute('aria-expanded','false');
 }
 profiles=[...new Map((rows||[]).map(x=>{
  const mst=normalize(typeof x==='object'?x.mst:x);
  return [mst,{mst,display_name:typeof x==='object'?String(x.display_name||'').slice(0,120):''}];
 }).filter(([mst])=>/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))).values()];
 renderPicker();
 if(owner&&$('mst').value)await select($('mst').value);
 if(!owner)notify('Đăng nhập AutoTax để xem hồ sơ MST đã liên kết.');
}
async function saveAfterLogin(mst,password){
 if(!owner||!profiles.some(p=>p.mst===mst)||!password||password.length>MAX_PASS)return;
 try{
  await writeStore('credentials',entryKey(mst),await encryptPassword(password));
  notify('Đã lưu mật khẩu Thuế đã mã hóa cho '+mst+' trên trình duyệt này. Không gửi lên Supabase.');
 }catch(e){notify('Không thể lưu mật khẩu vào bộ nhớ được mã hóa: '+(e.message||e),true)}
}
async function forget(mst=$('mst').value){
 if(!owner||!mst)return;
 await deleteStore('credentials',entryKey(mst));
 $('gdtPassword').value='';notify('Đã xóa mật khẩu cổng Thuế đã lưu cho '+mst+'.');
}
const hasSaved=async mst=>!!owner&&!!await readStore('credentials',entryKey(mst)).catch(()=>null);
function lock(){requestSeq++;deviceKey=null;$('gdtPassword').value=''}
function init(){
 $('mstPickerToggle').addEventListener('click',()=>{
  const menu=$('mstPickerMenu');menu.hidden=!menu.hidden;
  $('mstPickerToggle').setAttribute('aria-expanded',String(!menu.hidden));
 });
 $('mst').addEventListener('change',()=>void select($('mst').value));
 $('mstForgetPassword').addEventListener('click',()=>{
  if(confirm('Xóa mật khẩu cổng Thuế đã lưu của MST đang chọn trên thiết bị này?'))
   void forget().catch(e=>notify(e.message,true));
 });
}
window.GdtVault={setUser,select,saveAfterLogin,forget,lock,hasSaved};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
