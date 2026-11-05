/* AutoTax V1.1.8 – Admin: manage footer links without changing source code. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const TABLE='addon_site_links_v118';
 function notice(text,bad=false){
  const e=$('siteLinksMessage');if(!e)return;
  e.textContent=text;e.style.color=bad?'#b91c1c':'#047857';
 }
 const node=(name,text)=>{const e=document.createElement(name);if(text!==undefined)e.textContent=text;return e};
 function validate(label,url){
  label=String(label||'').trim();url=String(url||'').trim();
  if(label.length<1||label.length>100)throw Error('Nội dung hiển thị cần 1–100 ký tự.');
  if(url.length>600)throw Error('Đường link quá dài.');
  let parsed;
  try{parsed=url.startsWith('/')&&!url.startsWith('//')?
    new URL(url,'https://tracuuhoadon.top'):new URL(url)}
  catch{throw Error('Địa chỉ liên kết không hợp lệ.')}
  if(parsed.protocol!=='https:')throw Error('Chỉ hỗ trợ liên kết HTTPS hoặc đường dẫn nội bộ bắt đầu bằng /.');
  return {label,url:parsed.href};
 }
 async function load(){
  const {data,error}=await client.from(TABLE).select('id,label,url,sort_order,enabled').order('sort_order').order('id');
  if(error){notice('Không tải được danh sách liên kết: '+error.message,true);return}
  const target=$('siteLinksBody');target.replaceChildren();
  for(const record of data||[]){
   const row=node('tr');
   const labelInput=node('input');labelInput.type='text';labelInput.value=record.label;labelInput.maxLength=100;labelInput.setAttribute('aria-label','Nội dung hiển thị');
   const urlInput=node('input');urlInput.type='url';urlInput.value=record.url;urlInput.setAttribute('aria-label','Đường link');
   const orderInput=node('input');orderInput.type='number';orderInput.value=String(record.sort_order||0);orderInput.style.width='68px';orderInput.setAttribute('aria-label','Thứ tự');
   const enabled=node('input');enabled.type='checkbox';enabled.checked=record.enabled;enabled.setAttribute('aria-label','Hiển thị liên kết');
   const save=node('button','Lưu');save.type='button';
   save.addEventListener('click',async()=>{
    save.disabled=true;
    try{
     const v=validate(labelInput.value,urlInput.value);
     const {error}=await client.from(TABLE).update({
      ...v,sort_order:Number(orderInput.value)||0,enabled:enabled.checked,
      updated_at:new Date().toISOString()
     }).eq('id',record.id);
     if(error)throw error;
     notice('Đã lưu '+v.label+' vào cấu hình chân trang.');
     await load();
    }catch(e){notice('Không lưu được: '+e.message,true);save.disabled=false}
   });
   const remove=node('button','Xóa');remove.type='button';remove.className='secondary';
   remove.addEventListener('click',async()=>{
    if(!confirm('Xóa liên kết '+record.label+' khỏi toàn bộ chân trang?'))return;
    remove.disabled=true;
    const {error}=await client.from(TABLE).delete().eq('id',record.id);
    if(error){notice('Không xóa được: '+error.message,true);remove.disabled=false;return}
    notice('Đã xóa liên kết '+record.label);await load();
   });
   for(const child of [labelInput,urlInput,orderInput,enabled]){
    const cell=node('td');cell.append(child);row.append(cell);
   }
   const buttons=node('td');buttons.append(save,remove);row.append(buttons);
   target.append(row);
  }
  $('siteLinksCount').textContent=(data||[]).length+' liên kết';
 }
 function init(){
  // Combo and validity are managed within the main Admin package controls.
  $('adminComboPackagesLink')?.remove();
  const f=$('siteLinkAdd');
  if(!f)return;
  f.addEventListener('submit',async e=>{
   e.preventDefault();
   const btn=$('siteLinkAddBtn');btn.disabled=true;
   try{
    const value=validate($('siteLinkText').value,$('siteLinkUrl').value);
    const {data:last}=await client.from(TABLE).select('sort_order').order('sort_order',{ascending:false}).limit(1);
    const {error}=await client.from(TABLE).insert({...value,sort_order:(Number(last?.[0]?.sort_order)||0)+10,enabled:true});
    if(error)throw error;
    $('siteLinkText').value='';$('siteLinkUrl').value='';
    notice('Đã thêm liên kết '+value.label);await load();
   }catch(e){notice('Không thêm được: '+e.message,true)}
   finally{btn.disabled=false}
  });
  $('reloadSiteLinks').addEventListener('click',()=>void load());
  // The customer/Admin inline bootstrap can resolve before this external
  // script loads, so also initialize after the whole document is ready.
  if(!$('app')?.classList.contains('hidden'))void load();
  client.auth.onAuthStateChange(()=>{
   setTimeout(()=>{if(!$('app')?.classList.contains('hidden'))void load()},150);
  });
 }
 window.AdminSiteLinks=Object.freeze({load});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
