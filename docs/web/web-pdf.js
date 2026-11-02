/* Web PDF downloader: original provider PDF first (only when a direct PDF URL is verified).
   Otherwise uses the GDT XML/detail data to generate a clearly labelled representation,
   NOT a legally original PDF issued by the invoice provider. */
(()=>{
'use strict';
const safe=v=>String(v||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,65);
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
 // First use original supplier PDF included in source files. No custom-rendered PDF is labelled original.
 let bytes=null;
 if(lookup.link){
  try{bytes=await readPdf(lookup.link)}catch{/* Provider may require CAPTCHA, cookies or block CORS. */}
 }
 if(bytes&&validPdf(bytes)){
  return {name:'PDF_goc_nha_phat_hanh/'+name+'.pdf',data:bytes,kind:'original'};
 }
 // PDF bundled with tax-portal files has unknown issuer provenance: keep it distinct.
 const bundled=fromSourceFiles(detail);
 if(bundled){
  return {name:'PDF_dinh_kem_du_lieu_CQT/'+name+'.pdf',data:bundled,kind:'tax_attachment',
   providerName:lookup.name||'',providerLink:lookup.link||'',lookupCode:lookup.code||''};
 }
 let input=detail,sourceRow=row,prefix='BanTheHien_GDT',sourceOriginal=false;
 if(row.gocRef){
  try{
   input=await window.HDDT.fetchOriginal(row,()=>false);
   sourceRow={...row,...row.gocRef};
   prefix='BanTheHien_HoaDonGoc_GDT';sourceOriginal=true;
  }catch{input=detail}
 }
 const rendered=await window.Pdf.buildInvoicePdf(sourceRow,input,window.HDDT.originalLookup(sourceRow,input.head));
 if(!validPdf(rendered))throw Error('Không dựng được bản thể hiện PDF hợp lệ.');
 return {name:prefix+'/'+name+'.pdf',data:rendered,kind:'representation',
  sourceOriginal,providerName:lookup.name||'',providerLink:lookup.link||'',lookupCode:lookup.code||''};
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
  sourceOriginals=results.filter(x=>x.sourceOriginal).length;
 if(!results.length)throw Error('Không tải được PDF nào. '+errors.slice(0,2).join('; '));
 const guide=[
  'AutoTax Web – PHAN BIET FILE PDF',
  'PDF_goc_nha_phat_hanh: Tap PDF goc lay truc tiep tu tep nha cung cap hoac duong dan PDF hop le.',
  'PDF_dinh_kem_du_lieu_CQT: PDF dinh kem voi du lieu cong Thue, CHUA XAC THUC nguon nha phat hanh.',
  'BanTheHien_GDT: Ban the hien PDF do AutoTax tu dung tu XML/JSON cong Thue, KHONG PHAI PDF GOC.',
  'BanTheHien_HoaDonGoc_GDT: Ban the hien tu du lieu hoa don goc tra duoc qua cong Thue.',
  'Neu nha cung cap yeu cau ma tra cuu/CAPTCHA ma khong cho phep tai PDF truc tiep,',
  'AutoTax khong the lay PDF goc mot cach chac chan. Link va ma tra cuu duoc liet ke ben duoi.',
  'Tong '+results.length+' tap PDF; goc nha phat hanh '+originals+'; ban the hien '+rendered+'; loi '+errors.length+'.'
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
 return {count:results.length,originals,rendered,attachments,sourceOriginals,errors};
}

window.WebPdfExport={create};
})();