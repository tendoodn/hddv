/* AutoTax V1.2.2 announcement. No tracking or remote dependencies. */
(()=>{
'use strict';
const VERSION='1.2.2', KEY='autotax_release_seen_'+VERSION;
function init(){
 try{if(localStorage.getItem(KEY)==='1')return}catch{}
 if(document.getElementById('autotaxReleaseNotice'))return;
 const node=document.createElement('aside');node.id='autotaxReleaseNotice';
 node.setAttribute('role','region');node.setAttribute('aria-label','Thông báo cập nhật AutoTax');
 node.style.cssText='position:fixed;z-index:4000;bottom:10px;left:10px;right:10px;max-width:460px;margin:auto;background:#fff6f7;border:2px solid #eb7180;border-radius:13px;box-shadow:0 10px 32px #2b10182c;padding:12px 15px;font:13px/1.5 system-ui,sans-serif;color:#4b1e2b';
 const title=document.createElement('strong');title.textContent='AutoTax V'+VERSION+' đã cập nhật';
 title.style.cssText='display:block;color:#a20d29;font-size:15px';
 const detail=document.createElement('p');
 detail.textContent='Đồng bộ đăng nhập Web–Lite–Add-on, chuẩn hóa tên file tải, cải thiện giao diện Lite trên điện thoại, tăng phản hồi nút bấm và tiếp tục tách mã nguồn build/backend khỏi repo public. Quyền MST, gói và lịch sử sử dụng được giữ nguyên.';
 detail.style.margin='5px 0';
 const close=document.createElement('button');close.type='button';close.textContent='Đóng thông báo';
 close.style.cssText='background:#bd0e2c;color:white;border:0;border-radius:8px;padding:8px 14px;font-weight:750;cursor:pointer';
 close.addEventListener('click',()=>{try{localStorage.setItem(KEY,'1')}catch{}node.remove()});
 node.append(title,detail,close);document.body.append(node);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
