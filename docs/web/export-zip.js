/* AutoTax Web V1.1.21: single XLSX, flat per-format ZIPs, one combined ZIP. */
(()=>{
 'use strict';
 let pending=null;
 const enc=new TextEncoder();
 const MIME_XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 const safe=value=>String(value??'').replace(/[\/\\:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'').slice(0,150)||'KhongRo';
 const last=name=>safe(String(name||'').replace(/\\/g,'/').split('/').pop());
 const asBytes=async data=>{
  if(data instanceof Uint8Array)return data;
  if(data instanceof ArrayBuffer)return new Uint8Array(data);
  if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
  if(data instanceof Blob)return new Uint8Array(await data.arrayBuffer());
  return enc.encode(String(data??''));
 };
 async function capture(name,data,mime){
  if(!pending)throw Error('Không có phiên đóng gói ZIP đang chạy.');
  const path=String(name||'').replace(/\\/g,'/');
  if(!path||path.split('/').some(part=>!part||part==='.'||part==='..'))
   throw Error('Tên tệp xuất không an toàn.');
  const bytes=await asBytes(data);
  if(bytes.byteLength>100*1024*1024)throw Error('Tệp vượt giới hạn 100 MB.');
  pending.push({name:path,data:bytes,mime:mime||'application/octet-stream'});
  return path;
 }
 function range(){
  const period=window.WebInvoiceApp?.getPeriod?.()||{};
  const date=value=>{
   const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));
   return match?match[3]+match[2]+match[1]:'KhongRoNgay';
  };
  const mst=String(window.WebInvoiceApp?.getMst?.()||'').replace(/\D/g,'')||'MST';
  return {mst,from:date(period.from),to:date(period.to)};
 }
 const prefix=()=>{
  const {mst,from,to}=range();
  return mst+'_'+from+'_'+to;
 };
 const filenames=()=>({
  excel:'Bang_ke_'+prefix()+'.xlsx',
  xml:'XML_'+prefix()+'.zip',
  html:'HTML_'+prefix()+'.zip',
  pdfTax:'PDF_Thue_'+prefix()+'.zip',
  pdf:'PDF_Goc_Dung_'+prefix()+'.zip',
  all:'AutoTax_Tat_Ca_'+prefix()+'.zip'
 });
 const matches=(f,kind)=>{
  const n=f.name.toLowerCase();
  if(kind==='excel')return /\.xlsx$/i.test(n);
  if(kind==='xml')return /\.xml$/i.test(n);
  if(kind==='html')return /\.html?$/i.test(n);
  // CQT can return a genuine PDF in its archive or an AutoTax-rendered copy.
  // Both belong to PDF Thuế, never to the issuer-original ZIP.
  const taxPdf=/^(?:pdf_thue_|pdf_nguon_tu_cong_thue\/)/i.test(f.name);
  if(kind==='pdfTax')return /\.pdf$/i.test(n)&&taxPdf;
  if(kind==='pdf')return /\.pdf$/i.test(n)&&!taxPdf;
  return false;
 };
 // Keep PDF ZIPs PDF-only, but preserve MST, signing month, direction and source.
 function pdfNameInsideZip(file,leaf){
  const {mst}=range();
  const signature=leaf.match(/_(\\d{2})(\\d{2})(\\d{4})(?:_\\d+)?\\.pdf$/i);
  const year=signature?signature[3]:'KhongRoNam';
  const month=signature?signature[2]:'KhongRoThang';
  const direction=/^MuaVao_/i.test(leaf)?'MuaVao':/^BanRa_/i.test(leaf)?'BanRa':'ChuaPhanLoai';
  const source=/^PDF_NGUON_TU_CONG_THUE\\//i.test(file.name)?'NguonCQT':
   /^PDF_THUE_/i.test(file.name)?'ThueDung':
   /^PDF_GOC_NHA_PHAT_HANH\\//i.test(file.name)?'GocNPH':
   /^PDF_NGUOI_DUNG/i.test(file.name)?'NguoiDung':'DungTuCQT';
  return ['HoaDon',safe(mst),year,month,direction,source+'_'+leaf].join('/');
 }
 function categoryFiles(files,kind){
  const names=new Set(),output=[];
  for(const file of files.filter(f=>matches(f,kind))){
   let name=last(file.name);
   if(kind==='pdfTax'||kind==='pdf')name=pdfNameInsideZip(file,name);
   const dot=name.lastIndexOf('.'),base=dot>=0?name.slice(0,dot):name,
    ext=dot>=0?name.slice(dot):'';
   let index=2;
   while(names.has(name.toLocaleLowerCase('vi-VN')))
    name=base+'_'+(index++)+ext;
   names.add(name.toLocaleLowerCase('vi-VN'));
   output.push({name,data:file.data});
  }
  return output;
 }
 function manifest(kind,files){
  const {mst,from,to}=range();
  const label=kind==='xml'?'XML goc tu Cong Thue':'HTML tu du lieu tra cuu Cong Thue';
  return [
   'AUTOTAX - THONG TIN VA NGUON DU LIEU',
   'Dinh dang: '+label,
   'MST tra cuu: '+mst,
   'Tu ngay: '+from+' | Den ngay: '+to,
   'Nguon: Cong tra cuu hoa don dien tu - hoadondientu.gdt.gov.vn',
   'Tong tep '+kind.toUpperCase()+': '+files.length,
   'Chi bao gom file '+(kind==='xml'?'.xml':'.html')+' va tep thong tin nay.',
   'Danh sach tep:',
   ...files.map(f=>'- '+f.name),
   'Luu y: Thong tin la du lieu tra cuu, khong thay the xac thuc hoa don goc.'
  ].join('\r\n');
 }
 function buildFormat(files,kind){
  const output=categoryFiles(files,kind);
  if(!output.length)throw Error('Không có dữ liệu '+kind.toUpperCase()+' hợp lệ để xuất.');
  if(kind==='xml'||kind==='html')
   output.push({name:'THONG_TIN_NGUON.txt',data:enc.encode(manifest(kind,output))});
  return window.Zip.writeZip(output);
 }
 async function saveResult(files,label){
  const names=filenames(),storage=window.AutoTaxDownloadFolder;
  if(label==='excel'){
   const items=categoryFiles(files,'excel');
   if(items.length!==1)throw Error('Excel cần đúng một tệp XLSX, thực tế: '+items.length);
   await storage.saveRootFile(names.excel,items[0].data,MIME_XLSX);
   window.WebInvoiceApp?.show?.('Đã lưu Excel: '+names.excel,true);
   return names.excel;
  }
  if(label==='all'){
   const book=categoryFiles(files,'excel');
   if(book.length!==1)throw Error('Thiếu file bảng kê Excel trong gói tổng.');
   const outer=[{name:names.excel,data:book[0].data}];
   for(const kind of ['xml','html','pdfTax','pdf']){
    try{outer.push({name:names[kind],data:buildFormat(files,kind)})}
    catch(error){console.warn('AutoTax: bỏ qua ZIP '+kind+': '+error.message)}
   }
   await storage.saveRootArchive(names.all,window.Zip.writeZip(outer));
   window.WebInvoiceApp?.show?.('Đã lưu '+names.all+' gồm '+outer.length+' tệp (1 Excel và các ZIP định dạng có dữ liệu).',true);
   return names.all;
  }
  if(['xml','html','pdfTax','pdf'].includes(label)){
   const zipped=buildFormat(files,label);
   await storage.saveRootArchive(names[label],zipped);
   window.WebInvoiceApp?.show?.('Đã lưu '+names[label],true);
   return names[label];
  }
  // Existing stock-import export is intentionally kept independent.
  const safeFiles=files.map(f=>({name:f.name,data:f.data}));
  if(!safeFiles.length)throw Error('Không có dữ liệu xuất phiếu nhập kho.');
  const name='NhapHang_'+prefix()+'.zip';
  await storage.saveRootArchive(name,window.Zip.writeZip(safeFiles));
  return name;
 }
 async function batch(job,label){
  if(pending)throw Error('Một phiên xuất dữ liệu khác đang chạy.');
  if(!window.Zip?.writeZip||!window.AutoTaxDownloadFolder?.saveRootArchive||
    !window.AutoTaxDownloadFolder?.saveRootFile)
   throw Error('Bộ ZIP hoặc API thư mục xuất chưa sẵn sàng.');
  pending=[];
  try{
   const result=await job();
   const files=pending;
   if(files.reduce((sum,f)=>sum+f.data.byteLength,0)>350*1024*1024)
    throw Error('Dữ liệu vượt 350 MB, hãy xuất theo tháng.');
   pending=null;
   await saveResult(files,label);
   return result;
  }finally{pending=null}
 }
 const mark=()=>pending?pending.length:0;
 const rollback=point=>{if(pending&&Number.isInteger(point))pending.length=Math.max(0,Math.min(point,pending.length))};
 window.AutoTaxZipExport=Object.freeze({
  isCapturing:()=>pending!==null,capture,batch,mark,rollback
 });
})();
