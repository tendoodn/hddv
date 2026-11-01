/* AutoTax V3.2 customer portal. Shares the same Supabase Auth + RPCs as the Chrome extension. */
"use strict";
const BASE="https://ucqqjdsoyvvaxswzbhaw.supabase.co";
const PUBLIC_KEY="sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ";
const client=window.supabase.createClient(BASE,PUBLIC_KEY);
const downloadUrlIsSafe=value=>{
 try{const url=new URL(String(value||"").trim());return url.protocol==="https:"&&!!url.hostname}
 catch{return false}
};
async function loadExtensionDownloadLink(){
 const button=document.getElementById("extensionDownloadBtn");
 try{
  const {data,error}=await client.from("addon_public_settings")
   .select("value").eq("setting_key","extension_download_url").maybeSingle();
  if(error)throw error;
  const url=String(data?.value||"").trim();
  button.hidden=!downloadUrlIsSafe(url);
  if(!button.hidden)button.href=url;
  else button.removeAttribute("href");
 }catch{button.hidden=true;button.removeAttribute("href")}
}

const $=id=>document.getElementById(id);
const vnDate=value=>value?new Date(value).toLocaleString("vi-VN"):"—";
const vnMoney=value=>Number(value||0).toLocaleString("vi-VN")+" đ";
const DUP_EMAIL="Email đã được đăng ký. Vui lòng thử email khác hoặc trở lại đăng nhập.";
let state=null,ordersWatch=null,paymentCloseTimer=null,checking=false;
let paymentCountdownTimer=null,paymentChannel=null,paymentOrder=null;
let paymentStatusPromise=null,postExpiryTimer=null;
function showMessage(text,bad=false,target="accountMessage"){
 const el=$(target);el.textContent=text;el.hidden=!text;el.classList.toggle("error",bad);
}
function isPendingV32Backend(error){
 const message=String(error?.message||error||"");
 return String(error?.code||"")==="PGRST202" ||
   /could not find the function|schema cache|function .* does not exist/i.test(message);
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
  invalid_mst:"MST phải có 10 hoặc 12 chữ số."
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
 if(paymentCountdownTimer)clearInterval(paymentCountdownTimer);
 if(postExpiryTimer)clearTimeout(postExpiryTimer);
 if(paymentChannel){void client.removeChannel(paymentChannel);paymentChannel=null}
 ordersWatch=null;paymentCloseTimer=null;paymentCountdownTimer=null;postExpiryTimer=null;
 paymentOrder=null;
 $("paymentArea").hidden=true;
 $("paymentQr").removeAttribute("src");
}
async function refresh(){
 if(checking)return;
 checking=true;
 try{
  const {data:{session}}=await client.auth.getSession();
  const signedIn=!!session;
  $("authSection").hidden=signedIn;
  $("dashboard").hidden=!signedIn;
  if(!signedIn){state=null;$("adminLink").hidden=true;closePayment();return}
  $("userEmail").textContent=session.user.email||"";
  const license=await rpc("addon_my_entitlements");
  state=license;
  const invoice=license.packages?.invoice||{};
  const mst=license.packages?.mst||{};
  const invRemaining=Number(invoice.remaining||0);
  const invTotal=Number(invoice.purchased||0);
  const mstCapacity=Number(mst.active_quantity||0);
  const selected=license.mode||"mst";
  $("licenseTitle").textContent=selected==="invoice"&&invRemaining===0&&license.can_reread_charged_invoices?"Hết lượt mới · được đọc lại hóa đơn cũ":license.allowed?"Đã có quyền sử dụng":"Chưa có gói hiệu lực";
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
  state=null;
  $("trialArea").hidden=true;
  $("modeSection").hidden=true;
  $("packageList").replaceChildren();
  $("mstList").replaceChildren();
  if(isPendingV32Backend(error)){
   $("licenseTitle").textContent="Đang chuyển đổi sang AutoTax V3.2";
   showMessage("Hệ thống cấp phép V3.2 chưa được triển khai trên Supabase. Đăng nhập vẫn hoạt động, nhưng mua gói, dùng thử và kích hoạt mã sẽ chỉ mở sau khi quản trị cập nhật SQL.",true);
  }else{
   showMessage("Chưa đồng bộ được dữ liệu Supabase V3.2: "+prettyError(error),true);
  }
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
 $("mstWebCount").textContent=String((rows||[]).length);
 for(const a of rows||[]){
  const line=document.createElement("div");line.className="mst-row";
  const name=document.createElement("div");
  addText(name,"strong",a.mst);
  addText(name,"small","Liên kết: "+vnDate(a.assigned_at),"muted");
  const button=addText(line,"button","Xóa MST");button.className="secondary";
  button.addEventListener("click",async()=>{
   if(!confirm("Xóa hồ sơ MST "+a.mst+"? Lịch sử cũ và dùng thử vẫn được giữ."))return;
   button.disabled=true;
   try{await rpc("addon_remove_mst_profile_v33",{p_mst:a.mst});showMessage("Đã xóa hồ sơ "+a.mst);await loadMstAssignments()}
   catch(e){showMessage(prettyError(e),true);button.disabled=false}
  });
  line.prepend(name);list.append(line);
 }
 if(!list.children.length)addText(list,"p","Chưa có hồ sơ MST nào. Hãy thêm MST của phiên cổng Thuế.","muted");
}
// Bank QR is displayed for five minutes, based on the server-issued deadline.
// A transfer cannot be technically revoked at the bank; late confirmation
// continues to be accepted and reflected in the entitlement balance.
function qrRemainingMilliseconds(order){
 return Math.max(0,order.expiresAt-(Date.now()+order.serverOffset));
}
function qrCountdownText(ms){
 const seconds=Math.ceil(ms/1000);
 return String(Math.floor(seconds/60)).padStart(2,"0")+":"+
  String(seconds%60).padStart(2,"0");
}
function expireQrDisplay(order){
 if(paymentOrder!==order||order.expired||order.completed)return;
 order.expired=true;
 $("paymentArea").hidden=true;
 $("paymentQr").removeAttribute("src");
 if(paymentCountdownTimer){clearInterval(paymentCountdownTimer);paymentCountdownTimer=null}
 if(ordersWatch){clearInterval(ordersWatch);ordersWatch=null}
 // Retain reconciliation monitoring for a limited time if bank confirmation is slow.
 ordersWatch=setInterval(()=>{void checkPaymentStatus()},10000);
 postExpiryTimer=setTimeout(()=>{if(paymentOrder===order)closePayment()},600000);
 showMessage("QR đã hết thời gian hiển thị (5 phút). Không nên chuyển khoản bằng mã QR cũ. Nếu đã chuyển khoản, hệ thống vẫn theo dõi xác nhận từ ngân hàng.",true);
}
async function finishPaidOrder(order){
 if(paymentOrder!==order||order.completed)return;
 order.completed=true;
 closePayment();
 let balancesText="Thông tin gói đã ghi nhận trên máy chủ.";
 try{
  await refresh();
  const licenses=await rpc("addon_my_entitlements");
  state=licenses;
  const inv=licenses.packages?.invoice||{},mst=licenses.packages?.mst||{};
  const remaining=Number(inv.remaining||0),purchased=Number(inv.purchased||0);
  const capacity=Number(mst.active_quantity||0);
  // Update the visible counters from the same authoritative response.
  $("invoiceBalance").textContent=remaining.toLocaleString("vi-VN")+" / "+purchased.toLocaleString("vi-VN");
  $("mstCapacity").textContent=capacity.toLocaleString("vi-VN")+" MST";
  $("mstExpiry").textContent="Hạn gần nhất: "+vnDate(mst.nearest_expiry)+" · Hạn xa nhất: "+vnDate(mst.farthest_expiry);
  balancesText="Hóa đơn: "+remaining.toLocaleString("vi-VN")+" / "+purchased.toLocaleString("vi-VN")+
   " lượt\nMST hiện có: "+capacity.toLocaleString("vi-VN")+
   (mst.nearest_expiry?"\nHạn gần nhất: "+vnDate(mst.nearest_expiry):"");
 }catch(error){
  balancesText="Thanh toán đã xác nhận. Không tải được số dư mới: "+prettyError(error)+". Bấm Làm mới để kiểm tra lại.";
 }
 $("paymentSuccessInfo").textContent="Đã nhận thanh toán cho gói "+order.packageCode+".";
 $("paymentSuccessBalance").textContent=balancesText;
 const dialog=$("paymentSuccessDialog");
 if(!dialog.open)dialog.showModal();
 showMessage("Thanh toán thành công! Đã cập nhật gói sử dụng.");
}
async function checkPaymentStatus(manual=false){
 const order=paymentOrder;
 if(!order)return;
 if(paymentStatusPromise)return paymentStatusPromise;
 paymentStatusPromise=(async()=>{
  try{
   const status=await rpc("addon_my_order_status",{p_order_id:order.id});
   if(paymentOrder!==order||!status)return;
   if(status.status==="paid"){await finishPaidOrder(order);return;}
   if(["cancelled","failed","refunded"].includes(status.status)){
    closePayment();
    showMessage("Đơn hàng không còn chờ thanh toán (trạng thái: "+status.status+"). Vui lòng tạo đơn khác.",true);
    return;
   }
   if(manual)showMessage(order.expired?"QR đã hết 5 phút, chưa ghi nhận thanh toán.":"Đơn hàng đang chờ ngân hàng xác nhận.");
  }catch(error){
   if(manual)showMessage("Không kiểm tra được thanh toán: "+prettyError(error),true);
  }
 })();
 try{return await paymentStatusPromise}finally{paymentStatusPromise=null}
}
async function buy(packageCode,button){
 button.disabled=true;
 try{
  const {data:{session}}=await client.auth.getSession();
  if(!session)throw Error("Vui lòng đăng nhập lại trước khi thanh toán.");
  const response=await fetch(BASE+"/functions/v1/addon-create-order",{
   method:"POST",headers:{apikey:PUBLIC_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
   body:JSON.stringify({package_code:packageCode})
  });
  const result=await response.json();
  if(!response.ok||!result.success||!result.payment?.qr_url)throw Error(result.error||"Không tạo được đơn hàng.");
  const expiresAt=Date.parse(result.payment.expires_at||result.order?.qr_expires_at);
  if(!Number.isFinite(expiresAt))throw Error("Hệ thống chưa trả về hạn QR. Vui lòng tải lại trang và thử lại.");
  closePayment();
  const serverTime=Date.parse(result.server_time);
  const order={
   id:result.order.order_id,packageCode,
   expiresAt,serverOffset:Number.isFinite(serverTime)?serverTime-Date.now():0,
   completed:false,expired:false
  };
  paymentOrder=order;
  $("paymentInfo").textContent=vnMoney(result.payment.amount_vnd)+" · "+
   result.payment.bank_name+" · "+result.payment.account_name+
   " · Nội dung: "+result.payment.transfer_content;
  $("paymentQr").src=result.payment.qr_url;
  $("paymentArea").hidden=false;
  const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("paymentArea").scrollIntoView({behavior:reducedMotion?"instant":"smooth",block:"center"});
  showMessage("Đã tạo đơn "+packageCode+". QR tự ẩn sau 5 phút; hệ thống theo dõi thanh toán tự động.");
  function tick(){
   if(paymentOrder!==order||order.completed||order.expired)return;
   const remaining=qrRemainingMilliseconds(order);
   $("paymentCountdown").textContent=qrCountdownText(remaining);
   if(remaining<=0)void checkPaymentStatus().then(()=>{
    if(paymentOrder===order&&!order.completed)expireQrDisplay(order);
   });
  }
  tick();
  paymentCountdownTimer=setInterval(tick,1000);
  ordersWatch=setInterval(()=>{void checkPaymentStatus()},2500);
  // Realtime is immediate when available; polling above remains the fallback.
  paymentChannel=client.channel("autotax-order-"+order.id)
   .on("postgres_changes",{
    event:"UPDATE",schema:"public",table:"addon_orders",filter:"id=eq."+order.id
   },()=>{void checkPaymentStatus()})
   .subscribe();
  void checkPaymentStatus();
 }catch(error){showMessage("Không tạo được đơn: "+prettyError(error),true)}
 finally{button.disabled=false}
}
async function action(id,fn){
 const button=$(id);button.disabled=true;
 try{await fn()}catch(error){showMessage(prettyError(error),true,$("dashboard").hidden?"authMessage":"accountMessage")}
 finally{button.disabled=false}
}
$("loginForm").addEventListener("submit",event=>{
 event.preventDefault();
 if($("loginBtn").disabled)return;
 void action("loginBtn",async()=>{
 const {error}=await client.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
 if(error)throw error;
 showMessage("");await refresh();
 });
});
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
$("refreshBtn").addEventListener("click",()=>{void loadExtensionDownloadLink();void refresh()});
$("webAddMstForm").addEventListener("submit",async e=>{
 e.preventDefault();const input=$("webAddMst"),mst=input.value.trim().replace(/[ -]/g,"");
 if(!/^(\d{10}|\d{12}|\d{13})$/.test(mst)){showMessage("MST phải có 10, 12 hoặc 13 chữ số.",true);return}
 const submit=$("webAddMstForm").querySelector('button[type="submit"]');submit.disabled=true;
 try{await rpc("addon_add_mst_profile_v33",{p_mst:mst});input.value="";await loadMstAssignments();showMessage("Đã thêm hồ sơ MST "+mst)}
 catch(e){showMessage(prettyError(e),true)}
 finally{submit.disabled=false}
});
$("giftWebBtn").addEventListener("click",()=>{$("giftWebDialog").showModal();$("unlockCode").focus()});
$("closeGiftWebBtn").addEventListener("click",()=>$("giftWebDialog").close());
$("renewWebBtn").addEventListener("click",()=>$("planSection").scrollIntoView({behavior:"smooth",block:"center"}));
$("passwordOpenBtn").addEventListener("click",()=>{
 $("passwordPanel").hidden=false;
 $("passwordPanel").scrollIntoView({behavior:"smooth",block:"center"});
 $("newPassword").focus();
});
$("passwordCloseBtn").addEventListener("click",()=>{$("passwordPanel").hidden=true});

$("trialBtn").addEventListener("click",()=>action("trialBtn",async()=>{
 const mst=$("trialMst").value.trim().replace(/[ -]/g,"");
 if(!/^\d{10}(\d{2})?$/.test(mst))throw Error("MST phải có 10 hoặc 12 chữ số.");
 const granted=await rpc("addon_start_mst_trial",{p_mst:mst});
 $("trialMst").value="";
 await refresh();showMessage("Dùng thử 1 MST đến "+vnDate(granted.expires_at));
}));
$("redeemBtn").addEventListener("click",()=>action("redeemBtn",async()=>{
 const code=$("unlockCode").value.trim().toUpperCase();
 if(!code)throw Error("Vui lòng nhập mã unlock.");
 const granted=await rpc("addon_redeem_package_unlock",{p_code:code});
 $("unlockCode").value="";
 await refresh();$("giftWebDialog").close();showMessage("Đã kích hoạt gói "+granted.package_code+".");
}));
$("usageMode").addEventListener("change",async e=>{
 const selected=e.target.value;
 try{await rpc("addon_set_usage_mode",{p_mode:selected});await refresh()}
 catch(error){showMessage(prettyError(error),true);e.target.value=state?.mode||"mst"}
});
$("closePaymentBtn").addEventListener("click",closePayment);
$("checkPaymentBtn").addEventListener("click",()=>{void checkPaymentStatus(true)});
$("closePaymentSuccessBtn").addEventListener("click",()=>$("paymentSuccessDialog").close());
$("changePasswordBtn").addEventListener("click",()=>action("changePasswordBtn",async()=>{
 const password=$("newPassword").value;
 if(password.length<8)throw Error("Mật khẩu cần ít nhất 8 ký tự.");
 const {error}=await client.auth.updateUser({password});
 if(error)throw error;
 $("newPassword").value="";
 showMessage("Mật khẩu đã được thay đổi.");
}));
client.auth.onAuthStateChange((event)=>{if(event==="PASSWORD_RECOVERY")$("passwordRecovery").hidden=false});
loadExtensionDownloadLink();
refresh();
