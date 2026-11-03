/* AutoTax account feedback. All records require authenticated Supabase RPCs;
   images live in a private 2 MiB-per-file Storage bucket. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const BUCKET='autotax-feedback-images',MAX_BYTES=2*1024*1024,MAX_WORDS=1000;
 const formats={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
 const status=(text,error=false)=>{
  const el=$('feedbackStatus');if(!el)return;
  el.textContent=text;el.classList.toggle('error',error);
 };
 const button=(text,action)=>{
  const b=document.createElement('button');
  b.type='button';b.className='secondary';b.textContent=text;
  b.addEventListener('click',action);return b;
 };
 const wordCount=text=>text.trim()?text.trim().split(/\s+/u).length:0;
 function validate(body,files){
  if(!body.trim())throw Error('Nhập nội dung phản hồi trước khi gửi.');
  if(wordCount(body)>MAX_WORDS)throw Error('Nội dung không được vượt quá 1.000 từ.');
  if(body.length>7000)throw Error('Nội dung dài hơn giới hạn lưu trữ 7.000 ký tự.');
  if(files.length>5)throw Error('Chỉ được đính kèm tối đa 5 ảnh.');
  for(const f of files){
   if(!formats[f.type])throw Error('Ảnh không hợp lệ. Chỉ nhận JPEG, PNG hoặc WEBP.');
   if(f.size>MAX_BYTES)throw Error('Mỗi ảnh phải nhỏ hơn hoặc bằng 2 MB: '+f.name);
  }
 }
 async function inbox(){
  const box=$('feedbackInboxList');if(!box)return;
  const {data:{session}}=await client.auth.getSession();
  if(!session){box.textContent='Đăng nhập để đọc phản hồi từ quản trị.';return}
  const {data,error}=await client.rpc('addon_feedback_my_inbox');
  if(error){box.textContent='Không tải được tin nhắn: '+error.message;return}
  box.replaceChildren();
  const threads=Array.isArray(data)?data:[];
  if(!threads.length){box.textContent='Chưa có phản ánh hoặc tin nhắn nào.';return}
  for(const row of threads){
   const article=document.createElement('article');article.className='feedback-thread';
   const header=document.createElement('strong');
   header.textContent=new Date(row.created_at).toLocaleString('vi-VN')+
    (row.status==='answered'?' · Đã được trả lời':' · Đang tiếp nhận');
   const original=document.createElement('p');original.textContent=row.body;
   article.append(header,original);
   for(const reply of row.replies||[]){
    const boxReply=document.createElement('div');boxReply.className='feedback-reply';
    const title=document.createElement('strong');title.textContent='Tin từ quản trị · '+
     new Date(reply.created_at).toLocaleString('vi-VN');
    const text=document.createElement('p');text.textContent=reply.body;
    const until=document.createElement('small');
    until.textContent='Tin này tự hết hạn sau 7 ngày · '+new Date(reply.expires_at).toLocaleString('vi-VN');
    const del=button('Xóa tin nhắn',async()=>{
     del.disabled=true;
     const {error}=await client.rpc('addon_feedback_hide_reply',{p_reply_id:reply.id});
     if(error){status(error.message,true);del.disabled=false;return}
     await inbox();
    });
    boxReply.append(title,text,until,del);article.append(boxReply);
   }
   box.append(article);
  }
 }
 async function submit(event){
  event.preventDefault();
  const submitButton=$('feedbackSubmit'),body=$('feedbackBody').value;
  const files=[...$('feedbackImages').files];
  try{validate(body,files)}catch(e){status(e.message,true);return}
  submitButton.disabled=true;
  try{
   const {data:{session}}=await client.auth.getSession();
   if(!session?.user?.id)throw Error('Bạn cần đăng nhập tài khoản AutoTax.');
   const {data:id,error}=await client.rpc('addon_feedback_submit',{p_body:body});
   if(error)throw error;
   const failed=[];
   for(const file of files){
    const path=session.user.id+'/'+id+'/'+crypto.randomUUID()+'.'+formats[file.type];
    const {error:uploadError}=await client.storage.from(BUCKET).upload(path,file,{
     contentType:file.type,upsert:false,cacheControl:'0'
    });
    if(uploadError)failed.push(file.name+': '+uploadError.message);
   }
   $('feedbackForm').reset();
   $('feedbackWordCount').textContent='0 / 1000 từ · 0 / 5 ảnh';
   await inbox();
   if(failed.length)status('Phản hồi đã gửi nhưng có ảnh không tải được: '+failed.join('; '),true);
   else{
    status('Phản hồi đã gửi thành công.');
    $('feedbackDialog').close();
   }
  }catch(e){status('Không gửi được phản hồi: '+e.message,true)}
  finally{submitButton.disabled=false}
 }
 function count(){
  const words=wordCount($('feedbackBody').value),files=$('feedbackImages').files.length;
  $('feedbackWordCount').textContent=words+' / '+MAX_WORDS+' từ · '+files+' / 5 ảnh';
  $('feedbackWordCount').style.color=words>MAX_WORDS||files>5?'#b91c1c':'';
 }
 function init(){
  if(!$('feedbackOpen'))return;
  $('feedbackOpen').addEventListener('click',()=>{
   $('feedbackDialog').showModal();$('feedbackBody').focus();
  });
  $('feedbackClose').addEventListener('click',()=>$('feedbackDialog').close());
  $('feedbackForm').addEventListener('submit',submit);
  $('feedbackBody').addEventListener('input',count);
  $('feedbackImages').addEventListener('change',count);
  $('feedbackInboxRefresh').addEventListener('click',()=>void inbox());
  client.auth.onAuthStateChange(()=>setTimeout(()=>void inbox(),0));
  void inbox();
 }
 window.AutoTaxFeedbackInbox={refresh:inbox};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
