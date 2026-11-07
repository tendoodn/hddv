/* AutoTax Web v3.4: account-scoped MST picker and encrypted device credentials.
 * No vault passphrase UI. Credentials are encrypted with a non-extractable
 * WebCrypto AES-GCM key stored in IndexedDB on THIS device/browser only.
 * Personal passwords use the account vault. Explicitly shared team credentials
 * are retrieved per use from the server with live membership authorization.
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
let owner='',profiles=[],dbPromise=null,deviceKey=null,deviceKeyPromise=null,keyEpoch=0,requestSeq=0,profileSetEpoch=0,invoiceMode=false,lastRenderedPickerFingerprint='';
const lastKey=()=> 'autotax_last_mst_'+owner;
const searchedKey=()=> 'autotax_last_searched_mst_'+owner;
const validMst=m=>/^(?:\d{10}|\d{12}|\d{13})$/.test(m);
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
 const requestedOwner=owner,epoch=keyEpoch;
 // Coalesce concurrent reads from the same MST picker. Reusing the stored
 // non-extractable key avoids a costly AES key generation on every page load.
 if(deviceKeyPromise?.owner===requestedOwner&&deviceKeyPromise.epoch===epoch)
  return deviceKeyPromise.promise;
 const task=(async()=>{
  const keyName='account:'+requestedOwner;
  let key=await readStore('keys',keyName);
  if(!key){
   // Another tab may create the key while we generate a candidate. The
   // read-write transaction rechecks, preserving the original encrypted data.
   const proposed=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const db=await openDB();
   key=await new Promise((resolve,reject)=>{
    const tx=db.transaction('keys','readwrite'),store=tx.objectStore('keys');
    const req=store.get(keyName);
    let result;
    req.onsuccess=()=>{
     if(req.result)result=req.result;
     else{result=proposed;store.put(proposed,keyName)}
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);
   });
  }
  // Validation belongs INSIDE the shared promise: every concurrent caller
  // must reject a key resolved after account change or pagehide lock.
  if(requestedOwner!==owner||epoch!==keyEpoch)
   throw Error('Tài khoản hoặc kho MST đã thay đổi trong khi mở khóa thiết bị.');
  deviceKey=key;
  return key;
 })();
 deviceKeyPromise={owner:requestedOwner,epoch,promise:task};
 try{return await task}
 finally{
  if(deviceKeyPromise?.promise===task)deviceKeyPromise=null;
 }
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
 $('mstPickerMenu').hidden=true;
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
 $('mstPickerMenu').hidden=false;
 if(showAll)$('mstPickerMenu').querySelectorAll('.mst-picker-card').forEach(card=>card.hidden=false);
 else filterPicker();
}
function renderPicker(){
 const select=$('mst'),input=$('mstFree'),typed=input.value.trim(),old=select.value;
 let remembered='',lastSearched='';
 try{
  if(owner){
   remembered=normalize(localStorage.getItem(lastKey())||'');
   lastSearched=normalize(localStorage.getItem(searchedKey())||'');
  }
 }catch{}
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
  const head=document.createElement('span');head.className='mst-picker-head';
  const number=document.createElement('strong');number.className='mst-picker-tax-id';number.textContent=mst;
  head.append(number);
  if(!invoiceMode){
   const permission=document.createElement('small');
   permission.className='mst-picker-permission';
   permission.append(document.createTextNode(
    p.mst_allowed?'Đã cấp quyền sử dụng ':'Chưa cấp quyền sử dụng '
   ));
   const mark=document.createElement('strong');
   mark.className=p.mst_allowed?'mst-permission-tick':'mst-permission-cross';
   mark.textContent=p.mst_allowed?'✓':'✕';
   mark.setAttribute('aria-label',p.mst_allowed?'Đã được cấp quyền':'Chưa được cấp quyền');
   permission.append(mark);
   head.append(permission);
  }
  const alias=document.createElement('small');alias.textContent=mstName(p);
  pick.append(head,alias);
  pick.addEventListener('click',()=>{
   input.value=mst;select.value=mst;closePicker();
   select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  card.append(pick);
  if(p.source==='team'){
   const granted=p.can_use_mst_package===true||p.personally_authorized===true;
   if(!granted){
    const authorize=document.createElement('button');authorize.type='button';
    authorize.className='mst-picker-grant';authorize.textContent='Cấp quyền MST cá nhân';
    authorize.title='Dùng hạn mức MST cá nhân, không dùng gói MST trưởng nhóm';
    authorize.addEventListener('click',async()=>{
     authorize.disabled=true;
     try{
      const client=window.AutoTaxSharedClient;
      const {error}=await client.rpc('autotax_member_authorize_shared_mst_v120',{p_mst:mst});
      if(error)throw error;
      notify('Đã cấp quyền MST '+mst+' bằng hạn mức cá nhân.');
      await window.AutoTaxRefreshWebAccount?.({force:true});
     }catch(error){notify('Không cấp được quyền MST cá nhân: '+error.message,true)}
     finally{authorize.disabled=false}
    });
    card.append(authorize);
   }else{
    const readonly=document.createElement('small');
    readonly.className='mst-picker-readonly';readonly.textContent='MST chia sẻ · chỉ xem';
    card.append(readonly);
   }
  }else{
   const manage=document.createElement('a');manage.href='/user';
   manage.target='_blank';manage.rel='noopener noreferrer';manage.className='mst-picker-remove';
   manage.textContent='Quản lý';card.append(manage);
  }
  menu.append(card);
 }
 const valid=m=>profiles.some(p=>p.mst===m);
 const typedMst=normalize(typed);
 // Restore the last completed lookup, including arbitrary IDs in invoice mode.
 // Never replace a new ID that the user is actively typing.
 const recent=validMst(lastSearched)&&(valid(lastSearched)||invoiceMode)?lastSearched:'';
 const wanted=valid(typedMst)?typedMst:valid(old)?old:
  (recent||(valid(remembered)?remembered:ordered[0]?.mst||''));
 select.value=valid(wanted)?wanted:'';
 input.hidden=false;
 if(!typed||valid(typedMst))input.value=wanted;
 $('mstProfileCount').textContent=profiles.length+' hồ sơ đã lưu';
 updateChosen();
 if(!menu.hidden)filterPicker();
}
function updateChosen(){
 const mst=$('mst').value;
 for(const card of $('mstPickerMenu').querySelectorAll('.mst-picker-card')){
  const selected=card.querySelector('strong')?.textContent===mst;
  card.classList.toggle('selected',selected);
  card.querySelector('.mst-picker-selected')?.remove();
  if(selected){
   const badge=document.createElement('span');badge.className='mst-picker-selected';
   badge.textContent='Gần đây';
   const head=card.querySelector('.mst-picker-head');
   const permission=head?.querySelector('.mst-picker-permission');
   if(permission)head.insertBefore(badge,permission);else head?.append(badge);
  }
 }
}
async function select(mst){
 const input=$('gdtPassword');input.value='';input.type='password';
 const borrowed=profiles.some(p=>p.mst===mst&&p.source==='team');
 const eye=$('togglePassword'),forget=$('mstForgetPassword');
 if(eye)eye.hidden=borrowed;
 if(forget)forget.hidden=borrowed;
 const stamp=++requestSeq;
 updateChosen();
 if(!owner||!(/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))||
   false)return;
 let previousLast='';try{previousLast=localStorage.getItem(lastKey())||'';localStorage.setItem(lastKey(),mst)}catch{}
 if(previousLast!==mst)renderPicker();
 try{
  // Team password is served only for the MST currently granted to this
  // member; do not save a personal copy to local IndexedDB or user vault.
  const profile=profiles.find(p=>p.mst===mst);
  if(profile?.source==='team'){
   const sharedPassword=await window.AutoTaxTeamShared?.getPassword?.(mst);
   if(stamp!==requestSeq||normalize($('mstFree').value||$('mst').value)!==mst)return;
   if(sharedPassword&&!input.value){
    input.value=sharedPassword;
    notify('Đã tự điền mật khẩu HĐĐT do trưởng nhóm chia sẻ cho MST '+mst+'.');
   }else notify('MST nhóm chưa được cấp mật khẩu HĐĐT. Hãy đề nghị trưởng nhóm đồng bộ mật khẩu.');
   return;
  }
  // The cloud vault and local encrypted device credential are independent.
  // Fetch concurrently; a slow network must not delay the local fallback.
  const [cloudResult,localResult]=await Promise.allSettled([
   Promise.resolve().then(()=>window.AutoTaxSharedMstVault?.get(mst)),
   (async()=>{
    const record=await readStore('credentials',entryKey(mst));
    return record?decryptPassword(record):null;
   })()
  ]);
  if(stamp!==requestSeq||normalize($('mstFree').value||$('mst').value)!==mst||
     input.value)return; // Never overwrite a password the user typed meanwhile.
  const cloud=cloudResult.status==='fulfilled'?cloudResult.value:null;
  const local=localResult.status==='fulfilled'?localResult.value:null;
  if(cloud){
   input.value=cloud;
   notify('Đã tự điền mật khẩu MST '+mst+' từ kho mã hóa đồng bộ Web/Add-on.');
   return;
  }
  if(local){
   input.value=local;
   if(cloudResult.status==='rejected')
    notify('Đã khôi phục mật khẩu MST trên máy; kho đồng bộ đang chờ mở khóa.');
   else notify('Đã khôi phục mật khẩu MST '+mst+' trên máy.');
   void window.AutoTaxSharedMstVault?.importLocal?.(mst,local)?.catch(e=>
    console.warn('Chưa đồng bộ được mật khẩu cũ:',e.message));
   return;
  }
  if(cloudResult.status==='rejected')
   notify('Kho đồng bộ chưa sẵn sàng: '+cloudResult.reason?.message,true);
  else if(localResult.status==='rejected')
   notify('Không đọc được mật khẩu trên máy: '+localResult.reason?.message,true);
  else notify('MST chưa có mật khẩu đồng bộ. Nhập và đăng nhập cổng Thuế một lần để lưu.');
 }catch(e){if(stamp===requestSeq)notify('Không đọc được mật khẩu đã lưu. Hãy nhập lại: '+(e.message||e),true)}
}
async function setUser(userId,rows,mode='mst'){
 const epoch=++profileSetEpoch;
 const wasInvoiceMode=invoiceMode,wasOwner=owner,previousProfilesJson=JSON.stringify(profiles);
 invoiceMode=mode==='invoice';
 $('mstFree').placeholder=invoiceMode?'Nhập hoặc tìm MST (gói số tờ)':'Nhập MST hoặc tìm theo tên hồ sơ';
 const changed=(userId||'')!==owner;
 if(changed){
  owner=userId||'';deviceKey=null;deviceKeyPromise=null;keyEpoch++;requestSeq++;$('gdtPassword').value='';$('mstFree').value='';
  $('mstPickerMenu').hidden=true;
 }
 const previous=changed?[]:[...profiles];
 profiles=[...new Map((rows||[]).map(x=>{
  const mst=normalize(typeof x==='object'?x.mst:x);
  return [mst,{mst,display_name:typeof x==='object'?String(x.display_name||'').slice(0,120):'',
   mst_allowed:typeof x==='object'?x.mst_allowed===true:false,
   source:typeof x==='object'&&x.source==='team'?'team':'personal',
   can_use_mst_package:typeof x==='object'&&x.can_use_mst_package===true,
   personally_authorized:typeof x==='object'&&x.personally_authorized===true}];
 }).filter(([mst])=>/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))).values()];
 const currentIds=new Set(profiles.map(p=>p.mst));
 const revoked=previous.filter(p=>p.source==='team'&&!currentIds.has(p.mst)).map(p=>p.mst);
 if(revoked.length){
  const activeMst=normalize($('mstFree').value||$('mst').value);
  if(revoked.includes(activeMst)){
   $('mstFree').value='';$('mst').value='';$('gdtPassword').value='';
   $('gdtPassword').type='password';
   const eye=$('togglePassword');if(eye)eye.hidden=false;
  }
  document.dispatchEvent(new CustomEvent('autotax-team-msts-revoked',{detail:{msts:revoked}}));
 }
 if(owner&&!invoiceMode){
  const allowed=new Set(profiles.map(p=>p.mst));
  await Promise.allSettled(previous.filter(old=>!allowed.has(old.mst))
   .map(old=>deleteStore('credentials',entryKey(old.mst))));
 }
 if(epoch!==profileSetEpoch)return;
 const renderedFingerprint=JSON.stringify([owner,invoiceMode,profiles]);
 const profilesChanged=wasOwner!==owner||wasInvoiceMode!==invoiceMode||
  previousProfilesJson!==JSON.stringify(profiles)||
  lastRenderedPickerFingerprint!==renderedFingerprint;
 if(profilesChanged){
  renderPicker();
  lastRenderedPickerFingerprint=renderedFingerprint;
 }
 if(profilesChanged&&owner&&($('mstFree').value||$('mst').value))
  // Credential retrieval is async; never block the account dashboard on it.
  void select(normalize($('mstFree').value||$('mst').value))
   .catch(error=>notify('Chưa điền được mật khẩu MST: '+error.message,true));
 if(!owner)notify('Đăng nhập AutoTax để xem hồ sơ MST đã liên kết.');
}
async function saveAfterLogin(mst,password){
 // Borrowed group credentials must not become a permanent personal copy:
 // membership revocation also revokes the right to retrieve them.
 if(profiles.some(p=>p.mst===mst&&p.source==='team'))
  return {stored:false,source:'team',shared:true};
 if(!owner||
    !/^(?:\d{10}|\d{12}|\d{13})$/.test(mst)||!password||password.length>MAX_PASS)return {stored:false};
 try{
  let previous=null;
  try{
   const old=await readStore('credentials',entryKey(mst));
   if(old)previous=await decryptPassword(old);
  }catch{}
  await writeStore('credentials',entryKey(mst),await encryptPassword(password));
  try{await window.AutoTaxTeamShared?.syncOwnedPassword?.(mst,password)}
  catch(e){console.warn('Chưa đồng bộ mật khẩu cho nhóm:',e.message)}
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
 if(!owner||!mst||profiles.some(p=>p.mst===mst&&p.source==='team'))return;
 await window.AutoTaxSharedMstVault?.remove(mst);
 await deleteStore('credentials',entryKey(mst));
 $('gdtPassword').value='';notify('Đã xóa mật khẩu MST '+mst+' trên kho đồng bộ và thiết bị.');
}
const hasSaved=async mst=>!!owner&&!!await readStore('credentials',entryKey(mst)).catch(()=>null);
function rememberSearch(mst){
 const number=normalize(mst);
 if(!owner||!validMst(number))return false;
 try{localStorage.setItem(searchedKey(),number);return true}catch{return false}
}
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
function lock(){requestSeq++;keyEpoch++;deviceKey=null;deviceKeyPromise=null;$('gdtPassword').value=''}
function init(){
 const input=$('mstFree'),selector=$('mst');
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
   !input.contains(event.target))closePicker();
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
window.GdtVault={setUser,select,saveAfterLogin,rememberSearch,forget,lock,hasSaved,claimPasswordReminder};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
