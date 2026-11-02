/* Local encrypted GDT credential vault.
   Passwords are NEVER stored in plaintext or sent to Supabase for synchronization.
   AES-GCM key derives from a separate user-supplied passphrase and exists in tab memory only. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const encoder=new TextEncoder(),decoder=new TextDecoder();
const iterations=260000;
const b64=u=>btoa(String.fromCharCode(...u));
const bytes=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
const random=n=>crypto.getRandomValues(new Uint8Array(n));
let owner='',key=null,record=null,entries={},profiles=[],recoveryPending=false;
const storageKey=()=> 'autotax_gdt_secret_v1_'+owner;
const lastKey=()=> 'autotax_last_mst_'+owner;
const resetMarkerKey=()=> 'autotax_vault_reset_generation_'+owner;
function status(text,error=false){
 const el=$('vaultStatus');el.textContent=text;el.style.color=error?'#ff96a1':'#9ae6b4';
}
function existing(){try{return JSON.parse(localStorage.getItem(storageKey())||'null')}catch{return null}}
function renderSecretList(){
 const tbody=$('vaultList');tbody.replaceChildren();
 if(!key){$('vaultAfterUnlock').hidden=true;return;}
 $('vaultAfterUnlock').hidden=false;
 const reveal=$('vaultReveal').checked;
 const saved=Object.entries(entries).filter(([mst])=>profiles.includes(mst));
 if(!saved.length){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=2;td.textContent='Chưa lưu mật khẩu cho MST nào.';tr.append(td);tbody.append(tr);
 }
 for(const [mst,password] of saved){
  const tr=document.createElement('tr'),a=document.createElement('td'),b=document.createElement('td');
  a.textContent=mst;
  b.textContent=reveal?password:'••••••••';
  tr.append(a,b);tbody.append(tr);
 }
}
async function checkRemoteReset(){
 if(!owner)return;
 const getClient=window.WebInvoiceApp?.getClient;
 const client=getClient?.();
 if(!client){status('Chưa thể kiểm tra trạng thái khôi phục từ máy chủ.',true);return;}
 try{
  const {data,error}=await client.rpc('addon_my_vault_reset_state');
  if(error)throw error;
  const current=Number(data||0),seen=Number(localStorage.getItem(resetMarkerKey())||0);
  if(current>seen){
   // No remote party can decrypt old encrypted credentials; discard THIS browser's ciphertext.
   localStorage.removeItem(storageKey());
   localStorage.setItem(resetMarkerKey(),String(current));
   key=null;entries={};record=null;recoveryPending=true;
   $('gdtPassword').value='';$('vaultReveal').checked=false;
   $('vaultAfterUnlock').hidden=true;
   $('vaultRecovery').hidden=false;$('vaultPanel').open=true;
   status('Admin đã yêu cầu reset kho. Mật khẩu Thuế từng lưu không thể khôi phục. Nhập mã tạm 0000, sau đó tạo mật khẩu kho mới.',true);
  }else if(current===seen&&seen>0&&!record){
   // Recovery must still be completed after page reload.
   recoveryPending=localStorage.getItem(resetMarkerKey()+'_confirmed')!=='1';
   $('vaultRecovery').hidden=!recoveryPending;
   if(recoveryPending)$('vaultPanel').open=true;
  }
 }catch(e){status('Không xác minh được trạng thái reset kho: '+(e.message||e),true)}
}
function hasSaved(mst){return !!entries[mst]||!!record&&!key}
function refreshList(){
 const node=$('mst'),active=node.value,previous=owner?localStorage.getItem(lastKey()):null;
 node.replaceChildren();
 const empty=document.createElement('option');empty.value='';empty.textContent='Chọn MST từ hồ sơ AutoTax';node.append(empty);
 for(const mst of profiles){
  const opt=document.createElement('option');opt.value=mst;
  opt.textContent=mst+(entries[mst]?' · Đã lưu mật khẩu':'');
  node.append(opt);
 }
 const selected=profiles.includes(active)?active:profiles.includes(previous)?previous:profiles[0]||'';
 node.value=selected;
 $('mstProfileCount').textContent=profiles.length+' hồ sơ';
}
function select(mst){
 const input=$('gdtPassword');input.value='';
 if(mst&&key&&entries[mst]){
  input.value=entries[mst];
  status('Đã điền mật khẩu từ kho mã hóa cho MST '+mst+'.');
 }else if(mst&&record&&!key){
  status('Kho đang khóa. Nhập mật khẩu kho trong mục quản lý để điền mật khẩu đã lưu.');
 }else if(mst)status('MST '+mst+' chưa có mật khẩu lưu trong kho hiện tại.');
 if(owner&&profiles.includes(mst))localStorage.setItem(lastKey(),mst);
}
async function setUser(userId,msts){
 const changed=userId!==owner;
 if(changed){key=null;entries={};owner=userId||'';record=owner?existing():null;
  recoveryPending=false;$('vaultRecovery').hidden=true;$('vaultAfterUnlock').hidden=true;
  $('vaultReveal').checked=false;$('rememberGdt').checked=false;
 }
 profiles=[...new Set((msts||[]).map(x=>String(x).replace(/\D/g,'')).filter(x=>/^\d{10}(?:\d{2,3})?$/.test(x)))];
 refreshList();
 select($('mst').value);
 if(changed)status(record?'Đã tìm thấy kho mật khẩu mã hóa trên máy. Mở kho để tự điền.':
  'Chưa tạo kho trên thiết bị này. Bật Tự lưu và tạo mật khẩu kho để lưu sau khi đăng nhập Thuế.');
 await checkRemoteReset();
}
async function derive(pass,salt){
 const material=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},
  material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function persist(){
 if(!owner||!key)throw Error('Mở kho mật khẩu trước khi lưu.');
 const iv=random(12);
 const payload=encoder.encode(JSON.stringify(entries));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,payload));
 record={version:1,salt:record.salt,iterations,iv:b64(iv),data:b64(ciphertext)};
 localStorage.setItem(storageKey(),JSON.stringify(record));
}
async function unlock(){
 if(!owner){status('Đăng nhập AutoTax trước khi mở kho.',true);return}
 if(recoveryPending){status('Cần xác nhận mã khôi phục 0000 trước khi tạo lại kho.',true);$('vaultRecovery').hidden=false;return}
 const pass=$('vaultPassphrase').value;
 if(pass.length<8){status('Mật khẩu kho cần tối thiểu 8 ký tự, khác mật khẩu cổng Thuế.',true);return}
 $('vaultUnlock').disabled=true;
 try{
  if(!record){
   record={version:1,salt:b64(random(16)),iterations};
   key=await derive(pass,bytes(record.salt));entries={};await persist();
   status('Đã tạo kho mật khẩu mã hóa. Bật Tự lưu, tra cứu thành công để ghi nhớ MST và mật khẩu.');
  }else{
   const candidate=await derive(pass,bytes(record.salt));
   const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(record.iv)},candidate,bytes(record.data));
   const parsed=JSON.parse(decoder.decode(clear));
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Kho không hợp lệ');
   key=candidate;entries=parsed;status('Đã mở kho: '+Object.keys(entries).length+' MST có mật khẩu lưu.');
  }
  refreshList();select($('mst').value);renderSecretList();
 }catch{
  key=null;entries={};$('vaultAfterUnlock').hidden=true;
  status('Không mở được kho. Mật khẩu kho có thể chưa đúng hoặc dữ liệu đã thay đổi.',true);
 }finally{
  $('vaultPassphrase').value='';
  $('vaultUnlock').disabled=false;
 }
}
async function saveAfterLogin(mst,password){
 if(!$('rememberGdt').checked)return;
 if(!owner||!key){$('vaultPanel').open=true;status('Bạn đã bật Tự lưu nhưng kho chưa mở; hãy tạo/mở kho để lưu mật khẩu.',true);return}
 if(!profiles.includes(mst)){status('MST chưa thuộc hồ sơ AutoTax — không lưu mật khẩu.',true);return}
 if(!password)return;
 entries[mst]=password;
 try{await persist();refreshList();$('mst').value=mst;renderSecretList();
  status('Đã mã hóa và lưu mật khẩu cho MST '+mst+' trên thiết bị này. Không đồng bộ mật khẩu lên Supabase.');
 }catch(e){status('Lưu mã hóa không thành công: '+e.message,true)}
}
async function forget(){
 const mst=$('mst').value;if(!owner||!key){status('Mở khóa kho để xóa mật khẩu MST.',true);return}
 if(!entries[mst]){status('MST này chưa có mật khẩu lưu.');return}
 delete entries[mst];await persist();
 $('gdtPassword').value='';refreshList();$('mst').value=mst;renderSecretList();
 status('Đã xóa mật khẩu đã lưu của MST '+mst+'.');
}
function lock(){
 key=null;entries={};$('gdtPassword').value='';
 $('vaultPassphrase').value='';$('vaultNewPassphrase').value='';
 $('vaultReveal').checked=false;$('vaultAfterUnlock').hidden=true;refreshList();
 status('Đã khóa kho. Mật khẩu chỉ được điền lại sau khi mở khóa.');
}
async function rotatePassphrase(){
 if(!owner||!key){status('Mở khóa kho cũ trước khi đổi mật khẩu.',true);return}
 const next=$('vaultNewPassphrase').value;
 if(next.length<8){status('Mật khẩu kho mới phải dài ít nhất 8 ký tự.',true);return}
 const priorKey=key,priorRecord=record;
 try{
  record={version:1,salt:b64(random(16)),iterations};
  key=await derive(next,bytes(record.salt));
  await persist();
  $('vaultNewPassphrase').value='';
  status('Đã đổi mật khẩu kho thành công. Mật khẩu cũ không còn mở được kho này.');
 }catch(e){key=priorKey;record=priorRecord;status('Không đổi được mật khẩu kho: '+e.message,true)}
}
function confirmRecovery(){
 if(!recoveryPending)return;
 if($('vaultRecoveryCode').value!=='0000'){
  status('Mã khôi phục không đúng. Liên hệ admin để xác minh lại.',true);return;
 }
 recoveryPending=false;
 localStorage.setItem(resetMarkerKey()+'_confirmed','1');
 $('vaultRecovery').hidden=true;$('vaultRecoveryCode').value='';
 $('vaultPassphrase').value='';
 status('Đã xác nhận reset. Hãy nhập mật khẩu kho MỚI từ 8 ký tự rồi bấm Mở / tạo kho. Mật khẩu Thuế cũ đã mất, cần đăng nhập lại từng MST.');
}
function init(){
 $('vaultUnlock').addEventListener('click',()=>void unlock());
 $('vaultForget').addEventListener('click',()=>void forget().catch(e=>status(e.message,true)));
 $('vaultLock').addEventListener('click',lock);
 $('vaultReveal').addEventListener('change',renderSecretList);
 $('vaultChangePass').addEventListener('click',()=>void rotatePassphrase());
 $('vaultConfirmRecovery').addEventListener('click',confirmRecovery);
 window.addEventListener('pagehide',lock);
}
window.GdtVault={setUser,select,saveAfterLogin,lock,hasSaved,checkRemoteReset};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();