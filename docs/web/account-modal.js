/* AutoTax Web: unified account dialogs. Supabase sessions persist; passwords never persist in localStorage. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const client=window.AutoTaxSharedClient;
const accountFlow=window.AutoTaxAccountFlow;
if(!client||!$('webLoginDialog'))return;
const dialogs=['webLoginDialog','webSignupDialog','webForgotDialog','webResetSentDialog','webNewPasswordDialog','webProfileDialog'];
const logo='/favicon.svg?v=20261102b';
const allowedEmail=v=>/^[^@\s]+@(gmail\.com|hotmail\.com|yahoo\.com|yahoo\.com\.vn)$/i.test(v);
let account=null,recovery=false,resetCloseTimer=null,avatar=logo;
let loginSubmitting=false;
let usernameOwner='',usernameCache='',usernameRequest=null;
async function loadProfileUsername(user){
 const field=$('webProfileUsername');
 if(!field||!user?.id)return;
 if(usernameOwner!==user.id){usernameOwner=user.id;usernameCache='';usernameRequest=null}
 if(usernameCache){field.value=usernameCache;return}
 field.value='Đang tải…';
 if(!usernameRequest)usernameRequest=client.rpc('autotax_my_username_v130').then(({data,error})=>{
  if(error)throw error;
  return String(data||'').trim()||'Chưa đăng ký';
 }).finally(()=>{usernameRequest=null});
 try{
  const username=await usernameRequest;
  if(usernameOwner===user.id){usernameCache=username;field.value=username}
 }catch(error){
  if(usernameOwner===user.id)field.value='Không tải được';
  console.warn('Không đọc được User đăng nhập:',error.message||error);
 }
}
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
  const greeting=$('webGreeting'),greetingText=greeting.querySelector('.web-greeting-text')||greeting;
  greetingText.textContent='Xin chào '+name;
  requestAnimationFrame(()=>{
   const overflow=Math.max(0,greetingText.scrollWidth-greeting.clientWidth);
   greeting.style.setProperty('--greeting-overflow',overflow+'px');
   greeting.classList.toggle('web-greeting-long',overflow>3);
  });
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
 // Đăng nhập không được đóng chỉ vì người dùng bấm vào vùng nền bên ngoài.
 // Chỉ dùng nút Đóng, đăng nhập thành công, hoặc thao tác chuyển popup.
 if(id==='webLoginDialog')continue;
 d.addEventListener('click',e=>{if(e.target===d&&id!=='webNewPasswordDialog')close(id)});
}
document.querySelectorAll('[data-web-close]').forEach(b=>b.addEventListener('click',()=>close(b.dataset.webClose)));
$('webLoginOpen').addEventListener('click',()=>{
 $('webLoginEmail').value=recentEmail();$('webLoginPassword').value='';
 message('webLoginStatus');open('webLoginDialog');
});
$('webLoginToSignup').addEventListener('click',()=>{
 $('webSignupName').value='';$('webSignupUsername').value='';$('webSignupEmail').value=$('webLoginEmail').value.includes('@')?$('webLoginEmail').value:'';
 $('webSignupPassword').value='';$('webSignupConfirm').value='';
 message('webSignupStatus');open('webSignupDialog');
});
$('webLoginToForgot').addEventListener('click',()=>{
 $('webForgotEmail').value=$('webLoginEmail').value.includes('@')?$('webLoginEmail').value:recentEmail();
 message('webForgotStatus');open('webForgotDialog');
});
$('webLoginForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('webLoginSubmit'),email=$('webLoginEmail').value.trim().toLowerCase();
 const password=$('webLoginPassword').value;
 if(btn.disabled)return;
 btn.disabled=true;loginSubmitting=true;
 message('webLoginStatus','Đang xác thực tài khoản…');
 try{
  const login=email.includes('@')?
    await client.auth.signInWithPassword({email,password}):
    await (async()=>{
      const session=await accountFlow.usernameSession(email,password);
      return client.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token});
    })();
  const {data,error}=login;
  if(error)throw Error(accountFlow.message(error));
  account=data.user||data.session?.user||null;
  if(!account?.id)throw Error('Không nhận được phiên đăng nhập hợp lệ.');
  saveEmail(account.email||email);
  // The account is authenticated. Close the popup immediately, without waiting
  // for vault decryption or the larger quota/profile refresh.
  $('webLoginPassword').value='';
  close('webLoginDialog');update();
  if(account.app_metadata?.autotax_force_password_change){
   $('webNewPasswordTitle').textContent='Đổi mật khẩu sau khi Admin cấp lại';
   open('webNewPasswordDialog');
  }
  const signedInUserId=account.id;
  if(!account.app_metadata?.autotax_force_password_change&&window.AutoTaxSharedMstVault?.unlock){
   void Promise.resolve().then(()=>window.AutoTaxSharedMstVault.unlock(signedInUserId,password))
    .catch(error=>{
      console.warn('Kho MST chưa mở khóa:',error.message||error);
      if(account?.id===signedInUserId)
       message('webAccountNotice','Kho MST chưa mở khóa: '+(error.message||error),true);
    });
  }
  void Promise.resolve().then(()=>window.AutoTaxRefreshWebAccount?.({force:true}))
    .catch(error=>console.warn('Chưa đồng bộ được hồ sơ sau đăng nhập:',error.message||error));
 }catch(error){message('webLoginStatus',accountFlow.message(error),true)}
 finally{loginSubmitting=false;btn.disabled=false}
});
$('webSignupForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const btn=$('webSignupSubmit'),name=accountFlow.normalizeName($('webSignupName').value);
 const email=accountFlow.normalizeEmail($('webSignupEmail').value);
 const pass=$('webSignupPassword').value,confirm=$('webSignupConfirm').value;
 const invalid=accountFlow.validateSignup({name,email,password:pass,confirmPassword:confirm});
  const username=$('webSignupUsername').value.trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{3,31}$/.test(username))
   return message('webSignupStatus','User đăng nhập phải có 4–32 ký tự, bắt đầu bằng chữ và chỉ chứa chữ thường và chữ số, không dấu hoặc ký tự đặc biệt.',true);
  const {data:free,error:checkError}=await client.rpc('autotax_username_available_v130',{p_username:username});
  if(checkError)return message('webSignupStatus','Chưa kiểm tra được User đăng nhập, hãy thử lại.',true);
  if(!free)return message('webSignupStatus','User đăng nhập đã được sử dụng. Hãy chọn User khác.',true);
 if(invalid)return message('webSignupStatus',invalid,true);
 btn.disabled=true;message('webSignupStatus');
 try{
  const {data,error}=await client.auth.signUp({email,password:pass,options:{data:{full_name:name,display_name:name,username}}});
  if(error){
   if(/already|exists|registered|identity/i.test(String(error.code||'')+' '+String(error.message||'')))
    throw Error('Email đã tồn tại.');
   throw error;
  }
  if(accountFlow.duplicateSignup(data))
   throw Error('Email đã tồn tại.');
  if(data?.session){const {error:out}=await client.auth.signOut();if(out)throw out;}
  saveEmail(email);
  open('webLoginDialog');
  $('webLoginEmail').value=email;$('webLoginPassword').value=pass;
  message('webLoginStatus',data?.session?'Đăng ký thành công. Bấm Đăng nhập để tiếp tục.':
   'Đã tạo yêu cầu đăng ký. Nếu hệ thống yêu cầu xác minh email, hãy xác minh rồi đăng nhập.');
  $('webLoginSubmit').focus();
 }catch(error){message('webSignupStatus',accountFlow.message(error),true)}
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
 }catch(error){message('webForgotStatus',accountFlow.message(error),true)}
 finally{btn.disabled=false}
});
$('webResetSentClose').addEventListener('click',closeAll);
function openProfile(){
 const user=account;if(!user)return;
 $('webSettingsMenu').hidden=true;
 $('webProfileName').value=nameOf(user);
 $('webProfileEmail').value=user.email||'';
 void loadProfileUsername(user);
 $('webProfileOld').value='';$('webProfileNew').value='';
 $('webProfileAvatarFile').value='';
 avatar=/^data:image\/jpeg;base64,/.test(user.user_metadata?.avatar_data_url||'')?
  user.user_metadata.avatar_data_url:logo;
 $('webProfileAvatar').src=avatar;message('webProfileStatus');
 open('webProfileDialog');
}
function positionAccountMenu(){
 const menu=$('webSettingsMenu'),trigger=$('webSettingsToggle');
 if(menu.hidden)return;
 const rect=trigger.getBoundingClientRect();
 menu.style.top=Math.max(6,rect.bottom+7)+'px';
 menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-212))+'px';
}
$('webSettingsToggle').addEventListener('click',()=>{
 const menu=$('webSettingsMenu');menu.hidden=!menu.hidden;
 $('webSettingsToggle').setAttribute('aria-expanded',String(!menu.hidden));
 positionAccountMenu();
});
window.addEventListener('resize',positionAccountMenu,{passive:true});
window.addEventListener('scroll',positionAccountMenu,{passive:true});
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
  await window.AutoTaxRefreshWebAccount?.({force:true});
 }catch(error){message('webProfileStatus',accountFlow.message(error),true)}
 finally{btn.disabled=false}
});
$('webLogout').addEventListener('click',async()=>{
 $('webSettingsMenu').hidden=true;closeAll();
 const {error}=await client.auth.signOut();
 if(error)return message('webAccountNotice',accountFlow.message(error),true);
 account=null;update();await window.AutoTaxRefreshWebAccount?.({force:true});
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
   if(!response.ok||!result.ok)throw Error('Không đổi được mật khẩu do quản trị cấp. Vui lòng thử lại.');
  }else{
   const {error}=await client.auth.updateUser({password:pass});
   if(error)throw error;
  }
  try{await window.AutoTaxSharedMstVault?.rekey(pass)}catch(err){console.warn('Kho MST cần mở lại sau reset:',err.message)}
  const {data,error}=await client.auth.signInWithPassword({email,password:pass});
  if(error)throw Error('Đã đổi mật khẩu, nhưng cần đăng nhập lại: '+authErrorVi(error));
  account=data.user;saveEmail(email);
  try{await window.AutoTaxSharedMstVault?.unlock(data.user.id,pass)}catch(err){console.warn('Kho MST chưa mở khóa:',err.message)}
  recovery=false;window.__autotaxRecoveryFromUrl=false;$('webNewPassword').value='';$('webNewPasswordConfirm').value='';
  closeAll();update();await window.AutoTaxRefreshWebAccount?.({force:true});
 }catch(error){message('webNewPasswordStatus',accountFlow.message(error),true)}
 finally{btn.disabled=false}
});
client.auth.onAuthStateChange((event,session)=>{
 queueMicrotask(()=>{
  const previousUserId=account?.id||null;
  const nextUserId=session?.user?.id||null;
  account=session?.user||null;
  // Supabase emits SIGNED_IN for the same account after tab focus. It is not
  // a fresh login and must not reset controls or refetch the whole account.
  const unchangedSignIn=event==='SIGNED_IN'&&previousUserId===nextUserId&&!!nextUserId;
  if(!unchangedSignIn)update();
  if(event==='PASSWORD_RECOVERY'||(window.__autotaxRecoveryFromUrl&&account&&!recovery)){
   recovery=true;$('webNewPasswordTitle').textContent='Đặt mật khẩu mới';
   message('webNewPasswordStatus');open('webNewPasswordDialog');
  }else if(account?.app_metadata?.autotax_force_password_change&&!recovery&&event!=='SIGNED_OUT'){
   $('webNewPasswordTitle').textContent='Đổi mật khẩu sau khi Admin cấp lại';
   if(!$('webNewPasswordDialog').open)open('webNewPasswordDialog');
  }
  if(['SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event)&&
     !loginSubmitting&&!unchangedSignIn)
    void Promise.resolve().then(()=>window.AutoTaxRefreshWebAccount?.({force:true}))
     .catch(error=>console.warn('Không đồng bộ được phiên AutoTax:',error.message||error));
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
