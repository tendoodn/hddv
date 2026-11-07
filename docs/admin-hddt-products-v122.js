/* AutoTax V1.2.2 — Admin HĐĐT catalogue editor. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('vi-VN');
const short=v=>String(v||'').trim().split(/\s+/).slice(0,4).join(' ');
let rows=[],editing=null,imageData='';
function client(){return window.AutoTaxSharedClient}
function status(t,error=false){const el=$('hddtProductAdminStatus');if(!el)return;el.textContent=t||'';el.classList.toggle('error',!!error)}
async function fileData(file){
 if(!file)return '';
 if(!/^image\//.test(file.type)||file.size>8*1024*1024)throw Error('Ảnh phải nhỏ hơn 8 MB.');
 const raw=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file)});
 const img=new Image();img.src=raw;await img.decode();
 const scale=Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
 canvas.getContext('2d',{alpha:false}).drawImage(img,0,0,canvas.width,canvas.height);
 return canvas.toDataURL('image/jpeg',.82);
}
function render(){
 const body=$('hddtProductAdminRows');if(!body)return;
 body.innerHTML=rows.length?'':'<tr><td colspan="6">Chưa có sản phẩm.</td></tr>';
 rows.forEach((p,i)=>{
  const tr=document.createElement('tr');
  tr.innerHTML='<td>'+(p.image_url?'<img src="'+esc(p.image_url)+'" alt="" style="width:64px;height:48px;object-fit:contain;border-radius:8px;background:#f8fafc">':'—')+'</td>'+
   '<td><strong>'+esc(p.name)+'</strong></td><td>'+money(p.price_vnd)+' ₫</td><td title="'+esc(p.details)+'">'+esc(short(p.details)||'—')+'</td>'+
   '<td>'+(p.active?'Đang hiện':'Đã ẩn')+'</td><td><button type="button" class="secondary" data-edit="'+i+'">Sửa</button></td>';
  body.append(tr);
 });
}
async function load(){
 const c=client();if(!c)return;
 status('Đang tải danh mục HĐĐT…');
 const {data,error}=await c.from('autotax_hddt_products_v122').select('*').order('sort_order').order('created_at');
 if(error){status('Không tải được sản phẩm: '+error.message,true);return}
 rows=data||[];render();status('Đã tải '+rows.length+' sản phẩm.');
}
function openEditor(row=null){
 editing=row?.id||null;imageData=row?.image_url||'';
 $('hddtProductForm').reset();
 $('hddtProductDialogTitle').textContent=row?'Cập nhật sản phẩm':'Thêm sản phẩm';
 $('hddtProductName').value=row?.name||'';
 $('hddtProductPrice').value=row?.price_vnd??0;
 $('hddtProductDetails').value=row?.details||'';
 $('hddtProductSort').value=row?.sort_order??0;
 $('hddtProductActive').checked=row?.active??true;
 $('hddtProductImagePreview').src=imageData||'';
 $('hddtProductImagePreview').hidden=!imageData;
 const d=$('hddtProductDialog');if(!d.open)d.showModal();
}
async function save(e){
 e.preventDefault();const c=client();if(!c)return;
 const btn=$('hddtProductSave');btn.disabled=true;
 try{
  const file=$('hddtProductImage').files?.[0];
  if(file)imageData=await fileData(file);
  const payload={
   image_url:imageData||'',name:$('hddtProductName').value.trim(),
   price_vnd:Number($('hddtProductPrice').value||0),details:$('hddtProductDetails').value.trim(),
   sort_order:Number($('hddtProductSort').value||0),active:$('hddtProductActive').checked
  };
  if(!payload.name)throw Error('Nhập tên sản phẩm.');
  if(!Number.isSafeInteger(payload.price_vnd)||payload.price_vnd<0)throw Error('Giá bán không hợp lệ.');
  const q=editing?c.from('autotax_hddt_products_v122').update(payload).eq('id',editing):
    c.from('autotax_hddt_products_v122').insert(payload);
  const {error}=await q;if(error)throw error;
  $('hddtProductDialog').close();status('Đã lưu sản phẩm.');await load();
 }catch(error){$('hddtProductFormStatus').textContent=error.message||String(error)}
 finally{btn.disabled=false}
}
function init(){
 if(!$('adminHddtProducts'))return;
 $('hddtProductAdd').addEventListener('click',()=>openEditor());
 $('hddtProductReload').addEventListener('click',()=>void load());
 $('hddtProductAdminRows').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openEditor(rows[Number(b.dataset.edit)])});
 $('hddtProductImage').addEventListener('change',async e=>{try{const d=await fileData(e.target.files?.[0]);if(d){imageData=d;$('hddtProductImagePreview').src=d;$('hddtProductImagePreview').hidden=false}}catch(error){$('hddtProductFormStatus').textContent=error.message}});
 $('hddtProductForm').addEventListener('submit',save);
 $('hddtProductCancel').addEventListener('click',()=>$('hddtProductDialog').close());
 $('hddtProductClose').addEventListener('click',()=>$('hddtProductDialog').close());
 const d=$('hddtProductDialog');d.addEventListener('cancel',e=>e.preventDefault());d.addEventListener('click',e=>{if(e.target===d)e.preventDefault()});
 setTimeout(()=>void load(),0);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
