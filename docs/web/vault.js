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
let owner='',profiles=[],dbPromise=null,deviceKey=null,requestSeq=0,invoiceMode=false;
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
 const requestedOwner=owner;
 // Generate before opening transaction so it stays active, then serialize
 // competing tabs on the same database key with a read-write transaction.
 const proposed=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const db=await openDB(),keyName='account:'+requestedOwner;
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
 if(requestedOwner!==owner)throw Error('Tài khoản đã thay đổi trong khi mở khóa thiết bị.');
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
 empty.value='';empty.textContent='＋ Thêm MST mới';select.append(empty);
 const menu=$('mstPickerMenu');menu.replaceChildren();
 const add=document.createElement('button');
 add.type='button';add.className='mst-picker-choice';add.textContent='＋ Thêm MST mới';
 add.addEventListener('click',()=>{
  select.value='';$('mstFree').value='';$('mstFree').hidden=false;
  menu.hidden=true;$('mstPickerToggle').setAttribute('aria-expanded','false');
  $('gdtPassword').value='';updateChosen();$('mstFree').focus();
 });
 menu.append(add);
 const visibleProfiles=invoiceMode?profiles:profiles.filter(p=>p.mst_allowed);
 for(const p of visibleProfiles){
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
   $('mstFree').value='';$('mstFree').hidden=true;select.value=mst;select.dispatchEvent(new Event('change',{bubbles:true}));
   menu.hidden=true;$('mstPickerToggle').setAttribute('aria-expanded','false');
  });
  card.append(pick);
  // Deleting a profile now also removes backend invoice deduction history.
  // Keep this destructive action only in the dedicated customer portal.
  const manage=document.createElement('a');
  manage.href='./';manage.target='_blank';manage.rel='noopener noreferrer';
  manage.className='mst-picker-remove';manage.textContent='Quản lý';

  card.append(manage);menu.append(card);
 }
 const typed=normalize($('mstFree').value);
 const wanted=visibleProfiles.some(p=>p.mst===typed)?typed:
  visibleProfiles.some(p=>p.mst===old)?old:
  visibleProfiles.some(p=>p.mst===remembered)?remembered:visibleProfiles[0]?.mst||'';
 select.value=wanted;$('mstFree').hidden=!!wanted;
 if(wanted)$('mstFree').value='';
 $('mstProfileCount').textContent=visibleProfiles.length+' / '+profiles.length+' hồ sơ';
 updateChosen();
}
function updateChosen(){
 const mst=$('mst').value,p=profiles.find(x=>x.mst===mst);
 $('mstPickerToggle').textContent=p?
  p.mst+' · '+mstName(p)+' ▾':'＋ Thêm MST mới ▾';
 for(const card of $('mstPickerMenu').children){
  const chosen=card.querySelector('.mst-picker-choice');
  const selected=!!chosen&&chosen.querySelector('strong')?.textContent===mst;
  card.classList.toggle('selected',selected);
  chosen?.querySelectorAll('.mst-picker-selected').forEach(el=>el.remove());
  if(selected){
   const badge=document.createElement('span');badge.className='mst-picker-selected';
   badge.textContent='Đang chọn';
   chosen.append(badge);
  }
 }
}
async function select(mst){
 const input=$('gdtPassword');input.value='';
 const stamp=++requestSeq;
 updateChosen();
 if(!owner||!(/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))||
   false)return;
 try{localStorage.setItem(lastKey(),mst)}catch{}
 try{
  const record=await readStore('credentials',entryKey(mst));
  if(stamp!==requestSeq||normalize($('mstFree').value||$('mst').value)!==mst)return;
  if(!record){
   notify('Chưa lưu mật khẩu cổng Thuế trên thiết bị này. Nhập một lần để tự ghi nhớ sau khi đăng nhập thành công.');
   return;
  }
  const password=await decryptPassword(record);
  if(stamp!==requestSeq||normalize($('mstFree').value||$('mst').value)!==mst)return;
  input.value=password;
  notify('Đã tự điền mật khẩu mã hóa của MST '+mst+' trên thiết bị này.');
 }catch(e){if(stamp===requestSeq)notify('Không đọc được mật khẩu đã lưu. Hãy nhập lại: '+(e.message||e),true)}
}
async function setUser(userId,rows,mode='mst'){
 invoiceMode=mode==='invoice';
 $('mstPickerToggle').hidden=false;
 $('mstFree').placeholder=invoiceMode?'Nhập MST bất kỳ (gói số tờ)':'Nhập MST mới để thêm vào gói MST';
 const changed=(userId||'')!==owner;
 if(changed){
  owner=userId||'';deviceKey=null;requestSeq++;$('gdtPassword').value='';
  $('mstPickerMenu').hidden=true;$('mstPickerToggle').setAttribute('aria-expanded','false');
 }
 const previous=changed?[]:[...profiles];
 profiles=[...new Map((rows||[]).map(x=>{
  const mst=normalize(typeof x==='object'?x.mst:x);
  return [mst,{mst,display_name:typeof x==='object'?String(x.display_name||'').slice(0,120):'',mst_allowed:typeof x==='object'?x.mst_allowed===true:false}];
 }).filter(([mst])=>/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))).values()];
 if(owner&&!invoiceMode){
  const allowed=new Set(profiles.map(p=>p.mst));
  for(const old of previous)if(!allowed.has(old.mst))
   await deleteStore('credentials',entryKey(old.mst)).catch(()=>{});
 }
 renderPicker();
 if(owner&&($('mstFree').value||$('mst').value))
  await select(normalize($('mstFree').value||$('mst').value));
 if(!owner)notify('Đăng nhập AutoTax để xem hồ sơ MST đã liên kết.');
}
async function saveAfterLogin(mst,password){
 if(!owner||
    !/^(?:\d{10}|\d{12}|\d{13})$/.test(mst)||!password||password.length>MAX_PASS)return {stored:false};
 try{
  let previous=null;
  try{
   const old=await readStore('credentials',entryKey(mst));
   if(old)previous=await decryptPassword(old);
  }catch{}
  await writeStore('credentials',entryKey(mst),await encryptPassword(password));
  notify('Đã lưu mật khẩu Thuế đã mã hóa cho '+mst+' trên trình duyệt này. Không gửi lên Supabase.');
  return {stored:true,changed:previous!==password};
 }catch(e){notify('Không thể lưu mật khẩu vào bộ nhớ được mã hóa: '+(e.message||e),true);return {stored:false}}
}
async function forget(mst=$('mst').value){
 if(!owner||!mst)return;
 await deleteStore('credentials',entryKey(mst));
 $('gdtPassword').value='';notify('Đã xóa mật khẩu cổng Thuế đã lưu cho '+mst+'.');
}
const hasSaved=async mst=>!!owner&&!!await readStore('credentials',entryKey(mst)).catch(()=>null);
function claimPasswordReminder(mst){
 if(!owner||!mst)return false;
 const key='autotax-tax-password-reminder-v115-'+owner+':'+normalize(mst);
 const today=new Date().toISOString().slice(0,10);
 try{
  if(localStorage.getItem(key)===today)return false;
  localStorage.setItem(key,today);
 }catch{/* Storage disabled: still show a reminder for this session. */}
 return true;
}
function lock(){requestSeq++;deviceKey=null;$('gdtPassword').value=''}
function init(){
 $('mstPickerToggle').addEventListener('click',()=>{
  const menu=$('mstPickerMenu');menu.hidden=!menu.hidden;
  $('mstPickerToggle').setAttribute('aria-expanded',String(!menu.hidden));
 });
 $('mst').addEventListener('change',()=>{
  $('mstFree').value='';$('mstFree').hidden=!!$('mst').value;
  if(!$('mst').value)$('mstFree').focus();
  void select($('mst').value);
 });
 $('mstFree').addEventListener('change',()=>{
  $('mst').value='';void select(normalize($('mstFree').value));
 });
 $('mstForgetPassword').addEventListener('click',()=>{
  if(confirm('Xóa mật khẩu cổng Thuế đã lưu của MST đang chọn trên thiết bị này?'))
   void forget().catch(e=>notify(e.message,true));
 });
}
window.GdtVault={setUser,select,saveAfterLogin,forget,lock,hasSaved,claimPasswordReminder};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
