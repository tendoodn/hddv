/* Private administrator feedback inbox.
 * Replies are server-expiring after seven days; customer can hide a reply.
 * Access to images is governed by Supabase private Storage RLS.
 */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),BUCKET='autotax-feedback-images';
 const message=(value,bad=false)=>{
  const e=$('feedbackAdminMessage');e.textContent=value;e.classList.toggle('error',bad);
 };
 const btn=(value,callback,cls='secondary')=>{
  const b=document.createElement('button');
  b.type='button';b.className=cls;b.textContent=value;b.addEventListener('click',callback);
  return b;
 };
 async function listImages(row,container){
  const prefix=row.user_id+'/'+row.id;
  const {data:files,error}=await client.storage.from(BUCKET).list(prefix,{
   limit:6,sortBy:{column:'name',order:'asc'}
  });
  if(error)throw error;
  for(const file of (files||[]).filter(f=>f.name&&!f.name.startsWith('.')).slice(0,5)){
   const path=prefix+'/'+file.name;
   const {data,error:urlError}=await client.storage.from(BUCKET).createSignedUrl(path,300);
   if(urlError||!data?.signedUrl)continue;
   const a=document.createElement('a');
   a.href=data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';
   const img=document.createElement('img');
   img.src=data.signedUrl;img.alt='Ảnh phản ánh của khách hàng';img.loading='lazy';
   img.width=120;img.height=95;img.style.cssText='width:120px;height:95px;object-fit:cover;border-radius:8px;border:1px solid #f3b9c0';
   a.append(img);container.append(a);
  }
 }
 async function cleanupImages(row){
  const prefix=row.user_id+'/'+row.id;
  const {data,error}=await client.storage.from(BUCKET).list(prefix,{limit:100});
  if(error)throw Error('Không liệt kê được ảnh để xóa: '+error.message);
  const paths=(data||[]).filter(f=>f.name&&!f.name.startsWith('.'))
   .map(f=>prefix+'/'+f.name);
  if(paths.length){
   const {error:removeError}=await client.storage.from(BUCKET).remove(paths);
   if(removeError)throw Error('Không xóa được ảnh khỏi Storage: '+removeError.message);
  }
 }
 async function load(){
  const container=$('adminFeedbackList');if(!container)return;
  container.textContent='Đang tải các phản ánh…';
  const {data,error}=await client.rpc('addon_admin_feedback_list');
  if(error){container.textContent='Không tải được phản ánh: '+error.message;return}
  const rows=Array.isArray(data)?data:[];
  $('adminFeedbackCount').textContent=rows.length+' phản ánh';
  container.replaceChildren();
  if(!rows.length){container.textContent='Chưa có phản ánh từ khách hàng.';return}
  for(const row of rows){
   const art=document.createElement('article');art.className='admin-feedback-item';
   const title=document.createElement('strong');
   title.textContent=(row.email||'Khách hàng')+' · '+
    new Date(row.created_at).toLocaleString('vi-VN')+' · '+
    (row.status==='answered'?'Đã trả lời':'Chưa trả lời');
   const content=document.createElement('p');
   content.textContent=row.body;content.style.whiteSpace='pre-wrap';
   const pictures=document.createElement('div');pictures.className='admin-feedback-images';
   pictures.style.cssText='display:flex;flex-wrap:wrap;gap:7px;margin:7px 0';
   art.append(title,content,pictures);
   for(const reply of row.replies||[]){
    const p=document.createElement('p');p.className='sub';
    p.textContent='Quản trị đã trả lời: '+reply.body+' · '+
     new Date(reply.created_at).toLocaleString('vi-VN')+
     ' (xóa sau '+new Date(reply.expires_at).toLocaleString('vi-VN')+')';
    art.append(p);
   }
   const textarea=document.createElement('textarea');
   textarea.rows=3;textarea.maxLength=4000;
   textarea.placeholder='Soạn tin trả lời cho khách hàng (tối đa 4.000 ký tự)…';
   textarea.style.cssText='width:100%;margin:9px 0;padding:10px;border-radius:8px;border:1px solid #cbd5e1;box-sizing:border-box';
   art.append(textarea);
   const actions=document.createElement('div');actions.className='actions';
   const reply=btn('Trả lời',async()=>{
    const text=textarea.value.trim();
    if(!text)return message('Vui lòng nhập nội dung trả lời.',true);
    reply.disabled=true;
    const {error}=await client.rpc('addon_admin_feedback_reply',{
     p_feedback_id:row.id,p_body:text
    });
    if(error){message('Lỗi trả lời: '+error.message,true);reply.disabled=false;return}
    message('Đã gửi tin trả lời. Tin tự hết hạn trong 7 ngày.');
    await load();
   },'primary');
   const del=btn('Xóa phản ánh',async()=>{
    if(!confirm('Xóa vĩnh viễn phản ánh của '+row.email+' và các tin trả lời?'))return;
    del.disabled=true;
    try{
     await cleanupImages(row);
     const {error}=await client.rpc('addon_admin_feedback_delete',{p_feedback_id:row.id});
     if(error)throw error;
     message('Đã xóa phản ánh và ảnh đính kèm.');
     await load();
    }catch(e){message('Không thể xóa: '+e.message,true);del.disabled=false}
   },'danger');
   actions.append(reply,del);art.append(actions);container.append(art);
   // A broken attachment must not block text and reply controls.
   void listImages(row,pictures).catch(e=>{
    const alert=document.createElement('small');
    alert.textContent='Chưa đọc được ảnh đính kèm: '+e.message;
    pictures.append(alert);
   });
  }
 }
 function init(){
  if(!$('reloadAdminFeedback'))return;
  $('reloadAdminFeedback').addEventListener('click',()=>void load());
 }
 window.AdminFeedback={load};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
