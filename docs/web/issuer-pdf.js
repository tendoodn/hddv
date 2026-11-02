/* Authorized source-PDF helper. Only exposes links/security codes already in the
 * invoice's signed/source metadata; it does not guess CAPTCHAs or manufacture PDF originals. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
let current=null;
const title=v=>String(v??'').slice(0,200);
const safe=v=>title(v).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
function verifiedHttps(value){
 try{const u=new URL(String(value||''));return u.protocol==='https:'?u.toString():''}
 catch{return ''}
}
const status=message=>{$('issuerPdfStatus').textContent=message};
async function open(row){
 const d=$('issuerPdfDialog'),app=window.WebInvoiceApp;
 current=null;
 $('issuerPdfName').value='';$('issuerPdfCode').value='';
 $('issuerPdfLink').hidden=true;$('issuerPdfLink').removeAttribute('href');
 $('tryIssuerPdf').disabled=true;$('copyIssuerCode').disabled=true;
 $('issuerPdfMeta').textContent='Hóa đơn '+title(row.khhdon)+' / '+title(row.shdon)+
  ' · MST bên bán '+title(row.nbmst);
 status('Đang lấy dữ liệu nguồn về trang tra cứu và mã bảo mật...');
 if(!d.open)d.showModal();
 try{
  const detail=await app.fetchDetail(row);
  if(!d.open)return;
  const source=window.HDDT.originalLookup(row,detail.head||{});
  const link=verifiedHttps(source?.link);
  const code=title(source?.code);
  $('issuerPdfName').value=source?.name||'Chưa xác định nhà phát hành';
  $('issuerPdfCode').value=code;
  $('copyIssuerCode').disabled=!code;
  if(link){$('issuerPdfLink').href=link;$('issuerPdfLink').hidden=false;}
  current={row,link,code,detail};
  $('tryIssuerPdf').disabled=!link;
  status(link?
   (code?'Đã lấy được link và mã tra cứu. Có thể mở cổng nhà phát hành để nhập CAPTCHA nếu có.':
    'Có link nhà phát hành, nhưng dữ liệu Thuế không cung cấp mã bảo mật riêng.'):
   'Không có link HTTPS của nhà phát hành trong dữ liệu này. Không thể tự đoán endpoint PDF gốc.');
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
  if(!/\.pdf(?:$)|\/pdf(?:\/|$)|download.*pdf|format=pdf/i.test(link.pathname+link.search))
   throw Error('Đây là trang tra cứu, không phải đường dẫn tải PDF trực tiếp. Hãy mở trang bên cạnh để xác thực.');
  const res=await fetch(current.link,{method:'GET',mode:'cors',credentials:'omit',
   redirect:'error',signal:abort.signal,cache:'no-store'});
  if(!res.ok)throw Error('Nhà phát hành phản hồi HTTP '+res.status);
  const n=Number(res.headers.get('content-length')||0);
  if(n>12000000)throw Error('PDF lớn hơn 12 MB.');
  const bytes=new Uint8Array(await res.arrayBuffer());
  if(bytes.length<5||bytes.length>12000000||bytes[0]!==37||bytes[1]!==80||
   bytes[2]!==68||bytes[3]!==70||bytes[4]!==45)
   throw Error('Không nhận được tệp PDF thực (có thể là trang CAPTCHA hoặc HTML đăng nhập).');
  window.WebInvoiceApp.download(
   'PDF_Goc_'+safe(current.row.khhdon)+'_'+safe(current.row.shdon)+'.pdf',
   bytes,'application/pdf');
  status('Đã tải tệp PDF trực tiếp. Hãy đối chiếu thông tin nhà phát hành, chữ ký số và mã tra cứu.');
 }catch(err){status('Chưa thể tải PDF trực tiếp: '+(err.message||String(err))+
  '. Nếu cổng yêu cầu CAPTCHA, mở link tra cứu rồi nhập mã để tải bằng trang chính thức.');
 }finally{clearTimeout(timer);btn.disabled=!current?.link}
}
function init(){
 $('closeIssuerPdf').addEventListener('click',()=>$('issuerPdfDialog').close());
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