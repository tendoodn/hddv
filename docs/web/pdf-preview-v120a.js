/* AutoTax V1.1.20a — local PDF viewer; never labels rebuilt PDFs as originals. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 let generation=0,url='',bytes=null,filename='';
 function clear(){
  generation++;
  const frame=$('invoicePdfPreviewFrame');
  if(frame){frame.removeAttribute('src');frame.hidden=true}
  const canvasHost=$('invoicePdfCanvasPages');if(canvasHost){canvasHost.replaceChildren();canvasHost.hidden=true}
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
   // Mobile Chromium frequently has no PDF iframe plugin. Render every page
   // with PDF.js onto HTML canvas so it also works in Android browsers.
   const canvasHost=$('invoicePdfCanvasPages');
   if(!canvasHost)throw Error('Chưa tải được bộ xem PDF.');
   canvasHost.replaceChildren();canvasHost.hidden=false;
   frame.hidden=true;
   status.textContent='Đang hiển thị PDF trực tiếp…';
   try{
    const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    const doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;
    for(let n=1;n<=doc.numPages;n++){
      if(request!==generation||!dialog.open)break;
      const page=await doc.getPage(n);
      const viewport=page.getViewport({scale:1});
      const width=Math.max(220,Math.min(canvasHost.clientWidth||window.innerWidth-30,1100));
      const renderScale=width/viewport.width;
      const scaled=page.getViewport({scale:renderScale});
      const pixelRatio=Math.min(window.devicePixelRatio||1,2);
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(scaled.width*pixelRatio);
      canvas.height=Math.ceil(scaled.height*pixelRatio);
      canvas.style.width='100%';canvas.style.height='auto';
      canvas.setAttribute('aria-label','Trang PDF '+n);
      canvasHost.append(canvas);
      const ctx=canvas.getContext('2d',{alpha:false});
      await page.render({canvasContext:ctx,viewport:scaled,transform:
        [pixelRatio,0,0,pixelRatio,0,0]}).promise;
    }
    if(request===generation)status.hidden=true;
   }catch(pdfError){
    // Fall back to native iframe for desktop, and retain download on mobile.
    canvasHost.hidden=true;
    frame.src=url+'#view=FitH';frame.hidden=false;
    status.hidden=false;
    status.textContent='Trình duyệt chưa tải được bộ xem PDF trực tiếp. Có thể tải PDF bằng nút phía trên.';
    console.warn('PDF.js preview unavailable:',pdfError);
   }
   download.disabled=false;
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