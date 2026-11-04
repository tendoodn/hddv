/* AutoTax Web V1.1: two explicit export policies.
 * "tax": always rebuild a PDF representation from GDT invoice data.
 * "original": try actual issuer PDF (or user-attached PDF); if unavailable,
 * rebuild a clearly labelled replacement, NEVER call that PDF the original.
 */
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
 if(source.protocol!=='https:'||!(/\.(?:pdf|zip)$/i.test(source.pathname)||/\/(?:download|export)[^/]*|\/pdf(?:\/|$)|format=(?:pdf|zip)/i.test(source.pathname+source.search)))return null;
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
 try{
  const res=await fetch(source.toString(),{credentials:'omit',mode:'cors',signal:abort.signal,cache:'no-store'});
  if(!res.ok)throw Error('HTTP '+res.status);
  if(Number(res.headers.get('content-length')||0)>24*1024*1024)
   throw Error('PDF/ZIP vượt 24 MB.');
  const b=new Uint8Array(await res.arrayBuffer());
  if(b.byteLength>24*1024*1024||b.byteLength<5)throw Error('PDF/ZIP không hợp lệ.');
  if(b[0]===80&&b[1]===75&&b[2]===3&&b[3]===4)
   return (await window.AutoTaxIssuerArchive.extractPdf(b)).pdf;
  if(b.byteLength>12*1024*1024||b[0]!==37||b[1]!==80||
     b[2]!==68||b[3]!==70||b[4]!==45)throw Error('Nguồn không phải PDF hợp lệ.');
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
async function pdfForInvoice(row,index,total,mode){
 const invoice=[row.khhdon,row.shdon].filter(Boolean).join('_');
 const app=window.WebInvoiceApp;
 app.progress((mode==='tax'?'Đang dựng PDF Thuế ':'Đang thử PDF gốc và chuẩn bị PDF dự phòng ')+
  (index+1)+'/'+total);
 const detail=await app.fetchDetail(row);
 // Ngày ký là ngày phát hành ưu tiên; chỉ dùng ngày lập khi XML không có ngày ký.
 const signature=detail?.head?.seller?.time||detail?.head?.signatureTime||'';
 const dateForFilename=window.Report.dateVN(signature||detail?.head?.nlap||row.tdlap).split('/').join('');
 const sellerMst=String(row.nbmst||detail?.head?.seller?.mst||'KhongRoMST').replace(/\D/g,'')||'KhongRoMST';
 const invoiceCode=safe(String(row.mhdon||row.mccqt||[row.khhdon,row.shdon].filter(Boolean).join('_')||'KhongRoMa'));
 const name=safe(sellerMst+'_'+invoiceCode+'_'+(dateForFilename||'KhongRoNgay'));
 const lookup=window.HDDT.originalLookup(row,detail.head);
 // PDF Thuế is always reconstructed, regardless of whether the issuer source
 // link is available. Its directory and manifest explicitly say NOT ORIGINAL.
 if(mode==='tax'){
  const rendered=await window.Pdf.buildInvoicePdf(row,detail,lookup);
  if(!validPdf(rendered))throw Error('Không dựng được PDF Thuế từ dữ liệu hóa đơn.');
  return {name:'PDF_THUE_DUNG_TU_DU_LIEU_CQT_KHONG_PHAI_GOC/'+name+'.pdf',
   data:rendered,kind:'representation',reason:'Chế độ PDF Thuế: luôn dựng từ dữ liệu CQT',
   providerName:lookup.name||'',providerLink:lookup.link||'',lookupCode:lookup.code||''};
 }
 let bytes=null,failure='';
 if(lookup.link){
  try{bytes=await readPdf(lookup.link);
   if(!bytes)failure='Liên kết tra cứu chưa phải URL tải PDF trực tiếp.'}
  catch(e){failure='Không tải được PDF gốc: '+(e.message||String(e))}
 }else{
  failure='Không có link nhà phát hành trong dữ liệu hóa đơn.';
 }
 if(bytes&&validPdf(bytes)){
  return {name:'PDF_goc_nha_phat_hanh/'+name+'.pdf',
   data:bytes,kind:'original',providerName:lookup.name||'',
   providerLink:lookup.link||'',lookupCode:lookup.code||''};
 }
 // If a PDF was downloaded and attached by the user, keep it distinct
 // from a source-verified PDF. The issuer endpoint was attempted first.
 const uploaded=suppliedPdf.get(invoiceKey(row));
 if(uploaded){
  return {name:'PDF_nguoi_dung_cung_cap_CHUA_XAC_MINH/'+name+'.pdf',
   data:uploaded.bytes,kind:'user_supplied',providerName:lookup.name||'',
   providerLink:lookup.link||'',lookupCode:lookup.code||''};
 }
 // V1.1 fallback requested by user: an unsuccessful genuine source attempt
 // must not leave the invoice without a usable PDF representation.
 const rendered=await window.Pdf.buildInvoicePdf(row,detail,lookup);
 if(!validPdf(rendered))throw Error('PDF gốc chưa tải được và dựng lại PDF cũng thất bại. '+failure);
 return {name:'PDF_DUNG_LAI_TU_DU_LIEU_CQT_KHONG_PHAI_GOC/'+name+'.pdf',
  data:rendered,kind:'representation',fallbackAfterFailure:true,
  reason:failure||'Nhà phát hành chưa cung cấp tệp PDF gốc để tải',
  providerName:lookup.name||'',providerLink:lookup.link||'',lookupCode:lookup.code||''};
}
async function create(rows,mode='original'){
 if(!['tax','original'].includes(mode))throw Error('Chế độ xuất PDF không hợp lệ.');
 if(!rows.length)throw Error('Không có hóa đơn trong phạm vi xuất.');
 const app=window.WebInvoiceApp,outputs=new Array(rows.length),errors=[];
 let offset=0;
 // Two workers: faster than sequential while limiting pressure on the tax portal.
 const worker=async()=>{
  for(;;){
   const index=offset++;
   if(index>=rows.length)return;
   try{outputs[index]=await pdfForInvoice(rows[index],index,rows.length,mode)}
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
 // Save every PDF independently; preserve a separate provenance report for rebuilt files.
 const guide=[
  'AutoTax Web V1.1 - BAO CAO NGUON PDF',
  'Che do: '+(mode==='tax'?'PDF THUE (tat ca PDF dung lai)':'PDF GOC UU TIEN (neu that bai thi dung lai)'),
  'PDF_goc_nha_phat_hanh: Tap PDF nhan truc tiep tu duong dan nha cung cap, chua tu kiem tra chu ky so.',
  'PDF_THUE_DUNG_TU_DU_LIEU_CQT_KHONG_PHAI_GOC: Ban the hien duoc dung tu du lieu cong Thue; KHONG PHAI PDF GOC.',
  'PDF_DUNG_LAI_TU_DU_LIEU_CQT_KHONG_PHAI_GOC: Ban du phong khi PDF goc chua tai duoc; KHONG PHAI PDF GOC.',
  'PDF_nguoi_dung_cung_cap_CHUA_XAC_MINH: PDF do nguoi dung gan; chua xac minh nguon va chu ky.',
  'Neu hoa don co link tra cuu ma nha cung cap yeu cau CAPTCHA/dang nhap, su dung link + ma duoi day de tiep tuc tai ban goc.',
  'Tong: '+results.length+' tep PDF; PDF goc nhan duoc '+originals+'; PDF dung lai '+rendered+'; nguoi dung gan '+userSupplied+'; loi '+errors.length+'.'
 ];
 for(const x of results.filter(x=>x.kind!=='original')){
  guide.push('',x.name,
   'Loai: '+(x.kind==='representation'?'PDF DUNG LAI, KHONG PHAI GOC':'PDF NGUOI DUNG, CHUA XAC MINH'),
   'Nha phat hanh: '+(x.providerName||'Chua xac dinh'),
   'Link tra cuu: '+(x.providerLink||'Khong co'),
   'Ma bao mat: '+(x.lookupCode||'Khong co'),
   'Ly do: '+(x.reason||'Chua xac minh nguon tai'));
 }
 if(errors.length)guide.push('LOI KHONG XUAT DUOC:',...errors);
 if(!results.length)throw Error('Không có PDF hợp lệ từ nhà phát hành hoặc dữ liệu Thuế.');
 for(const file of results)
  await app.saveFile(file.name,file.data,'application/pdf');
 if(errors.length||rendered||userSupplied)
  await app.saveFile('NGUON_PDF_MA_TRA_CUU.txt',guide.join('\n'),'text/plain');

 return {mode,count:results.length,originals,rendered,attachments,userSupplied,sourceOriginals,errors};
}

window.WebPdfExport={create,attachUserPdf,hasUserPdf};
})();