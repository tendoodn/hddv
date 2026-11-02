(() => {
 const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co',KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ',STORE='autotax_license_session_v1';
 let session=null,license=null,timer=null,checking=false,packages=[],trialActivationConfirmed=false,profileMsts=[];
 const $=id=>document.getElementById(id),emit=()=>document.dispatchEvent(new CustomEvent('autotax-license-change',{detail:{license,session}}));
 const headers=token=>({apikey:KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})});
 async function request(path,options={},token=session?.access_token){const res=await fetch(BASE+path,{...options,headers:{...headers(token),...(options.headers||{})}});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.msg||data.message||data.error_description||data.error||'Máy chủ trả về lỗi '+res.status);return data}
 const emitProfiles=()=>document.dispatchEvent(new CustomEvent('autotax-mst-profiles',{
  detail:{msts:[...profileMsts],userId:session?.user?.id||null}
 }));
 const save=()=>chrome.storage.local.set({[STORE]:session});
 async function refreshToken(){if(!session?.refresh_token)return false;try{session=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})},null);await save();return true}catch{session=null;await save();return false}}
 async function authed(path,options={}){if(!session?.access_token)throw new Error('Vui lòng đăng nhập.');try{return await request(path,options)}catch(e){if(!/401|JWT|token/i.test(e.message)||!(await refreshToken()))throw e;return request(path,options)}}
 const rpc=(name,args={})=>authed('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(args)});
 function message(t,error=false){const el=$('lic-message');el.textContent=t;el.className='lic-message'+(error?' error':'');el.hidden=!t}
 function gate(){document.dispatchEvent(new CustomEvent('autotax-license-gate',{detail:{allowed:!!license?.allowed}}))}
 function money(v){return Number(v||0).toLocaleString('vi-VN')+'đ'}
 function render(){
  if(!$('license-card'))return;
  const active=!!session?.access_token;const mstPanel=$('lic-mst-manager');if(mstPanel)mstPanel.hidden=!active;
  $('lic-header-email').hidden=!active;$('lic-header-email').textContent=active?(session?.user?.email||''):'';
  $('lic-logout').hidden=!active;$('lic-manage-account').hidden=!active;
  $('lic-auth').hidden=active;$('lic-account').hidden=!active;
  $('lic-account-quick-actions').hidden=!active;
  const rows=license?.packages||{},inv=rows.invoice||{},mst=rows.mst||{};
  const invLeft=Number(inv.remaining||0),invBought=Number(inv.purchased||0),mstCount=Number(mst.active_quantity||0);
  const both=(invLeft>0||!!license?.can_reread_charged_invoices)&&mstCount>0;
  const mode=license?.mode||(invLeft>0?'invoice':'mst');
  $('lic-mode-wrap').hidden=!both;$('lic-mode').value=mode;
  const holder=$('lic-entitlements');holder.replaceChildren();
  const card=document.createElement('div');card.className='license-entitlement';
  const info=document.createElement('div'),heading=document.createElement('b'),detail=document.createElement('small'),value=document.createElement('strong');
  if(mode==='invoice'){
   heading.textContent='Số tờ hóa đơn còn lại / đã mua';
   detail.textContent='Các lần mua được cộng dồn';
   value.textContent=invLeft.toLocaleString('vi-VN')+' / '+invBought.toLocaleString('vi-VN');
  }else{
   heading.textContent='Số MST được quản lý';
   detail.textContent='Hạn xa nhất: '+(mst.farthest_expiry?new Date(mst.farthest_expiry).toLocaleDateString('vi-VN'):'—');
   info.append(heading,detail);
   if(mst.nearest_expiry){
    const exp=document.createElement('small');
    exp.textContent=Number(mst.expiring_quantity||0)+' MST hết hạn ngày '+new Date(mst.nearest_expiry).toLocaleDateString('vi-VN');
    info.append(exp);
   }
   value.textContent=mstCount.toLocaleString('vi-VN')+' MST';
  }
  if(mode==='invoice')info.append(heading,detail);
  card.append(info,value);holder.append(card);
  $('lic-state').textContent=mode==='invoice'&&invLeft===0&&license?.can_reread_charged_invoices?'Hết lượt mới · được đọc lại hóa đơn cũ':license?.allowed?'Đã kích hoạt':'Chưa có quyền sử dụng';
  $('lic-state').className='lic-state '+(license?.allowed?'active':'locked');
  const trialPanel=$('lic-trial-panel');if(trialPanel)trialPanel.hidden=!active||!!license?.allowed||!!license?.ever_had_package||!!license?.trial_used||trialActivationConfirmed;
  gate();
 }
 async function status(){if(!session?.access_token){license={allowed:false,reason:'Đăng nhập để xem gói sử dụng.'};emit();return license}license=await rpc('addon_my_entitlements');emit();return license}
 async function check(){if(checking)return license;checking=true;try{await status()}catch(e){license={allowed:false,offline:true,reason:e.message};emit();message('Không xác minh được gói: '+e.message,true)}finally{checking=false}render();if(session?.access_token)await Promise.all([loadMyMst(),loadPackages()]);return license}
 const DUPLICATE_EMAIL_MESSAGE='Email đã được đăng ký. Vui lòng thử email khác hoặc trở lại đăng nhập.';
 function signupEmailExists(error){
  return /user_already_exists|email_exists|identity_already_exists|user already registered|email already (registered|exists|in use)|already registered/i.test(String(error?.message||error||''));
 }
 async function auth(kind){
  const email=$('lic-email').value.trim().toLowerCase(),password=$('lic-password').value;
  if(!email||!password)return message('Nhập email và mật khẩu.',true);
  $('lic-login').disabled=$('lic-register').disabled=true;
  try{
   if(kind==='register'){
    const signup=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})},null);
    // Supabase may return an obfuscated user with no identities instead of an error.
    if(signup?.user && Array.isArray(signup.user.identities) && signup.user.identities.length===0)
     return message(DUPLICATE_EMAIL_MESSAGE,true);
    if(!signup?.access_token)
     return message('Đã gửi email xác minh (nếu địa chỉ hợp lệ). Vui lòng kiểm tra email rồi trở lại đăng nhập.');
    session=signup;
   }else{
    session=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},null);
   }
   await save();$('lic-password').value='';await check();
   message(kind==='register'?'Đăng ký và đăng nhập thành công.':'Đăng nhập thành công.');
  }catch(e){
   message(kind==='register'&&signupEmailExists(e)?DUPLICATE_EMAIL_MESSAGE:e.message,true);
  }finally{
   $('lic-login').disabled=$('lic-register').disabled=false;
  }
 }
 async function loadPackages(){
  try{
   packages=await rpc('addon_list_packages');
   const holder=$('lic-package-list');holder.replaceChildren();
   for(const p of packages||[]){
    const card=document.createElement('div');card.className='license-package';
    const details=document.createElement('div');
    const name=document.createElement('b');name.textContent=p.name||p.code;
    const description=document.createElement('small');
    description.textContent=p.family==='mst'
      ? (p.description?p.description+' · ':'')+(p.validity_days?p.validity_days+' ngày · ':'')+'Không giới hạn số hóa đơn tra cứu trong phạm vi MST được quản lý.'
      : (p.description?p.description+' · ':'')+'Không giới hạn MST tra cứu; mỗi hóa đơn mới trừ 1 lượt.';
    const price=document.createElement('strong');price.textContent=money(p.price_vnd);
    details.append(name,description,price);
    const button=document.createElement('button');button.type='button';button.textContent='Chọn mua';
    button.dataset.package=p.code;
    button.disabled=p.family==='mst'&&!p.validity_days;
    card.append(details,button);holder.append(card);
   }
   if(!holder.childElementCount){const empty=document.createElement('small');empty.textContent='Hiện chưa có gói mở bán.';holder.append(empty)}
  }catch(e){message('Không tải được danh sách gói: '+e.message,true)}
 }
 async function buy(code,btn){btn.disabled=true;message('Đang tạo đơn thanh toán…');try{const d=await authed('/functions/v1/addon-create-order',{method:'POST',body:JSON.stringify({package_code:code})});if(!d.success||!d.payment?.qr_url)throw new Error(d.error||'Không tạo được đơn.');$('lic-qr').src=d.payment.qr_url;$('lic-payment-info').textContent=money(d.payment.amount_vnd)+' · '+d.payment.bank_name+' · '+d.payment.account_name+' · Nội dung: '+d.payment.transfer_content;$('lic-payment').hidden=false;message('Quét QR và chuyển khoản đúng nội dung.');clearInterval(timer);timer=setInterval(async()=>{try{const s=await rpc('addon_my_entitlements');if(s?.packages&&JSON.stringify(s.packages)!==JSON.stringify(license?.packages)){clearInterval(timer);await check();$('lic-payment').hidden=true;message('Thanh toán đã được ghi nhận.')}}catch{}},5000);setTimeout(()=>clearInterval(timer),900000)}catch(e){message(e.message,true)}finally{btn.disabled=false}}
 async function redeemUnlock(){
  const input=$('lic-unlock-code'),btn=$('lic-unlock-redeem'),code=input.value.trim().toUpperCase();
  if(!code){message('Nhập mã quà tặng.',true);input.focus();return}
  btn.disabled=true;
  try{
   const result=await rpc('addon_redeem_package_unlock',{p_code:code});
   input.value='';
   const dialog=$('lic-unlock-dialog');
   if(dialog.open)dialog.close();
   await check();
   message('Đã kích hoạt gói '+result.package_code+' · '+result.quantity+
     (result.family==='mst'?' MST':' lượt hóa đơn')+
     (result.expires_at?' · hết hạn '+new Date(result.expires_at).toLocaleDateString('vi-VN'):''));
  }catch(e){message('Mã quà tặng không hợp lệ: '+e.message,true)}
  finally{btn.disabled=false}
 }
 async function startMstTrial(){
  const input=$('lic-trial-mst'),btn=$('lic-trial-start');
  const mst=(input?.value||'').trim().replace(/[ -]/g,'');
  if(!/^[0-9]{10}([0-9]{2})?$/.test(mst))return message('Nhập MST 10 hoặc 12 chữ số hợp lệ.',true);
  btn.disabled=true;
  try{
   const result=await rpc('addon_start_mst_trial',{p_mst:mst});
   input.value='';
   trialActivationConfirmed=true;
   $('lic-trial-panel').hidden=true;
   await check();
   message('Đã kích hoạt dùng thử MST '+result.mst+' đến '+new Date(result.expires_at).toLocaleDateString('vi-VN')+'.');
  }catch(e){message('Không kích hoạt được dùng thử: '+e.message,true)}
  finally{btn.disabled=false}
 }
 function ensureTrialPanel(){
  if($('lic-trial-start')){if(!$('lic-trial-start').dataset.bound){$('lic-trial-start').addEventListener('click',startMstTrial);$('lic-trial-start').dataset.bound='1'}return;}if(!$('lic-entitlements'))return;
  const wrapper=document.createElement('div');wrapper.id='lic-trial-panel';wrapper.className='license-entitlement';
  const content=document.createElement('div');
  const title=document.createElement('b');title.textContent='Dùng thử miễn phí 7 ngày · 1 MST';
  const hint=document.createElement('small');hint.textContent='Mỗi email và MST chỉ được dùng thử một lần. Gói trả phí không bị giới hạn trùng MST.';
  const input=document.createElement('input');input.id='lic-trial-mst';input.placeholder='Nhập MST 10 hoặc 12 chữ số';input.inputMode='numeric';input.maxLength=13;
  const button=document.createElement('button');button.id='lic-trial-start';button.type='button';button.textContent='Kích hoạt dùng thử';
  button.addEventListener('click',startMstTrial);
  content.append(title,hint,input);wrapper.append(content,button);
  $('lic-entitlements').insertAdjacentElement('afterend',wrapper);
 }
 async function loadMyMst(){
  const target=$('lic-mst-assignments');
  if(!target||!session?.access_token){profileMsts=[];emitProfiles();return}
  try{
   const rows=await rpc('addon_list_my_mst_assignments');
   profileMsts=(rows||[]).map(x=>String(x.mst||'').replace(/\D/g,'')).filter(Boolean);
   $('lic-mst-count').textContent=String(profileMsts.length);
   target.replaceChildren();
   for(const row of rows||[]){
    const line=document.createElement('div');line.className='mst-profile-row';
    const info=document.createElement('div'),name=document.createElement('strong');
    name.textContent=row.mst;
    const note=document.createElement('small');
    note.textContent='Đã thêm: '+(row.assigned_at?
      new Date(row.assigned_at).toLocaleDateString('vi-VN'):'—');
    info.append(name,note);
    const button=document.createElement('button');
    button.type='button';button.textContent='Xóa';
    button.title='Xóa MST khỏi danh sách. Lịch sử cũ và quyền dùng thử không bị xóa.';
    button.addEventListener('click',async()=>{
     if(!confirm('Xóa hồ sơ MST '+row.mst+'? Lịch sử hóa đơn và dùng thử vẫn được giữ nguyên.'))return;
     button.disabled=true;
     try{
      await rpc('addon_remove_mst_profile_v33',{p_mst:row.mst});
      message('Đã xóa hồ sơ MST '+row.mst);
      await loadMyMst();
     }catch(e){message('Không xóa được MST: '+e.message,true);button.disabled=false}
    });
    line.append(info,button);target.append(line);
   }
   if(!rows?.length){
    const empty=document.createElement('small');
    empty.textContent='Chưa cấu hình MST nào. Thêm MST đang đăng nhập trên cổng Thuế để tra cứu.';
    target.append(empty);
   }
   emitProfiles();
  }catch(e){
   profileMsts=[];emitProfiles();
   message('Không tải được danh sách hồ sơ MST: '+e.message,true);
  }
 }
 async function addMstProfile(event){
  event?.preventDefault();
  const input=$('lic-mst-add-input'),btn=$('lic-mst-add-btn');
  const mst=(input.value||'').trim().replace(/[ -]/g,'');
  if(!/^(\d{10}|\d{12}|\d{13})$/.test(mst)){
   message('Nhập MST 10 hoặc 12 chữ số hợp lệ (MST chi nhánh 13 số vẫn được hỗ trợ).',true);return;
  }
  btn.disabled=true;
  try{
   const result=await rpc('addon_add_mst_profile_v33',{p_mst:mst});
   input.value='';
   await loadMyMst();
   message(result?.already_linked?'MST đã có trong danh sách.':'Đã thêm hồ sơ MST '+mst+'.');
  }catch(e){message('Không thể thêm MST: '+e.message,true)}
  finally{btn.disabled=false}
 }
 function ensureMstPanel(){ /* Profile controls are declared in panel HTML. */ }
 async function changePassword(){const current=$('lic-current-password').value,password=$('lic-new-password').value;if(!current)return message('Nhập mật khẩu hiện tại để xác minh.',true);if(password.length<8)return message('Mật khẩu mới cần ít nhất 8 ký tự.',true);if(current===password)return message('Mật khẩu mới phải khác mật khẩu hiện tại.',true);const btn=$('lic-password-save');btn.disabled=true;try{const verified=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:session?.user?.email,password:current})},null);if(!verified?.access_token)throw new Error('Không xác minh được mật khẩu hiện tại.');session=verified;await save();await authed('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});$('lic-current-password').value='';$('lic-new-password').value='';$('lic-password-box').hidden=true;message('Đã cập nhật mật khẩu.')}catch(e){message(e.message,true)}finally{btn.disabled=false}}
 async function logout(){try{await request('/auth/v1/logout',{method:'POST'})}catch{}session=null;license={allowed:false};profileMsts=[];emitProfiles();await save();clearInterval(timer);render();message('Đã đăng xuất.')}
 async function init(){ensureTrialPanel();ensureMstPanel();const stored=await chrome.storage.local.get(STORE);session=stored[STORE]||null;if(session?.expires_at&&session.expires_at*1000<Date.now()+60000)await refreshToken();await check();setInterval(check,60000)}
 document.addEventListener('DOMContentLoaded',()=>{$('lic-login').addEventListener('click',()=>auth('login'));$('lic-register').addEventListener('click',()=>auth('register'));$('lic-logout').addEventListener('click',logout);$('lic-mst-add-form').addEventListener('submit',addMstProfile);$('lic-refresh').addEventListener('click',check);$('lic-renew').addEventListener('click',()=>{$('lic-packages').hidden=!$('lic-packages').hidden});$('lic-packages-close').addEventListener('click',()=>$('lic-packages').hidden=true);$('lic-package-list').addEventListener('click',e=>{const b=e.target.closest('[data-package]');if(b)buy(b.dataset.package,b)});$('lic-gift-open').addEventListener('click',()=>{
  const dialog=$('lic-unlock-dialog');
  if(!dialog.open)dialog.showModal();
  $('lic-unlock-code').focus();
 });
 $('lic-unlock-close').addEventListener('click',()=>$('lic-unlock-dialog').close());
 $('lic-unlock-form').addEventListener('submit',e=>{e.preventDefault();void redeemUnlock()});$('lic-password-open').addEventListener('click',()=>$('lic-password-box').hidden=!$('lic-password-box').hidden);$('lic-password-save').addEventListener('click',changePassword);$('lic-mode').addEventListener('change',async e=>{try{await rpc('addon_set_usage_mode',{p_mode:e.target.value});license.mode=e.target.value;await check();message('Đã đổi chế độ.')}catch(err){message(err.message,true);e.target.value=license?.mode||'mst'}});$('lic-close-qr').addEventListener('click',()=>{$('lic-payment').hidden=true;clearInterval(timer)});init().catch(e=>message(e.message,true))});
 globalThis.License={status,check,canUse:()=>!!license?.allowed,getState:()=>license,getProfiles:()=>[...profileMsts]};
})();