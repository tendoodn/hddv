/* Authorized source-PDF helper. Only exposes links/security codes already in the
 * invoice's signed/source metadata; it does not guess CAPTCHAs or manufacture PDF originals. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
let current=null,sequence=0;
const title=v=>String(v??'').slice(0,200);
const safe=v=>title(v).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
function verifiedHttps(value){
 try{const u=new URL(String(value||''));return u.protocol==='https:'?u.toString():''}
 catch{return ''}
}
const status=message=>{$('issuerPdfStatus').textContent=message};
const directPdfLink=link=>{
 try{
  const u=new URL(link);
  return u.protocol==='https:'&&(/\.(?:pdf|zip)$/i.test(u.pathname)||/\/(?:download|export)[^/]*|\/pdf(?:\/|$)|format=(?:pdf|zip)/i.test(u.pathname+u.search));
 }catch{return false}
};
function providerInstructions(name,link){
 const supplier=window.IssuerPortals?.describe(link);
 if(supplier?.id==='kiotviet')
  return 'KiotViet: nhập mã tra cứu trên tracuuhoadon.kiotviet.vn rồi bấm Tải xuống. Nhà phát hành có thể trả ZIP chứa cả PDF gốc và XML; giải nén ZIP, chọn đúng PDF để gắn lại trên Web.';
 if(supplier?.id==='vnpt')
  return 'VNPT: dùng ĐÚNG link ghi trên hóa đơn vì mỗi đơn vị phát hành có thể dùng cổng riêng. Nhập mã xác nhận, tải PDF từ trang chính thức.';
 if(/misa|meinvoice/i.test(name))
  return 'MISA meInvoice: dùng mã tra cứu trên hóa đơn, nhập mã xác nhận tại cổng MISA và tải PDF từ trang chính thức.';
 if(/viettel|sinvoice/i.test(name))
  return 'Viettel SInvoice: nhập MST bên bán và Mã số bí mật, kéo thanh trượt xác minh hình ảnh, bấm Tìm kiếm, sau đó chọn nút Tải PDF/ZIP trên chính cổng Viettel.';
 if(/vnpt/i.test(name))
  return 'VNPT Invoice: dùng đúng đường dẫn cổng được đơn vị bán cung cấp, nhập mã tra cứu và mã xác nhận để tải PDF.';
 return 'Nếu cổng yêu cầu mã xác nhận hoặc đăng nhập, xác thực trên chính trang nhà phát hành rồi tải PDF xuống máy.';
}

async function open(row){
 const d=$('issuerPdfDialog'),app=window.WebInvoiceApp,stamp=++sequence;
 current=null;
 $('issuerPdfFile').value='';
 $('issuerPdfAttach').disabled=true;
 $('issuerPdfName').value='';$('issuerPdfCode').value='';
 $('issuerPdfLink').hidden=true;$('issuerPdfLink').removeAttribute('href');
 $('tryIssuerPdf').disabled=true;$('copyIssuerCode').disabled=true;
 $('issuerPdfMeta').textContent='Hóa đơn '+title(row.khhdon)+' / '+title(row.shdon)+
  ' · MST bên bán '+title(row.nbmst)+
  (row.nmmst?' · MST bên mua '+title(row.nmmst):'');
 status('Đang lấy dữ liệu nguồn về trang tra cứu và mã bảo mật...');
 if(!d.open)d.showModal();
 try{
  const detail=await app.fetchDetail(row);
  if(!d.open||stamp!==sequence)return;
  const source=window.HDDT.originalLookup(row,detail.head||{});
  const originalLink=verifiedHttps(source?.link);
  // A known issuer's official search page is a manual fallback, never a PDF URL.
  // Viettel requires the user to complete the slider CAPTCHA on its own portal.
  const viettelPortal=/(viettel|s[ -]?invoice)/i.test(source?.name||'')
    ?window.IssuerPortals?.sources?.find(x=>x.id==='viettel')?.portal:'';
  const link=originalLink||verifiedHttps(viettelPortal);
  const code=title(source?.code);
  const catalog=window.IssuerPortals?.describe(link);
  $('issuerPdfName').value=source?.name||catalog?.name||'Chưa xác định nhà phát hành';
  $('issuerPdfCode').value=code;
  $('copyIssuerCode').disabled=!code;
  if(link){$('issuerPdfLink').href=link;$('issuerPdfLink').hidden=false;}
  current={row,link,code,detail};
  $('issuerPdfAttach').disabled=false;
  $('tryIssuerPdf').disabled=!directPdfLink(link);
  $('issuerPdfHelp').textContent=providerInstructions(source?.name||catalog?.name||'',link)+
   ' Nếu cổng đã xác thực nhưng Web bị CORS chặn, tải tệp trên chính trang phát hành hoặc dùng Add-on để nhận PDF qua phiên trang đó.';
  const previouslyAttached=window.WebPdfExport?.hasUserPdf(row);
  status((previouslyAttached?'Đã có tệp PDF được gắn trong phiên làm việc. ':
    'Bạn có thể gắn PDF tải từ cổng nhà phát hành vào đúng hóa đơn này. ')+
   (link?'Mở trang tra cứu để tải nếu cần. ':
    'Dữ liệu không có link trực tiếp; hãy lấy link từ người bán. ')+
   'Tệp do người dùng gắn KHÔNG được tự động coi là PDF gốc đã xác minh.');
 }catch(err){
  status('Chưa đọc được dữ liệu nhà phát hành: '+(err.message||String(err)));
 }
}
async function downloadDirect(){
 if(!current?.link)return;
 const btn=$('tryIssuerPdf');btn.disabled=true;
 status('Đang thử tải tệp PDF trực tiếp từ nhà phát hành…');
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),14000);
 try{
  const link=new URL(current.link);
  if(!/\.(?:pdf|zip)(?:$|\?)|\/(?:download|export)[^/]*|format=(?:pdf|zip)/i.test(link.pathname+link.search))
   throw Error('Đây là trang tra cứu, không phải đường dẫn tải PDF trực tiếp. Hãy mở trang bên cạnh để xác thực.');
  const res=await fetch(current.link,{method:'GET',mode:'cors',credentials:'omit',
   redirect:'error',signal:abort.signal,cache:'no-store'});
  if(!res.ok)throw Error('Nhà phát hành phản hồi HTTP '+res.status);
  const n=Number(res.headers.get('content-length')||0);
  if(n>24*1024*1024)throw Error('PDF/ZIP lớn hơn 24 MB.');
  let bytes=new Uint8Array(await res.arrayBuffer());
  if(bytes.length>24*1024*1024||bytes.length<5)
   throw Error('Không nhận được PDF/ZIP thực.');
  if(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4)
   bytes=(await window.AutoTaxIssuerArchive.extractPdf(bytes)).pdf;
  if(bytes.length>12*1024*1024||bytes[0]!==37||bytes[1]!==80||
    bytes[2]!==68||bytes[3]!==70||bytes[4]!==45)
   throw Error('Không nhận được PDF gốc từ nhà phát hành (có thể là CAPTCHA hoặc HTML đăng nhập).');
  const issue=window.Report.dateVN(current.detail?.head?.nlap||current.row.tdlap).split('/').join('');
  await window.WebInvoiceApp.saveFile(
   'pdf_goc/'+safe((current.row.kind==='purchase'?'MuaVao_':'BanRa_')+
     current.row.khhdon+'_'+current.row.shdon+'_'+(issue||'KhongRoNgay'))+'.pdf',
   bytes,'application/pdf');
  status('Đã tải tệp PDF trực tiếp. Hãy đối chiếu thông tin nhà phát hành, chữ ký số và mã tra cứu.');
 }catch(err){status('Chưa thể tải PDF trực tiếp: '+(err.message||String(err))+
  '. Nếu cổng yêu cầu CAPTCHA, mở link tra cứu rồi nhập mã để tải bằng trang chính thức.');
 }finally{clearTimeout(timer);btn.disabled=!current?.link}
}
async function attachDownloaded(){
 if(!current?.row)return status('Chưa chọn hóa đơn cần gắn tệp.');
 const file=$('issuerPdfFile').files?.[0];
 if(!file)return status('Hãy chọn PDF đã tải từ trang nhà phát hành trước.');
 if(file.size>12*1024*1024)return status('PDF không được vượt quá 12 MB.');
 const row=current.row,btn=$('issuerPdfAttach');
 btn.disabled=true;
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(current?.row!==row)return;
  const result=window.WebPdfExport.attachUserPdf(row,bytes,file.name);
  status('Đã gắn tệp '+file.name+' vào hóa đơn này trong bộ nhớ phiên ('+
   result.count+'/16 tệp). Khi xuất báo cáo PDF, AutoTax sẽ lấy tệp này và đặt trong '+
   'thư mục CHƯA XÁC MINH. Nội dung/chữ ký số cần được kiểm tra riêng; không tải lên máy chủ.');
 }catch(e){status('Không gắn được PDF: '+(e.message||String(e)))}
 finally{btn.disabled=!current?.row}
}
function init(){
 $('issuerPdfDialog').addEventListener('close',()=>{sequence++;current=null});
 $('closeIssuerPdf').addEventListener('click',()=>$('issuerPdfDialog').close());
 $('issuerPdfAttach').addEventListener('click',()=>void attachDownloaded());
 $('copyIssuerDetails').addEventListener('click',async()=>{
  if(!current?.row)return status('Chưa chọn hóa đơn.');
  const {row,detail,link,code}=current,head=detail?.head||{};
  const information=[
   'MST bên bán: '+String(head.nbmst||row.nbmst||''),
   'MST bên mua: '+String(head.nmmst||row.nmmst||''),
   'Ngày lập: '+String(head.nlap||row.nlap||''),
   'Mẫu số hóa đơn: '+String(head.khmshdon||row.khmshdon||''),
   'Ký hiệu hóa đơn: '+String(head.khhdon||row.khhdon||''),
   'Số hóa đơn: '+String(head.shdon||row.shdon||''),
   'Mã bảo mật/tra cứu: '+String(code||'Không có trong dữ liệu'),
   'Cổng tra cứu: '+String(link||'Liên hệ người bán')
  ].join('\n');
  try{
   await navigator.clipboard.writeText(information);
   status('Đã sao chép thông tin tra cứu. Chỉ dán vào cổng chính thức của đơn vị phát hành.');
  }catch{
   status('Trình duyệt chưa cấp quyền sao chép. Hãy dùng các ô thông tin hiển thị để nhập thủ công.');
  }
 });
 $('copyIssuerCode').addEventListener('click',async()=>{
  const code=$('issuerPdfCode').value;
  if(!code)return;
  try{await navigator.clipboard.writeText(code);status('Đã sao chép mã bảo mật vào bộ nhớ tạm.')}
  catch{const field=$('issuerPdfCode');field.focus();field.select();
   status('Không thể sao chép tự động. Mã đang được chọn để bạn sao chép bằng Ctrl+C.')}
 });
 $('tryIssuerPdf').addEventListener('click',()=>void downloadDirect());
}
window.IssuerPdf={open};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();