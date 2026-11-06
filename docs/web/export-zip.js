/* AutoTax 1.1.22: deterministic per-format exports, flat ZIP entries and provenance. */
(()=>{
 'use strict';
 let pending=null;
 const enc=new TextEncoder();
 const MIME_XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 const safe=value=>String(value??'').replace(/[\/\\:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'').trim().slice(0,120)||'KhongRo';
 const basename=path=>safe(String(path||'').replace(/\\/g,'/').split('/').pop());
 const asBytes=async data=>{
  if(data instanceof Uint8Array)return data;
  if(data instanceof ArrayBuffer)return new Uint8Array(data);
  if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
  if(data instanceof Blob)return new Uint8Array(await data.arrayBuffer());
  return enc.encode(String(data??''));
 };
 async function capture(name,data,mime){
  if(!pending)throw Error('Không có phiên xuất đang chạy.');
  const path=String(name||'').replace(/\\/g,'/');
  if(!path||path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Đường dẫn không an toàn.');
  const bytes=await asBytes(data);
  if(bytes.byteLength>100*1024*1024)throw Error('Tệp vượt 100 MB.');
  pending.push({name:path,data:bytes,mime:mime||'application/octet-stream'});
  return path;
 }
 function period(){
  const p=window.WebInvoiceApp?.getPeriod?.()||{};
  const date=s=>{
   const raw=String(s||'');
   const iso=/^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
   if(iso)return iso[3]+iso[2]+iso[1];
   const vn=/^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
   return vn?vn[1]+vn[2]+vn[3]:'KhongRoNgay';
  };
  const mst=String(window.WebInvoiceApp?.getMst?.()||'').replace(/\D/g,'')||'KhongRoMST';
  const alias=document.querySelector('.mst-picker-card.selected .mst-picker-choice small')?.textContent?.trim()||
   (document.querySelector('#mst option:checked')?.value?document.querySelector('#mst option:checked')?.textContent?.replace(mst,'').replace(/^[-–\s]+/,'').trim():'')||
   (window.WebInvoiceApp?.getRows?.()||[]).find(x=>x.kind==='purchase')?.nmten||
   (window.WebInvoiceApp?.getRows?.()||[]).find(x=>x.kind==='sold')?.nbten||'TenMST';
  return {mst,from:date(p.from),to:date(p.to),alias:safe(alias).slice(0,75)};
 }
 function names(){
  const p=period(),base=p.mst+'_'+p.from+'_'+p.to;
  return {
   excel:'Bang_Thong_Ke_'+base+'.xlsx',
   xml:'XML_'+base+'.zip',html:'HTML_'+base+'.zip',
   pdfTax:'PDF_Dung_Tu_Thue_'+base+'.zip',
   pdf:'PDF_Goc_'+base+'.zip',
   all:p.mst+'_'+p.alias+'.zip'
  };
 }
 function isKind(file,kind){
  const n=file.name.toLowerCase();
  if(kind==='excel')return /\.xlsx$/i.test(n);
  if(kind==='xml')return /\.xml$/i.test(n);
  if(kind==='html')return /\.html?$/i.test(n);
  const tax=/^(?:pdf_thue_|pdf_dung_tu_thue\/|pdf_nguon_tu_cong_thue\/)/i.test(file.name);
  if(kind==='pdfTax')return /\.pdf$/i.test(n)&&tax;
  if(kind==='pdf')return /\.pdf$/i.test(n)&&!tax;
  return false;
 }
 function group(files,kind){
  const out=[],used=new Set();
  for(const f of files.filter(f=>isKind(f,kind))){
   const pieces=f.name.replace(/\\/g,'/').split('/').filter(Boolean);
   let name=basename(f.name);
   // Invoice-specific HTML packages often repeat the same "index.html" filename.
   if(kind==='html'&&pieces.length>2)name=safe(pieces.at(-2))+'_'+name;
   const dot=name.lastIndexOf('.'),stem=dot===-1?name:name.slice(0,dot),ext=dot===-1?'':name.slice(dot);
   let suffix=2;
   while(used.has(name.toLocaleLowerCase('vi-VN')))name=stem+'_'+suffix+++ext;
   used.add(name.toLocaleLowerCase('vi-VN'));
   out.push({name,data:f.data,originalPath:f.name});
  }
  return out;
 }
 function sourceText(kind,items,extra=''){
  const p=period();
  const source=kind==='pdfTax'?'PDF dựng từ dữ liệu hóa đơn do cổng Thuế cung cấp, KHÔNG PHẢI PDF GỐC.':
    kind==='xml'?'XML từ gói hóa đơn điện tử của cổng Thuế.':
    kind==='html'?'HTML được lấy từ dữ liệu gói tra cứu cổng Thuế.':
    'Bảng kê được AutoTax tạo từ dữ liệu tra cứu.';
  return [
   'AutoTax 1.1.22 - TONG HOP NGUON TEP',
   'Dinh dang: '+kind.toUpperCase(),
   'Ma so thue: '+p.mst,
   'Khoang ngay: '+p.from+' - '+p.to,
   'Nguon: https://hoadondientu.gdt.gov.vn/',
   source,
   'So tep: '+items.length,
   'Danh sach:',
   ...items.map(f=>'- '+f.name+' | '+f.originalPath),
   extra
  ].join('\r\n');
 }
 function category(files,kind){
  const entries=group(files,kind);
  if(!entries.length)throw Error('Không có dữ liệu '+kind.toUpperCase()+' để xuất.');
  return entries.map(f=>({name:f.name,data:f.data})).concat([{
   name:'THONG_TIN_NGUON.txt',data:enc.encode(sourceText(kind,entries,
    files.filter(f=>/nguon_pdf_ma_tra_cuu\.txt$/i.test(f.name)).map(f=>new TextDecoder().decode(f.data)).join('\n')))
  }]);
 }
 async function saveResult(files,label){
  const output=names(),storage=window.AutoTaxDownloadFolder;
  if(label==='excel'){
   const x=group(files,'excel');
   if(x.length!==1)throw Error('Mỗi lần xuất Excel cần đúng một tệp XLSX.');
   await storage.saveRootFile(output.excel,x[0].data,MIME_XLSX);
   return output.excel;
  }
  if(label==='all'||label==='TatCa'){
   const books=group(files,'excel');
   if(books.length!==1)throw Error('Gói tổng thiếu một bảng kê Excel.');
   const all=[{name:output.excel,data:books[0].data}];
   // Files inside each folder are flat; only one TXT summarizes provenance.
   // Both genuine issuer PDFs and PDFs rebuilt from tax data belong in the
   // combined archive. One unique source note per PDF category.
   const folders={pdfTax:'PDF',pdf:'PDF',xml:'XML',html:'HTML'};
   const used=new Set(all.map(item=>item.name.toLowerCase()));
   const addUnique=(requested,data)=>{
    const dot=requested.lastIndexOf('.'),stem=dot<0?requested:requested.slice(0,dot);
    const ext=dot<0?'':requested.slice(dot);
    let name=requested,suffix=2;
    while(used.has(name.toLowerCase()))name=stem+'_'+suffix+++ext;
    used.add(name.toLowerCase());all.push({name,data});
   };
   for(const [kind,folder] of Object.entries(folders)){
    try{
     for(const file of category(files,kind)){
      const fname=file.name==='THONG_TIN_NGUON.txt'&&folder==='PDF'?
       (kind==='pdfTax'?'THONG_TIN_NGUON_PDF_THUE.txt':'THONG_TIN_NGUON_PDF_GOC.txt'):
       file.name;
      addUnique(folder+'/'+fname,file.data);
     }
    }catch(e){console.warn('AutoTax: '+kind,e.message)}
   }
   all.push({name:'THONG_TIN_NGUON_EXCEL.txt',data:enc.encode(
    sourceText('excel',books,'Bang thong ke XLSX nam tai thu muc goc: '+output.excel))});
   await storage.saveRootArchive(output.all,window.Zip.writeZip(all));
   return output.all;
  }
  if(['xml','html','pdfTax','pdf'].includes(label)){
   const zip=window.Zip.writeZip(category(files,label));
   await storage.saveRootArchive(output[label],zip);
   return output[label];
  }
  if(!files.length)throw Error('Không có tệp xuất phiếu nhập kho.');
  const name='NhapHang_'+period().mst+'.zip';
  await storage.saveRootArchive(name,window.Zip.writeZip(files.map(f=>({name:basename(f.name),data:f.data}))));
  return name;
 }
 async function batch(job,label){
  if(pending)throw Error('Đang có phiên xuất dữ liệu khác.');
  if(!window.Zip?.writeZip||!window.AutoTaxDownloadFolder?.saveRootArchive||
    !window.AutoTaxDownloadFolder?.saveRootFile)throw Error('Chưa có bộ ZIP hoặc quyền lưu file.');
  pending=[];
  try{
   const result=await job();
   const files=pending;
   if(files.reduce((sum,f)=>sum+f.data.byteLength,0)>350*1024*1024)
    throw Error('Tổng dữ liệu vượt 350 MB. Hãy xuất theo tháng.');
   pending=null;
   window.WebInvoiceApp?.progress?.('Đang đóng gói và ghi tệp xuống thiết bị…');
   const written=await saveResult(files,label);
   window.WebInvoiceApp?.progress?.('Đã lưu hoàn tất: '+written);
   return result;
  }finally{pending=null}
 }
 const mark=()=>pending?pending.length:0;
 const rollback=n=>{if(pending&&Number.isInteger(n))pending.length=Math.max(0,Math.min(n,pending.length))};
 window.AutoTaxZipExport=Object.freeze({isCapturing:()=>pending!==null,capture,batch,mark,rollback});
})();
