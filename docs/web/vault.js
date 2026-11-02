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
let owner='',key=null,record=null,entries={},profiles=[];
const storageKey=()=> 'autotax_gdt_secret_v1_'+owner;
const lastKey=()=> 'autotax_last_mst_'+owner;
function status(text,error=false){
 const el=$('vaultStatus');el.textContent=text;el.style.color=error?'#ff96a1':'#9ae6b4';
}
function existing(){try{return JSON.parse(localStorage.getItem(storageKey())||'null')}catch{return null}}
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
function setUser(userId,msts){
 const changed=userId!==owner;
 if(changed){key=null;entries={};owner=userId||'';record=owner?existing():null;
  $('rememberGdt').checked=false;
 }
 profiles=[...new Set((msts||[]).map(x=>String(x).replace(/\D/g,'')).filter(x=>/^\d{10}(?:\d{2,3})?$/.test(x)))];
 refreshList();
 select($('mst').value);
 if(changed)status(record?'Đã tìm thấy kho mật khẩu mã hóa trên máy. Mở kho để tự điền.':
  'Chưa tạo kho trên thiết bị này. Bật Tự lưu và tạo mật khẩu kho để lưu sau khi đăng nhập Thuế.');
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
  refreshList();select($('mst').value);
 }catch{
  key=null;entries={};
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
 try{await persist();refreshList();$('mst').value=mst;
  status('Đã mã hóa và lưu mật khẩu cho MST '+mst+' trên thiết bị này. Không đồng bộ mật khẩu lên Supabase.');
 }catch(e){status('Lưu mã hóa không thành công: '+e.message,true)}
}
async function forget(){
 const mst=$('mst').value;if(!owner||!key){status('Mở khóa kho để xóa mật khẩu MST.',true);return}
 if(!entries[mst]){status('MST này chưa có mật khẩu lưu.');return}
 delete entries[mst];await persist();
 $('gdtPassword').value='';refreshList();$('mst').value=mst;
 status('Đã xóa mật khẩu đã lưu của MST '+mst+'.');
}
function lock(){
 key=null;entries={};$('gdtPassword').value='';
 $('vaultPassphrase').value='';refreshList();
 status('Đã khóa kho. Mật khẩu chỉ được điền lại sau khi mở khóa.');
}
function init(){
 $('vaultUnlock').addEventListener('click',()=>void unlock());
 $('vaultForget').addEventListener('click',()=>void forget().catch(e=>status(e.message,true)));
 $('vaultLock').addEventListener('click',lock);
 window.addEventListener('pagehide',lock);
}
window.GdtVault={setUser,select,saveAfterLogin,lock,hasSaved};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();