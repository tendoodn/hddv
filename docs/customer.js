/* AutoTax V3.2 customer portal. Shares the same Supabase Auth + RPCs as the Chrome extension. */
"use strict";
const BASE="https://ucqqjdsoyvvaxswzbhaw.supabase.co";
const PUBLIC_KEY="sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ";
const client=window.supabase.createClient(BASE,PUBLIC_KEY);
const $=id=>document.getElementById(id);
const vnDate=value=>value?new Date(value).toLocaleString("vi-VN"):"—";
const vnMoney=value=>Number(value||0).toLocaleString("vi-VN")+" đ";
const DUP_EMAIL="Email đã được đăng ký. Vui lòng thử email khác hoặc trở lại đăng nhập.";
let state=null,ordersWatch=null,paymentCloseTimer=null,checking=false;
function showMessage(text,bad=false,target="accountMessage"){
 const el=$(target);el.textContent=text;el.hidden=!text;el.classList.toggle("error",bad);
}
function prettyError(error){
 const code=String(error?.code||"");
 const msg=String(error?.message||error||"Không xác định");
 const known={
  trial_email_already_used:"Email này đã sử dụng quyền dùng thử. Vui lòng mua gói để tiếp tục.",
  trial_mst_already_used:"MST này đã từng dùng thử ở tài khoản khác. Bạn có thể mua gói để sử dụng.",
  existing_package_account_not_eligible_for_trial:"Tài khoản này đã từng nhận gói, không thể đăng ký dùng thử.",
  mst_capacity_reached:"Đã đủ số MST được phép quản lý.",
  mst_unlink_requires_active_package:"Gói MST đã hết hạn, chỉ admin mới có quyền gỡ MST.",
  trial_mst_not_reserved:"MST chưa được đăng ký dùng thử hợp lệ.",
  invoice_mode_not_selected:"Vui lòng chọn chế độ sử dụng hóa đơn.",
  invalid_mst:"MST phải có 10 hoặc 13 chữ số."
 };
 return known[code]||known[msg]||msg;
}
async function rpc(name,args={}){
 const {data,error}=await client.rpc(name,args);
 if(error)throw error;
 return data;
}
function addText(node,tag,value,className=""){
 const element=document.createElement(tag);
 element.textContent=value??"";
 if(className)element.className=className;
 node.append(element);
 return element;
}
function setBusy(id,flag){$(id).disabled=!!flag}
function closePayment(){
 if(ordersWatch)clearInterval(ordersWatch);
 if(paymentCloseTimer)clearTimeout(paymentCloseTimer);
 ordersWatch=null;paymentCloseTimer=null;
 $("paymentArea").hidden=true;
}
async function refresh(){
 if(checking)return;
 checking=true;
 try{
  const {data:{session}}=await client.auth.getSession();
  const signedIn=!!session;
  $("authSection").hidden=signedIn;
  $("dashboard").hidden=!signedIn;
  if(!signedIn){state=null;closePayment();return}
  $("userEmail").textContent=session.user.email||"";
  const license=await rpc("addon_my_entitlements");
  state=license;
  const invoice=license.packages?.invoice||{};
  const mst=license.packages?.mst||{};
  const invRemaining=Number(invoice.remaining||0);
  const invTotal=Number(invoice.purchased||0);
  const mstCapacity=Number(mst.active_quantity||0);
  const selected=license.mode||"mst";
  $("licenseTitle").textContent=license.allowed?"Đã có quyền sử dụng":(selected==="invoice"&&license.can_reread_charged_invoices?"Chỉ được đọc lại hóa đơn cũ":"Chưa có gói hiệu lực");
  $("invoiceBalance").textContent=invRemaining.toLocaleString("vi-VN")+" / "+invTotal.toLocaleString("vi-VN");
  $("mstCapacity").textContent=mstCapacity.toLocaleString("vi-VN")+" MST";
  $("mstExpiry").textContent="Hạn gần nhất: "+vnDate(mst.nearest_expiry)+" · Hạn xa nhất: "+vnDate(mst.farthest_expiry);
  $("rereadNote").hidden=!license.can_reread_charged_invoices;
  $("modeSection").hidden=!(invTotal>0&&mstCapacity>0);
  $("usageMode").value=selected;
  $("trialArea").hidden=!!license.ever_had_package||!!license.trial_used||!!license.allowed;
  $("trialStatus").textContent=license.trial_used?"Email đã nhận dùng thử trước đây.":(license.ever_had_package?"Tài khoản đã có lịch sử gói.":"");
  await Promise.all([loadMstAssignments(),loadPackages(),refreshAdminLink()]);
 }catch(error){
  showMessage("Chưa đồng bộ được dữ liệu Supabase V3.2: "+prettyError(error),true);
 }finally{checking=false}
}
async function refreshAdminLink(){
 try{$("adminLink").hidden=!(await rpc("addon_is_admin"))}
 catch{$("adminLink").hidden=true}
}
async function loadPackages(){
 const rows=await rpc("addon_list_packages");
 const list=$("packageList");list.replaceChildren();
 for(const item of rows||[]){
  const card=document.createElement("div");card.className="plan";
  addText(card,"h3",item.name);
  addText(card,"p",item.family==="invoice"?item.quantity+" lượt hóa đơn, cộng dồn khi mua thêm":item.quantity+" MST · "+(item.validity_days?item.validity_days+" ngày":"Chưa mở thời hạn"),"muted");
  addText(card,"strong",vnMoney(item.price_vnd),"price");
  const b=addText(card,"button","Chọn mua");
  b.type="button";b.disabled=item.family==="mst"&&!item.validity_days;
  b.addEventListener("click",()=>buy(item.code,b));
  list.append(card);
 }
 if(!list.children.length)addText(list,"p","Hiện chưa mở bán gói nào.","muted");
}
async function loadMstAssignments(){
 const list=$("mstList");list.replaceChildren();
 const rows=await rpc("addon_list_my_mst_assignments");
 const capacity=Number(state?.packages?.mst?.active_quantity||0);
 for(const a of rows||[]){
  const line=document.createElement("div");line.className="mst-row";
  const name=document.createElement("div");
  addText(name,"strong",a.mst);
  addText(name,"small","Liên kết: "+vnDate(a.assigned_at),"muted");
  const button=addText(line,"button","Gỡ MST");
  button.className="secondary";
  button.disabled=capacity===0;
  button.title=capacity===0?"Gói MST hết hạn; liên hệ admin để gỡ.":"";
  button.addEventListener("click",async()=>{
   if(!confirm("Gỡ MST "+a.mst+"? Lịch sử dùng thử vẫn được giữ."))return;
   button.disabled=true;
   try{await rpc("addon_unlink_mst",{p_mst:a.mst});showMessage("Đã gỡ MST "+a.mst);await loadMstAssignments()}
   catch(e){showMessage(prettyError(e),true);button.disabled=false}
  });
  line.prepend(name);list.append(line);
 }
 if(!list.children.length)addText(list,"p","Chưa liên kết MST nào.","muted");
}
async function buy(packageCode,button){
 button.disabled=true;
 try{
  const {data:{session}}=await client.auth.getSession();
  const response=await fetch(BASE+"/functions/v1/addon-create-order",{
   method:"POST",headers:{apikey:PUBLIC_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
   body:JSON.stringify({package_code:packageCode})
  });
  const result=await response.json();
  if(!response.ok||!result.success||!result.payment?.qr_url)throw Error(result.error||"Không tạo được đơn hàng.");
  $("paymentInfo").textContent=vnMoney(result.payment.amount_vnd)+" · "+result.payment.bank_name+" · "+result.payment.account_name+" · Nội dung: "+result.payment.transfer_content;
  $("paymentQr").src=result.payment.qr_url;
  $("paymentArea").hidden=false;
  showMessage("Đã tạo đơn. Vui lòng chuyển khoản đúng nội dung.");
  const previous=JSON.stringify(state?.packages||{});
  closeTimersOnly();
  ordersWatch=setInterval(async()=>{
   try{const next=await rpc("addon_my_entitlements");if(JSON.stringify(next.packages)!==previous){closePayment();await refresh();showMessage("Đã ghi nhận gói mới.")}}
   catch{/* Polling never changes package balances on the client. */}
  },5000);
  paymentCloseTimer=setTimeout(()=>{closePayment();showMessage("Mã QR đã đóng sau 15 phút. Có thể tạo đơn mới nếu cần.")},900000);
 }catch(error){showMessage("Không tạo được đơn: "+prettyError(error),true)}
 finally{button.disabled=false}
}
function closeTimersOnly(){
 if(ordersWatch)clearInterval(ordersWatch);
 if(paymentCloseTimer)clearTimeout(paymentCloseTimer);
 ordersWatch=null;paymentCloseTimer=null;
}
async function action(id,fn){
 const button=$(id);button.disabled=true;
 try{await fn()}catch(error){showMessage(prettyError(error),true)}
 finally{button.disabled=false}
}
$("loginBtn").addEventListener("click",()=>action("loginBtn",async()=>{
 const {error}=await client.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
 if(error)throw error;
 showMessage("");await refresh();
}));
$("signupBtn").addEventListener("click",()=>action("signupBtn",async()=>{
 const {data,error}=await client.auth.signUp({email:$("email").value.trim().toLowerCase(),password:$("password").value});
 if(error){
  const value=String(error.code||"")+" "+error.message;
  if(/user_already_exists|email_exists|identity_already_exists|already registered|already in use/i.test(value))return showMessage(DUP_EMAIL,true,"authMessage");
  throw error;
 }
 if(data?.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0)return showMessage(DUP_EMAIL,true,"authMessage");
 showMessage(data?.session?"Đã tạo tài khoản và đăng nhập.":"Nếu email hợp lệ, hãy kiểm tra hộp thư xác minh rồi đăng nhập.",false,"authMessage");
 if(data?.session)await refresh();
}));
$("resetBtn").addEventListener("click",()=>action("resetBtn",async()=>{
 const {error}=await client.auth.resetPasswordForEmail($("email").value.trim(),{redirectTo:location.href.split("#")[0]});
 if(error)throw error;
 showMessage("Đã gửi hướng dẫn khôi phục nếu email hợp lệ.",false,"authMessage");
}));
$("logoutBtn").addEventListener("click",()=>action("logoutBtn",async()=>{closePayment();await client.auth.signOut();await refresh()}));
$("refreshBtn").addEventListener("click",refresh);
$("trialBtn").addEventListener("click",()=>action("trialBtn",async()=>{
 const mst=$("trialMst").value.trim().replace(/[ -]/g,"");
 if(!/^\d{10}(\d{3})?$/.test(mst))throw Error("MST phải có 10 hoặc 13 chữ số.");
 const granted=await rpc("addon_start_mst_trial",{p_mst:mst});
 $("trialMst").value="";
 await refresh();showMessage("Dùng thử 1 MST đến "+vnDate(granted.expires_at));
}));
$("redeemBtn").addEventListener("click",()=>action("redeemBtn",async()=>{
 const code=$("unlockCode").value.trim().toUpperCase();
 if(!code)throw Error("Vui lòng nhập mã unlock.");
 const granted=await rpc("addon_redeem_package_unlock",{p_code:code});
 $("unlockCode").value="";
 await refresh();showMessage("Đã kích hoạt gói "+granted.package_code+".");
}));
$("usageMode").addEventListener("change",async e=>{
 const selected=e.target.value;
 try{await rpc("addon_set_usage_mode",{p_mode:selected});await refresh()}
 catch(error){showMessage(prettyError(error),true);e.target.value=state?.mode||"mst"}
});
$("closePaymentBtn").addEventListener("click",closePayment);
$("checkPaymentBtn").addEventListener("click",refresh);
$("changePasswordBtn").addEventListener("click",()=>action("changePasswordBtn",async()=>{
 const password=$("newPassword").value;
 if(password.length<8)throw Error("Mật khẩu cần ít nhất 8 ký tự.");
 const {error}=await client.auth.updateUser({password});
 if(error)throw error;
 $("newPassword").value="";
 showMessage("Mật khẩu đã được thay đổi.");
}));
client.auth.onAuthStateChange((event)=>{if(event==="PASSWORD_RECOVERY")$("passwordRecovery").hidden=false});
refresh();
