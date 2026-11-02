/* Web PDF downloader: original provider PDF first (only when a direct PDF URL is verified).
   Otherwise uses the GDT XML/detail data to generate a clearly labelled representation,
   NOT a legally original PDF issued by the invoice provider. */
(()=>{
'use strict';
const safe=v=>String(v||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,65);
const readPdf=async url=>{
 const source=new URL(url);
 if(source.protocol!=='https:'||!/\.pdf$/i.test(source.pathname))return null;
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
async function create(rows){
 if(!rows.length)throw Error('Không có hóa đơn trong phạm vi xuất.');
 const app=window.WebInvoiceApp,files=[],errors=[];
 let originals=0,rendered=0,sourceOriginals=0;
 for(let index=0;index<rows.length;index++){
  const row=rows[index],invoice=[row.khhdon,row.shdon].filter(Boolean).join('_');
  const base=safe((row.kind==='purchase'?'MuaVao_':'BanRa_')+invoice);
  app.progress('Đang xử lý PDF '+(index+1)+'/'+rows.length);
  try{
   // Fetch source invoice details and resolve a direct supplier PDF URL, if provided.
   const detail=await app.fetchDetail(row);
   const lookup=window.HDDT.originalLookup(row,detail.head);
   let bytes=null;
   if(lookup.link){
    try{bytes=await readPdf(lookup.link)}catch{
     // Many providers require their own CAPTCHA, cookies or CORS authorization.
     // Never present a provider search HTML page as an actual PDF.
    }
   }
   if(bytes){
    files.push({name:'PDF_goc_nha_phat_hanh/'+base+'.pdf',data:bytes});
    originals++;continue;
   }
   let invoiceData=detail,sourceRow=row,prefix='BanTheHien_GDT';
   if(row.gocRef){
    try{
     invoiceData=await window.HDDT.fetchOriginal(row,()=>false);
     sourceRow={...row,...row.gocRef};
     prefix='BanTheHien_HoaDonGoc_GDT';sourceOriginals++;
    }catch{
     // The original invoice may not exist in the accessible GDT source;
     // fallback to the current invoice's official data.
     invoiceData=detail;
    }
   }
   bytes=await window.Pdf.buildInvoicePdf(sourceRow,invoiceData,
    window.HDDT.originalLookup(sourceRow,invoiceData.head));
   if(!(bytes instanceof Uint8Array)||bytes[0]!==37||bytes[1]!==80)
    throw Error('Bản thể hiện không phải tệp PDF.');
   files.push({name:prefix+'/'+base+'.pdf',data:bytes});
   rendered++;
  }catch(e){errors.push(base+': '+(e.message||String(e)))}
 }
 if(!files.length)throw Error('Không tải được PDF nào. '+errors.slice(0,2).join('; '));
 const guide='AutoTax Web · PHÂN BIỆT NGUỒN PDF\n\n'+
  'PDF_goc_nha_phat_hanh/: PDF trực tiếp của đơn vị phát hành, được xác minh bắt đầu bằng %PDF-.\n'+
  'BanTheHien_GDT/: Bản thể hiện do AutoTax TỰ TẠO từ XML/chi tiết lấy trên cổng Thuế.\n'+
  'BanTheHien_HoaDonGoc_GDT/: Bản thể hiện TỰ TẠO dựa trên dữ liệu hóa đơn gốc nếu cổng Thuế trả được.\n'+
  'Hai thư mục BanTheHien KHÔNG PHẢI file PDF gốc do nhà cung cấp phát hành.\n'+
  'Một số cổng cung cấp PDF gốc yêu cầu CAPTCHA riêng nên không thể tải trực tiếp trên website.\n'+
  '\nThành công: '+files.length+'; bản gốc nhà phát hành: '+originals+
  '; bản thể hiện từ dữ liệu Thuế: '+rendered+
  '; nguồn hóa đơn gốc truy xuất được: '+sourceOriginals+'; lỗi: '+errors.length+'.\n'+
  (errors.length?'\nLỖI:\n'+errors.join('\n'):'');
 if(files.length===1&&!errors.length){
  const name=files[0].name.split('/').pop();
  app.download(name,files[0].data,'application/pdf');
 }else{
  files.push({name:'NGUON_PDF_VA_LUU_Y.txt',data:guide});
  const filename='AutoTax_PDF_'+safe(app.getMst())+'_'+
   new Date().toISOString().slice(0,10)+'.zip';
  app.download(filename,window.Zip.writeZip(files),'application/zip');
 }
 return {count:files.filter(f=>f.name.endsWith('.pdf')).length,originals,rendered,
  sourceOriginals,errors};
}
window.WebPdfExport={create};
})();