/* AutoTax release announcement. No tracking, no third-party beacons. */
(()=>{
'use strict';
const VERSION='1.1.31',KEY='autotax_release_seen_'+VERSION;
function init(){
 try{if(localStorage.getItem(KEY)==='1')return}catch{}
 const node=document.createElement('aside');
 node.id='autotaxReleaseNotice';node.setAttribute('role','status');
 node.style.cssText='position:fixed;z-index:4000;bottom:12px;left:12px;right:12px;max-width:460px;margin:auto;background:#fff6f7;border:2px solid #eb7180;border-radius:13px;box-shadow:0 10px 32px #2b10182c;padding:12px 15px;font:13px/1.55 system-ui,sans-serif;color:#4b1e2b';
 const title=document.createElement('strong');title.textContent='AutoTax đã cập nhật V'+VERSION;title.style.cssText='display:block;color:#a20d29;font-size:15px';
 const detail=document.createElement('p');detail.textContent='Tự lấy HĐ thường và máy tính tiền; xuất Excel theo mẫu 48 cột; ghi nhận nhà phát hành đã xác minh và danh sách hóa đơn chờ bổ sung XML.';detail.style.margin='5px 0';
 const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Đã hiểu';
 dismiss.style.cssText='background:#bd0e2c;color:white;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer';
 dismiss.addEventListener('click',()=>{try{localStorage.setItem(KEY,'1')}catch{}node.remove()});
 node.append(title,detail,dismiss);document.body.append(node);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
