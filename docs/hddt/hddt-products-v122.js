/* AutoTax V1.2.2 — public HĐĐT product catalogue backed by RLS-protected Supabase rows. */
(()=>{
'use strict';
const ENDPOINT='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const money=v=>Number(v||0).toLocaleString('vi-VN')+' ₫';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=v=>String(v||'').trim().split(/\s+/).slice(0,4).join(' ');
async function init(){
 const tab=document.getElementById('tab3'); if(!tab||!window.supabase)return;
 const host=document.createElement('section');host.className='hddt-admin-products card';
 host.innerHTML='<h2 style="margin-top:0">Dịch vụ HĐĐT & Thiết bị</h2><p class="hddt-product-note">Danh mục và giá được cập nhật trực tiếp từ hệ thống AutoTax.</p><div id="hddtProductGrid" class="hddt-product-grid"><p>Đang tải sản phẩm…</p></div>';
 tab.prepend(host);
 const client=window.supabase.createClient(ENDPOINT,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.from('autotax_hddt_products_v122').select('id,image_url,name,price_vnd,details,sort_order').eq('active',true).order('sort_order').order('created_at');
 const grid=document.getElementById('hddtProductGrid');
 if(error){grid.innerHTML='<p>Chưa tải được danh mục sản phẩm.</p>';return}
 if(!data?.length){grid.innerHTML='<p>Danh mục đang được cập nhật.</p>';return}
 grid.replaceChildren();
 for(const item of data){
  const card=document.createElement('article');card.className='hddt-product-card';
  const img=item.image_url?'<img src="'+esc(item.image_url)+'" alt="'+esc(item.name)+'" loading="lazy" referrerpolicy="no-referrer">':'';
  card.innerHTML=img+'<h3>'+esc(item.name)+'</h3><div class="hddt-product-price">'+money(item.price_vnd)+'</div><p class="hddt-product-note">'+esc(short(item.details)||'Xem cấu hình chi tiết')+'</p><button class="hddt-product-detail" type="button">CẤU HÌNH CHI TIẾT</button>';
  card.querySelector('button').addEventListener('click',()=>{
   const modal=document.getElementById('hddtProductDetailModal')||document.body.appendChild(Object.assign(document.createElement('dialog'),{id:'hddtProductDetailModal'}));
   modal.style.cssText='width:min(560px,calc(100vw - 24px));border:1px solid #e5e7eb;border-radius:16px;padding:20px';
   modal.innerHTML='<button type="button" aria-label="Đóng" style="float:right">✕</button><h2>'+esc(item.name)+'</h2><strong style="color:#ee002e;font-size:1.25rem">'+money(item.price_vnd)+'</strong><div style="white-space:pre-wrap;line-height:1.6;margin-top:14px">'+esc(item.details||'Chưa có thông tin chi tiết.')+'</div>';
   modal.querySelector('button').onclick=()=>modal.close();
   if(!modal.open)modal.showModal();
  });
  grid.append(card);
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void init());else void init();
})();
