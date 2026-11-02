/* AutoTax Web v1 — shared GDT invoice engine + shared AutoTax Supabase license.
   The GDT password and token are kept in memory only; no browser storage or server database. */
(function(){
'use strict';
const SUPABASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
const PUBLIC_KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const GATEWAY=SUPABASE+'/functions/v1/autotax-web-gateway';
const $=id=>document.getElementById(id);
const client=window.supabase?.createClient(SUPABASE,PUBLIC_KEY);
let account=null,govtToken='',govtMst='',captchaKey='',captchaUrl='',rows=[],details=new Map();
let busy=false,stopped=false,selectedMode='mst',profileMsts=[];
const vn=(iso)=>iso.split('-').reverse().join('/');
const dateOnly=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const idOf=r=>JSON.stringify([r.kind,r.form,r.khhdon,r.shdon,r.nbmst,r.nmmst]);
const money=n=>Number(n||0).toLocaleString('vi-VN')+' ₫';
const safe=s=>String(s||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70);
const selected=name=>[...document.querySelectorAll('input[name="'+name+'"]:checked')].map(el=>el.value);
const show=(msg,ok=false)=>{const box=$('notice');box.hidden=!msg;box.textContent=msg||'';box.classList.toggle('success',!!ok)};
const progress=msg=>{$('progressText').textContent=msg;};
const busyState=value=>{busy=!!value;$('progress').hidden=!value;$('searchBtn').disabled=!!value;
  for(const id of ['exportExcel','exportXml','exportTax','exportPdf'])$(id).disabled=!!value;};
const govSession={get token(){return govtToken}};
window.WebTaxState=govSession;
function clearGov(){
 govtToken='';govtMst='';details=new Map();rows=[];$('gdtPassword').value='';$('gdtStatus').textContent='Chưa có phiên đăng nhập cổng Thuế.';
 $('captchaBox').hidden=false;$('results').hidden=true;
}
async function authedRequest(op,data={},signal){
 const {data:sessionData}=await client.auth.getSession();
 const token=sessionData?.session?.access_token;
 if(!token)throw Error('Phiên AutoTax đã hết hạn. Vui lòng đăng nhập lại ở trang tài khoản.');
 const res=await fetch(GATEWAY,{method:'POST',signal,headers:{'Content-Type':'application/json',
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
  gdt_timeout:'Cổng Thuế phản hồi quá chậm. Thử lại sau.',
  gdt_connection_unavailable:'Máy chủ chưa kết nối được với cổng Thuế. Có thể bị chặn hoặc đang bảo trì.',
  gdt_sign_in_required:'Cổng Thuế yêu cầu đăng nhập lại.',
  gdt_mst_mismatch:'MST phiên Thuế không khớp MST hồ sơ AutoTax.',
  mst_profile_not_configured:'Hãy thêm MST này vào hồ sơ trên trang tài khoản AutoTax.',
  mst_package_expired:'Gói MST đã hết hạn.',
  mst_capacity_reduced:'MST vượt số lượng hồ sơ được phép.',
  invoice_package_required:'Gói số tờ không còn lượt mới.',
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
async function getCaptcha(){
 if(!account)return;
 $('reloadCaptcha').disabled=true;
 try{
  const res=await authedRequest('captcha');
  if(!res.ok)throw Error(await messageOf(res));
  const data=await res.json();
  if(!data?.key||!/^<svg[\s>]/i.test(String(data.content||'').trim()))
   throw Error('Cổng Thuế không trả ảnh CAPTCHA hợp lệ.');
  captchaKey=String(data.key);
  if(captchaUrl)URL.revokeObjectURL(captchaUrl);
  captchaUrl=URL.createObjectURL(new Blob([data.content],{type:'image/svg+xml'}));
  $('captchaImage').src=captchaUrl;
  $('captchaInput').value='';
 }catch(e){captchaKey='';show('Không tải được CAPTCHA: '+e.message)}
 finally{$('reloadCaptcha').disabled=false}
}
async function refreshAccount(){
 if(!client){show('Không tải được thư viện đăng nhập Supabase. Vui lòng tải lại trang.');return}
 try{
  const {data:{session}}=await client.auth.getSession();
  account=session?.user||null;
  if(!account){
   $('authStatus').textContent='Chưa đăng nhập — đăng nhập ở trang tài khoản trước.';
   show('Phiên bản Web dùng chung tài khoản AutoTax. Hãy đăng nhập và đăng ký hồ sơ MST ở trang Tài khoản rồi quay lại trang này.');
   return;
  }
  $('authStatus').textContent=account.email+' · Đã kết nối';
  const [ent,profiles]=await Promise.all([
   client.rpc('addon_my_entitlements'),
   client.rpc('addon_list_my_mst_assignments')
  ]);
  if(ent.error)throw ent.error;if(profiles.error)throw profiles.error;
  selectedMode=ent.data?.mode||'mst';
  profileMsts=(profiles.data||[]).map(x=>String(x.mst||'').replace(/\D/g,'')).filter(Boolean);
  $('mstList').replaceChildren(...profileMsts.map(m=>{const opt=document.createElement('option');opt.value=m;return opt}));
  if(profileMsts.length&&!$('mst').value)$('mst').value=profileMsts[0];
  if(!profileMsts.length)show('Chưa có hồ sơ MST. Bạn cần đăng ký MST tại trang tài khoản AutoTax.');
  else{show('Đã đồng bộ '+profileMsts.length+' hồ sơ MST. '+(selectedMode==='invoice'?'Gói T: trừ lượt hóa đơn mới, không trừ lại hóa đơn đã đọc.':'Gói MST: tra cứu theo thời hạn hồ sơ.'),true);await getCaptcha()}
 }catch(e){show('Không đồng bộ được quyền AutoTax: '+e.message)}
}
async function signIntoTax(mst){
 const username=$('mst').value.trim();
 const password=$('gdtPassword').value;
 const cvalue=$('captchaInput').value.trim();
 if(!password)throw Error('Hãy nhập mật khẩu cổng Thuế.');
 if(!captchaKey||!cvalue)throw Error('Hãy nhập mã CAPTCHA trên ảnh.');
 progress('Đang xác thực tài khoản cổng Thuế…');
 const res=await authedRequest('authenticate',{username,password,ckey:captchaKey,cvalue});
 $('gdtPassword').value='';
 // Captcha is single use, even if login failed.
 captchaKey='';$('captchaInput').value='';
 if(!res.ok){await getCaptcha();throw Error(await messageOf(res))}
 const json=await res.json().catch(()=>({}));
 const token=extractToken(json),sub=tokenMst(token);
 if(!token||!sub){await getCaptcha();throw Error('Cổng Thuế chưa trả phiên đăng nhập hợp lệ. Hãy thử đăng nhập tại website chính thức để kiểm tra tài khoản.')}
 if(sub!==mst){await getCaptcha();throw Error('MST đăng nhập cổng Thuế khác MST đã chọn trong AutoTax.')}
 govtToken=token;govtMst=mst;$('captchaBox').hidden=true;
 $('gdtStatus').textContent='Đã xác thực cổng Thuế cho MST '+mst+' · phiên chỉ ở trong bộ nhớ tab.';
}
async function ensurePermission(mst){
 const {data,error}=await client.rpc('addon_verify_session_mst_v33',{p_mst:mst});
 if(error)throw Error(error.message);
 if(!data?.allowed)throw Error('MST này chưa được cấp quyền hoặc gói đã hết hạn: '+(data?.reason||''));
 selectedMode=data.mode||selectedMode;
}
async function claimRows(all,mst){
 if(selectedMode!=='invoice'||!all.length)return all;
 const accepted=[],max=250;
 const key=r=>JSON.stringify([r.mst,r.direction,r.form_code,r.series,r.invoice_number]);
 for(let from=0;from<all.length;from+=max){
  const batch=all.slice(from,from+max);
  const items=batch.map(r=>({mst,direction:r.kind||'',
   form_code:(r.form||'')+':'+(r.khmshdon||''),
   series:r.khhdon||'',invoice_number:String(r.shdon??'')}));
  const {data,error}=await client.rpc('addon_claim_invoice_quota',{p_items:items});
  if(error)throw Error('Không kiểm tra được lượt hóa đơn: '+error.message);
  const allowed=new Set((data.allowed_items||[]).map(key));
  for(let i=0;i<items.length;i++)if(allowed.has(key(items[i])))accepted.push(batch[i]);
  progress('Đã ghi nhận '+Number(data.deducted||0)+' lượt mới; '+Number(data.previously_deducted||0)+' lượt cũ trong đợt.');
 }
 return accepted;
}
function renderResults(list,warnings=[]){
 $('results').hidden=false;
 const mua=list.filter(r=>r.kind==='purchase').length;
 $('resultSummary').textContent='Tìm thấy '+list.length+' hóa đơn · Mua vào: '+mua+' · Bán ra: '+(list.length-mua)+(warnings.length?' · Có cảnh báo nguồn dữ liệu':'');
 const tbody=$('resultRows');tbody.replaceChildren();
 for(const r of list.slice(0,1500)){
  const tr=document.createElement('tr');
  const partner=r.kind==='purchase'?(r.nbten||r.nbmst):(r.nmten||r.nmmst);
  const date=r.tdlap?new Date(r.tdlap).toLocaleDateString('vi-VN'):'—';
  const values=[r.kind==='purchase'?'Mua vào':'Bán ra',date,
   [r.khhdon,r.shdon].filter(Boolean).join(' / '),partner||'—',
   money(r.tgtttbso),HDDT.TTHAI[r.tthai]||'—'];
  values.forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(i===4)td.className='money';tr.append(td)});
  tbody.append(tr);
 }
 if(list.length>1500)show('Có '+list.length+' hóa đơn; bảng xem trước giới hạn 1.500 dòng, Excel vẫn xuất theo toàn bộ kết quả.',true);
}
async function search(e){
 e.preventDefault();if(busy)return;
 const mst=String($('mst').value||'').replace(/\D/g,'');
 const start=$('fromDate').value,end=$('toDate').value;
 if(!account)return show('Đăng nhập tài khoản AutoTax trước khi tra cứu.');
 if(!profileMsts.includes(mst))return show('MST chưa nằm trong danh sách hồ sơ AutoTax của bạn.');
 if(!start||!end||start>end)return show('Khoảng ngày chưa hợp lệ.');
 if(!selected('kind').length||!selected('form').length)return show('Chọn ít nhất một loại và một hình thức hóa đơn.');
 stopped=false;busyState(true);show('');
 try{
  await ensurePermission(mst);
  if(govtMst!==mst||!govtToken)await signIntoTax(mst);
  progress('Đang kiểm tra phiên cổng Thuế…');
  const info=await HDDT.getSessionInfo();
  if(!info?.ready||String(info.mst||'').replace(/\D/g,'')!==mst)
    throw Error('Phiên cổng Thuế hết hạn hoặc MST không khớp.');
  const result=await HDDT.search({tuNgay:vn(start),denNgay:vn(end),
    kinds:selected('kind'),forms:selected('form'),shouldStop:()=>stopped,
    onProgress:p=>progress(p.label+' · '+p.count+' hóa đơn'),
    onWarn:msg=>show(msg),onWait:w=>progress(w.label+' · đang đợi cổng Thuế '+(w.secs||0)+' giây')});
  if(stopped)throw Error('Đã dừng theo yêu cầu.');
  rows=await claimRows(result.rows,mst);details.clear();
  renderResults(rows,result.skipped||[]);
  show('Đã tra cứu '+rows.length+' hóa đơn được phép sử dụng.'+
   (result.skipped?.length?' Nguồn chưa hoàn tất: '+result.skipped.join(', '):''),true);
 }catch(error){show(error.message||'Tra cứu không thành công.');}
 finally{busyState(false)}
}
async function loadDetails(){
 if(!rows.length)throw Error('Chưa có hóa đơn để xuất.');
 let done=0;
 for(const row of rows){
  if(stopped)throw Error('Đã dừng khi tải chi tiết.');
  if(details.has(idOf(row)))continue;
  try{const v=await HDDT.fetchInvoice(row,()=>stopped);
   details.set(idOf(row),v);
  }catch(e){details.set(idOf(row),{error:e.message});}
  progress('Đang tải chi tiết '+(++done)+'/'+rows.length+' hóa đơn');
 }
 const good=new Map();
 for(const row of rows){const v=details.get(idOf(row));if(v&&!v.error)good.set(row.key,v)}
 return good;
}
function download(filename,data,mime){
 const b=new Blob([data],{type:mime});
 const u=URL.createObjectURL(b),a=document.createElement('a');
 a.href=u;a.download=filename;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(u),30000);
}
async function exportFile(kind){
 if(busy)return;if(!rows.length)return show('Hãy tra cứu có kết quả trước khi xuất file.');
 stopped=false;busyState(true);show('');
 try{
  const stamp=($('fromDate').value||'').replace(/-/g,'')+'_'+($('toDate').value||'').replace(/-/g,'');
  const fileBase='AutoTax_'+safe(govtMst)+'_'+stamp;
  let detailMap=new Map();
  if(kind!=='pdf')detailMap=await loadDetails();
  if(kind==='excel'||kind==='tax'){
   const book=Report.buildSheets(rows,detailMap,{
    withLines:kind==='excel',withPdf:true,
    sheets:kind==='excel'?
      {reduction:true,hdkd:true,risk:true,seller:false,adjust:true,gtgt:false}:
      {reduction:true,hdkd:true,risk:false,seller:false,adjust:false,gtgt:true}
   });
   const name=kind==='tax'?'ToKhai_tham_khao_':'BangKe_';
   download(name+fileBase+'.xlsx',Xlsx.buildXlsx(book),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   show('Đã tạo Excel '+book.length+' sheet.'+(book.notes?.length?' Ghi chú: '+book.notes.join('; '):''),true);
  }else if(kind==='xml'){
   const z=[];
   for(const row of rows){
    const det=detailMap.get(row.key);
    if(!det?.files)continue;
    for(const [name,data] of Object.entries(det.files)){
      if(!/\.xml$/i.test(name))continue;
      z.push({name:safe(row.kind+'_'+row.khhdon+'_'+row.shdon)+'_'+safe(name)+'.xml'.replace(/\.xml\.xml$/i,'.xml'),data});
    }
   }
   if(!z.length)throw Error('Không tìm thấy XML gốc từ cổng Thuế trong danh sách hóa đơn. Không xuất dữ liệu giả.');
   download('HoaDon_XML_'+fileBase+'.zip',Zip.writeZip(z),'application/zip');
   show('Đã đóng gói '+z.length+' XML gốc từ cổng Thuế.',true);
  }else{
   const values=[['Loại','Ký hiệu','Số hóa đơn','Đơn vị phát hành','Link tra cứu PDF gốc','Mã tra cứu']];
   for(const row of rows){
    const p=HDDT.originalLookup(row,details.get(idOf(row))?.head);
    values.push([row.kind,row.khhdon,row.shdon,p.name,p.link,p.code]);
   }
   const csv='\uFEFF'+values.map(line=>line.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
   download('LienKet_PDF_Goc_'+fileBase+'.csv',csv,'text/csv;charset=utf-8');
   show('Đã tải danh sách liên kết để mở tra cứu PDF gốc trên website của đơn vị phát hành. Không phải file PDF gốc.',true);
  }
 }catch(e){show('Không xuất được tệp: '+e.message)}
 finally{busyState(false)}
}
function init(){
 const today=new Date();$('toDate').value=dateOnly(today);
 $('fromDate').value=dateOnly(new Date(today.getFullYear(),today.getMonth(),1));
 $('searchForm').addEventListener('submit',search);
 $('stopBtn').addEventListener('click',()=>{stopped=true;progress('Đang dừng sau yêu cầu hiện tại…')});
 $('reloadCaptcha').addEventListener('click',getCaptcha);
 $('clearGdt').addEventListener('click',()=>{clearGov();getCaptcha();show('Đã xóa phiên cổng Thuế khỏi bộ nhớ.',true)});
 $('mst').addEventListener('change',()=>{const x=$('mst').value.replace(/\D/g,'');if(govtToken&&x!==govtMst){clearGov();getCaptcha()}});
 $('togglePassword').addEventListener('click',()=>{const input=$('gdtPassword');input.type=input.type==='password'?'text':'password'});
 for(const [id,kind] of [['exportExcel','excel'],['exportXml','xml'],['exportTax','tax'],['exportPdf','pdf']])
  $(id).addEventListener('click',()=>exportFile(kind));
 window.addEventListener('pagehide',()=>{govtToken='';govtMst='';$('gdtPassword').value=''});
 refreshAccount();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();