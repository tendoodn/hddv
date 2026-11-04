/* AutoTax V1.1.20a — local PDF viewer; never labels rebuilt PDFs as originals. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 let generation=0,url='',bytes=null,filename='';
 function clear(){
  generation++;
  const frame=$('invoicePdfPreviewFrame');
  if(frame){frame.removeAttribute('src');frame.hidden=true}
  if(url)URL.revokeObjectURL(url);
  url='';bytes=null;filename='';
  const download=$('downloadInvoicePdfPreview');if(download)download.disabled=true;
 }
 async function open(row){
  const dialog=$('invoicePdfPreviewDialog'),frame=$('invoicePdfPreviewFrame');
  const status=$('invoicePdfPreviewStatus'),download=$('downloadInvoicePdfPreview');
  const meta=$('invoicePdfPreviewMeta');
  if(!dialog||!frame||!status||!download||!meta||!row)return;
  clear();
  const request=++generation;
  status.hidden=false;status.textContent='Đang dựng bản thể hiện PDF…';
  meta.textContent='Bản dựng từ dữ liệu Thuế · Không phải PDF gốc';
  if(!dialog.open)dialog.showModal();
  try{
   const app=window.WebInvoiceApp;
   if(!app?.fetchDetail||!window.Pdf?.buildInvoicePdf)throw Error('Bộ dựng PDF chưa khởi tạo.');
   const detail=await app.fetchDetail(row);
   if(request!==generation||!dialog.open)return;
   const lookup=window.HDDT?.originalLookup?.(row,detail?.head)||{};
   const output=await window.Pdf.buildInvoicePdf(row,detail,lookup);
   if(request!==generation||!dialog.open)return;
   if(!(output instanceof Uint8Array)||output.length<5||
    String.fromCharCode(...output.subarray(0,5))!=='%PDF-')
    throw Error('Không dựng được bản PDF hợp lệ.');
   bytes=output;
   filename=[row.nbmst||'MST',row.khhdon||'',row.shdon||'']
    .filter(Boolean).join('_').replace(/[^\w.-]/g,'_')+'_BAN_DUNG.pdf';
   url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   frame.src=url+'#view=FitH';frame.hidden=false;
   status.hidden=true;download.disabled=false;
   meta.textContent=[row.khhdon,row.shdon].filter(Boolean).join(' / ')+' · Bản dựng, không phải PDF gốc';
  }catch(error){
   if(request===generation&&dialog.open){
    status.textContent='Không xem được PDF: '+(error.message||String(error));
    status.hidden=false;
   }
  }
 }
 function init(){
  const dialog=$('invoicePdfPreviewDialog'),close=$('closeInvoicePdfPreview');
  const download=$('downloadInvoicePdfPreview');if(!dialog||!close||!download)return;
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',clear);
  download.addEventListener('click',()=>{
   if(!bytes||!url)return;
   const a=document.createElement('a');a.href=url;a.download=filename;
   document.body.append(a);a.click();a.remove();
  });
  window.addEventListener('pagehide',clear);
 }
 window.WebPdfPreview={open};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();