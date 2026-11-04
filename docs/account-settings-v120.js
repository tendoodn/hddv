/* AutoTax V1.1.20: customer greeting, avatar and privacy-aware account settings. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const logo='./favicon.svg?v=20261102b';
const status=(message,error=false)=>{const el=$('accountProfileStatus');el.textContent=message;el.hidden=!message;el.classList.toggle('error',error)};
const menu=$('accountSettingsMenu'),toggle=$('accountSettingsToggle'),dialog=$('accountProfileDialog');
let avatarData=logo;
const safeAvatar=value=>typeof value==='string'&&value.startsWith('data:image/jpeg;base64,')&&value.length<65000?value:logo;
const nameFrom=user=>String(user?.user_metadata?.full_name||user?.user_metadata?.display_name||'').trim().slice(0,100);
async function render(){
 const {data:{session}}=await client.auth.getSession();
 if(!session?.user)return;
 const user=session.user;
 $('accountGreeting').textContent='Xin chào '+(nameFrom(user)||'bạn')+' !!!';
 avatarData=safeAvatar(user.user_metadata?.avatar_data_url);
 $('accountAvatar').src=avatarData;
 $('accountAvatarPreview').src=avatarData;
 $('accountDisplayName').value=nameFrom(user);
 $('accountProfileEmail').value=user.email||'';
}
function hideMenu(){menu.hidden=true;toggle.setAttribute('aria-expanded','false')}
function showProfile(){
 hideMenu();status('');
 $('accountOldPassword').value='';$('accountNewPassword').value='';
 $('accountAvatarUpload').value='';void render();
 if(!dialog.open)dialog.showModal();
}
toggle.addEventListener('click',()=>{
 const willOpen=menu.hidden;menu.hidden=!willOpen;
 toggle.setAttribute('aria-expanded',String(willOpen));
});
document.addEventListener('pointerdown',e=>{
 if(!menu.hidden&&!e.target.closest('.autotax-settings-wrap'))hideMenu();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideMenu()});
$('accountEditProfile').addEventListener('click',showProfile);
$('accountFeedbackMenu').addEventListener('click',()=>{hideMenu();$('feedbackOpen').click()});
$('accountGiftMenu').addEventListener('click',()=>{hideMenu();$('giftWebBtn').click()});
$('accountLogoutMenu').addEventListener('click',()=>{hideMenu();$('logoutBtn').click()});
$('accountProfileClose').addEventListener('click',()=>dialog.close());
$('accountAvatarUpload').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file){avatarData=$('accountAvatar').src;return}
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){
  status('Ảnh phải là JPG, PNG hoặc WebP, dung lượng dưới 5 MB.',true);return
 }
 try{
  const picture=await createImageBitmap(file);
  const c=document.createElement('canvas'),ctx=c.getContext('2d');
  const size=144;c.width=size;c.height=size;
  const scale=Math.max(size/picture.width,size/picture.height);
  const w=picture.width*scale,h=picture.height*scale;
  ctx.drawImage(picture,(size-w)/2,(size-h)/2,w,h);
  picture.close();
  const result=c.toDataURL('image/jpeg',0.66);
  if(result.length>65000)throw Error('Ảnh sau khi nén vẫn quá lớn.');
  avatarData=result;$('accountAvatarPreview').src=avatarData;
  status('Đã chọn ảnh đại diện. Bấm Lưu để đồng bộ ảnh.');
 }catch(error){status('Không đọc được ảnh: '+error.message,true)}
});
$('accountProfileForm').addEventListener('submit',async event=>{
 event.preventDefault();
 const btn=$('accountProfileSave'),name=$('accountDisplayName').value.trim().replace(/\s+/g,' ');
 const oldPass=$('accountOldPassword').value,newPass=$('accountNewPassword').value,avatarToSave=avatarData;
 if(name.length<2||name.length>100)return status('Tên người dùng phải dài từ 2 đến 100 ký tự.',true);
 if(Boolean(oldPass)!==Boolean(newPass))return status('Muốn đổi mật khẩu phải nhập cả mật khẩu cũ và mới.',true);
 if(newPass&&newPass.length<10)return status('Mật khẩu mới phải có ít nhất 10 ký tự.',true);
 btn.disabled=true;status('Đang cập nhật thông tin…');
 try{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.user?.email)throw Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
  if(newPass){
   const {error:passwordError}=await client.auth.signInWithPassword({email:session.user.email,password:oldPass});
   if(passwordError)throw Error('Mật khẩu cũ không đúng. '+passwordError.message);
  }
  const data={full_name:name,display_name:name,avatar_data_url:avatarToSave===logo?null:avatarToSave};
  const change={data,...(newPass?{password:newPass}:{})};
  const {error}=await client.auth.updateUser(change);
  if(error)throw error;
  if(newPass){
   try{await window.AutoTaxSharedMstVault?.rekey(newPass)}
   catch(e){status('Đã đổi mật khẩu tài khoản nhưng chưa cập nhật khóa kho MST: '+e.message,true);await render();return}
  }
  $('accountOldPassword').value='';$('accountNewPassword').value='';
  await render();
  if(typeof refresh==='function')await refresh();
  status('Đã lưu tên và avatar'+(newPass?' cùng mật khẩu mới':'')+'.');
 }catch(error){status('Không lưu được: '+error.message,true)}
 finally{btn.disabled=false}
});
client.auth.onAuthStateChange(event=>{
 if(['INITIAL_SESSION','SIGNED_IN','USER_UPDATED'].includes(event))queueMicrotask(()=>void render().catch(()=>{}));
});
void render().catch(()=>{});
})();