/* AutoTax V1.1.20 — đổi chế độ cho tài khoản từ trang quản trị.
   Không thao tác .hidden nếu thiếu phần tử (tránh null.hidden). */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const users=$('users'),dialog=$('adminUsageModeDialog'),
  select=$('adminUsageModeSelect'),title=$('adminUsageModeTitle'),
  notice=$('adminUsageModeMessage'),save=$('adminUsageModeSave'),close=$('adminUsageModeClose');
 if(!users||!dialog||!select||!title||!notice||!save||!close){
  console.error('AutoTax: thiếu thành phần popup chỉnh chế độ Admin.');
  return;
 }
 const fail=message=>{notice.textContent=message;notice.hidden=false};
 users.addEventListener('click',e=>{
  const button=e.target.closest('button[data-mode-user]');
  if(!button)return;
  e.preventDefault();e.stopImmediatePropagation();
  const user=allUsers.find(u=>u.user_id===button.dataset.modeUser);
  if(!user){msg('msg','Không tìm thấy tài khoản để đổi chế độ.',true);return}
  dialog.dataset.userId=user.user_id;
  title.textContent='Chế độ sử dụng · '+(user.email||user.user_id);
  select.value=user.mode==='invoice'?'invoice':'mst';
  notice.textContent='';notice.hidden=true;
  if(!dialog.open)dialog.showModal();
 },true);
 close.addEventListener('click',()=>{if(dialog.open)dialog.close()});
 save.addEventListener('click',async()=>{
  const userId=dialog.dataset.userId,mode=select.value,
   user=allUsers.find(u=>u.user_id===userId);
  if(!user||!['invoice','mst'].includes(mode)){fail('Tài khoản hoặc chế độ không hợp lệ.');return}
  save.disabled=true;notice.hidden=true;
  try{
   const {data,error}=await client.rpc('addon_admin_set_usage_mode_v120',{p_user_id:userId,p_mode:mode});
   if(error)throw error;
   if(!data?.success||data.mode!==mode)throw Error('Máy chủ chưa xác nhận thay đổi.');
   user.mode=mode;
   dialog.close();
   renderUsers();
   msg('msg','Đã chuyển '+(user.email||userId)+' sang chế độ '+(mode==='invoice'?'Số tờ':'MST')+'.');
   await loadUsers();
  }catch(error){fail('Không đổi được chế độ: '+(error.message||String(error)))}
  finally{save.disabled=false}
 });
})();