/* AutoTax Web: unified account dialogs. Supabase sessions persist; passwords never persist in localStorage. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const client=window.AutoTaxSharedClient;
if(!client||!$('webLoginDialog'))return;
const dialogs=['webLoginDialog','webSignupDialog','webForgotDialog','webResetSentDialog','webNewPasswordDialog','webProfileDialog'];
const logo='/favicon.svg?v=20261102b';
const allowedEmail=v=>/^[^@\s]+@(gmail\.com|hotmail\.com|yahoo\.com|yahoo\.com\.vn)$/i.test(v);
let account=null,recovery=false,resetCloseTimer=null,avatar=logo;
const recentEmail=()=>{try{return localStorage.getItem('autotax_recent_email')||''}catch{return ''}};
const saveEmail=value=>{try{localStorage.setItem('autotax_recent_email',value)}catch{}};
const nameOf=user=>String(user?.user_metadata?.full_name||user?.user_metadata?.display_name||'').trim().slice(0,100);
function message(id,value='',error=false){
 const el=$(id);if(!el)return;
 el.textContent=value;el.hidden=!value;el.classList.toggle('error',error);
}
function closeAll(){
 for(const id of dialogs){const dialog=$(id);if(dialog?.open)dialog.close();}
 if(resetCloseTimer){clearTimeout(resetCloseTimer);resetCloseTimer=null}
}
function open(id){
 closeAll();const dialog=$(id);if(!dialog)return;
 dialog.showModal();
 dialog.querySelector('input:not([type=file])')?.focus();
}
function update(){
 const signedIn=!!account;
 $('webLoginOpen').hidden=signedIn;
 $('webUserBlock').hidden=!signedIn;
 if(signedIn){
  const name=nameOf(account)||account.email?.split('@')[0]||'bạn';
  $('webGreeting').textContent='Xin chào '+name;
  $('webAvatar').src=/^data:image\/jpeg;base64,/.test(account.user_metadata?.avatar_data_url||'')?
   account.user_metadata.avatar_data_url:logo;
  saveEmail(account.email||'');
 }
 $('webSettingsMenu').hidden=true;
 $('webSettingsToggle').setAttribute('aria-expanded','false');
}
function sync(user){
 const oldId=account?.id;
 account=user||null;
 update();
 if(account?.app_metadata?.autotax_force_password_change&&!recovery){
  if(!$('webNewPasswordDialog').open){$('webNewPasswordTitle').textContent='Đổi mật khẩu sau khi Admin cấp lại';open('webNewPasswordDialog')}
 }else if(oldId&&!account&&$('webNewPasswordDialog').open){closeAll()}
}
window.AutoTaxWebAccount={sync};
const close=id=>{if($(id)?.open)$(id).close()};
for(const id of dialogs){
 const d=$(id);
 d.addEventListener('click',e=>{if(e.target===d&&id!=='webNewPasswordDialog')close(id)});
}
document.querySelectorAll('[data-web-close]').forEach(b=>b.addEventListener('click',()=>close(b.dataset.webClose)));
$('webLoginOpen').addEventListener('click',()=>{
 $('webLoginEmail').value=recentEmail();$('webLoginPassword').value='';
 message('webLoginStatus');open('webLoginDialog');
});
$('webLoginToSignup').addEventListener('click',()=>{
 $('webSignupName').value='';$('webSignupEmail').value=$('webLoginEmail').value;
 $('webSignupPassword').value='';$('webSignupConfirm').value='';
 message('webSignupStatus');open('webSignupDialog');
});
$('webLoginToForgot').addEventListener('click',()=>{
 $('webForgotEmail').value=$('webLoginEmail').value||recentEmail();
 message('webForgotStatus');open('webForgotDialog');
});
$('webLoginForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('webLoginSubmit'),email=$('webLoginEmail').value.trim().toLowerCase();
 const password=$('webLoginPassword').value;
 if(btn.disabled)return;
 btn.disabled=true;message('webLoginStatus');
 try{
  const {data,error}=await client.auth.signInWithPassword({email,password});
  if(error)throw error;
  account=data.user;saveEmail(email);
  if(!account?.app_metadata?.autotax_force_password_change){
   try{await window.AutoTaxSharedMstVault?.unlock(account.id,password)}
   catch(vaultError){console.warn('Kho MST chưa mở khóa:',vaultError.message);message('webAccountNotice','Kho MST chưa mở khóa: '+vaultError.message,true)}
  }
  $('webLoginPassword').value='';
  close('webLoginDialog');update();
  await window.AutoTaxRefreshWebAccount?.();
  if(account?.app_metadata?.autotax_force_password_change){
   $('webNewPasswordTitle').textContent='Đổi mật khẩu sau khi Admin cấp lại';
   open('webNewPasswordDialog');
  }
 }catch(error){message('webLoginStatus',error.message||'Không đăng nhập được.',true)}
 finally{btn.disabled=false}
});
$('webSignupForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const btn=$('webSignupSubmit'),name=$('webSignupName').value.trim().replace(/\s+/g,' ');
 const email=$('webSignupEmail').value.trim().toLowerCase();
 const pass=$('webSignupPassword').value,confirm=$('webSignupConfirm').value;
 if(name.length<2||name.length>100)return message('webSignupStatus','Tên người dùng phải từ 2 đến 100 ký tự.',true);
 if(!allowedEmail(email))return message('webSignupStatus','Chỉ hỗ trợ Gmail, Hotmail hoặc Yahoo Mail.',true);
 if(pass.length<10||pass.length>128)return message('webSignupStatus','Mật khẩu phải từ 10 đến 128 ký tự.',true);
 if(pass!==confirm)return message('webSignupStatus','Hai lần nhập mật khẩu không khớp.',true);
 btn.disabled=true;message('webSignupStatus');
 try{
  const {data,error}=await client.auth.signUp({email,password:pass,options:{data:{full_name:name,display_name:name}}});
  if(error){
   if(/already|exists|registered|identity/i.test(String(error.code||'')+' '+String(error.message||'')))
    throw Error('Email đã được đăng ký. Hãy đăng nhập hoặc sử dụng email khác.');
   throw error;
  }
  if(data?.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0)
   throw Error('Email đã được đăng ký. Hãy đăng nhập hoặc sử dụng email khác.');
  if(data?.session){const {error:out}=await client.auth.signOut();if(out)throw out;}
  saveEmail(email);
  open('webLoginDialog');
  $('webLoginEmail').value=email;$('webLoginPassword').value=pass;
  message('webLoginStatus',data?.session?'Đăng ký thành công. Bấm Đăng nhập để tiếp tục.':
   'Đã tạo yêu cầu đăng ký. Nếu hệ thống yêu cầu xác minh email, hãy xác minh rồi đăng nhập.');
  $('webLoginSubmit').focus();
 }catch(error){message('webSignupStatus',error.message||'Không đăng ký được.',true)}
 finally{btn.disabled=false}
});
$('webForgotForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const btn=$('webForgotSubmit'),email=$('webForgotEmail').value.trim().toLowerCase();
 if(!allowedEmail(email))return message('webForgotStatus','Nhập email đã đăng ký (Gmail, Hotmail hoặc Yahoo).',true);
 btn.disabled=true;message('webForgotStatus');
 try{
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:'https://tracuuhoadon.top/'});
  if(error)throw error;
  open('webResetSentDialog');
  resetCloseTimer=setTimeout(closeAll,10000);
 }catch(error){message('webForgotStatus',error.message||'Không gửi được email.',true)}
 finally{btn.disabled=false}
});
$('webResetSentClose').addEventListener('click',closeAll);
function openProfile(){
 const user=account;if(!user)return;
 $('webSettingsMenu').hidden=true;
 $('webProfileName').value=nameOf(user);
 $('webProfileEmail').value=user.email||'';
 $('webProfileOld').value='';$('webProfileNew').value='';
 $('webProfileAvatarFile').value='';
 avatar=/^data:image\/jpeg;base64,/.test(user.user_metadata?.avatar_data_url||'')?
  user.user_metadata.avatar_data_url:logo;
 $('webProfileAvatar').src=avatar;message('webProfileStatus');
 open('webProfileDialog');
}
$('webSettingsToggle').addEventListener('click',()=>{
 const menu=$('webSettingsMenu');menu.hidden=!menu.hidden;
 $('webSettingsToggle').setAttribute('aria-expanded',String(!menu.hidden));
});
document.addEventListener('pointerdown',e=>{
 if(!e.target.closest('.web-settings-wrap')){
  $('webSettingsMenu').hidden=true;$('webSettingsToggle').setAttribute('aria-expanded','false');
 }
});
$('webEditProfile').addEventListener('click',openProfile);
$('webProfileAvatarFile').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)
  return message('webProfileStatus','Ảnh phải là JPG, PNG hoặc WebP dưới 5 MB.',true);
 try{
  const bitmap=await createImageBitmap(file),size=144;
  const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext('2d'),scale=Math.max(size/bitmap.width,size/bitmap.height);
  ctx.drawImage(bitmap,(size-bitmap.width*scale)/2,(size-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);
  bitmap.close();avatar=canvas.toDataURL('image/jpeg',0.66);
  if(avatar.length>65000)throw Error('Ảnh quá lớn sau khi nén.');
  $('webProfileAvatar').src=avatar;
 }catch(error){message('webProfileStatus',error.message,true)}
});
$('webProfileForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const btn=$('webProfileSave'),name=$('webProfileName').value.trim().replace(/\s+/g,' ');
 const oldPass=$('webProfileOld').value,newPass=$('webProfileNew').value;
 if(name.length<2||name.length>100)return message('webProfileStatus','Tên từ 2 đến 100 ký tự.',true);
 if(Boolean(oldPass)!==Boolean(newPass))return message('webProfileStatus','Đổi mật khẩu phải nhập cả mật khẩu cũ và mới.',true);
 if(newPass&&newPass.length<10)return message('webProfileStatus','Mật khẩu mới ít nhất 10 ký tự.',true);
 btn.disabled=true;
 try{
  if(newPass){const {error}=await client.auth.signInWithPassword({email:account.email,password:oldPass});if(error)throw Error('Mật khẩu cũ không đúng.');}
  const {data,error}=await client.auth.updateUser({data:{full_name:name,display_name:name,avatar_data_url:avatar===logo?null:avatar},...(newPass?{password:newPass}:{})});
  if(error)throw error;
  if(newPass)try{await window.AutoTaxSharedMstVault?.rekey(newPass)}catch(err){message('webProfileStatus','Đã đổi mật khẩu, nhưng cần mở lại kho MST: '+err.message,true);return;}
  account=data.user;update();close('webProfileDialog');
  await window.AutoTaxRefreshWebAccount?.();
 }catch(error){message('webProfileStatus',error.message||'Không lưu được.',true)}
 finally{btn.disabled=false}
});
$('webLogout').addEventListener('click',async()=>{
 $('webSettingsMenu').hidden=true;closeAll();
 const {error}=await client.auth.signOut();
 if(error)return message('webAccountNotice',error.message,true);
 account=null;update();await window.AutoTaxRefreshWebAccount?.();
});
$('webNewPasswordForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const pass=$('webNewPassword').value,confirm=$('webNewPasswordConfirm').value,btn=$('webNewPasswordSave');
 if(pass.length<10||pass.length>128)return message('webNewPasswordStatus','Mật khẩu mới phải từ 10 đến 128 ký tự.',true);
 if(pass!==confirm)return message('webNewPasswordStatus','Hai lần nhập mật khẩu chưa khớp.',true);
 if(account?.app_metadata?.autotax_force_password_change&&pass==='000000')
  return message('webNewPasswordStatus','Không được sử dụng lại mật khẩu tạm.',true);
 btn.disabled=true;message('webNewPasswordStatus');
 try{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.user)throw Error('Liên kết khôi phục không còn hiệu lực.');
  const email=session.user.email||account?.email;
  if(session.user.app_metadata?.autotax_force_password_change){
   const response=await fetch('https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-admin-password-reset',{
    method:'POST',headers:{Authorization:'Bearer '+session.access_token,
     apikey:'sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ','Content-Type':'application/json'},
    body:JSON.stringify({action:'complete',new_password:pass})
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.ok)throw Error(result.error||'Không đổi được mật khẩu do Admin cấp.');
  }else{
   const {error}=await client.auth.updateUser({password:pass});
   if(error)throw error;
  }
  try{await window.AutoTaxSharedMstVault?.rekey(pass)}catch(err){console.warn('Kho MST cần mở lại sau reset:',err.message)}
  const {data,error}=await client.auth.signInWithPassword({email,password:pass});
  if(error)throw Error('Đã đổi mật khẩu, nhưng cần đăng nhập lại: '+error.message);
  account=data.user;saveEmail(email);
  try{await window.AutoTaxSharedMstVault?.unlock(data.user.id,pass)}catch(err){console.warn('Kho MST chưa mở khóa:',err.message)}
  recovery=false;window.__autotaxRecoveryFromUrl=false;$('webNewPassword').value='';$('webNewPasswordConfirm').value='';
  closeAll();update();await window.AutoTaxRefreshWebAccount?.();
 }catch(error){message('webNewPasswordStatus',error.message||'Không đổi được mật khẩu.',true)}
 finally{btn.disabled=false}
});
client.auth.onAuthStateChange((event,session)=>{
 queueMicrotask(async()=>{
  account=session?.user||null;update();
  if(event==='PASSWORD_RECOVERY'||(window.__autotaxRecoveryFromUrl&&account&&!recovery)){
   recovery=true;$('webNewPasswordTitle').textContent='Đặt mật khẩu mới';
   message('webNewPasswordStatus');open('webNewPasswordDialog');
  }else if(account?.app_metadata?.autotax_force_password_change&&!recovery&&event!=='SIGNED_OUT'){
   $('webNewPasswordTitle').textContent='Đổi mật khẩu sau khi Admin cấp lại';
   if(!$('webNewPasswordDialog').open)open('webNewPasswordDialog');
  }
  if(['SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event))await window.AutoTaxRefreshWebAccount?.();
 });
});
$('webAccountNotice').hidden=true;
client.auth.getSession().then(({data:{session}})=>{
 account=session?.user||null;update();
 if(window.__autotaxRecoveryFromUrl&&account){
  recovery=true;$('webNewPasswordTitle').textContent='Đặt mật khẩu mới';open('webNewPasswordDialog');
 }else if(account?.app_metadata?.autotax_force_password_change&&!recovery){
  $('webNewPasswordTitle').textContent='Đổi mật khẩu sau khi Admin cấp lại';
  open('webNewPasswordDialog');
 }
}).catch(()=>{});
})();
