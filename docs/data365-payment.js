/* Shared DATA365 SePay/VietQR modal; only the server can confirm payment. */
(()=>{
'use strict';
const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const SUCCESS='Thanh toán thành công, đợi 5-10s để hệ thống cập nhật. Nếu không kích hoạt vui lòng liên hệ quản trị.';
const $=id=>document.getElementById(id);
let dialog=null,order=null,timer=null,finishTimer=null,checking=false,client=null,onPaid=()=>{},onClose=()=>{},generation=0;
function create(){
 if(dialog)return;
 const css=document.createElement('style');
 css.textContent='#data365PaymentDialog{box-sizing:border-box;width:min(440px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;margin:auto;padding:22px;border:1px solid #d1d5db;border-radius:16px;background:#fff;color:#1f2937;box-shadow:0 24px 65px #0008;line-height:1.5}'+
 '#data365PaymentDialog::backdrop{background:#080c18b8}'+
 '#data365PaymentDialog h2{margin:0 0 8px;color:#b91c1c;font-size:20px}'+
 '#data365PaymentDialog .detail{font-size:13px;white-space:pre-line;overflow-wrap:anywhere;font-weight:700}'+
 '#data365PaymentDialog .qr{display:block;width:min(260px,75vw);height:auto;margin:10px auto;border:1px solid #ddd;border-radius:10px}'+
 '#data365PaymentDialog .state{padding:12px;border-radius:9px;background:#eff6ff;color:#1e40af;font-size:13px;line-height:1.6}'+
 '#data365PaymentDialog .state.success{background:#dcfce7;color:#166534;font-weight:750}'+
 '#data365PaymentDialog .state.error{background:#fef2f2;color:#991b1b}'+
 '#data365PaymentDialog .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}'+
 '#data365PaymentDialog .actions button{padding:10px 14px;border:1px solid #ccd1d9;border-radius:9px;color:#1f2937;background:#e5e7eb;font-weight:800;cursor:pointer}'+
 '#data365PaymentDialog #data365PayCheck{background:#b91c1c;color:white}'+
 '#data365PaymentDialog [hidden]{display:none!important}';
 document.head.append(css);
 dialog=document.createElement('dialog');dialog.id='data365PaymentDialog';
 dialog.setAttribute('aria-labelledby','data365PaymentTitle');
 dialog.innerHTML='<h2 id="data365PaymentTitle">Thanh toán DATA365</h2>'+
 '<p style="font-size:12px;color:#64748b">365 ngày · Giá theo Admin · Không áp dụng mã giảm giá.</p>'+
 '<p class="detail" id="data365PayInfo" role="status">Đang tạo QR…</p>'+
 '<section id="data365PayQrBox" hidden><p style="text-align:center">QR còn hiệu lực: <strong id="data365PayTime">05:00</strong></p><img class="qr" id="data365PayQr" alt="VietQR DATA365"></section>'+
 '<p id="data365PayState" class="state" aria-live="polite">Đang tạo đơn…</p>'+
 '<div class="actions"><button id="data365PayCheck" type="button" hidden>Kiểm tra</button><button id="data365PayClose" type="button">Đóng</button></div>';
 document.body.append(dialog);
 $('data365PayClose').onclick=()=>close();
 $('data365PayCheck').onclick=()=>void check(true);
 dialog.addEventListener('click',e=>{if(e.target===dialog)e.preventDefault()});
}
const setState=(t,kind='')=>{const node=$('data365PayState');node.textContent=t;node.className='state '+kind};
function stopTimers(){clearInterval(timer);clearTimeout(finishTimer);timer=null;finishTimer=null}
function close(done=false){
 ++generation;stopTimers();order=null;checking=false;
 if(dialog?.open)dialog.close();$('data365PayQr')?.removeAttribute('src');
 if(done)Promise.resolve().then(()=>onClose()).catch(console.warn);
}
async function check(manual=false){
 const ref=order;if(!ref||ref.done||checking)return;
 checking=true;
 try{
  const {data,error}=await client.rpc('addon_my_order_status',{p_order_id:ref.id});
  if(order!==ref)return;
  if(error)throw error;
  if(data?.status==='paid'){
   ref.done=true;stopTimers();$('data365PayQrBox').hidden=true;$('data365PayCheck').hidden=true;
   $('data365PayInfo').textContent='Đã nhận xác nhận thanh toán DATA365 từ máy chủ.';
   setState(SUCCESS,'success');
   Promise.resolve().then(()=>onPaid()).catch(e=>console.warn('DATA365 refresh:',e));
   finishTimer=setTimeout(()=>{if(order===ref)close(true)},5000);return;
  }
  if(['cancelled','failed','refunded'].includes(data?.status)){
   ref.done=true;stopTimers();$('data365PayQrBox').hidden=true;
   setState('Đơn đã dừng ('+data.status+'). Hãy tạo đơn khác.','error');return;
  }
  if(manual)setState('Ngân hàng chưa xác nhận; hệ thống tiếp tục kiểm tra.');
 }catch(e){if(manual&&order===ref)setState('Không kiểm tra được: '+(e.message||e),'error')}
 finally{checking=false}
}
function clock(ms){
 const t=Math.max(0,Math.ceil(ms/1000));
 return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
}
async function open(opts={}){
 if(!opts.client?.auth?.getSession||!opts.client?.rpc)throw Error('Chưa có kết nối phiên AutoTax.');
 create();if(dialog.open){dialog.focus();return}
 client=opts.client;onPaid=typeof opts.onPaid==='function'?opts.onPaid:()=>{};
 onClose=typeof opts.onClose==='function'?opts.onClose:()=>{};
 const seq=++generation;dialog.showModal();$('data365PayQrBox').hidden=true;
 $('data365PayCheck').hidden=true;$('data365PayQr').removeAttribute('src');
 $('data365PayInfo').textContent='Đang tạo mã QR thanh toán…';setState('Hệ thống đang tạo đơn DATA365…');
 try{
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  if(!data?.session?.access_token)throw Error('Vui lòng đăng nhập AutoTax trước khi thanh toán.');
  const response=await fetch(BASE+'/functions/v1/addon-create-order',{
   method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
   body:JSON.stringify({package_code:'DATA365',coupon_code:null,replace_order_id:null})
  });
  const reply=await response.json().catch(()=>({}));
  if(!response.ok||!reply.success||!reply.order?.order_id||!reply.payment?.qr_url)throw Error(reply.error||'Không tạo được đơn DATA365.');
  const expires=Date.parse(reply.payment.expires_at||reply.order.qr_expires_at);
  if(!Number.isFinite(expires))throw Error('Chưa có thời hạn QR từ máy chủ.');
  const url=new URL(reply.payment.qr_url);if(url.protocol!=='https:')throw Error('Địa chỉ QR không hợp lệ.');
  if(!dialog.open||seq!==generation)return;
  const server=Date.parse(reply.server_time),offset=Number.isFinite(server)?server-Date.now():0;
  const ref={id:reply.order.order_id,expires,offset,done:false};order=ref;
  const img=$('data365PayQr');
  img.hidden=true;
  img.onload=()=>{if(order===ref&&seq===generation){img.hidden=false;setState('QR đã sẵn sàng. Chuyển khoản đúng số tiền và nội dung.')}};
  img.onerror=()=>{if(order===ref&&seq===generation)setState('Ảnh QR tải lỗi. Hãy thử tạo QR mới hoặc dùng thông tin chuyển khoản được máy chủ xác nhận.','error')};
  img.loading='eager';img.decoding='async';img.fetchPriority='high';
  img.src=url.href;
  $('data365PayQrBox').hidden=false;$('data365PayCheck').hidden=false;
  $('data365PayInfo').textContent=Number(reply.payment.amount_vnd||0).toLocaleString('vi-VN')+' ₫\n'+
   String(reply.payment.bank_name||'Ngân hàng')+' · '+String(reply.payment.account_name||'')+'\nNội dung: '+String(reply.payment.transfer_content||'');
  setState('Đã có thông tin thanh toán. Đang tải ảnh QR…');
  const tick=()=>{
   if(order!==ref||ref.done)return;
   const remaining=Math.max(0,ref.expires-Date.now()-ref.offset);
   $('data365PayTime').textContent=clock(remaining);
   if(remaining<=0){
    stopTimers();$('data365PayQrBox').hidden=true;
    setState('QR đã hết hạn. Không chuyển khoản bằng QR cũ. Nếu đã chuyển tiền, bấm Kiểm tra hoặc liên hệ quản trị.','error');
   }
  };
  tick();timer=setInterval(()=>{tick();void check(false)},2500);void check(false);
 }catch(e){
  if(seq!==generation)return;
  $('data365PayInfo').textContent='Chưa có mã QR.';
  setState('Không tạo được thanh toán DATA365: '+(e.message||e),'error');
 }
}
window.AutoTaxData365Payment=Object.freeze({open,close});
})();