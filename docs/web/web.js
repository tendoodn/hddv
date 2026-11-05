/* AutoTax Web v1 — shared GDT invoice engine + shared AutoTax Supabase license.
   The GDT password and token are kept in memory only; no browser storage or server database. */
(function(){
'use strict';
const SUPABASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
const PUBLIC_KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const GATEWAY=SUPABASE+'/functions/v1/autotax-web-gateway';
let gatewayRegion='ap-southeast-1'; // Singapore, closer to Viet Nam than the previous Seoul route.
const gatewayUrl=()=>GATEWAY+'?forceFunctionRegion='+gatewayRegion;
const $=id=>document.getElementById(id);
const client=window.AutoTaxSharedClient||(window.AutoTaxSharedClient=window.supabase?.createClient(SUPABASE,PUBLIC_KEY));
window.AutoTaxSharedMstVault?.setAuthProvider(async()=>{
 const {data:{session}}=await client.auth.getSession();
 return {userId:session?.user?.id,token:session?.access_token};
});
let account=null,govtToken='',govtMst='',captchaKey='',captchaValue='',captchaUrl='',captchaMode='pending',captchaIssuedAt=0,rows=[],details=new Map();
let busy=false,stopped=false,selectedMode='mst',profileMsts=[],profileAllowedMsts=[],teamAllowedMsts=[],searchedBothKinds=false;
const vn=iso=>iso?iso.split('-').reverse().join('/'):'';
const parseVnDate=text=>{
 const raw=String(text||'').trim();
 const matched=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
 if(!matched)return '';
 const [,dd,mm,yyyy]=matched;
 const dt=new Date(Date.UTC(Number(yyyy),Number(mm)-1,Number(dd)));
 if(dt.getUTCFullYear()!==Number(yyyy)||dt.getUTCMonth()!==Number(mm)-1||dt.getUTCDate()!==Number(dd))return '';
 return yyyy+'-'+mm+'-'+dd;
};
const formatVnDateInput=value=>{
 const digits=String(value||'').replace(/\D/g,'').slice(0,8);
 return digits.slice(0,2)+(digits.length>2?'/'+digits.slice(2,4):'')+
  (digits.length>4?'/'+digits.slice(4):'');
};
const readVnDate=id=>parseVnDate($(id).value);
const setVnDate=(id,iso)=>{$(id).value=vn(iso);const native=$(id+'Native');if(native)native.value=iso};
function configureVnDates(){
 for(const id of ['fromDate','toDate']){
  const text=$(id),native=$(id+'Native');
  // Keep hidden native value in sync for compatibility, but never open Chrome date UI.
  native.addEventListener('change',()=>{if(native.value)setVnDate(id,native.value)});
  text.addEventListener('input',()=>{
   const raw=text.value,caret=text.selectionStart??raw.length;
   const before=raw.slice(0,caret).replace(/\D/g,'').length;
   const formatted=formatVnDateInput(raw);
   if(raw===formatted)return;
   text.value=formatted;
   let position=0,seen=0;
   while(position<formatted.length&&seen<before){if(/\d/.test(formatted[position]))seen++;position++}
   text.setSelectionRange(position,position);
  });
  text.addEventListener('blur',()=>{const iso=readVnDate(id);if(iso)setVnDate(id,iso)});
 }
 window.AutoTaxWebDatePicker?.attach({
  from:$('fromDate'),to:$('toDate'),
  fromButton:$('fromDatePick'),toButton:$('toDatePick'),
  onSelect:setVnDate
 });
}

const dateOnly=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const idOf=r=>JSON.stringify([r.kind,r.form,r.khhdon,r.shdon,r.nbmst,r.nmmst]);
const money=n=>Number(n||0).toLocaleString('vi-VN')+' ₫';
const safe=s=>String(s||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70);
const selected=name=>[...document.querySelectorAll('input[name="'+name+'"]:checked')].map(el=>el.value);
const show=(msg,ok=false)=>{const box=$('notice');box.hidden=!msg;box.textContent=msg||'';box.classList.toggle('success',!!ok)};
const QUOTA_MESSAGE='Hạn mức tài khoản đạt giới hạn. Vui lòng gia hạn thêm';
const QUOTA_REASONS=new Set(['mst_not_whitelisted','mst_package_expired','mst_capacity_reduced','mst_capacity_reached','invoice_package_required','invoice_quota_exceeded','quota_exceeded','quota_reached','mst_limit_reached']);
let quotaExceededDuringSearch=false;
function showQuotaWarning(mode=selectedMode){
 quotaExceededDuringSearch=true;
 const dialog=$(mode==='invoice'?'invoiceQuotaDialog':'mstLimitDialog');
 if(dialog&&!dialog.open)dialog.showModal();
 show(QUOTA_MESSAGE);
 progress(QUOTA_MESSAGE);
}
const isQuotaMessage=message=>/(hết hạn mức|hạn mức tài khoản đạt giới hạn|gói MST đã hết hạn|MST vượt số lượng hồ sơ|gói số tờ không còn lượt mới|mst_capacity_reached|mst_package_expired|mst_capacity_reduced|invoice_package_required|quota_exceeded)/i.test(String(message||''));
const progress=msg=>{const log=$('progressLog'),line=document.createElement('div');line.className='autotax-terminal-line';const severity=/lỗi|thất bại|không thể|gián đoạn/i.test(String(msg))?'error':/cảnh báo|bỏ qua|chưa lấy|thiếu|lưu ý/i.test(String(msg))?'warn':/hoàn tất|thành công|đã tải|đã xuất/i.test(String(msg))?'success':'info';line.classList.add('terminal-'+severity);const clock=new Date().toLocaleTimeString('vi-VN',{hour12:false});line.textContent='['+clock+'] '+String(msg||'Đang xử lý…');log.append(line);while(log.children.length>5)log.firstElementChild.remove();log.scrollTop=log.scrollHeight;};
const busyState=(value,keepLog=false,success=false)=>{busy=!!value;
  const indicator=$('downloadConsoleDone'),spinner=$('downloadConsoleSpinner');
  if(indicator)indicator.hidden=!!value||!success;
  if(spinner)spinner.hidden=!value;
  const active=$('downloadConsoleActive');if(active)active.hidden=!value;
  $('progress').hidden=!value&&!keepLog;if(value){$('progressLog').replaceChildren();progress('Khởi tạo phiên xử lý…');$('stopBtn').textContent='Dừng'}else if(keepLog){$('stopBtn').textContent='Đóng'}$('searchBtn').disabled=false;$('searchBtn').textContent=value?'Dừng tra cứu':'⌕ Tìm kiếm hóa đơn';
  for(const id of ['exportAllZip','exportExcel','exportXml','exportHtml','exportPdf','exportPdfTax'])$(id).disabled=!!value;};
const govSession={get token(){return govtToken}};
window.WebTaxState=govSession;
const showGatewayHelp=visible=>{$('gdtConnectionHelp').hidden=!visible;};
function resetCaptchaImage(){
 if(captchaUrl){URL.revokeObjectURL(captchaUrl);captchaUrl='';}
 const img=$('captchaImage');
 img.removeAttribute('src');
 img.hidden=true;
}
function clearGov(){
 govtToken='';govtMst='';details=new Map();rows=[];$('gdtPassword').value='';$('gdtStatus').textContent='Chưa có phiên đăng nhập cổng Thuế.';
 captchaKey='';captchaValue='';captchaMode='pending';captchaIssuedAt=0;
 resetCaptchaImage();
 $('captchaBox').hidden=true;showGatewayHelp(false);
 $('captchaStatus').textContent='Mã xác nhận sẽ được xử lý tự động khi tra cứu.';
 $('results').hidden=true;
 // Redundant top-of-search totals were removed; results use #results only.
}
async function authedRequest(op,data={},signal){
 const {data:sessionData}=await client.auth.getSession();
 const token=sessionData?.session?.access_token;
 if(!token)throw Error('Phiên AutoTax đã hết hạn. Vui lòng đăng nhập lại ở trang tài khoản.');
 const res=await fetch(gatewayUrl(),{method:'POST',signal,headers:{'Content-Type':'application/json',
   apikey:PUBLIC_KEY,Authorization:'Bearer '+token},
   body:JSON.stringify({op,...data})});
 return res;
}
const messageOf=async res=>{
 const data=await res.json().catch(()=>({}));
 const code=data?.error||data?.message||'';
 const errs={
  autotax_sign_in_required:'Bạn cần đăng nhập tài khoản AutoTax.',
  autotax_session_expired:'Phiên AutoTax hết hạn. Hãy đăng nhập lại.',
  invalid_login_details:'Kiểm tra MST, mật khẩu và CAPTCHA rồi thử lại.',
  gdt_timeout:'Máy chủ AutoTax kết nối cổng Thuế bị hết thời gian chờ. Đây không phải lỗi CAPTCHA nhập sai.',
  gdt_captcha_timeout:'Máy chủ kết nối không lấy được CAPTCHA từ cổng Thuế. Không có ảnh để nhập thủ công; hãy thử kết nối lại hoặc dùng trang Thuế chính thức.',
  gdt_captcha_unavailable:'Máy chủ kết nối chưa lấy được ảnh CAPTCHA từ cổng Thuế.',
  autotax_auth_unavailable:'Dịch vụ xác thực AutoTax tạm thời không phản hồi.',
  gdt_connection_unavailable:'Máy chủ chưa kết nối được với cổng Thuế. Có thể bị chặn hoặc đang bảo trì.',
  gdt_sign_in_required:'Cổng Thuế yêu cầu đăng nhập lại.',
  gdt_mst_mismatch:'MST phiên Thuế không khớp MST hồ sơ AutoTax.',
  mst_profile_not_configured:'Hãy thêm MST này vào hồ sơ trên trang tài khoản AutoTax.',
  mst_package_expired:QUOTA_MESSAGE,
  mst_capacity_reduced:QUOTA_MESSAGE,
  mst_capacity_reached:QUOTA_MESSAGE,
  invoice_package_required:QUOTA_MESSAGE,
  invoice_quota_exceeded:QUOTA_MESSAGE,
  quota_exceeded:QUOTA_MESSAGE,
  origin_not_allowed:'Trang kết nối không đúng địa chỉ AutoTax chính thức.',
  upstream_path_not_allowed:'Đường dẫn API cổng Thuế chưa được hỗ trợ.',
 };
 return errs[code]||data?.message||code||'Máy chủ trả về HTTP '+res.status;
};
// Every GDT GET goes through a fixed-host server gateway; no cross-origin direct requests.
window.WebTaxTransport=async function(url,init={}){
 const target=new URL(url);
 const captcha=target.pathname==='/api/captcha';
 const res=await authedRequest(captcha?'captcha':'get',captcha?{}:{
   url:target.toString(),gdtToken:govtToken,mst:govtMst,
   headers:init.headers||{}
 },init.signal);
 // Preserve upstream status/content-type for the extension's existing parser.
 return res;
};
function extractToken(obj){
 if(!obj||typeof obj!=='object')return '';
 const c=[obj.token,obj.access_token,obj.accessToken,obj.jwt,obj?.data?.token,
   obj?.data?.accessToken,obj?.data?.access_token,obj?.result?.token,obj?.data];
 return c.find(x=>typeof x==='string'&&x.split('.').length===3)||'';
}
function tokenMst(token){
 try{
 const p=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
 if(p.exp&&p.exp*1000<Date.now())throw Error('Phiên hết hạn');
 return String(p.sub||'').replace(/\D/g,'');
 }catch{return '';}
}
// Uses the exact SVG recognition engine shared with the extension. Never stores CAPTCHA or passwords.
function normalizeCaptchaSvg(content){
 const value=String(content||'').trim();
 let svg=value;
 if(/^data:image\/svg\+xml;base64,/i.test(value))
   svg=atob(value.split(',').slice(1).join(','));
 else if(/^data:image\/svg\+xml,/i.test(value))
   svg=decodeURIComponent(value.slice(value.indexOf(',')+1));
 else if(value.startsWith('<?xml'))svg=value.slice(value.indexOf('<svg'));
 if(!/^<svg(?:\s|>)/i.test(svg))throw Error('Cổng Thuế không trả CAPTCHA SVG đúng định dạng.');
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')
   throw Error('Không đọc được CAPTCHA SVG từ cổng Thuế.');
 return doc.documentElement.outerHTML;
}
function manualCaptcha(msg){
 if(!captchaKey||!captchaUrl||!$('captchaImage').naturalWidth){
  captchaMode='error';
  $('captchaBox').hidden=true;showGatewayHelp(true);
  $('captchaStatus').textContent='Không có ảnh CAPTCHA hợp lệ để nhập thủ công.';
  return;
 }
 captchaMode='manual';captchaValue='';
 showGatewayHelp(false);
 $('captchaImage').hidden=false;
 $('captchaBox').hidden=false;
 $('captchaInput').value='';
 $('captchaStatus').textContent=msg||'Không đủ độ tin cậy để tự đọc mã. Vui lòng nhập CAPTCHA trên ảnh.';
}
async function getCaptcha(){
 if(!account)return false;
 $('reloadCaptcha').disabled=true;
 $('retryConnectionBtn').disabled=true;
 captchaKey='';captchaValue='';captchaMode='pending';captchaIssuedAt=0;
 $('captchaBox').hidden=true;
 showGatewayHelp(false);
 resetCaptchaImage();
 $('captchaStatus').textContent='Đang kết nối và tải mã xác nhận từ cổng Thuế…';
 try{
  const res=await authedRequest('captcha');
  if(!res.ok)throw Error(await messageOf(res));
  const data=await res.json().catch(()=>null);
  if(!data?.key||!data?.content)
   throw Error('Cổng Thuế chưa trả mã xác nhận hoặc ảnh CAPTCHA.');
  const svg=normalizeCaptchaSvg(data.content);
  captchaUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  const img=$('captchaImage');
  img.src=captchaUrl;
  // A manual fallback is valid only when the image has actually rendered.
  await img.decode();
  if(!img.naturalWidth)throw Error('Không hiển thị được ảnh CAPTCHA nhận từ cổng Thuế.');
  captchaKey=String(data.key);
  captchaIssuedAt=Date.now();
  $('captchaInput').value='';
  let result=null;
  try{result=window.SvgCaptcha?.solve(svg)||null;}catch(_){
   manualCaptcha('Cổng Thuế đã thay đổi mẫu CAPTCHA. Vui lòng nhập mã trên ảnh để tiếp tục.');
   return false;
  }
  const text=String(result?.text||'').trim();
  const confidence=Number(result?.confidence||0);
  if(text.length>=4&&text.length<=8&&/^[a-z0-9]+$/i.test(text)&&confidence>=80){
   captchaValue=text;captchaMode='automatic';
   $('captchaBox').hidden=true;
   $('captchaStatus').textContent='Đã nhận dạng CAPTCHA (độ tin cậy '+confidence+'%). Không cần nhập mã.';
   return true;
  }
  manualCaptcha('Chưa nhận dạng đủ tin cậy ('+confidence+'%). Vui lòng nhập mã trên ảnh.');
  return false;
 }catch(e){
  captchaKey='';captchaValue='';captchaMode='error';captchaIssuedAt=0;
  resetCaptchaImage();
  $('captchaBox').hidden=true;
  showGatewayHelp(true);
  $('captchaStatus').textContent='Kết nối cổng Thuế chưa sẵn sàng — không có CAPTCHA để nhập.';
  show('Không tải được CAPTCHA: '+e.message);
  return false;
 }finally{
  $('reloadCaptcha').disabled=false;
  $('retryConnectionBtn').disabled=false;
 }
}
// Account-owned display name: prefer the authenticated GDT profile name;
 // fall back only to an invoice buyer/seller name whose MST matches this session.
const profileDisplayNames=new Map(),profileVerifiedNames=new Set();
const normalizedMst=v=>String(v||'').replace(/\D/g,'');
const currentSearchMst=()=>normalizedMst($('mstFree')?.value||$('mst').value);
const validProfileLabel=v=>{
 const s=String(v||'').trim().replace(/\s+/g,' ');
 return s.length>=3&&s.length<=120&&/[\p{L}]/u.test(s)&&
  !/^(khách lẻ|khach le|người mua không lấy hóa đơn|không có tên)$/i.test(s)?s:'';
};
async function assignAutoMstName(mst,candidate,source){
 const label=validProfileLabel(candidate),id=normalizedMst(mst);
 const verifiedSource=source==='cổng Thuế đã đăng nhập';
 if(!label||!account||!profileMsts.includes(id))return false;
 if(verifiedSource?profileVerifiedNames.has(id):!!profileDisplayNames.get(id))return false;
 try{
  const {error}=await client.rpc(
   verifiedSource?'addon_confirm_gdt_mst_name':'addon_set_mst_profile_name',
   {p_mst:id,p_display_name:label});
  if(error)throw error;
  profileDisplayNames.set(id,label);
  if(verifiedSource)profileVerifiedNames.add(id);
  // Reload account-scoped labels in the MST picker, preserving the selection.
  const {data}=await client.rpc('addon_list_my_mst_assignments');
  if(data)await window.GdtVault?.setUser(account.id,data,selectedMode);
  $('gdtStatus').textContent='Tên hồ sơ '+id+' được nhận từ '+source+': '+label;
  return true;
 }catch(e){console.warn('Không đồng bộ được tên hồ sơ MST:',e.message);return false}
}
function nameFromMatchedInvoices(rows,mst){
 const normalized=normalizedMst(mst),names=new Map();
 for(const r of rows){
  const match=r.kind==='purchase'?
   normalizedMst(r.nmmst)===normalized:normalizedMst(r.nbmst)===normalized;
  if(!match)continue;
  const name=validProfileLabel(r.kind==='purchase'?r.nmten:r.nbten);
  if(name)names.set(name,(names.get(name)||0)+1);
 }
 return [...names.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
}

function maybeRemindTaxPassword(profiles){
 if(selectedMode!=='mst'||!account)return;
 const due=profiles.find(p=>p.password_updated_at&&
  Date.now()-new Date(p.password_updated_at).getTime()>=80*86400000);
 if(!due)return;
 if(!window.GdtVault?.claimPasswordReminder?.(due.mst))return;
 const popup=$('mstPasswordReminder');if(!popup||popup.open)return;
 const days=Math.floor((Date.now()-new Date(due.password_updated_at).getTime())/86400000);
 $('mstPasswordReminderText').textContent='MST '+due.mst+' đã '+days+
  ' ngày kể từ lần ghi nhận mật khẩu. Hãy kiểm tra và đổi mật khẩu nếu cần.';
 popup.showModal();
}
async function refreshAccount(){
 if(!client){show('Không tải được thư viện đăng nhập Supabase. Vui lòng tải lại trang.');return}
 try{
  const {data:{session}}=await client.auth.getSession();
  account=session?.user||null;
  window.AutoTaxWebAccount?.sync(account);
  if(!account){
   $('webModeControls').hidden=true;
   $('accountEmailLabel').textContent='Chưa đăng nhập';
   profileMsts=[];profileAllowedMsts=[];profileDisplayNames.clear();
   window.GdtVault?.setUser(null,[]);
   // Clear catalog from the previous user's in-memory UI immediately after sign-out.
   document.dispatchEvent(new CustomEvent('autotax-web-user-ready',{detail:{userId:null}}));
   $('authStatus').textContent='Chưa đăng nhập — bấm Đăng nhập tại đây.';
   show('Hãy bấm Đăng nhập ở phía trên để sử dụng AutoTax.');
   return;
  }
  $('authStatus').textContent=account.email+' · Đã kết nối';
  $('accountEmailLabel').textContent=account.email||'Tài khoản AutoTax';
  const [ent,profiles,sharedRows]=await Promise.all([
   client.rpc('autotax_my_entitlements_v118'),
   client.rpc('addon_list_my_mst_assignments'),
   client.rpc('autotax_team_shared_mst_profiles_v119')
  ]);
  if(ent.error)throw ent.error;if(profiles.error)throw profiles.error;
  if(sharedRows.error)console.warn('Không tải được MST nhóm:',sharedRows.error.message);
  const shared=Array.isArray(sharedRows.data)?sharedRows.data:[];
  selectedMode=ent.data?.mode||'mst';
  const modeSelect=$('webUsageMode');
  modeSelect.value=selectedMode;
  const inv=ent.data?.packages?.invoice||{},msts=ent.data?.packages?.mst||{};
  const canInvoice=Number(inv.remaining||0)>0||Number(ent.data?.team_invoice_remaining||0)>0;
  const hasInvoice=Number(inv.purchased||0)>0||canInvoice||!!ent.data?.can_reread_charged_invoices;
  const canMst=Number(msts.active_quantity||0)>0||Number(ent.data?.team_mst_count||0)>0;
  modeSelect.querySelector('[value="invoice"]').disabled=!canInvoice;
  modeSelect.querySelector('[value="mst"]').disabled=!canMst;
  const dual=hasInvoice&&canMst;
  modeSelect.disabled=!dual;
  $('webModeControls').hidden=!dual;
  if(dual&&$('webModeControls').parentElement!==$('webAccountModeSlot'))
   $('webAccountModeSlot').append($('webModeControls'));
  // Force the only spendable family. When both are exhausted, retain the last selected mode.
  if(canInvoice!==canMst&&selectedMode!==(canInvoice?'invoice':'mst')){
   const auto=canInvoice?'invoice':'mst';
   const changed=await client.rpc('autotax_set_usage_mode_v118',{p_mode:auto});
   if(!changed.error){selectedMode=auto;modeSelect.value=auto;}
  }
  $('webUsageModeHint').textContent=dual?
    'Hai chế độ dùng chung tài khoản, không chạy cùng lúc. Gói chưa chọn được bảo lưu.':
    'Chỉ chuyển được khi cả hai gói có quyền sử dụng còn hiệu lực.';
  const ownProfiles=profiles.data||[];
  const ownMsts=new Set(ownProfiles.map(x=>String(x.mst||'').replace(/\D/g,'')));
  const borrowedProfiles=shared.filter(row=>!ownMsts.has(String(row.mst||'').replace(/\D/g,'')))
   .map(row=>({...row,source:'team',mst_allowed:row.can_use_mst_package===true}));
  const allProfiles=[...ownProfiles,...borrowedProfiles];
  profileMsts=allProfiles.map(x=>String(x.mst||'').replace(/\D/g,'')).filter(Boolean);
  teamAllowedMsts=(ent.data?.team_mst_allowed_msts||[]).map(x=>String(x||'').replace(/\D/g,'')).filter(Boolean);
  profileAllowedMsts=[...new Set([...(profiles.data||[]).filter(x=>x.mst_allowed===true)
   .map(x=>String(x.mst||'').replace(/\D/g,'')).filter(Boolean),...teamAllowedMsts])];
  profileDisplayNames.clear();profileVerifiedNames.clear();
  for(const item of allProfiles){
   profileDisplayNames.set(normalizedMst(item.mst),String(item.display_name||'').trim());
   if(item.name_verified_at)profileVerifiedNames.add(normalizedMst(item.mst));
  }
  await window.GdtVault?.setUser(account.id,allProfiles,selectedMode);
  maybeRemindTaxPassword(profiles.data||[]);
  document.dispatchEvent(new CustomEvent('autotax-web-user-ready',{detail:{userId:account.id}}));
  if(selectedMode==='invoice')show('Chế độ số tờ: nhập MST bất kỳ, không cần thêm vào danh sách hồ sơ. Hệ thống sẽ trừ lượt hóa đơn mới.',true);
  else if(!profileAllowedMsts.length)show('Chưa có MST được cấp quyền. Khi tra cứu MST đầu tiên, AutoTax sẽ hỏi bạn có muốn cấp phép hay không.');
  else show('Gói MST: đã cấp quyền '+profileAllowedMsts.length+' MST. Chỉ các MST trong danh sách cấp quyền được tra cứu.',true);
 }catch(e){show('Không đồng bộ được quyền AutoTax: '+e.message)}
}
async function signIntoTax(mst){
 const username=mst;
 const password=$('gdtPassword').value;
 if(!password)throw Error('Hãy nhập mật khẩu cổng Thuế.');
 if(!captchaKey||Date.now()-captchaIssuedAt>120000)await getCaptcha();
 if(!captchaKey)throw Error('Không lấy được CAPTCHA từ cổng Thuế. Hãy bấm Đổi mã và thử lại.');
 const getValue=()=>captchaMode==='automatic'?captchaValue:$('captchaInput').value.trim();
 if(!getValue()){
  $('captchaBox').hidden=false;
  throw Error('Không nhận dạng được CAPTCHA tự động. Hãy nhập mã trên ảnh.');
 }
 progress('Đang xác thực cổng Thuế…');
 try{
  // One bounded automatic retry, only when the server explicitly identifies CAPTCHA failure.
  for(let attempt=0;attempt<2;attempt++){
   const cvalue=getValue();
   if(!cvalue)throw Error('Hãy nhập CAPTCHA hiển thị trên ảnh.');
   const usingAuto=captchaMode==='automatic';
   const key=captchaKey;
   captchaKey='';captchaValue='';
   const res=await authedRequest('authenticate',{username,password,ckey:key,cvalue});
   if(res.ok){
    const json=await res.json().catch(()=>({}));
    const token=extractToken(json),sub=tokenMst(token);
    if(!token||!sub)throw Error('Cổng Thuế chưa trả phiên đăng nhập hợp lệ. Vui lòng kiểm tra tên đăng nhập và dịch vụ kết nối.');
    if(sub!==mst)throw Error('MST đăng nhập cổng Thuế khác MST hồ sơ AutoTax đang chọn.');
    govtToken=token;govtMst=mst;$('captchaBox').hidden=true;
    // Login only saves the MST profile; granting a paid whitelist slot
    // is requested explicitly on the FIRST invoice search, not at GDT login.
    if(!teamAllowedMsts.includes(mst)&&!profileMsts.includes(mst)){
     const registration=await client.rpc('addon_add_mst_profile_v33',{p_mst:mst});
     if(registration.error)throw Error('Đã vào cổng Thuế nhưng không lưu được hồ sơ MST: '+registration.error.message);
     profileMsts.push(mst);
    }
    const vaultSaved=await window.GdtVault?.saveAfterLogin(mst,password);
    if(vaultSaved?.changed&&profileMsts.includes(mst)){
     const {error:stampError}=await client.rpc('addon_mark_mst_password_updated',{p_mst:mst});
     if(stampError)console.warn('Chưa lưu được mốc mật khẩu:',stampError.message);
    }
    $('gdtStatus').textContent='Đã xác thực cổng Thuế cho MST '+mst+' · phiên chỉ ở bộ nhớ tab.';
    $('captchaStatus').textContent='Đã đăng nhập bằng mã xác nhận tự xử lý.';
    // Instantly refresh both Web and customer-side shared profile metadata.
    await refreshAccount();
    return;
   }
   const message=await messageOf(res);
   const captchaRejected=/captcha|mã xác nhận|mã kiểm tra|cvalue|ckey/i.test(message);
   const retry=usingAuto&&captchaRejected&&attempt===0;
   await getCaptcha();
   if(retry&&captchaMode==='automatic'){
    progress('CAPTCHA chưa được chấp nhận, đang thử lại một lần với mã mới…');
    continue;
   }
   if(captchaRejected&&captchaMode!=='automatic')
    throw Error('CAPTCHA tự động chưa được chấp nhận. Vui lòng nhập mã thủ công trong khung bên dưới.');
   if(!captchaRejected&&/mật khẩu|mat khau|sai mật khẩu|incorrect password|invalid credentials|wrong password|tài khoản.*không đúng/i.test(message)){
    $('gdtLoginErrorText').textContent='Cổng Thuế từ chối mật khẩu MST '+mst+
     '. Hãy nhập mật khẩu mới cho đúng hồ sơ, sau khi đăng nhập thành công AutoTax sẽ cập nhật mật khẩu mã hóa trên thiết bị.';
    $('gdtLoginErrorDialog').showModal();
   }
   throw Error('Cổng Thuế từ chối đăng nhập: '+message);
  }
  throw Error('Cổng Thuế không chấp nhận CAPTCHA sau lần thử lại. Vui lòng thử thủ công.');
 }finally{
  // No persistence; after one sign-in attempt remove password from HTML input.
  $('gdtPassword').value='';
 }
}
async function ensurePermission(mst){
 const {data,error}=await client.rpc('autotax_verify_session_mst_v118',{p_mst:mst});
 if(error)throw Error(error.message);
 if(!data?.allowed){
  const reason=String(data?.reason||'');
  if(QUOTA_REASONS.has(reason)){
   showQuotaWarning(data?.mode==='invoice'?'invoice':'mst');
   throw Error(QUOTA_MESSAGE);
  }
  throw Error('MST này chưa được cấp quyền hoặc gói đã hết hạn: '+reason);
 }
 selectedMode=data.mode||selectedMode;
}
async function claimRows(all,mst){
 if(!all.length)return all; // V1.1.7: record every invoice read in both account modes.
 const accepted=[],max=250;
 const key=r=>JSON.stringify([r.mst,r.direction,r.form_code,r.series,r.invoice_number]);
 for(let from=0;from<all.length;from+=max){
  const batch=all.slice(from,from+max);
  const items=batch.map(r=>({mst,direction:r.kind||'',
   form_code:(r.form||'')+':'+(r.khmshdon||''),
   series:r.khhdon||'',invoice_number:String(r.shdon??'')}));
  const {data,error}=await client.rpc('autotax_claim_invoice_quota_v118',{p_items:items});
  if(error)throw Error('Không kiểm tra được lượt hóa đơn: '+error.message);
  const allowed=new Set((data.allowed_items||[]).map(key));
  for(let i=0;i<items.length;i++)if(allowed.has(key(items[i])))accepted.push(batch[i]);
  progress('Đã ghi nhận '+Number(data.recorded_without_charge||0)+' hóa đơn bằng gói MST, '+Number(data.deducted||0)+' lượt số tờ mới; '+Number(data.previously_deducted||0)+' hóa đơn đọc lại không trừ lượt.');
  if(Number(data.denied||0)>0&&selectedMode==='invoice'){
   showQuotaWarning('invoice');
  }
 }
 return accepted;
}
function askMstGrantConsent(){
 const dialog=$('mstGrantConsentDialog');
 return new Promise(resolve=>{
  let answered=false;
  const finish=choice=>{
   if(answered)return;answered=true;
   dialog.removeEventListener('close',closed);
   yes.removeEventListener('click',allow);
   no.removeEventListener('click',deny);
   if(dialog.open)dialog.close();resolve(choice);
  };
  const yes=$('mstGrantConsentYes'),no=$('mstGrantConsentNo');
  const allow=()=>finish(true),deny=()=>finish(false),closed=()=>finish(false);
  yes.addEventListener('click',allow,{once:true});no.addEventListener('click',deny,{once:true});
  dialog.addEventListener('close',closed,{once:true});dialog.showModal();
 });
}
function renderResults(list,warnings=[]){
 if(window.WebResults?.render)window.WebResults.render(list,warnings);
 else show('Đã có '+list.length+' hóa đơn. Giao diện kết quả chưa tải xong, vui lòng làm mới trang.');
}
async function search(e){
 e.preventDefault();if(busy)return;
 const mst=currentSearchMst();
 const start=readVnDate('fromDate'),end=readVnDate('toDate');
 if(!account)return show('Bấm Đăng nhập tại ô Chế độ sử dụng để bắt đầu.');
 if(account.app_metadata?.autotax_force_password_change)return show('Bạn cần đổi mật khẩu do Admin cấp lại trước khi tra cứu.');
 if(!/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))
  return show('MST phải có 10, 12 hoặc 13 chữ số hợp lệ.');
 if(!start||!end||start>end)return show('Khoảng ngày chưa hợp lệ. Nhập ngày/tháng/năm (dd/mm/yyyy).');
 if(!selected('kind').length||!selected('form').length)return show('Chọn ít nhất một loại và một hình thức hóa đơn.');
 // Select the output folder from this Search click before network requests.
 try{
  const folder=await AutoTaxDownloadFolder.prepare();
  show('Thư mục lưu: '+folder,true);
 }catch(error){
  if(error.name!=='AbortError')show('Không chọn được thư mục lưu: '+error.message);
  return;
 }
 stopped=false;quotaExceededDuringSearch=false;busyState(true);
 let scanCompleted=false;
 $('results').hidden=true;// Redundant top-of-search totals were removed; results use #results only.
 window.WebResults?.resetForSearch?.();
 try{
  if(govtMst!==mst||!govtToken)await signIntoTax(mst);
  // Consent must precede the first MST-package lookup. No = no whitelist slot.
  if(selectedMode==='mst'&&!profileAllowedMsts.includes(mst)){
   const agreed=await askMstGrantConsent();
   if(!agreed)throw Error('Bạn đã chọn Không. MST '+mst+' chưa được cấp phép dùng gói MST.');
   const {data:grant,error:grantError}=await client.rpc('addon_register_gdt_signin_v115',{p_mst:mst});
   if(grantError)throw grantError;
   if(!grant?.allowed){
    if(QUOTA_REASONS.has(String(grant?.warning||''))){
     showQuotaWarning('mst');
     throw Error(QUOTA_MESSAGE);
    }
    throw Error(grant?.warning==='trial_mst_already_used'?
     'MST này đã dùng thử với tài khoản khác. Vui lòng mua gói MST hoặc liên hệ quản trị.':
     'MST chưa được cấp quyền: '+String(grant?.warning||'Không xác định'));
   }
   profileAllowedMsts.push(mst);
  }
  await ensurePermission(mst);
  progress('Đang kiểm tra phiên cổng Thuế…');
  const info=await HDDT.getSessionInfo();
  if(!info?.ready||String(info.mst||'').replace(/\D/g,'')!==mst)
    throw Error('Phiên cổng Thuế hết hạn hoặc MST không khớp.');
  if(info.company)await assignAutoMstName(mst,info.company,'cổng Thuế đã đăng nhập');
  // Read the next GDT page while Supabase validates the previous one.
  // Nothing reaches the result table until server quota returns allowed_items.
  const authorized=new Map();
  let claimTail=Promise.resolve(),claimFailure=null;
  const onBatch=batch=>{
   claimTail=claimTail.then(async()=>{
    if(stopped||claimFailure)return;
    const unseen=batch.filter(row=>!authorized.has(idOf(row)));
    if(!unseen.length)return;
    const accepted=await claimRows(unseen,mst);
    if(stopped)return;
    for(const row of accepted)authorized.set(idOf(row),row);
    if(accepted.length){
     rows=[...authorized.values()];
     window.WebResults?.append?.(accepted);
    }
   }).catch(error=>{claimFailure=error;stopped=true});
  };
  let result;
  try{
   result=await HDDT.search({tuNgay:vn(start),denNgay:vn(end),
    kinds:selected('kind'),forms:selected('form'),shouldStop:()=>stopped,
    onBatch,onProgress:p=>progress(p.label+' · '+p.count+' hóa đơn'),
    onWarn:msg=>show(msg),onWait:w=>progress(w.label+' · đang đợi cổng Thuế '+(w.secs||0)+' giây')});
  }finally{await claimTail}
  if(claimFailure)throw claimFailure;
  if(stopped)throw Error('Đã dừng theo yêu cầu.');
  // Reconcile with the FULL live result: never retain a partial/removed invoice
  // if a source failed or changed its page contents during the scan.
  const outstanding=result.rows.filter(row=>!authorized.has(idOf(row)));
  if(outstanding.length){
   const accepted=await claimRows(outstanding,mst);
   for(const row of accepted)authorized.set(idOf(row),row);
  }
  rows=result.rows.filter(row=>authorized.has(idOf(row)));
  details.clear();
  if(!profileVerifiedNames.has(mst)&&!profileDisplayNames.get(mst))
   await assignAutoMstName(mst,nameFromMatchedInvoices(rows,mst),
    'tên người mua/người bán khớp MST trên hóa đơn');
  searchedBothKinds=selected('kind').includes('purchase')&&selected('kind').includes('sold');
  if(window.WebResults?.finish)window.WebResults.finish(rows,result.skipped||[]);
  else renderResults(rows,result.skipped||[]);
  if(quotaExceededDuringSearch)show(QUOTA_MESSAGE);
  else show('Đã tra cứu '+rows.length+' hóa đơn được phép sử dụng.'+
   (result.skipped?.length?' Nguồn chưa hoàn tất: '+result.skipped.join(', '):''),true);
  scanCompleted=true;
 }catch(error){
  const msg=error?.message||'Tra cứu không thành công.';
  if(isQuotaMessage(msg)&&!quotaExceededDuringSearch)showQuotaWarning(selectedMode);
  else show(quotaExceededDuringSearch?QUOTA_MESSAGE:msg);
 }
 finally{busyState(false,true,scanCompleted)}
}
const pendingDetails=new Map();
async function loadDetails(scopeRows=rows){
 if(!scopeRows.length)throw Error('Chưa có hóa đơn để xuất.');
 const queue=scopeRows.filter(r=>!details.has(idOf(r))||details.get(idOf(r))?.error);
 let next=0,completed=0;
 const worker=async()=>{
  for(;;){
   if(stopped)return;
   const index=next++;
   if(index>=queue.length)return;
   const row=queue[index],id=idOf(row);
   try{
    if(!pendingDetails.has(id)){
     const cache=window.AutoTaxInvoiceCache;
     const scope={userId:String(account?.id||''),mst:String(govtMst||currentSearchMst())};
     const request=(async()=>{
      const cached=await cache?.get(scope,row);
      if(cached)return cached;
      const fresh=await HDDT.fetchInvoice(row,()=>stopped);
      if(!stopped)void cache?.put(scope,row,fresh).catch(()=>{});
      return fresh;
     })().then(
      result=>{details.set(id,result);return result},
      error=>{details.set(id,{error:error.message});return null}
     ).finally(()=>pendingDetails.delete(id));
     pendingDetails.set(id,request);
    }
    await pendingDetails.get(id);
   }catch(error){details.set(id,{error:error.message})}
   completed++;
   progress('Đã đọc '+completed+'/'+queue.length+' chi tiết hóa đơn (tối đa 3 yêu cầu song song)');
  }
 };
 await Promise.all(Array.from({length:Math.min(3,queue.length)},()=>worker()));
 const good=new Map();
 for(const row of scopeRows){
  const result=details.get(idOf(row));
  if(result&&!result.error)good.set(row.key,result);
 }
 return good;
}

async function saveFile(filename,data,mime){
 if(window.AutoTaxZipExport?.isCapturing())return window.AutoTaxZipExport.capture(filename,data,mime);
 return AutoTaxDownloadFolder.save(filename,data,mime);
}
function download(filename,data,mime){
 // Legacy single-file buttons also use the folder if already selected.
 if(AutoTaxDownloadFolder?.label){
  const result=saveFile(filename,data,mime);
  result.catch(error=>show('Không lưu được '+filename+': '+error.message));
  return result;
 }
 const b=new Blob([data],{type:mime});
 const u=URL.createObjectURL(b),a=document.createElement('a');
 a.href=u;a.download=filename;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(u),30000);
 return Promise.resolve();
}
async function exportFileCore(kind){
 const targetRows=window.WebResults?.exportRows?.()||rows;
 if(!targetRows.length)return show('Không có hóa đơn trong phạm vi xuất. Kiểm tra các ô đã tick hoặc tháng được chọn.');
 stopped=false;
 let exportCompleted=false;
 const label={excel:'Excel',xml:'XML',html:'HTML',pdf:'PDF nhà phát hành',pdfTax:'PDF dựng lại'}[kind]||kind;
 progress('Bắt đầu tải '+targetRows.length+' hóa đơn · '+label+'…');
 try{
  const stamp=(readVnDate('fromDate')||'').replace(/-/g,'')+'_'+(readVnDate('toDate')||'').replace(/-/g,'')+
   (window.WebResults?.exportSuffix?.()||'');
  const fileBase='AutoTax_'+safe(govtMst)+'_'+stamp;
  let detailMap=new Map();
  if(kind==='excel'||kind==='xml')detailMap=await loadDetails(targetRows);
  if(kind==='excel'){
   const book=Report.buildSheets(targetRows,detailMap,{
    withLines:true,withPdf:true,
    sheets:{reduction:true,hdkd:true,risk:true,seller:false,adjust:true,gtgt:false}
   });
   await saveFile('BangKe_'+fileBase+'.xlsx',await window.AutoTaxFastWorkbook.build(book),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   show('Đã tạo Excel '+book.length+' sheet.'+(book.notes?.length?' Ghi chú: '+book.notes.join('; '):''),true);
  }else if(kind==='xml'){
   const z=[];
   for(const row of targetRows){
    const det=detailMap.get(row.key);
    if(!det?.files)continue;
    for(const [name,data] of Object.entries(det.files)){
      if(!/\.xml$/i.test(name))continue;
      const issue=Report.dateVN(det?.head?.seller?.time||det?.head?.signatureTime||det?.head?.nlap||row.tdlap).split('/').join('');
      z.push({name:(safe((row.kind==='purchase'?'MuaVao_':'BanRa_')+
        row.khhdon+'_'+row.shdon+'_'+(issue||'KhongRoNgay'))+'_'+safe(name)).replace(/\.xml$/i,'')+'.xml',data});
    }
   }
   if(!z.length)throw Error('Không tìm thấy XML gốc từ cổng Thuế trong danh sách hóa đơn. Không xuất dữ liệu giả.');
   for(const file of z)await saveFile('xml/'+file.name,file.data,'application/xml');
   show('Đã lưu '+z.length+' file XML gốc riêng lẻ vào xml/.',true);
  }else if(kind==='html'){
   const detail=await loadDetails(targetRows);
   let n=0;
   for(const row of targetRows){
    const inv=detail.get(row.key);
    if(!inv?.files)continue;
    const issue=Report.dateVN(inv?.head?.seller?.time||inv?.head?.signatureTime||inv?.head?.nlap||row.tdlap).split('/').join('');
    const prefix=safe((row.kind==='purchase'?'MuaVao_':'BanRa_')+
      row.khhdon+'_'+row.shdon+'_'+(issue||'KhongRoNgay'));
    for(const [name,data] of Object.entries(inv.files)){
     if(/\.(?:xml|pdf)$/i.test(name))continue;
     await saveFile('html/'+prefix+'/'+name,data,'text/html');n++;
    }
   }
   if(!n)throw Error('Cổng Thuế chưa cung cấp HTML để xuất.');
   show('Đã lưu '+n+' file HTML/tài nguyên vào html/.',true);
  }else if(kind==='pdf'||kind==='pdfTax'){
   if(!window.WebPdfExport)throw Error('Bộ xử lý PDF chưa tải xong; vui lòng làm mới trang.');
   const mode=kind==='pdfTax'?'tax':'original';
   const result=await window.WebPdfExport.create(targetRows,mode);
   show('PDF gốc nhà phát hành: '+result.originals+
    '; PDF trong gói cổng Thuế: '+result.attachments+
    '; PDF dựng lại từ dữ liệu Thuế (không phải gốc): '+result.rendered+
    '; PDF do người dùng gắn (chưa xác minh chữ ký): '+(result.userSupplied||0)+
    '. '+(result.errors.length?result.errors.length+
    ' hóa đơn chưa lấy được PDF gốc — xem link/mã tra cứu trong tệp hướng dẫn ZIP.':
    'Đã tải toàn bộ tệp có thể truy cập.')+
    ' Chế độ '+(mode==='tax'?'PDF dựng lại: tạo theo cùng mẫu trình bày với nút Xem PDF trên Web và Add-on, không phải PDF gốc.':'PDF gốc: ưu tiên bản nhà phát hành, nếu không tải được sẽ dùng bản dựng có ghi nhãn.')+' Mọi PDF dựng đều ghi rõ KHÔNG PHẢI GỐC.',
    result.errors.length===0);
  }else{throw Error('Định dạng tải không được hỗ trợ.');}
  exportCompleted=true;
  progress('Đã hoàn tất tải '+label+' · '+targetRows.length+' hóa đơn.');
 }catch(e){progress('Lỗi xuất '+label+': '+e.message);show('Không xuất được tệp: '+e.message);throw e}
 finally{/* Download Console chỉ hoàn tất sau khi ZIP thực sự được lưu. */}
}
async function exportFile(kind){
 if(kind==='pdf'){
  show('PDF Gốc nhà phát hành: đang chờ phát triển tiếp. Nút PDF dựng từ dữ liệu Thuế vẫn hoạt động bình thường.',true);
  return;
 }
 if(busy)return;
 if(!window.AutoTaxZipExport)return show('Bộ ZIP chưa tải xong; hãy làm mới trang.');
 busyState(true);show('');
 let success=false;
 try{
  if(kind==='all'){
   const warnings=[];
   await window.AutoTaxZipExport.batch(async()=>{
    for(const type of ['excel','xml','html','pdfTax']){
     const point=window.AutoTaxZipExport.mark();
     try{await exportFileCore(type)}
     catch(error){window.AutoTaxZipExport.rollback(point);warnings.push(type+': '+error.message)}
    }
   },'all');
   if(warnings.length)show('ZIP đã tạo, định dạng không đủ dữ liệu: '+warnings.join('; '),true);
  }else{
   await window.AutoTaxZipExport.batch(()=>exportFileCore(kind),kind);
  }
  success=true;
  progress('Hoàn tất quét, xuất và ghi tệp trên thiết bị.');
 }catch(error){
  progress('Lỗi xuất tệp: '+(error.message||error));
  show('Không xuất được dữ liệu: '+(error.message||error));
 }finally{
  busyState(false,true,success);
 }
}
// Shared in-page adapter: export and stock tools use the exact same invoice rows
// and fetchInvoice() implementation as the extension.
window.WebInvoiceApp={
 getRows:()=>rows,
 getMst:()=>govtMst||currentSearchMst(),
 getPeriod:()=>({from:readVnDate('fromDate'),to:readVnDate('toDate')}),
 getAccount:()=>account,
 getClient:()=>client,
 refreshAccount,
 searchedBothKinds:()=>searchedBothKinds,
 busy:()=>busy,
 busyState,progress,show,download,saveFile,loadDetails,
 startTask:()=>{stopped=false;busyState(true);show('')},
 async fetchDetail(row){
  if(!row)throw Error('Không tìm thấy hóa đơn.');
  const existing=details.get(idOf(row));
  if(existing?.error)details.delete(idOf(row));
  const m=await loadDetails([row]);
  const out=m.get(row.key);
  if(!out)throw Error(details.get(idOf(row))?.error||'Cổng Thuế chưa trả chi tiết hóa đơn.');
  return out;
 }
};
function init(){
 // Both invoice forms start selected whenever Web is opened; users may untick later.
 document.querySelectorAll('input[name="form"]').forEach(input=>{input.checked=true});
 const today=new Date();configureVnDates();setVnDate('toDate',dateOnly(today));
 setVnDate('fromDate',dateOnly(new Date(today.getFullYear(),today.getMonth(),1)));
 $('searchForm').addEventListener('submit',search);
 $('clearLocalInvoiceHistory')?.addEventListener('click',async()=>{
  if(busy)return show('Đang quét hoặc tải hóa đơn. Hãy hoàn tất trước khi xóa dữ liệu cục bộ.');
  const mst=currentSearchMst();
  if(!account?.id||!/^(?:\d{10}|\d{12}|\d{13})$/.test(mst))
   return show('Đăng nhập và chọn MST hợp lệ trước khi xóa lịch sử.');
  if(!confirm('Xóa lịch sử và bộ nhớ đệm hóa đơn cho MST '+mst+' trên thiết bị này?\nDữ liệu quyền sử dụng và lượt đã ghi nhận trên Supabase vẫn được giữ nguyên.'))return;
  const button=$('clearLocalInvoiceHistory');button.disabled=true;
  try{
   const count=await window.AutoTaxInvoiceCache?.clearForAccount(account.id,mst);
   details.clear();pendingDetails.clear();rows=[];window.WebResults?.resetForSearch?.();
   show('Đã xóa lịch sử hóa đơn cục bộ và '+(count||0)+' bản dữ liệu đệm cho MST '+mst+'.',true);
  }catch(error){show('Không xóa được bộ nhớ đệm: '+(error.message||error))}
  finally{button.disabled=false}
 });
 // Bring MST profiles and mode from Supabase whenever this tab becomes active.
 // Both Web and Add-on use the same account records; never sync tax passwords.
 let profileRefreshBusy=false,lastProfileRefreshAt=0;
 const refreshVisibleProfiles=async()=>{
  if(busy||document.hidden||profileRefreshBusy||Date.now()-lastProfileRefreshAt<9000)return;
  profileRefreshBusy=true;lastProfileRefreshAt=Date.now();
  try{await refreshAccount()}finally{profileRefreshBusy=false}
 };
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)void refreshVisibleProfiles()
 });
 window.addEventListener('focus',()=>void refreshVisibleProfiles());
 $('webUsageMode').addEventListener('change',async event=>{
  const input=event.currentTarget,previous=selectedMode;
  if(input.value===previous)return;
  input.disabled=true;
  try{
   const {error}=await client.rpc('autotax_set_usage_mode_v118',{p_mode:input.value});
   if(error)throw error;
   selectedMode=input.value;
   clearGov();
   await refreshAccount();
   show('Đã chuyển sang chế độ '+(selectedMode==='mst'?'MST':'số tờ')+
    '. Dữ liệu hồ sơ MST được giữ nguyên và đồng bộ với Add-on.',true);
  }catch(error){input.value=previous;show('Không đổi được chế độ: '+error.message)}
  finally{input.disabled=false}
 });
 $('changeOutputFolderWeb').addEventListener('click',async()=>{
  try{show('Đã chọn thư mục '+await AutoTaxDownloadFolder.change(),true)}
  catch(error){if(error.name!=='AbortError')show(error.message)}
 });
 $('searchBtn').addEventListener('click',()=>{
  if(busy){stopped=true;progress('Đã yêu cầu dừng tra cứu…');return}
  $('searchBtn').closest('form').requestSubmit();
 });
 $('stopBtn').addEventListener('click',()=>{if(!busy){$('progress').hidden=true;return}stopped=true;progress('Đang dừng sau yêu cầu hiện tại…')});
 $('reloadCaptcha').addEventListener('click',getCaptcha);
 $('retryConnectionBtn').addEventListener('click',async()=>{
  // A user-requested retry tries a different supported Supabase Edge region once.
  gatewayRegion=gatewayRegion==='ap-southeast-1'?'ap-northeast-1':'ap-southeast-1';
  $('captchaStatus').textContent='Đang thử kết nối qua tuyến máy chủ khác…';
  const ok=await getCaptcha();
  if(ok)show('Đã lấy CAPTCHA thành công. Nhấn Tìm kiếm hóa đơn để tiếp tục.',true);
 });
 $('clearGdt').addEventListener('click',()=>{clearGov();show('Đã xóa phiên cổng Thuế khỏi bộ nhớ.',true)});
 $('mstFree').addEventListener('input',()=>{
  if(govtToken&&currentSearchMst()!==govtMst)clearGov();
 });
 $('mstLimitClose').addEventListener('click',()=>$('mstLimitDialog').close());
 $('invoiceQuotaClose').addEventListener('click',()=>$('invoiceQuotaDialog').close());
 $('mstPasswordReminderClose').addEventListener('click',()=>$('mstPasswordReminder').close());
 $('mst').addEventListener('change',()=>{
  const x=currentSearchMst();
  if(govtToken&&x!==govtMst)clearGov();
  // GdtVault handles the selection event and encrypted credential autofill.
 });
 $('togglePassword').addEventListener('click',()=>{const input=$('gdtPassword');input.type=input.type==='password'?'text':'password'});
 $('closeGdtLoginError').addEventListener('click',()=>$('gdtLoginErrorDialog').close());
 for(const [id,kind] of [['exportAllZip','all'],['exportExcel','excel'],['exportXml','xml'],['exportHtml','html'],['exportPdf','pdf'],['exportPdfTax','pdfTax']])
  $(id).addEventListener('click',()=>exportFile(kind));
 window.addEventListener('pagehide',()=>{govtToken='';govtMst='';$('gdtPassword').value='';window.GdtVault?.lock()});
 refreshAccount();
}
window.AutoTaxRefreshWebAccount=refreshAccount;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();