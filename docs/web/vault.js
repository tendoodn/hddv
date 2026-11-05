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
function closePicker(){
 $('mstPickerMenu').hidden=true;$('mstPickerToggle').setAttribute('aria-expanded','false');
}
function filterPicker(){
 const query=$('mstFree').value.trim().toLocaleLowerCase('vi-VN');
 const numeric=normalize(query);
 for(const card of $('mstPickerMenu').querySelectorAll('.mst-picker-card')){
  const text=card.textContent.toLocaleLowerCase('vi-VN');
  card.hidden=!!query&&!text.includes(query)&&(!numeric||!text.includes(numeric));
 }
}
function openPicker(showAll=false){
 $('mstPickerMenu').hidden=false;$('mstPickerToggle').setAttribute('aria-expanded','true');
 if(showAll)$('mstPickerMenu').querySelectorAll('.mst-picker-card').forEach(card=>card.hidden=false);
 else filterPicker();
}
function renderPicker(){
 const select=$('mst'),input=$('mstFree'),typed=input.value.trim(),old=select.value;
 let remembered='';try{remembered=owner?localStorage.getItem(lastKey())||'':''}catch{}
 select.replaceChildren();
 const empty=document.createElement('option');empty.value='';empty.textContent='MST đã lưu';select.append(empty);
 const menu=$('mstPickerMenu');menu.replaceChildren();
 // MST mới được nhập trực tiếp vào ô tìm kiếm, không thêm mục lựa chọn riêng.
 const ordered=[...profiles].sort((a,b)=>{
  if(a.mst===remembered)return -1;
  if(b.mst===remembered)return 1;
  return mstName(a).localeCompare(mstName(b),'vi',{sensitivity:'base'})||
   a.mst.localeCompare(b.mst);
 });
 for(const p of ordered){
  const mst=p.mst;
  const option=document.createElement('option');
  option.value=mst;option.textContent=mst+' — '+mstName(p);select.append(option);
  const card=document.createElement('div');card.className='mst-picker-card';
  const pick=document.createElement('button');pick.type='button';pick.className='mst-picker-choice';
  const number=document.createElement('strong');number.textContent=mst;
  const alias=document.createElement('small');alias.textContent=mstName(p);
  pick.append(number,alias);
  if(!invoiceMode){
   const permission=document.createElement('small');
   permission.textContent=p.mst_allowed?'✓ Đã cấp quyền sử dụng':'✕ Chưa cấp quyền sử dụng';
   permission.className=p.mst_allowed?'mst-picker-allowed':'mst-picker-not-allowed';
   pick.append(permission);
  }
  pick.addEventListener('click',()=>{
   input.value=mst;select.value=mst;closePicker();
   select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  card.append(pick);
  const manage=document.createElement('a');manage.href='/user';
  manage.target='_blank';manage.rel='noopener noreferrer';manage.className='mst-picker-remove';
  manage.textContent='Quản lý';card.append(manage);menu.append(card);
 }
 const valid=m=>profiles.some(p=>p.mst===m);
 const typedMst=normalize(typed),wanted=valid(typedMst)?typedMst:
  valid(old)?old:valid(remembered)?remembered:ordered[0]?.mst||'';
 select.value=wanted;
 input.hidden=false;
 if(!typed||valid(typedMst))input.value=wanted;
 $('mstProfileCount').textContent=profiles.length+' hồ sơ đã lưu';
 updateChosen();
 if(!menu.hidden)filterPicker();
}
function updateChosen(){
 const mst=$('mst').value;
 $('mstPickerToggle').textContent='▾';
 for(const card of $('mstPickerMenu').querySelectorAll('.mst-picker-card')){
  const selected=card.querySelector('strong')?.textContent===mst;
  card.classList.toggle('selected',selected);
  card.querySelector('.mst-picker-selected')?.remove();
  if(selected){
   const badge=document.createElement('span');badge.className='mst-picker-selected';
   badge.textContent='Gần đây';card.querySelector('.mst-picker-choice')?.append(badge);
  }
 }
}
async function select(mst){
 const input=$('gdtPassword');input.value='';
 const stamp=++requestSeq;
 updateChosen();
 if(!owner||!(/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))||
   false)return;
 let previousLast='';try{previousLast=localStorage.getItem(lastKey())||'';localStorage.setItem(lastKey(),mst)}catch{}
 if(previousLast!==mst)renderPicker();
 try{
  // First read the shared end-to-end encrypted cloud vault; then migrate old local data.
  let cloud=null;
  try{cloud=await window.AutoTaxSharedMstVault?.get(mst)}
  catch(e){notify('Kho đồng bộ chưa sẵn sàng: '+e.message,true)}
  if(stamp!==requestSeq||normalize($('mstFree').value||$('mst').value)!==mst)return;
  if(cloud){
   input.value=cloud;
   notify('Đã tự điền mật khẩu MST '+mst+' từ kho mã hóa đồng bộ Web/Add-on.');
   return;
  }
  const record=await readStore('credentials',entryKey(mst));
  if(!record){
   notify('MST chưa có mật khẩu đồng bộ. Nhập và đăng nhập cổng Thuế một lần để lưu.');
   return;
  }
  const password=await decryptPassword(record);
  if(stamp!==requestSeq||normalize($('mstFree').value||$('mst').value)!==mst)return;
  input.value=password;
  try{await window.AutoTaxSharedMstVault?.importLocal(mst,password)}
  catch(e){notify('Đã đọc mật khẩu cũ trên máy, nhưng chờ đồng bộ: '+e.message,true);return}
  notify('Đã khôi phục mật khẩu MST '+mst+' và đồng bộ lên tài khoản.');
 }catch(e){if(stamp===requestSeq)notify('Không đọc được mật khẩu đã lưu. Hãy nhập lại: '+(e.message||e),true)}
}
async function setUser(userId,rows,mode='mst'){
 const wasInvoiceMode=invoiceMode,wasOwner=owner,previousProfilesJson=JSON.stringify(profiles);
 invoiceMode=mode==='invoice';
 $('mstPickerToggle').hidden=false;
 $('mstFree').placeholder=invoiceMode?'Nhập hoặc tìm MST (gói số tờ)':'Nhập MST hoặc tìm theo tên hồ sơ';
 const changed=(userId||'')!==owner;
 if(changed){
  $('mstPickerToggle').dataset.userPicked='';
  owner=userId||'';deviceKey=null;requestSeq++;$('gdtPassword').value='';$('mstFree').value='';
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
 const profilesChanged=wasOwner!==owner||wasInvoiceMode!==invoiceMode||previousProfilesJson!==JSON.stringify(profiles);
 if(profilesChanged)renderPicker();
 if(profilesChanged&&owner&&($('mstFree').value||$('mst').value))
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
  try{
   await window.AutoTaxSharedMstVault?.save(mst,password);
   notify('Đã đồng bộ mật khẩu Thuế AES-GCM của MST '+mst+' với Web và Add-on.');
   return {stored:true,changed:previous!==password,synced:true};
  }catch(e){
   notify('Đã lưu trên máy nhưng đồng bộ gặp lỗi: '+e.message,true);
   return {stored:true,changed:previous!==password,synced:false,error:e.message};
  }
 }catch(e){notify('Không thể lưu mật khẩu vào bộ nhớ được mã hóa: '+(e.message||e),true);return {stored:false}}
}
async function forget(mst=normalize($('mstFree').value||$('mst').value)){
 if(!owner||!mst)return;
 await window.AutoTaxSharedMstVault?.remove(mst);
 await deleteStore('credentials',entryKey(mst));
 $('gdtPassword').value='';notify('Đã xóa mật khẩu MST '+mst+' trên kho đồng bộ và thiết bị.');
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
 const input=$('mstFree'),selector=$('mst'),toggle=$('mstPickerToggle');
 toggle.addEventListener('click',()=>{$('mstPickerMenu').hidden?openPicker(true):closePicker();});
 input.addEventListener('focus',()=>openPicker(true));
 input.addEventListener('input',()=>{
  const typed=normalize(input.value);
  const exact=profiles.find(p=>p.mst===typed);
  if(typed&&/^(?:\d{10}|\d{12}|\d{13})$/.test(typed)){
   if(exact){
    if(selector.value!==exact.mst)selector.value=exact.mst
   }else selector.value='';
  }else selector.value='';
  requestSeq++;$('gdtPassword').value='';
  openPicker();updateChosen();
  if(exact&&selector.value===exact.mst)void select(exact.mst);
 });
 input.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'){openPicker(true);event.preventDefault();return}
  if(event.key==='Escape'){closePicker();return}
  if(event.key==='Enter'&&!$('mstPickerMenu').hidden){
   const typed=normalize(input.value);
   if(/^(?:\d{10}|\d{12}|\d{13})$/.test(typed)){closePicker();return}
   const first=[...$('mstPickerMenu').querySelectorAll('.mst-picker-card:not([hidden]) .mst-picker-choice')][0];
   if(first){event.preventDefault();first.click()}
  }
 });
 document.addEventListener('pointerdown',event=>{
  if(!$('mstPickerMenu').hidden&&!$('mstPickerMenu').contains(event.target)&&
   !toggle.contains(event.target)&&!input.contains(event.target))closePicker();
 },{capture:true});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')closePicker()});
 selector.addEventListener('change',()=>{
  input.value=selector.value;input.hidden=false;closePicker();
  void select(selector.value);
 });
 input.addEventListener('change',()=>{
  const mst=normalize(input.value);
  if(/^(?:\d{10}|\d{12}|\d{13})$/.test(mst)&&selector.value!==mst){
   selector.value=profiles.some(p=>p.mst===mst)?mst:'';
   void select(mst);
  }
 });
 $('mstForgetPassword').addEventListener('click',()=>{
  if(confirm('Xóa mật khẩu cổng Thuế đã lưu của MST đang nhập?'))
   void forget().catch(e=>notify(e.message,true));
 });
}
window.GdtVault={setUser,select,saveAfterLogin,forget,lock,hasSaved,claimPasswordReminder};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
