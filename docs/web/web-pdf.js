/* Web PDF downloader: original provider PDF first (only when a direct PDF URL is verified).
   Otherwise uses the GDT XML/detail data to generate a clearly labelled representation,
   NOT a legally original PDF issued by the invoice provider. */
(()=>{
'use strict';
const safe=v=>String(v||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,65);

/* PDF downloaded by the user from an official issuer portal.
   It stays in this browser tab's memory; NO backend upload, localStorage or
   automatic claims about the document's issuer/signature/provenance. */
const suppliedPdf=new Map();
let suppliedBytes=0,activeAccount='';
const MAX_SUPPLIED_FILES=16, MAX_SUPPLIED_TOTAL=64*1024*1024, MAX_PDF_BYTES=12*1024*1024;
// Clear in-memory files when the logged-in account changes, including logout.
function scopedAccount(){
 const id=String(window.WebInvoiceApp?.getAccount?.()?.id||'');
 if(id!==activeAccount){suppliedPdf.clear();suppliedBytes=0;activeAccount=id}
 return id;
}
const invoiceKey=row=>JSON.stringify([
 scopedAccount(),row?.kind||'',row?.form||'',
 String(row?.nbmst||'').replace(/\D/g,''),
 String(row?.nmmst||'').replace(/\D/g,''),
 row?.khmshdon||'',row?.khhdon||'',String(row?.shdon??'')
]);
const isPdf=bytes=>bytes instanceof Uint8Array&&bytes.byteLength>=5&&
 bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70&&bytes[4]===45;
function attachUserPdf(row,bytes,filename=''){
 if(!scopedAccount())throw Error('Cần đăng nhập AutoTax trước khi gắn PDF.');
 if(!row?.shdon||!row?.nbmst)throw Error('Chọn hóa đơn có số và MST bên bán trước khi gắn tệp.');
 if(!isPdf(bytes)||bytes.byteLength>MAX_PDF_BYTES)
  throw Error('Tệp phải là PDF hợp lệ và không vượt quá 12 MB.');
 const key=invoiceKey(row),old=suppliedPdf.get(key);
 if(!old&&suppliedPdf.size>=MAX_SUPPLIED_FILES)
  throw Error('Một phiên chỉ giữ tối đa 16 tệp. Hãy xuất các tệp đã chọn trước.');
 if(suppliedBytes-(old?.bytes.byteLength||0)+bytes.byteLength>MAX_SUPPLIED_TOTAL)
  throw Error('Tổng tệp PDF trong bộ nhớ vượt 64 MB. Hãy tải báo cáo rồi làm mới trang.');
 suppliedBytes=suppliedBytes-(old?.bytes.byteLength||0)+bytes.byteLength;
 suppliedPdf.set(key,{bytes,filename:safe(filename||'NguoiDungTaiLen.pdf')});
 return {count:suppliedPdf.size,bytes:suppliedBytes};
}
const hasUserPdf=row=>suppliedPdf.has(invoiceKey(row));

const readPdf=async url=>{
 const source=new URL(url);
 if(source.protocol!=='https:'||!(/\.pdf$/i.test(source.pathname)||/\/download[^/]*pdf|\/pdf(?:\/|$)|format=pdf/i.test(source.pathname+source.search)))return null;
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
 try{
  const res=await fetch(source.toString(),{credentials:'omit',mode:'cors',signal:abort.signal,cache:'no-store'});
  if(!res.ok)throw Error('HTTP '+res.status);
  if(Number(res.headers.get('content-length')||0)>12*1024*1024)throw Error('PDF vượt 12 MB.');
  const b=new Uint8Array(await res.arrayBuffer());
  if(b.byteLength>12*1024*1024||b.byteLength<5||
     b[0]!==37||b[1]!==80||b[2]!==68||b[3]!==70||b[4]!==45)
   throw Error('Nguồn không phải PDF hợp lệ.');
  return b;
 }finally{clearTimeout(timer)}
};
const validPdf=b=>b instanceof Uint8Array&&b.byteLength>=5&&
 b[0]===37&&b[1]===80&&b[2]===68&&b[3]===70&&b[4]===45;
function fromSourceFiles(inv){
 for(const [name,data] of Object.entries(inv?.files||{})){
  if(!/\.pdf$/i.test(name))continue;
  const u=data instanceof Uint8Array?data:data instanceof ArrayBuffer?new Uint8Array(data):null;
  if(u&&validPdf(u))return u;
 }
 return null;
}
async function pdfForInvoice(row,index,total){
 const invoice=[row.khhdon,row.shdon].filter(Boolean).join('_');
 const name=safe((row.kind==='purchase'?'MuaVao_':'BanRa_')+invoice);
 const app=window.WebInvoiceApp;
 app.progress('Đang tải PDF và kiểm tra nguồn '+(index+1)+'/'+total);
 const detail=await app.fetchDetail(row);
 const lookup=window.HDDT.originalLookup(row,detail.head);
 // A file explicitly selected for this exact invoice is bundled as user-supplied,
 // NOT as a verified issuer-original. The PDF signature is not authenticated here.
 const uploaded=suppliedPdf.get(invoiceKey(row));
 if(uploaded){
  return {name:'PDF_nguoi_dung_cung_cap_CHUA_XAC_MINH/'+name+'.pdf',
   data:uploaded.bytes,kind:'user_supplied',providerName:lookup.name||'',
   providerLink:lookup.link||'',lookupCode:lookup.code||''};
 }
 // First try the real direct issuer PDF link if one exists.
 let bytes=null;
 if(lookup.link){
  try{bytes=await readPdf(lookup.link)}catch{/* Provider may require CAPTCHA, cookies or block CORS. */}
 }
 if(bytes&&validPdf(bytes)){
  return {name:'PDF_goc_nha_phat_hanh/'+name+'.pdf',data:bytes,kind:'original'};
 }
 // Strict issuer-original mode: tax-portal attachments and locally generated
 // PDF representations are never silently substituted for the original PDF.
 // The provider may require its own authenticated session and CAPTCHA.
 throw Error('Chưa tải được PDF gốc từ nhà phát hành. '+
  'Nhà phát hành: '+(lookup.name||'chưa xác định')+'. '+
  'Link tra cứu: '+(lookup.link||'chưa có')+'. '+
  'Mã tra cứu: '+(lookup.code||'chưa có trong XML')+
  '. Mở chức năng Tra PDF gốc ở hóa đơn để xác thực tại cổng phát hành và gắn file nhận được.');
}
async function create(rows){
 if(!rows.length)throw Error('Không có hóa đơn trong phạm vi xuất.');
 const app=window.WebInvoiceApp,outputs=new Array(rows.length),errors=[];
 let offset=0;
 // Two workers: faster than sequential while limiting pressure on the tax portal.
 const worker=async()=>{
  for(;;){
   const index=offset++;
   if(index>=rows.length)return;
   try{outputs[index]=await pdfForInvoice(rows[index],index,rows.length)}
   catch(e){errors.push('Hóa đơn '+(rows[index].khhdon||'')+' / '+
    (rows[index].shdon||'')+': '+(e.message||String(e)))}
  }
 };
 await Promise.all(Array.from({length:Math.min(2,rows.length)},worker));
 const results=outputs.filter(Boolean),originals=results.filter(x=>x.kind==='original').length,
  rendered=results.filter(x=>x.kind==='representation').length,
  attachments=results.filter(x=>x.kind==='tax_attachment').length,
  userSupplied=results.filter(x=>x.kind==='user_supplied').length,
  sourceOriginals=results.filter(x=>x.sourceOriginal).length;
 // Even if all provider downloads fail, export a useful source/status report,
 // never manufacture an invoice representation or claim a fake original.
 const guide=[
  'AutoTax Web – PHAN BIET FILE PDF',
  'PDF_goc_nha_phat_hanh: Tap PDF goc lay truc tiep tu tep nha cung cap hoac duong dan PDF hop le.',
  'Che do bat buoc PDF goc: khong tao PDF the hien thay the va khong su dung PDF kem cong Thue chua ro nguon.',
  'PDF_nguoi_dung_cung_cap_CHUA_XAC_MINH: File PDF duoc nguoi dung gan thu cong, khong tu dong xac minh chu ky so hay nguon goc.',
  'Neu khong co PDF goc, xem danh sach hoa don that bai va link/ma tra cuu o cuoi tep.'
  'Tep nguoi dung gan thu cong chi duoc gan nhan CHUA XAC MINH chu ky, khong la PDF goc duoc AutoTax xac thuc.'
  'Neu nha cung cap yeu cau ma tra cuu/CAPTCHA ma khong cho phep tai PDF truc tiep,',
  'AutoTax khong the lay PDF goc mot cach chac chan. Link va ma tra cuu duoc liet ke ben duoi.',
  'Tong '+results.length+' tap PDF; goc nha phat hanh '+originals+'; nguoi dung cung cap '+userSupplied+'; ban the hien '+rendered+'; loi '+errors.length+'.'
 ];
 for(const x of results.filter(x=>x.kind!=='original'&&(x.providerLink||x.lookupCode))){
  guide.push('',x.name,'Nha phat hanh: '+x.providerName,'Link tra cuu: '+x.providerLink,
   'Ma bao mat / ma tra cuu (neu co): '+(x.lookupCode||'Chua co trong du lieu cong Thue'));
 }
 if(errors.length)guide.push('LOI:',...errors);
 if(results.length===1&&!errors.length&&results[0].kind==='original'){
  const file=results[0];app.download(file.name.split('/').pop(),file.data,'application/pdf');
 }else{
  const files=results.map(x=>({name:x.name,data:x.data}));
  files.push({name:'NGUON_PDF_MA_TRA_CUU.txt',data:guide.join('\n')});
  app.download('AutoTax_PDF_'+safe(app.getMst())+'_'+new Date().toISOString().slice(0,10)+'.zip',
   window.Zip.writeZip(files),'application/zip');
 }
 return {count:results.length,originals,rendered,attachments,userSupplied,sourceOriginals,errors};
}

window.WebPdfExport={create,attachUserPdf,hasUserPdf};
})();