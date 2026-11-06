/* AutoTax unified account rules v1 — same implementation for Web, User and Chrome Add-on.
 * Authentication always uses the existing Supabase Auth project. Browser and
 * extension maintain their own sessions because they have distinct origins.
 */
(()=>{
 'use strict';
 const normalizeEmail=value=>String(value||'').trim().toLowerCase();
 const validEmail=value=>/^[^@\s]+@(gmail\.com|hotmail\.com|yahoo\.com|yahoo\.com\.vn)$/i.test(normalizeEmail(value));
 const normalizeName=value=>String(value||'').trim().replace(/\s+/g,' ');
 function message(error, fallback='Không thực hiện được thao tác. Vui lòng thử lại.'){
  const raw=String(error?.code||'')+' '+String(error?.message||error?.msg||error?.error_description||error?.error||error||'');
  const str=raw.toLowerCase();
  if(/user_already_exists|email_exists|identity_already_exists|already registered|already in use|already exists|already taken/.test(str))return 'Email đã tồn tại.';
  if(/invalid_credentials|invalid login credentials|invalid password|wrong password|incorrect password/.test(str))return 'Sai mật khẩu.';
  if(/email_not_confirmed|email not confirmed/.test(str))return 'Email chưa được xác minh. Vui lòng kiểm tra hộp thư.';
  if(/user_not_found|user not found/.test(str))return 'Không tìm thấy tài khoản.';
  if(/weak_password|password should|password is too short|password must/.test(str))return 'Mật khẩu phải đủ mạnh và có ít nhất 10 ký tự.';
  if(/over_email_send_rate_limit|email rate limit/.test(str))return 'Bạn đã yêu cầu gửi email quá nhiều lần. Vui lòng thử lại sau.';
  if(/over_request_rate_limit|too many requests|rate limit/.test(str))return 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.';
  if(/signup_disabled|signups not allowed/.test(str))return 'Hệ thống đang tạm ngừng đăng ký tài khoản.';
  if(/email_address_invalid|invalid email/.test(str))return 'Địa chỉ email không hợp lệ.';
  if(/same_password|new password should be different/.test(str))return 'Mật khẩu mới phải khác mật khẩu cũ.';
  if(/session_not_found|session expired|jwt expired|auth session missing|refresh token/.test(str))return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if(/network|failed to fetch|fetch failed|timeout/.test(str))return 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';
  if(/not_team_owner/.test(str))return 'Chỉ trưởng nhóm được thực hiện thao tác này.';
  if(/team_access_denied/.test(str))return 'Bạn không có quyền truy cập nhóm.';
  if(/[À-ỹ]/.test(raw))return String(error?.message||error||fallback);
  return fallback;
 }
 const validUsername=value=>/^[a-z][a-z0-9]{3,31}$/.test(String(value||'').trim().toLowerCase());
 async function usernameSession(username,password){
  const response=await fetch('https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-username-login',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({identifier:String(username||'').toLowerCase().trim(),password}),
   signal:AbortSignal.timeout(15000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Không đăng nhập được bằng User.');
  return data;
 }
 const duplicateSignup=data=>!!(data?.user&&Array.isArray(data.user.identities)&&!data.user.identities.length);
 function validateSignup({name,email,password,confirmPassword}){
  if(normalizeName(name).length<2||normalizeName(name).length>100)return 'Tên người dùng phải từ 2 đến 100 ký tự.';
  if(!validEmail(email))return 'Chỉ hỗ trợ đăng ký bằng Gmail, Hotmail hoặc Yahoo Mail.';
  if(String(password||'').length<10||String(password||'').length>128)return 'Mật khẩu phải từ 10 đến 128 ký tự.';
  if(confirmPassword!==undefined&&password!==confirmPassword)return 'Hai lần nhập mật khẩu không khớp.';
  return '';
 }
 // Quy tắc duy nhất cho cả 3 giao diện: chọn theo hạn mức SỬ DỤNG ĐƯỢC.
 // Khi cả hai loại đều hết, chỉ giữ loại đã chọn cuối cùng.
 function quotaModes(entitlements){
  const e=entitlements||{},invoice=e.packages?.invoice||{},mst=e.packages?.mst||{};
  const invoiceUsable=Number(invoice.remaining||0)+Number(e.team_invoice_spendable_remaining||0)>0;
  const mstUsable=Number(mst.active_quantity||0)+Number(e.team_mst_count||0)>0;
  const last=e.mode==='invoice'?'invoice':'mst';
  const options=invoiceUsable&&mstUsable?['mst','invoice']:
   mstUsable?['mst']:invoiceUsable?['invoice']:[last];
  const selected=options.includes(last)?last:options[0];
  return {options,selected,invoiceUsable,mstUsable,autoSelect:options.length===1&&(invoiceUsable||mstUsable)};
 }
 // Thống kê số lượt MỚI bị trừ trong đúng phiên quét hiện tại.
 // Lấy số liệu từ RPC xác nhận giao dịch, không tính từ số hóa đơn tìm thấy
 // hoặc chênh lệch số dư có thể thay đổi vì những phiên khác.
 function createScanQuotaCounter(){
  const totals={group:0,personal:0,charged:0,reread:0,mst:0,groupMst:0,denied:0,batches:0};
  const safe=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?Math.floor(n):0};
  function add(data){
   if(!data||typeof data!=='object')return;
   const group=safe(data.team_deducted);
   const charged=safe(data.deducted);
   const personal=data.personal_deducted===undefined?Math.max(0,charged-group):safe(data.personal_deducted);
   totals.group+=group;
   totals.personal+=personal;
   totals.charged+=charged;
   totals.reread+=safe(data.previously_deducted);
   totals.mst+=safe(data.recorded_without_charge);
   totals.groupMst+=safe(data.team_mst_reads);
   totals.denied+=safe(data.denied);
   totals.batches++;
  }
  function summary(){
   return 'TỔNG KẾT PHIÊN QUÉT: Trừ '+totals.charged+' lượt số tờ'+
    ' (hạn mức nhóm: '+totals.group+', cá nhân: '+totals.personal+'). '+
    'Đọc lại không trừ: '+totals.reread+' hóa đơn. '+
    'Đọc bằng gói MST (không trừ số tờ): '+totals.mst+' hóa đơn'+
    (totals.groupMst?', trong đó MST nhóm: '+totals.groupMst:'')+
    '. Không đủ quyền/lượt: '+totals.denied+' hóa đơn.';
  }
  return {add,summary,getTotals:()=>({...totals})};
 }
 const forgotSuccess='Nếu email đã đăng ký, hướng dẫn đặt lại mật khẩu sẽ được gửi tới hộp thư.';
 Object.defineProperty(globalThis,'AutoTaxAccountFlow',{
  value:Object.freeze({normalizeEmail,normalizeName,validEmail,validateSignup,message,duplicateSignup,forgotSuccess,quotaModes,createScanQuotaCounter,validUsername,usernameSession}),
  writable:false,configurable:true
 });
})();