/* AutoTax V1.1.19: discount codes managed in the existing Admin portal. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const notice=(message,bad=false)=>{
 const box=$('couponMessage');box.textContent=message;box.classList.remove('hidden');box.classList.toggle('error',bad);
};
const rpc=async(name,args)=>{
 const {data,error}=await client.rpc(name,args||{});if(error)throw error;return data;
};
const node=(tag,txt)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=String(txt);return e};
function displayAmount(c){return c.discount_type==='percent'?c.discount_value+'%':Number(c.discount_value).toLocaleString('vi-VN')+'đ'}
async function load(){
 try{
  const {data:{session}}=await client.auth.getSession();if(!session)return;
  const rows=await rpc('autotax_admin_list_discounts_v119');
  const box=$('couponRows');box.replaceChildren();
  for(const c of rows||[]){
   const tr=node('tr');
   const date=c.valid_until?new Date(c.valid_until).toLocaleString('vi-VN'):'Không giới hạn';
   for(const val of [c.code,c.discount_type==='percent'?'Phần trăm':'Số tiền',
    displayAmount(c),c.used_count+' / '+(c.max_redemptions??'∞'),date,c.active?'Đang hoạt động':'Đã tắt']){
    tr.append(node('td',val));
   }
   const action=node('td'),btn=node('button',c.active?'Tạm dừng':'Kích hoạt');
   btn.type='button';btn.className='secondary';
   btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{
     const result=await rpc('autotax_admin_set_discount_active_v119',{p_code:c.code,p_active:!c.active});
     if(!result)throw Error('Không tìm thấy mã.');
     notice('Đã đổi trạng thái mã '+c.code+'.');await load();
    }catch(error){notice('Không đổi được mã: '+error.message,true)}
    finally{btn.disabled=false}
   });
   action.append(btn);tr.append(action);box.append(tr);
  }
  if(!rows?.length){const tr=node('tr'),td=node('td','Chưa tạo mã giảm giá.');td.colSpan=7;tr.append(td);box.append(tr)}
 }catch(error){notice('Không tải được mã giảm giá: '+error.message,true)}
}
$('couponReload').addEventListener('click',()=>void load());
$('couponType').addEventListener('change',()=>{
 const percent=$('couponType').value==='percent';
 $('couponValue').max=percent?'99':'1000000000';
 $('couponValue').placeholder=percent?'Ví dụ 20 (tương đương 20%)':'Ví dụ 20000';
});
$('couponCreateForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('couponCreate');
 if(btn.disabled)return;
 const code=$('couponCode').value.trim().toUpperCase();
 const type=$('couponType').value,value=Number($('couponValue').value);
 const rawLimit=$('couponLimit').value.trim();
 const limit=rawLimit?Number(rawLimit):null;
 const expires=$('couponExpiry').value?new Date($('couponExpiry').value).toISOString():null;
 if(!/^[A-Z0-9_-]{3,32}$/.test(code))return notice('Mã gồm 3–32 ký tự A–Z, 0–9, dấu _ hoặc -.',true);
 if(!Number.isSafeInteger(value)||value<1||(type==='percent'&&value>99))return notice('Giá trị giảm không hợp lệ.',true);
 if(limit!==null&&(!Number.isSafeInteger(limit)||limit<1))return notice('Giới hạn lượt phải là số nguyên dương.',true);
 btn.disabled=true;
 try{
  await rpc('autotax_admin_create_discount_v119',{p_code:code,p_discount_type:type,
   p_discount_value:value,p_max_redemptions:limit,p_valid_until:expires});
  $('couponCreateForm').reset();$('couponType').dispatchEvent(new Event('change'));
  notice('Đã tạo mã giảm giá '+code+' thành công.');await load();
 }catch(error){notice('Không tạo được mã: '+error.message,true)}
 finally{btn.disabled=false}
});
client.auth.onAuthStateChange((event)=>{
 if(event==='INITIAL_SESSION'||event==='SIGNED_IN')queueMicrotask(()=>void load());
});
void load();
})();
