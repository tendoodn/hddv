/* AutoTax V3.2 customer portal. Shares the same Supabase Auth + RPCs as the Chrome extension. */
"use strict";
const BASE="https://ucqqjdsoyvvaxswzbhaw.supabase.co";
const PUBLIC_KEY="sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ";
const client=window.AutoTaxSharedClient||(window.AutoTaxSharedClient=window.supabase.createClient(BASE,PUBLIC_KEY));
window.AutoTaxSharedMstVault?.setAuthProvider(async()=>{
 const {data:{session}}=await client.auth.getSession();
 return {userId:session?.user?.id,token:session?.access_token};
});
const $=id=>document.getElementById(id);
const vnDate=value=>value?new Date(value).toLocaleDateString("vi-VN"):"—";
const vnMoney=value=>Number(value||0).toLocaleString("vi-VN")+" đ";
const DUP_EMAIL="Email đã tồn tại.";
const accountFlow=window.AutoTaxAccountFlow;
let state=null,ordersWatch=null,paymentCloseTimer=null,checking=false;
let lastQuotaSnapshot='',quotaProbeBusy=false;
// Compare only entitlement facts, never volatile auth refresh timestamps.
function entitlementSnapshot(license){
 if(!license)return '';
 const keys=['mode','usage_mode','active_mode','selected_mode','allowed',
  'packages','can_reread_charged_invoices','team_invoice_remaining',
  'team_invoice_spendable_remaining','team_invoice_purchased',
  'team_mst_package_capacity','team_mst_count','team_invoice_shared_mst_count',
  'team_shared_msts','team_memberships','team_mode','team_id',
  'trial_used','trial_expires_at','ever_had_package'];
 return JSON.stringify(keys.map(key=>license[key]??null));
}
let adminRoleCheckedUser='',adminRoleCheckedAt=0,adminRoleRequest=0;
async function refreshExtensionDownloadLink(){
 const anchor=$('extensionDownloadBtn');
 if(!anchor)return;
 try{
  const {data,error}=await client.from('addon_public_settings').select('value').eq('setting_key','extension_download_url').maybeSingle();
  if(error)throw error;
  const url=String(data?.value||'').trim();
  const parsed=new URL(url);
  if(parsed.protocol==='https:' && (parsed.hostname==='drive.google.com'||parsed.hostname==='docs.google.com')){
   anchor.href=parsed.href;
   anchor.title='Tải bản AutoTax Extension mới nhất từ Google Drive';
  }
 }catch(error){console.warn('Không cập nhật được link Extension:',error.message)}
}
function setAdminVisibility(show){
 for(const id of ['adminLink','adminFooterLink']){
  const el=$(id);if(el)el.hidden=!show;
 }
}
async function refreshAdminVisibility(userId){
 if(!userId){adminRoleCheckedUser='';adminRoleCheckedAt=0;++adminRoleRequest;setAdminVisibility(false);return}
 if(adminRoleCheckedUser===userId&&Date.now()-adminRoleCheckedAt<60000)return;
 setAdminVisibility(false);
 const request=++adminRoleRequest;
 adminRoleCheckedUser=userId;
 try{
  const {data,error}=await client.rpc('addon_is_admin');
  if(request!==adminRoleRequest)return;
  const {data:{session}}=await client.auth.getSession();
  if(request!==adminRoleRequest||session?.user?.id!==userId)return;
  setAdminVisibility(!error&&data===true);
  adminRoleCheckedAt=Date.now();
 }catch(error){if(request===adminRoleRequest){setAdminVisibility(false);adminRoleCheckedAt=0;console.warn('Không xác minh được quyền admin:',error.message)}}
}
let paymentCountdownTimer=null,paymentChannel=null,paymentOrder=null;
let paymentCreating=false,paymentRequestEpoch=0;
let paymentStatusPromise=null,postExpiryTimer=null;
let mstEditing='',mstEditOriginalName='',mstGrantUnlocked=false,canDeleteMstProfiles=false;
let mstPage=1;
function applyMstPagination(){
 const list=$('mstList');if(!list)return;
 const perPage=Number($('mstPageSize')?.value)||3;
 const rows=Array.from(list.querySelectorAll(':scope > .mst-row'));
 const pages=Math.max(1,Math.ceil(rows.length/perPage));
 mstPage=Math.min(Math.max(1,mstPage),pages);
 rows.forEach((row,i)=>{row.hidden=i<(mstPage-1)*perPage||i>=mstPage*perPage});
 $('mstPageInfo').textContent='Trang '+mstPage+' / '+pages+' · '+rows.length+' MST';
 $('mstPagePrev').disabled=mstPage<=1;
 $('mstPageNext').disabled=mstPage>=pages;
}

// Limit old MST migration to 2 concurrent background reads to keep the UI responsive.
const legacyMstQueue=[],legacyMstQueued=new Set();
let legacyMstActive=0;
function enqueueLegacyMstMigration(userId,mst){
 const key=userId+':'+mst;
 if(legacyMstQueued.has(key))return;
 legacyMstQueued.add(key);legacyMstQueue.push({userId,mst});
 drainLegacyMstQueue();
}
function drainLegacyMstQueue(){
 while(legacyMstActive<2&&legacyMstQueue.length){
  const {userId,mst}=legacyMstQueue.shift();
  legacyMstActive++;
  Promise.resolve(window.AutoTaxProfileVault?.migrate(userId,mst))
   .catch(e=>{legacyMstQueued.delete(userId+':'+mst);console.warn('Khôi phục mật khẩu MST '+mst+':',e.message)})
   .finally(()=>{legacyMstActive--;drainLegacyMstQueue()});
 }
}
const personalMstCapacity=()=>Math.max(0,Number(state?.packages?.mst?.active_quantity)||0);
function updateMstGrantPreview(){
 const cap=personalMstCapacity();
 const granted=document.querySelectorAll('#mstList .mst-allow-checkbox:checked').length;
 $('mstAllowedSummary').textContent=(mstGrantUnlocked?'Đang chọn (chưa lưu): ':'Đã cấp quyền ')+granted+' / '+cap+' MST cá nhân';
 $('mstAllowedSummary').classList.toggle('error',granted>cap);
}
function setMstGrantUnlocked(value){
 // The user can always open settings. Zero personal slots must not make the
 // settings button unclickable; group grants stay read-only and independent.
 const cap=personalMstCapacity();
 mstGrantUnlocked=!!value;
 $('mstGrantAllow').hidden=!mstGrantUnlocked;
 $('mstGrantAllow').disabled=!mstGrantUnlocked||cap<1;
 $('mstGrantCancel').hidden=!mstGrantUnlocked;
 $('mstGrantUnlock').hidden=mstGrantUnlocked;
 $('mstGrantUnlock').disabled=false;
 const help=$('mstAllowHelp');
 if(help){
  help.hidden=!mstGrantUnlocked;
  help.textContent=cap>0?
   'Chọn MST cá nhân được cấp phép, tối đa '+cap+' MST. Hồ sơ trưởng nhóm chia sẻ chỉ được xem, không thể sửa/xóa tại đây.':
   'Tài khoản hiện không có hạn mức MST cá nhân để điều chỉnh. Quyền MST nhóm được cấp riêng; muốn cấp thêm quyền MST cá nhân, vui lòng gia hạn gói MST.';
 }
 for(const box of document.querySelectorAll('#mstList .mst-allow-checkbox'))
  box.disabled=!mstGrantUnlocked||cap<1||box.dataset.sharedReadonly==='true';
 updateMstGrantPreview();
}
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
  mst_capacity_reached:"Bạn đã hết hạn mức. Vui lòng chọn gói phù hợp",
  mst_not_whitelisted:"MST này chưa được cấp quyền tra cứu bằng gói MST. Hãy tick chọn rồi bấm Cấp quyền ở danh sách hồ sơ.",
  mst_profile_not_saved:"Có MST chưa được lưu trong hồ sơ. Vui lòng thêm hồ sơ trước khi cấp quyền.",
  mst_unlink_requires_active_package:"Gói MST đã hết hạn, chỉ admin mới có quyền gỡ MST.",
  trial_mst_not_reserved:"MST chưa được đăng ký dùng thử hợp lệ.",
  invoice_mode_not_selected:"Vui lòng chọn chế độ sử dụng hóa đơn.",
  invalid_mst:"MST phải có 10, 12 hoặc 13 chữ số (chi nhánh dạng 10-001)."
 };
 return known[code]||known[msg]||accountFlow.message(error);
}
const isAuthSessionError=error=>/Auth session missing|JWT expired|Invalid Refresh Token|refresh token not found/i.test(String(error?.message||error||''));
async function rpc(name,args={}){
 let {data,error}=await client.rpc(name,args);
 if(error&&isAuthSessionError(error)){
  // Check the browser session first; retry a protected RPC only once.
  const current=await client.auth.getSession();
  if(current.error||!current.data?.session)throw Error('Phiên đăng nhập AutoTax đã hết hạn. Vui lòng đăng nhập lại.');
  const refreshed=await client.auth.refreshSession();
  if(refreshed.error||!refreshed.data?.session)throw Error('Phiên đăng nhập AutoTax đã hết hạn. Vui lòng đăng nhập lại.');
  ({data,error}=await client.rpc(name,args));
 }
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
 ++paymentRequestEpoch;
 const qrLoading=$('paymentQrLoading');if(qrLoading)qrLoading.hidden=true;
 const timer=$('paymentCountdown')?.closest('[role="timer"]');if(timer)timer.hidden=false;
 const verify=$('checkPaymentBtn');if(verify)verify.hidden=false;
 const qr=$('paymentQr');if(qr){qr.onload=null;qr.onerror=null;qr.hidden=false}
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
  if(signedIn&&session.user?.email){try{localStorage.setItem('autotax_recent_email',session.user.email)}catch{}}
  let {data:userResult,error:userError}=signedIn?
   await client.auth.getUser():{data:{user:null},error:null};
  if(userError&&isAuthSessionError(userError)){
   // Recover once if the token changed while the account page was opening.
   const renewed=await client.auth.refreshSession();
   if(!renewed.error&&renewed.data?.session)
    ({data:userResult,error:userError}=await client.auth.getUser());
  }
  if(userError)throw userError;
  if(!signedIn){location.replace('/');return;}
  if(!userResult?.user)throw Error('Chưa xác minh được tài khoản. Vui lòng thử lại.');
  const forceChange=!!(userResult?.user||session?.user)?.app_metadata?.autotax_force_password_change;
  $('dashboard').classList.toggle('autotax-force-password',forceChange);
  $("dashboard").hidden=!signedIn;
  const forceDialog=$('forcedPasswordDialog');
  if(signedIn&&forceChange){
   $('passwordPanel').hidden=true;
   if(!forceDialog.open){
    $('forcedPasswordNew').value='';
    $('forcedPasswordConfirm').value='';
    $('forcedPasswordError').hidden=true;
    forceDialog.showModal();
   }
  }else if(forceDialog.open)forceDialog.close();
  void refreshAdminVisibility(session.user.id);
  void refreshExtensionDownloadLink();
  $("userEmail").textContent=session.user.email||"";
  let license=await rpc("autotax_my_entitlements_v118");
  // Một nguồn quy tắc cho user/web/addon, không căn cứ vào gói đã hết hạn.
  let modeChoice=accountFlow.quotaModes(license);
  if(modeChoice.autoSelect){
   try{
    // Persist even when the server already returned the effective mode: the
    // previous selected mode might still be stored and must survive a team kick.
    await rpc('autotax_set_usage_mode_v118',{p_mode:modeChoice.selected});
    license=await rpc("autotax_my_entitlements_v118");
    modeChoice=accountFlow.quotaModes(license);
   }catch(modeError){showMessage('Không lưu được chế độ tự động: '+prettyError(modeError),true)}
  }
  const hasInvoice=Number(license.packages?.invoice?.purchased||0)>0||
    Number(license.team_invoice_purchased||0)>0||modeChoice.invoiceUsable||
    !!license.can_reread_charged_invoices;
  const hasMst=modeChoice.mstUsable;
  const canInvoice=modeChoice.invoiceUsable;
  const canMst=modeChoice.mstUsable;
  state=license;
  const invoice=license.packages?.invoice||{};
  const mst=license.packages?.mst||{};
  const teamInvoice=Number(license.team_invoice_remaining||0);
  const teamInvoiceUsable=Number(license.team_invoice_spendable_remaining||0);
  const teamMst=Number(license.team_mst_package_capacity||0);
  const teamMstShared=Number(license.team_mst_count||0);
  const teamInvoiceShared=Number(license.team_invoice_shared_mst_count||0);
  const invRemaining=Number(invoice.remaining||0)+teamInvoice;
  const invTotal=Number(invoice.purchased||0)+Number(license.team_invoice_purchased||0);
  const mstCapacity=Number(mst.active_quantity||0)+teamMst;
  const selected=modeChoice.selected;
  $("licenseTitle").textContent=selected==="invoice"&&(Number(invoice.remaining||0)+teamInvoiceUsable)===0&&license.can_reread_charged_invoices?"Hết lượt mới · được đọc lại hóa đơn cũ":license.allowed?"":(teamInvoice>0||teamMst>0)?"Đã nhận gói nhóm · chờ trưởng nhóm chia sẻ MST":"Chưa có gói hiệu lực";
  $("licenseTitle").hidden=!!license.allowed&&!(selected==="invoice"&&invRemaining===0&&license.can_reread_charged_invoices);
  $("invoiceBalance").textContent=invRemaining.toLocaleString("vi-VN")+" / "+invTotal.toLocaleString("vi-VN");
  $("invoiceTeamLimit").textContent="Cá nhân: "+Number(invoice.remaining||0).toLocaleString("vi-VN")+" · Nhóm: "+teamInvoice.toLocaleString("vi-VN")+
   (teamInvoice>0&&teamInvoiceShared===0?" (chưa có MST được chia sẻ)":"");
  $("mstCapacity").textContent=mstCapacity.toLocaleString("vi-VN")+" MST";
  $("mstTeamLimit").textContent="Cá nhân: "+Number(mst.active_quantity||0).toLocaleString("vi-VN")+" MST · Nhóm: "+teamMst.toLocaleString("vi-VN")+" MST (đã chia sẻ "+teamMstShared+" MST)";
  $("mstExpiry").textContent="Hạn gói cá nhân: gần nhất "+vnDate(mst.nearest_expiry)+" · xa nhất "+vnDate(mst.farthest_expiry);
  $("rereadNote").hidden=!license.can_reread_charged_invoices;
  const modeCounts={invoice:Number(invoice.remaining||0)+teamInvoiceUsable,mst:Number(mst.active_quantity||0)+teamMstShared};
  const spendableInvoice=modeCounts.invoice>0,spendableMst=modeCounts.mst>0;
  $("modeSection").hidden=false;
  for(const option of $("usageMode").options){
   const visible=modeChoice.options.includes(option.value);
   option.hidden=!visible;option.disabled=!visible;
  }
  $("usageMode").disabled=modeChoice.options.length<2;
  const selectedCard=$(selected==='invoice'?'invoicePlanCard':'mstPlanCard');
  const otherCard=$(selected==='invoice'?'mstPlanCard':'invoicePlanCard');
  for(const card of [selectedCard,otherCard])card.classList.remove('is-selected-mode','is-other-mode');
  selectedCard.classList.add('is-selected-mode');otherCard.classList.add('is-other-mode');
  selectedCard.setAttribute('aria-current','true');otherCard.removeAttribute('aria-current');
  $("usageMode").value=selected;

  $("usageMode").title=modeChoice.options.length===2?
    'Có gói MST và số tờ (gồm quyền trưởng nhóm). Hai chế độ không chạy đồng thời.':
    'Chế độ được chọn tự động theo gói hiện có.';
  // Personal MST whitelist configuration is available even when the invoice mode is active.
  $("mstAllowControls").hidden=false;
  setMstGrantUnlocked(false);
  $("trialArea").hidden=!!license.ever_had_package||!!license.trial_used||!!license.allowed;
  $("trialStatus").textContent=license.trial_used?"Email đã nhận dùng thử trước đây.":"";
  await Promise.all([loadMstAssignments(),loadPackages()]);
  lastQuotaSnapshot=entitlementSnapshot(license);
  if($("accountMessage").textContent.includes("Chưa đồng bộ được dữ liệu Supabase V3.2"))showMessage("");
 }catch(error){
  const authProblem=isAuthSessionError(error)||
    /Phiên đăng nhập AutoTax đã hết hạn/i.test(String(error?.message||''));
  if(authProblem){
   // A temporary RPC/JWT failure does not mean that the user signed out.
   // Only redirect if Supabase can confirm the session really disappeared.
   const current=await client.auth.getSession().catch(e=>({data:null,error:e}));
   if(!current.error&&!current.data?.session){location.replace('/');return;}
   showMessage('Tạm thời chưa xác minh được phiên đăng nhập. Vui lòng thử lại sau hoặc đăng nhập lại nếu phiên đã hết hạn.',true);
   return;
  }
  // Background/transient failures should not blank the existing dashboard.
  if(!state){
   $("trialArea").hidden=true;
   $("modeSection").hidden=true;
   $("packageList").replaceChildren();
   $("mstList").replaceChildren();
  }
  if(isPendingV32Backend(error)){
   if(!state)$("licenseTitle").textContent="Đang chuyển đổi sang AutoTax V3.2";
   showMessage("Hệ thống cấp phép V3.2 chưa được triển khai trên Supabase. Đăng nhập vẫn hoạt động, nhưng mua gói, dùng thử và kích hoạt mã sẽ chỉ mở sau khi quản trị cập nhật SQL.",true);
  }else{
   showMessage("Chưa đồng bộ được dữ liệu Supabase V3.2: "+prettyError(error),true);
  }
 }finally{
  checking=false;
  const waiting=$('accountSessionPending');
  if(waiting){
   waiting.hidden=!$('dashboard').hidden;
   if(!waiting.hidden)waiting.textContent='Không xác thực được phiên AutoTax. Kiểm tra mạng và tải lại trang.';
  }
 }
}
async function loadPackages(){
 const rows=await rpc("addon_list_packages");
 const list=$("packageList");list.replaceChildren();
 const defaults=['T100','T200','T500','T1000','T5000','MST1','MST5','MST10','MST20','MST50'];
 const sorted=[...defaults.map(code=>(rows||[]).find(p=>p.code===code)).filter(Boolean),
   ...(rows||[]).filter(p=>!defaults.includes(p.code)).sort((a,b)=>(a.code==='DATA365'?-1:b.code==='DATA365'?1:0))];
 let customHeadingAdded=false;
 for(const item of sorted){
  if(!defaults.includes(item.code)&&!customHeadingAdded){
   const heading=document.createElement('h3');
   heading.textContent='Các gói mới · danh sách bổ sung';
   heading.style.cssText='grid-column:1/-1;margin:12px 0 0;color:#9f1239';
   list.append(heading);customHeadingAdded=true;
  }
  const card=document.createElement("div");card.className="plan";
  addText(card,"h3",item.name);
  addText(card,"p",item.family==="storage"
   ? (item.description||"Đồng bộ danh mục MISA/Tendoo khi đổi máy")+" · "+(item.validity_days||365)+" ngày. Không ảnh hưởng số lượt và MST."
   : item.family==="invoice"
   ? item.quantity+" lượt hóa đơn (cộng dồn khi mua thêm)"+(item.validity_days?" · hiệu lực "+item.validity_days+" ngày.": " · không hết hạn.")+" Không giới hạn MST tra cứu theo số lượt đã mua; tối đa 100 hồ sơ MST lưu cùng lúc."
   : item.quantity+" MST · "+(item.validity_days?item.validity_days+" ngày":"Chưa mở thời hạn")+". Không giới hạn số hóa đơn tra cứu trong phạm vi MST được quản lý.","muted");
  addText(card,"strong",vnMoney(item.price_vnd),"price");
  const b=addText(card,"button",item.code==="DATA365"?"Thanh toán QR DATA365":"Chọn mua");
  b.type="button";b.disabled=item.family==="mst"&&!item.validity_days;
  b.addEventListener("click",()=>buy(item.code,b));
  list.append(card);
 }
 if(!list.children.length)addText(list,"p","Hiện chưa mở bán gói nào.","muted");
}
function passwordAgeDays(when){
 if(!when)return null;
 const days=Math.floor((Date.now()-new Date(when).getTime())/86400000);
 return Number.isFinite(days)?Math.max(0,days):null;
}
function maybeRemindMstPassword(profile,userId){
 const days=passwordAgeDays(profile.password_updated_at);
 if(days===null||days<80||!userId)return;
 const tag='autotax-password-80-'+userId+':'+profile.mst;
 const today=new Date().toISOString().slice(0,10);
 try{if(localStorage.getItem(tag)===today)return;localStorage.setItem(tag,today)}catch{}
 const dlg=$('mstPassword80Dialog');
 if(!dlg.open){
  $('mstPassword80Text').textContent='MST '+profile.mst+
   ' đã '+days+' ngày kể từ lần lưu/sửa mật khẩu. Vui lòng kiểm tra và đổi mật khẩu nếu cần.';
  dlg.showModal();
 }
}
function openMstEditor(profile=null){
 mstEditing=profile?.mst||'';
 mstEditOriginalName=String(profile?.display_name||'').trim();
 $('mstProfileTitle').textContent=mstEditing?'Sửa hồ sơ MST '+mstEditing:'Thêm hồ sơ MST';
 $('mstProfileName').value=mstEditOriginalName;
 $('mstProfileNumber').value=mstEditing;
 $('mstProfileNumber').readOnly=!!mstEditing;
 $('mstProfilePassword').value='';
 $('mstProfilePassword').placeholder=mstEditing?'Để trống nếu không đổi mật khẩu':'Mật khẩu cổng Thuế (không bắt buộc lúc tạo)';
 $('mstProfilePasswordDate').value=profile?.password_updated_at?
  vnDate(profile.password_updated_at):'Chưa nhập mật khẩu';
 $('mstProfileDialog').showModal();
 (mstEditing?$('mstProfileName'):$('mstProfileNumber')).focus();
}
async function loadMstAssignments(){
 const list=$("mstList");list.replaceChildren();
 const [rows,deletePermission,borrowed]=await Promise.all([
  rpc("addon_list_my_mst_assignments"),
  rpc("addon_my_mst_deletion_allowed_v115"),
  rpc("autotax_team_shared_mst_profiles_v119")
 ]);
 const shared=Array.isArray(borrowed)?borrowed:[];
 const sharedByMst=new Map(shared.map(row=>[String(row.mst||''),row]));
 canDeleteMstProfiles=deletePermission===true;
 $("mstWebCount").textContent=String(new Set([...(rows||[]).map(x=>x.mst),...shared.map(x=>x.mst)]).size);
 const {data:{session}}=await client.auth.getSession();
 const userId=session?.user?.id;
 for(const item of rows||[]){
  const line=document.createElement("div");line.className="mst-row";
  const allow=document.createElement("label");allow.className="mst-allow-check";
  allow.title="Chọn MST này để được tra cứu trong chế độ gói MST";
  const check=document.createElement("input");check.type="checkbox";check.className="mst-allow-checkbox";
  check.value=item.mst;check.checked=item.mst_allowed===true;
  const borrowedMeta=sharedByMst.get(item.mst);
  if(borrowedMeta)check.dataset.sharedReadonly='true';
  check.disabled=!!borrowedMeta||!mstGrantUnlocked||personalMstCapacity()<1;
  if(borrowedMeta)allow.title='MST thuộc kho được trưởng nhóm chia sẻ, không thể sửa hồ sơ hoặc mật khẩu.';
  const caption=document.createElement("span");
  caption.className='mst-permission-status';
  const syncCaption=()=>{
   const granted=check.checked;
   caption.textContent=granted?'Cho phép':'Không cấp phép';
   caption.classList.toggle('is-granted',granted);
   caption.classList.toggle('is-denied',!granted);
   check.setAttribute('aria-label',(granted?'Cho phép':'Không cấp phép')+' tra cứu MST '+item.mst);
  };
  check.addEventListener('change',()=>{syncCaption();updateMstGrantPreview()});
  syncCaption();
  if(borrowedMeta?.can_use_mst_package){
   caption.textContent="✓ Hạn mức MST trưởng nhóm";
   caption.classList.add('is-granted');caption.classList.remove('is-denied');
  }else if(borrowedMeta?.personally_authorized){
   caption.textContent="✓ Hạn mức MST cá nhân";
   caption.classList.add('is-granted');caption.classList.remove('is-denied');
  }else if(borrowedMeta?.can_use_invoice_package){
   caption.textContent="✓ Được tra cứu bằng số tờ của nhóm";
   caption.classList.add('is-granted');caption.classList.remove('is-denied');
  }
  allow.append(check,caption);line.append(allow);
  const name=document.createElement("div");name.className="mst-name";
  addText(name,"strong",item.mst);
  addText(name,"div",item.display_name||"Tên NNT chưa được xác minh","mst-name");
  addText(name,"small","Liên kết: "+vnDate(item.assigned_at),"muted");
  const days=passwordAgeDays(item.password_updated_at);
  addText(name,"small",
   item.password_updated_at?
    'Mật khẩu cập nhật: '+vnDate(item.password_updated_at)+
    ' · '+(days>=80?'Đã đến hạn nhắc đổi':(80-days)+' ngày đến mốc nhắc đổi'):
    'Chưa ghi nhận ngày nhập/sửa mật khẩu',"muted");
  const actions=document.createElement("div");actions.className="mst-row-actions";
  const isBorrowed=sharedByMst.has(item.mst);
  if(!isBorrowed){
   const edit=addText(actions,"button","Sửa");edit.className="secondary";
   edit.type='button';edit.addEventListener('click',()=>openMstEditor(item));
   if(userId)enqueueLegacyMstMigration(userId,item.mst);
  }else{
   addText(actions,"span","MST trưởng nhóm chia sẻ · chỉ xem","muted");
   if(!borrowedMeta.can_use_mst_package&&!item.mst_allowed&&!borrowedMeta.personally_authorized&&personalMstCapacity()>0){
    const grant=addText(actions,"button","Cấp quyền MST cá nhân");grant.className="secondary";grant.type="button";
    grant.addEventListener("click",async()=>{
     grant.disabled=true;
     try{
      await rpc("autotax_member_authorize_shared_mst_v120",{p_mst:item.mst});
      showMessage("Đã cấp quyền MST "+item.mst+" bằng hạn mức cá nhân.");
      await loadMstAssignments();
     }catch(error){showMessage(prettyError(error),true);grant.disabled=false}
    });
   }else if(!borrowedMeta.can_use_mst_package&&!borrowedMeta.personally_authorized&&!item.mst_allowed){
    addText(actions,"small",borrowedMeta.can_use_invoice_package?
     "Được dùng gói số tờ của nhóm. Chưa được cấp gói MST của nhóm.":
     "Trưởng nhóm chưa cấp quyền gói MST; tài khoản không có lượt MST cá nhân.", "muted");
   }
  }
  const button=addText(actions,"button","Xóa MST");button.className="secondary";
  button.type='button';button.hidden=isBorrowed;button.disabled=isBorrowed||!canDeleteMstProfiles;
  if(!canDeleteMstProfiles){
   button.title='Tài khoản dùng thử hoặc đã hết hạn không được xóa MST. Chỉ tài khoản có gói hợp lệ không phải dùng thử được xóa.';
   button.textContent='Không thể xóa';
  }
  button.addEventListener("click",async()=>{
   if(!canDeleteMstProfiles)return;
   const warning='Xóa hồ sơ '+item.mst+' sẽ xóa dữ liệu quản lý và lịch sử các hóa đơn đã ghi nhận của MST này trên AutoTax. '+
    'Lượt đã trừ KHÔNG được hoàn. Nếu thêm lại, các hóa đơn cũ có thể bị trừ lượt mới. '+
    'Các tệp đã tải về ổ đĩa KHÔNG thể tự xóa; bạn cần tự xóa trong thư mục đã lưu. Tiếp tục?';
   if(!confirm(warning))return;
   button.disabled=true;
   try{
    await rpc("addon_remove_mst_profile_v113",{p_mst:item.mst,p_confirm:true});
    if(userId)await window.AutoTaxProfileVault?.forget(userId,item.mst);
    showMessage("Đã xóa dữ liệu máy chủ của MST "+item.mst+
      ". Các file đã lưu trên ổ đĩa phải xóa thủ công.");
    await loadMstAssignments();
   }catch(e){showMessage(prettyError(e),true);button.disabled=false}
  });
  line.append(name,actions);list.append(line);
  if(state?.mode==='mst'&&!isBorrowed)maybeRemindMstPassword(item,userId);
 }
 // Borrowed profiles are displayed in the same MST vault but never get edit/delete controls.
 const ownSet=new Set((rows||[]).map(x=>x.mst));
 for(const borrowedMst of shared){
  if(ownSet.has(borrowedMst.mst))continue;
  const line=document.createElement("div");line.className="mst-row";
  const flag=document.createElement("span");flag.className="mst-permission-status";
  const sourceAllowed=borrowedMst.can_use_mst_package===true;
  const personalAllowed=borrowedMst.personally_authorized===true;
  flag.textContent=sourceAllowed?"✓ Hạn mức MST trưởng nhóm":
   personalAllowed?"✓ Hạn mức MST cá nhân":
   borrowedMst.can_use_invoice_package?"✓ Được dùng số tờ của nhóm":"✕ Chưa cấp quyền MST";
  flag.classList.toggle('is-granted',sourceAllowed||personalAllowed||borrowedMst.can_use_invoice_package);
  flag.classList.toggle('is-denied',!sourceAllowed&&!personalAllowed&&!borrowedMst.can_use_invoice_package);
  line.append(flag);
  const info=document.createElement("div");info.className="mst-name";
  addText(info,"strong",borrowedMst.mst);
  addText(info,"div",borrowedMst.display_name||"MST được chia sẻ","mst-name");
  addText(info,"small","Trưởng nhóm chia sẻ · chỉ xem; không được sửa hoặc xóa mật khẩu","muted");
  const actions=document.createElement("div");actions.className="mst-row-actions";
  if(!sourceAllowed&&(personalAllowed||personalMstCapacity()>0)){
   const toggle=addText(actions,"button",personalAllowed?"Thu hồi quyền cá nhân":"Cấp quyền MST cá nhân");
   toggle.className="secondary";toggle.type="button";
   toggle.addEventListener("click",async()=>{
    toggle.disabled=true;
    try{
     await rpc(personalAllowed?"autotax_member_revoke_shared_mst_v120":
       "autotax_member_authorize_shared_mst_v120",{p_mst:borrowedMst.mst});
     showMessage(personalAllowed?"Đã thu hồi quyền MST cá nhân.":"Đã cấp quyền cho MST "+borrowedMst.mst+" bằng hạn mức cá nhân.");
     await loadMstAssignments();
    }catch(e){showMessage(prettyError(e),true);toggle.disabled=false}
   });
  }else if(!sourceAllowed){
   addText(actions,"small",borrowedMst.can_use_invoice_package?
    "Có thể dùng lượt số tờ của trưởng nhóm. Không có hạn mức MST cá nhân để cấp.":
    "Chưa được trưởng nhóm cấp gói MST. Không có hạn mức MST cá nhân.","muted");
  }
  line.append(info,actions);list.append(line);
 }
 if(!list.children.length)addText(list,"p","Chưa có hồ sơ. Bấm Thêm MST để quản lý.","muted");
 applyMstPagination();
 updateMstGrantPreview();
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
  const licenses=await rpc("autotax_my_entitlements_v118");
  state=licenses;
  const inv=licenses.packages?.invoice||{},mst=licenses.packages?.mst||{};
  const teamSheets=Number(licenses.team_invoice_remaining||0);
  const teamInvoiceShared=Number(licenses.team_invoice_shared_mst_count||0);
  const teamPurchased=Number(licenses.team_invoice_purchased||0);
  const teamMsts=Number(licenses.team_mst_package_capacity||0);
  const teamMstShared=Number(licenses.team_mst_count||0);
  const remaining=Number(inv.remaining||0)+teamSheets,purchased=Number(inv.purchased||0)+teamPurchased;
  const capacity=Number(mst.active_quantity||0)+teamMsts;
  // Update the visible counters from the same authoritative response.
  $("invoiceBalance").textContent=remaining.toLocaleString("vi-VN")+" / "+purchased.toLocaleString("vi-VN");
  $("mstCapacity").textContent=capacity.toLocaleString("vi-VN")+" MST";
  $("invoiceTeamLimit").textContent="Cá nhân: "+Number(inv.remaining||0).toLocaleString("vi-VN")+" · Nhóm: "+teamSheets.toLocaleString("vi-VN")+
   (teamSheets>0&&teamInvoiceShared===0?" (chưa có MST được chia sẻ)":"");
  $("mstTeamLimit").textContent="Cá nhân: "+Number(mst.active_quantity||0).toLocaleString("vi-VN")+" MST · Nhóm: "+teamMsts.toLocaleString("vi-VN")+" MST (đã chia sẻ "+teamMstShared+" MST)";
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
async function buy(packageCode,button,options={}){
 if(packageCode==="DATA365"){
  if(!window.AutoTaxData365Payment)return showMessage("Bộ thanh toán DATA365 chưa tải. Vui lòng tải lại trang.",true);
  // Dedicated QR checkout; no coupon UI or replacement order for DATA365.
  closePayment();
  try{
   await window.AutoTaxData365Payment.open({
    client,
    onPaid:async()=>{await refresh();},
    onClose:()=>{const old=$("paymentSuccessDialog");if(old?.open)old.close();}
   });
  }catch(error){showMessage("Không mở được DATA365: "+prettyError(error),true)}
  return;
 }
 if(paymentCreating||button.disabled)return;
 paymentCreating=true;button.disabled=true;
 // Show the checkout immediately. Do not show a QR or permit payment until
 // the server has created a real order with a validated amount and expiry.
 closePayment();
 const requestEpoch=paymentRequestEpoch;
 $('paymentArea').hidden=false;
 $('paymentInfo').textContent='Đang tạo đơn '+packageCode+' và mã QR bảo mật…';
 $('paymentQr').hidden=true;
 $('paymentQrLoading').hidden=false;
 $('paymentCountdown').closest('[role="timer"]').hidden=true;
 $('checkPaymentBtn').hidden=true;
 $('applyPaymentCoupon').disabled=true;
 $('paymentArea').scrollIntoView({behavior:'instant',block:'nearest'});
 showMessage('Đang yêu cầu mã QR thanh toán từ máy chủ…');
 try{
  const {data:{session}}=await client.auth.getSession();
  if(!session)throw Error("Vui lòng đăng nhập lại trước khi thanh toán.");
  const response=await fetch(BASE+"/functions/v1/addon-create-order",{
   method:"POST",headers:{apikey:PUBLIC_KEY,Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
   body:JSON.stringify({package_code:packageCode,coupon_code:options.coupon||null,replace_order_id:options.replaceId||null})
  });
  const result=await response.json();
  if(requestEpoch!==paymentRequestEpoch)return;
  if(!response.ok||!result.success||!result.payment?.qr_url)throw Error(result.error||"Không tạo được đơn hàng.");
  const expiresAt=Date.parse(result.payment.expires_at||result.order?.qr_expires_at);
  if(!Number.isFinite(expiresAt))throw Error("Hệ thống chưa trả về hạn QR. Vui lòng tải lại trang và thử lại.");
  // Keep the already-open checkout. Closing here would hide it and invalidate
  // a user request; only replace the placeholder with confirmed payment data.
  const serverTime=Date.parse(result.server_time);
  const order={
   id:result.order.order_id,packageCode,
   expiresAt,serverOffset:Number.isFinite(serverTime)?serverTime-Date.now():0,
   completed:false,expired:false
  };
  paymentOrder=order;
  $("paymentCouponCode").value=options.coupon||"";
  $("paymentCouponStatus").textContent=options.coupon?
   ("Đã áp dụng mã "+options.coupon+": giảm "+vnMoney(result.order?.discount_amount_vnd||0)+
   " · giá gốc "+vnMoney(result.order?.original_amount_vnd||result.payment.amount_vnd)+
   " · cần trả "+vnMoney(result.payment.amount_vnd)):
   (options.replaceId?"Đã bỏ mã giảm giá và tạo QR thanh toán mới.":"Có mã giảm giá? Nhập rồi bấm Áp dụng.");
  $("paymentInfo").textContent=vnMoney(result.payment.amount_vnd)+" · "+
   result.payment.bank_name+" · "+result.payment.account_name+
   " · Nội dung: "+result.payment.transfer_content;
  const qr=$('paymentQr'),loading=$('paymentQrLoading');
  qr.onload=()=>{if(paymentOrder!==order||requestEpoch!==paymentRequestEpoch)return;
    loading.hidden=true;qr.hidden=false;};
  qr.onerror=()=>{if(paymentOrder!==order||requestEpoch!==paymentRequestEpoch)return;
    loading.textContent='Ảnh QR đang tải lỗi. Bạn có thể thử mở lại QR hoặc dùng thông tin chuyển khoản đã hiển thị.';};
  loading.textContent='Đã có thông tin thanh toán. Đang tải ảnh QR…';
  qr.decoding='async';qr.loading='eager';qr.fetchPriority='high';
  qr.src=result.payment.qr_url;
  $('paymentCountdown').closest('[role="timer"]').hidden=false;
  $('checkPaymentBtn').hidden=false;
  $('applyPaymentCoupon').disabled=false;
  $('paymentArea').hidden=false;
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
 }catch(error){
  if(requestEpoch===paymentRequestEpoch){
   $('paymentInfo').textContent='Không tạo được mã QR: '+prettyError(error);
   $('paymentQrLoading').hidden=true;
   showMessage('Không tạo được đơn: '+prettyError(error),true);
  }
 }finally{paymentCreating=false;button.disabled=false;
  if(requestEpoch===paymentRequestEpoch)$('applyPaymentCoupon').disabled=false;
 }
}
$("applyPaymentCoupon").addEventListener("click",()=>{
 if(!paymentOrder)return showMessage("Chưa có QR để áp dụng mã.",true);
 const coupon=$("paymentCouponCode").value.trim().toUpperCase();
 void buy(paymentOrder.packageCode,$("applyPaymentCoupon"),{coupon,replaceId:paymentOrder.id});
});
async function action(id,fn){
 const button=$(id);button.disabled=true;
 try{await fn()}catch(error){showMessage(prettyError(error),true,"accountMessage")}
 finally{button.disabled=false}
}
// The customer portal does not accept credentials. Sign in/up/reset on / only.
$("logoutBtn").addEventListener("click",()=>action("logoutBtn",async()=>{closePayment();await client.auth.signOut();location.replace('/')}));

// Paging only hides DOM rows: selected MSTs from other pages remain checked
// and are still sent as the complete authorization list on Save.
$('mstPageSize').addEventListener('change',()=>{mstPage=1;applyMstPagination()});
$('mstPagePrev').addEventListener('click',()=>{mstPage--;applyMstPagination()});
$('mstPageNext').addEventListener('click',()=>{mstPage++;applyMstPagination()});
$("webAddMstForm").addEventListener("submit",e=>{
 e.preventDefault();
 openMstEditor();
});
$("mstGrantUnlock").addEventListener("click",()=>{
 setMstGrantUnlocked(true);
 if(personalMstCapacity()<1){
  showMessage("Đã mở phần thiết lập. Tài khoản chưa có hạn mức MST cá nhân; quyền MST trưởng nhóm vẫn được giữ nguyên.");
 }else{
  showMessage("Đã mở cấu hình. Chọn các MST cá nhân được cấp phép, sau đó bấm Lưu cấu hình.");
 }
});
$("mstGrantCancel").addEventListener("click",()=>{
 setMstGrantUnlocked(false);void loadMstAssignments();
});
$("mstGrantAllow").addEventListener("click",async()=>{
 if(!mstGrantUnlocked)return showMessage("Bấm Thiết lập lại quyền sử dụng để chọn MST.",true);
 if(personalMstCapacity()<1)
  return showMessage("Bạn chưa có hạn mức MST cá nhân để lưu cấu hình. Quyền MST của trưởng nhóm không bị thay đổi.",true);
 const all=[...document.querySelectorAll("#mstList .mst-allow-checkbox:checked")].map(x=>x.value);
 const capacity=personalMstCapacity();
 if(all.length>capacity){
  if(!$("mstProfileLimitDialog").open)$("mstProfileLimitDialog").showModal();
  return showMessage("Bạn chọn "+all.length+" MST nhưng gói chỉ cho phép "+capacity+". Bỏ tick hoặc mua thêm gói MST.",true);
 }
 const button=$("mstGrantAllow");button.disabled=true;
 try{
  const result=await rpc("addon_set_allowed_msts_v115",{p_msts:all});
  showMessage("Đã lưu và khóa danh sách "+result.count+" / "+result.capacity+
   " MST. Nếu cần chỉnh sửa, hãy bấm Thiết lập lại quyền sử dụng.");
  setMstGrantUnlocked(false);
  await loadMstAssignments();
 }catch(error){
  if(/mst_capacity_reached|mst_package_expired|trial_mst_already_used/i.test(String(error.message||error)))
   if(!$("mstProfileLimitDialog").open)$("mstProfileLimitDialog").showModal();
  showMessage(prettyError(error),true);
 }finally{button.disabled=!mstGrantUnlocked||personalMstCapacity()<1}
});
$("mstProfileCancel").addEventListener("click",()=>$("mstProfileDialog").close());
$("mstProfileLimitClose").addEventListener("click",()=>$("mstProfileLimitDialog").close());
$("mstPassword80Close").addEventListener("click",()=>$("mstPassword80Dialog").close());
$("mstProfileEditorForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const mst=$("mstProfileNumber").value.replace(/\D/g,''),name=$("mstProfileName").value.trim(),
  password=$("mstProfilePassword").value;
 if(!/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))return showMessage("MST phải có 10, 12 hoặc 13 chữ số.",true);
 if(name.length>120)return showMessage("Tên NNT tối đa 120 ký tự.",true);
 const submit=$("mstProfileSave");submit.disabled=true;
 try{
  let trialWarning='';
  if(!mstEditing){
   const status=await rpc('addon_trial_mst_status_v115',{p_mst:mst});
   if(status?.trial_conflict)
    trialWarning='MST này đã liên kết dùng thử với hồ sơ khác. Tài khoản chỉ được dùng thử 100 hóa đơn; muốn sử dụng gói MST hãy liên hệ quản trị hoặc mua gói.';
   await rpc("addon_add_mst_profile_v33",{p_mst:mst});
  }
  if(name!==mstEditOriginalName)
   await rpc("addon_set_mst_profile_name",{p_mst:mst,p_display_name:name});
  if(password){
   const {data:{session}}=await client.auth.getSession();
   if(!session?.user?.id)throw Error('Đăng nhập lại để mã hóa mật khẩu.');
   const result=await window.AutoTaxProfileVault.save(session.user.id,mst,password);
   if(result.changed)await rpc("addon_mark_mst_password_updated",{p_mst:mst});
   if(!result.synced)showMessage('Mật khẩu lưu cục bộ nhưng chưa đồng bộ MST: '+(result.error||'Đăng nhập lại AutoTax.'),true);
  }
  $("mstProfileDialog").close();await loadMstAssignments();
  showMessage(trialWarning||((mstEditing?'Đã sửa':'Đã thêm')+' hồ sơ MST '+mst+
    '. Chờ chọn cấp quyền ở lần đăng nhập/tra cứu đầu tiên.'+
    ' Chỉ mật khẩu được thay đổi mới cập nhật bộ đếm 80 ngày.'),!!trialWarning);
 }catch(error){
  const text=prettyError(error);
  if(/mst_capacity_reached|mst_profile_limit_reached|mst_package_expired|trial_mst_already_used/i.test(String(error.message||''))){
   if(!$("mstProfileLimitDialog").open)$("mstProfileLimitDialog").showModal();
  }
  showMessage(text,true);
 }finally{submit.disabled=false}
});
$("giftWebBtn").addEventListener("click",()=>{$("giftWebDialog").showModal();$("unlockCode").focus()});
$("closeGiftWebBtn").addEventListener("click",()=>$("giftWebDialog").close());
$("passwordOpenBtn").addEventListener("click",()=>{
 $("passwordPanel").hidden=false;
 $("passwordPanel").scrollIntoView({behavior:"smooth",block:"center"});
 $("newPassword").focus();
});
$("passwordCloseBtn").addEventListener("click",()=>{$("passwordPanel").hidden=true});

$("trialBtn").addEventListener("click",()=>action("trialBtn",async()=>{
 const granted=await rpc("addon_start_dual_trial");
 await refresh();
 showMessage("Dùng thử 7 ngày đã kích hoạt: 1 MST + 100 hóa đơn. Hạn đến "+vnDate(granted.expires_at));
}));
$("redeemBtn").addEventListener("click",()=>action("redeemBtn",async()=>{
 const code=$("unlockCode").value.trim().toUpperCase();
 if(!code)throw Error("Vui lòng nhập mã unlock.");
 const granted=await rpc("addon_redeem_package_unlock",{p_code:code});
 $("unlockCode").value="";
 await refresh();$("giftWebDialog").close();showMessage("Đã kích hoạt gói "+granted.package_code+".");
}));
// A select nested in <summary> must not accidentally toggle MST panel.
$('modeSection').addEventListener('click',event=>event.stopPropagation());
$('modeSection').addEventListener('keydown',event=>event.stopPropagation());
$("usageMode").addEventListener("change",async e=>{
 const selected=e.target.value;
 try{await rpc("autotax_set_usage_mode_v118",{p_mode:selected});await refresh()}
 catch(error){showMessage(prettyError(error),true);e.target.value=state?.mode||"mst"}
});
$("closePaymentBtn").addEventListener("click",closePayment);
$("checkPaymentBtn").addEventListener("click",()=>{void checkPaymentStatus(true)});
$("closePaymentSuccessBtn").addEventListener("click",()=>$("paymentSuccessDialog").close());
// Force-password reset uses the signed-in token, validated again by Supabase.
const resetDialog=$('forcedPasswordDialog');
resetDialog.addEventListener('cancel',e=>{e.preventDefault()});
resetDialog.addEventListener('click',e=>{if(e.target===resetDialog)e.preventDefault()});
$('forcedPasswordForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const password=$('forcedPasswordNew').value,confirmPassword=$('forcedPasswordConfirm').value;
 const error=$('forcedPasswordError'),button=$('forcedPasswordSave');
 const fail=message=>{error.textContent=message;error.hidden=false};
 error.hidden=true;
 if(password.length<10||password.length>128)return fail('Mật khẩu mới phải từ 10 đến 128 ký tự.');
 if(password==='000000')return fail('Không được dùng lại mật khẩu tạm 000000.');
 if(password!==confirmPassword)return fail('Hai lần nhập mật khẩu chưa trùng khớp.');
 button.disabled=true;
 try{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw Error('Phiên đăng nhập đã hết hạn.');
  const res=await fetch('https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-admin-password-reset',{
   method:'POST',headers:{Authorization:'Bearer '+session.access_token,
    apikey:'sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ',
    'Content-Type':'application/json'},
   body:JSON.stringify({action:'complete',new_password:password})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.ok)throw Error(data.error||'Không cập nhật được mật khẩu mới.');
  // Successful reset: close popup immediately, before refresh or sign-out.
  if(resetDialog.open)resetDialog.close();
  try{await window.AutoTaxSharedMstVault?.rekey(password)}
  catch(vaultError){console.warn('Đổi mật khẩu thành công, cần khôi phục khóa MST:',vaultError.message)}
  await client.auth.signOut();
  $('forcedPasswordNew').value='';
  $('forcedPasswordConfirm').value='';
  location.replace('/');
 }catch(err){fail('Không lưu được mật khẩu: '+(err.message||String(err)))}
 finally{button.disabled=false}
});
$("changePasswordBtn").addEventListener("click",()=>action("changePasswordBtn",async()=>{
 const password=$("newPassword").value;
 const forced=$('dashboard').classList.contains('autotax-force-password');
 if(password.length<(forced?10:8))throw Error('Mật khẩu mới phải có ít nhất '+(forced?10:8)+' ký tự.');
 if(forced){
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw Error('Bạn cần đăng nhập lại.');
  const res=await fetch('https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-admin-password-reset',{
   method:'POST',headers:{Authorization:'Bearer '+session.access_token,
    apikey:'sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ',
    'Content-Type':'application/json'},
   body:JSON.stringify({action:'complete',new_password:password})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.ok)throw Error(data.error||'Không đổi được mật khẩu tạm.');
  try{await window.AutoTaxSharedMstVault?.rekey(password)}
  catch(e){showMessage('Cần cập nhật lại khóa dữ liệu MST: '+e.message,true)}
  await client.auth.signOut();
  $('newPassword').value='';
  location.replace('/');
  return;
 }else{
  const {error}=await client.auth.updateUser({password});
  if(error)throw error;
  try{await window.AutoTaxSharedMstVault?.rekey(password)}
  catch(e){showMessage('Khóa mật khẩu MST chưa chuyển sang mật khẩu tài khoản mới: '+e.message,true)}
 }
 $('newPassword').value='';
 showMessage('Mật khẩu đã được thay đổi.');
 await refresh();
}));
client.auth.onAuthStateChange((event)=>{if(event==="PASSWORD_RECOVERY")location.replace("/");});
// Membership and quota figures are live entitlements, never permanent account balances.
// Re-query the server when returning to the page, so removal from a team drops its
// contributed quota without touching the member's personal quota or history.
let lastQuotaRefresh=0;
async function refreshTeamBalances(){
 if(document.hidden||$("dashboard").hidden||checking||quotaProbeBusy||
   mstGrantUnlocked||document.querySelector('dialog[open]')||
   document.activeElement?.matches('input,select,textarea,[contenteditable="true"]'))return;
 const now=Date.now();
 if(now-lastQuotaRefresh<12000)return;
 lastQuotaRefresh=now;
 quotaProbeBusy=true;
 try{
  const {data,error}=await client.rpc("autotax_my_entitlements_v118");
  if(error)throw error;
  // A tab focus or periodic check must not re-create MST checkboxes, plans,
  // scroll position and active settings when nothing actually changed.
  if(entitlementSnapshot(data)!==lastQuotaSnapshot)await refresh();
 }catch(error){
  console.warn('AutoTax: chưa cập nhật được quyền sử dụng nền:',error.message||error);
 }finally{quotaProbeBusy=false}
}
window.addEventListener("focus",()=>{void refreshTeamBalances()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refreshTeamBalances()});
setInterval(()=>{void refreshTeamBalances()},60000);
// Route only verified browser sessions into this protected account page.
client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')location.replace('/')});
refresh();
