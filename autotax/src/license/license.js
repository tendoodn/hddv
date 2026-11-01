(() => {
 const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co',KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ',STORE='autotax_license_session_v1';
 let session=null,license=null,timer=null,checking=false,packages=[];
 const $=id=>document.getElementById(id),emit=()=>document.dispatchEvent(new CustomEvent('autotax-license-change',{detail:{license,session}}));
 const headers=token=>({apikey:KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})});
 async function request(path,options={},token=session?.access_token){const res=await fetch(BASE+path,{...options,headers:{...headers(token),...(options.headers||{})}});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.msg||data.message||data.error_description||data.error||'Máy chủ trả về lỗi '+res.status);return data}
 const save=()=>chrome.storage.local.set({[STORE]:session});
 async function refreshToken(){if(!session?.refresh_token)return false;try{session=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})},null);await save();return true}catch{session=null;await save();return false}}
 async function authed(path,options={}){if(!session?.access_token)throw new Error('Vui lòng đăng nhập.');try{return await request(path,options)}catch(e){if(!/401|JWT|token/i.test(e.message)||!(await refreshToken()))throw e;return request(path,options)}}
 const rpc=(name,args={})=>authed('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(args)});
 function message(t,error=false){const el=$('lic-message');el.textContent=t;el.className='lic-message'+(error?' error':'');el.hidden=!t}
 function gate(){document.dispatchEvent(new CustomEvent('autotax-license-gate',{detail:{allowed:!!license?.allowed}}))}
 function money(v){return Number(v||0).toLocaleString('vi-VN')+'đ'}
 function render(){
  if(!$('license-card'))return;
  const active=!!session?.access_token;const mstPanel=$('lic-mst-assignments');if(mstPanel)mstPanel.hidden=!active||license?.mode!=='mst';
  $('lic-auth').hidden=active;$('lic-account').hidden=!active;$('lic-email-label').textContent=session?.user?.email||'';
  const rows=license?.packages||{},inv=rows.invoice||{},mst=rows.mst||{};
  const invLeft=Number(inv.remaining||0),invBought=Number(inv.purchased||0),mstCount=Number(mst.active_quantity||0);
  const both=invLeft>0&&mstCount>0;
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
  const trialPanel=$('lic-trial-panel');if(trialPanel)trialPanel.hidden=!active||!!license?.allowed||Number(invBought)>0||mstCount>0;
  gate();
 }
 async function status(){if(!session?.access_token){license={allowed:false,reason:'Đăng nhập để xem gói sử dụng.'};emit();return license}license=await rpc('addon_my_entitlements');emit();return license}
 async function check(){if(checking)return license;checking=true;try{await status()}catch(e){license={allowed:false,offline:true,reason:e.message};emit();message('Không xác minh được gói: '+e.message,true)}finally{checking=false}render();if(session?.access_token&&license?.mode==='mst')await loadMyMst();return license}
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
 async function loadPackages(){try{packages=await rpc('addon_list_packages');$('lic-package-list').innerHTML=packages.map(p=>'<div class="license-package"><div><b>'+p.name+'</b><small>'+p.description+'</small><strong>'+money(p.price_vnd)+'</strong></div><button type="button" data-package="'+p.code+'">Chọn mua</button></div>').join('')||'<small>Hiện chưa có gói mở bán.</small>'}catch(e){message('Không tải được danh sách gói: '+e.message,true)}}
 async function buy(code,btn){btn.disabled=true;message('Đang tạo đơn thanh toán…');try{const d=await authed('/functions/v1/addon-create-order',{method:'POST',body:JSON.stringify({package_code:code})});if(!d.success||!d.payment?.qr_url)throw new Error(d.error||'Không tạo được đơn.');$('lic-qr').src=d.payment.qr_url;$('lic-payment-info').textContent=money(d.payment.amount_vnd)+' · '+d.payment.bank_name+' · '+d.payment.account_name+' · Nội dung: '+d.payment.transfer_content;$('lic-payment').hidden=false;message('Quét QR và chuyển khoản đúng nội dung.');clearInterval(timer);timer=setInterval(async()=>{try{const s=await rpc('addon_my_entitlements');if(s?.packages&&JSON.stringify(s.packages)!==JSON.stringify(license?.packages)){clearInterval(timer);await check();$('lic-payment').hidden=true;message('Thanh toán đã được ghi nhận.')}}catch{}},5000);setTimeout(()=>clearInterval(timer),900000)}catch(e){message(e.message,true)}finally{btn.disabled=false}}
 async function redeemUnlock(){const input=$('lic-unlock-code'),btn=$('lic-unlock-redeem'),code=input.value.trim().toUpperCase();if(!code)return message('Nhập mã unlock.',true);btn.disabled=true;try{const result=await rpc('addon_redeem_package_unlock',{p_code:code});input.value='';await check();message('Đã kích hoạt gói '+result.package_code+' · '+result.quantity+(result.family==='mst'?' MST':' lượt hóa đơn')+(result.expires_at?' · hết hạn '+new Date(result.expires_at).toLocaleDateString('vi-VN'):''));}catch(e){message(e.message,true)}finally{btn.disabled=false}}
 async function startMstTrial(){
  const input=$('lic-trial-mst'),btn=$('lic-trial-start');
  const mst=(input?.value||'').trim();
  if(!/^[0-9]{10}(-?[0-9]{3})?$/.test(mst))return message('Nhập MST 10 hoặc 13 chữ số hợp lệ.',true);
  btn.disabled=true;
  try{
   const result=await rpc('addon_start_mst_trial',{p_mst:mst});
   input.value='';
   await check();
   message('Đã kích hoạt dùng thử MST '+result.mst+' đến '+new Date(result.expires_at).toLocaleDateString('vi-VN')+'.');
  }catch(e){message('Không kích hoạt được dùng thử: '+e.message,true)}
  finally{btn.disabled=false}
 }
 function ensureTrialPanel(){
  if($('lic-trial-start')||!$('lic-entitlements'))return;
  const wrapper=document.createElement('div');wrapper.id='lic-trial-panel';wrapper.className='license-entitlement';
  const content=document.createElement('div');
  const title=document.createElement('b');title.textContent='Dùng thử miễn phí 7 ngày · 1 MST';
  const hint=document.createElement('small');hint.textContent='Mỗi email và MST chỉ được dùng thử một lần. Gói trả phí không bị giới hạn trùng MST.';
  const input=document.createElement('input');input.id='lic-trial-mst';input.placeholder='Nhập mã số thuế';input.inputMode='numeric';input.maxLength=14;
  const button=document.createElement('button');button.id='lic-trial-start';button.type='button';button.textContent='Kích hoạt dùng thử';
  button.addEventListener('click',startMstTrial);
  content.append(title,hint,input);wrapper.append(content,button);
  $('lic-entitlements').insertAdjacentElement('afterend',wrapper);
 }
 async function loadMyMst(){const target=$('lic-mst-assignments');if(!target||!session?.access_token)return;try{const rows=await rpc('addon_list_my_mst_assignments');target.replaceChildren();const title=document.createElement('b');title.textContent='MST đã liên kết';target.append(title);for(const row of rows||[]){const line=document.createElement('div');line.className='license-entitlement';const name=document.createElement('span');name.textContent=row.mst;const button=document.createElement('button');button.type='button';button.textContent='Gỡ MST';button.disabled=!license?.allowed||license?.mode!=='mst';button.title=button.disabled?'Cần gói MST còn hiệu lực để tự gỡ':'Gỡ MST khỏi tài khoản';button.addEventListener('click',async()=>{if(!confirm('Gỡ liên kết MST '+row.mst+'?'))return;button.disabled=true;try{await rpc('addon_unlink_mst',{p_mst:row.mst});message('Đã gỡ MST '+row.mst);await loadMyMst()}catch(e){message(e.message,true);button.disabled=false}});line.append(name,button);target.append(line)}if(!rows?.length){const empty=document.createElement('small');empty.textContent='Chưa có MST liên kết.';target.append(empty)}}catch(e){message('Không tải được MST: '+e.message,true)}}
 function ensureMstPanel(){if($('lic-mst-assignments'))return;const anchor=$('lic-entitlements');if(!anchor)return;const panel=document.createElement('div');panel.id='lic-mst-assignments';panel.style.marginTop='12px';anchor.insertAdjacentElement('afterend',panel)}
 async function changePassword(){const current=$('lic-current-password').value,password=$('lic-new-password').value;if(!current)return message('Nhập mật khẩu hiện tại để xác minh.',true);if(password.length<8)return message('Mật khẩu mới cần ít nhất 8 ký tự.',true);if(current===password)return message('Mật khẩu mới phải khác mật khẩu hiện tại.',true);const btn=$('lic-password-save');btn.disabled=true;try{const verified=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:session?.user?.email,password:current})},null);if(!verified?.access_token)throw new Error('Không xác minh được mật khẩu hiện tại.');session=verified;await save();await authed('/auth/v1/user',{method:'PUT',body:JSON.stringify({password})});$('lic-current-password').value='';$('lic-new-password').value='';$('lic-password-box').hidden=true;message('Đã cập nhật mật khẩu.')}catch(e){message(e.message,true)}finally{btn.disabled=false}}
 async function logout(){try{await request('/auth/v1/logout',{method:'POST'})}catch{}session=null;license={allowed:false};await save();clearInterval(timer);render();message('Đã đăng xuất.')}
 async function init(){ensureTrialPanel();ensureMstPanel();const stored=await chrome.storage.local.get(STORE);session=stored[STORE]||null;if(session?.expires_at&&session.expires_at*1000<Date.now()+60000)await refreshToken();await check();if(session?.access_token){await loadPackages();}setInterval(check,60000)}
 document.addEventListener('DOMContentLoaded',()=>{$('lic-login').addEventListener('click',()=>auth('login'));$('lic-register').addEventListener('click',()=>auth('register'));$('lic-logout').addEventListener('click',logout);$('lic-refresh').addEventListener('click',check);$('lic-renew').addEventListener('click',()=>{$('lic-packages').hidden=!$('lic-packages').hidden});$('lic-packages-close').addEventListener('click',()=>$('lic-packages').hidden=true);$('lic-package-list').addEventListener('click',e=>{const b=e.target.closest('[data-package]');if(b)buy(b.dataset.package,b)});$('lic-unlock-redeem').addEventListener('click',redeemUnlock);$('lic-unlock-code').addEventListener('keydown',e=>{if(e.key==='Enter')redeemUnlock()});$('lic-password-open').addEventListener('click',()=>$('lic-password-box').hidden=!$('lic-password-box').hidden);$('lic-password-save').addEventListener('click',changePassword);$('lic-mode').addEventListener('change',async e=>{try{await rpc('addon_set_usage_mode',{p_mode:e.target.value});license.mode=e.target.value;message('Đã đổi chế độ.')}catch(err){message(err.message,true);e.target.value=license?.mode||'mst'}});$('lic-close-qr').addEventListener('click',()=>{$('lic-payment').hidden=true;clearInterval(timer)});init().catch(e=>message(e.message,true))});
 globalThis.License={status,check,canUse:()=>!!license?.allowed,getState:()=>license};
})();