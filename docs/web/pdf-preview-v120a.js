/* AutoTax V1.1.20a — local PDF viewer; never labels rebuilt PDFs as originals. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 let generation=0,url='',bytes=null,filename='',zoom=1;
 const ZOOM_MIN=.6,ZOOM_MAX=3;
 function applyZoom(next){
  zoom=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,Number(next)||1));
  const host=$('invoicePdfCanvasPages');
  host?.querySelectorAll('canvas[data-base-width]').forEach(canvas=>{
   canvas.style.width=(Number(canvas.dataset.baseWidth)*zoom)+'px';
  });
  const label=$('invoicePdfZoomValue');if(label)label.textContent=Math.round(zoom*100)+'%';
 }
 function clear(){
  generation++;
  const frame=$('invoicePdfPreviewFrame');
  if(frame){frame.removeAttribute('src');frame.hidden=true}
  const canvasHost=$('invoicePdfCanvasPages');if(canvasHost){canvasHost.replaceChildren();canvasHost.hidden=true}
  if(url)URL.revokeObjectURL(url);
  url='';bytes=null;filename='';zoom=1;applyZoom(1);
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
    // Do not rely on Android's missing built-in PDF plug-in. Render PDF
    // pixels with Mozilla PDF.js as canvas inside the current page.
    const locations=[
      ['https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.mjs',
       'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.mjs'],
      ['https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.mjs',
       'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.worker.mjs'],
      ['https://unpkg.com/pdfjs-dist@6.5.438/legacy/build/pdf.mjs',
       'https://unpkg.com/pdfjs-dist@6.5.438/legacy/build/pdf.worker.mjs']
    ];
    let doc=null,lastError=null;
    for(const [script,worker] of locations){
      try{
        const pdfjs=await import(script);
        pdfjs.GlobalWorkerOptions.workerSrc=worker;
        doc=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
        break;
      }catch(error){lastError=error;console.warn('Đổi nguồn hiển thị PDF:',error.message)}
    }
    if(!doc)throw lastError||Error('Không tải được PDF.js.');
    for(let n=1;n<=doc.numPages;n++){
      if(request!==generation||!dialog.open)break;
      const page=await doc.getPage(n);
      const viewport=page.getViewport({scale:1});
      const width=Math.max(220,Math.min(canvasHost.clientWidth||window.innerWidth-30,1100));
      const renderScale=width/viewport.width;
      const scaled=page.getViewport({scale:renderScale});
      // V1.2.2: render sharper text while keeping a per-page memory ceiling.
      const pixelRatio=Math.max(1,Math.min(window.devicePixelRatio||1,3,
        Math.sqrt(16000000/Math.max(1,scaled.width*scaled.height))));
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(scaled.width*pixelRatio);
      canvas.height=Math.ceil(scaled.height*pixelRatio);
      canvas.dataset.pdfWidth=String(viewport.width);
      canvas.dataset.baseWidth=String(scaled.width);
      canvas.style.width=(scaled.width*zoom)+'px';canvas.style.height='auto';
      canvas.setAttribute('aria-label','Trang PDF '+n);
      canvasHost.append(canvas);
      const ctx=canvas.getContext('2d',{alpha:false});
      await page.render({canvasContext:ctx,viewport:scaled,transform:
        [pixelRatio,0,0,pixelRatio,0,0]}).promise;
      page.cleanup();
    }
    if(request===generation){
     // At 100%, always fit the PDF to the current viewer width. This also
     // makes orientation changes/resizes adapt to the user's screen ratio.
     const fit=()=>{
      if(zoom!==1||!canvasHost?.clientWidth)return;
      const target=Math.max(220,Math.min(canvasHost.clientWidth-8,1100));
      canvasHost.querySelectorAll('canvas[data-base-width]').forEach(canvas=>{
       canvas.dataset.baseWidth=String(target);
       canvas.style.width=target+'px';
      });
     };
     fit();
     status.hidden=true;
    }
   }catch(pdfError){
    // On mobile do NOT show a native PDF iframe: it asks users to install a
    // plugin even though a PDF blob is already available for download.
    canvasHost.hidden=true;
    const mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)||
      window.matchMedia('(pointer:coarse)').matches;
    if(!mobile){frame.src=url+'#view=FitH';frame.hidden=false;}
    else{frame.removeAttribute('src');frame.hidden=true;}
    status.hidden=false;
    status.textContent=mobile?
      'Chế độ xem PDF chưa tải được. Bạn có thể bấm “Tải PDF” để xem bằng trình đọc tệp trên điện thoại, không cần cài plugin.' :
      'Bộ xem PDF trực tiếp chưa tải được; đang thử bộ xem tích hợp hoặc tải PDF phía trên.';
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
  const canvasHost=$('invoicePdfCanvasPages');
  // Always show an explicit text action; old cached builds used a narrow "×" button.
  close.textContent='Đóng';
  close.setAttribute('aria-label','Đóng trình xem PDF');
  const actions=dialog.querySelector('.invoice-pdf-actions,.invoice-pdf-buttons')||close.parentElement;
  if(actions&&!$('invoicePdfZoomOut')){
   const group=document.createElement('span');group.className='invoice-pdf-zoom';
   group.innerHTML='<button id="invoicePdfZoomOut" type="button" aria-label="Thu nhỏ PDF">−</button><output id="invoicePdfZoomValue" aria-live="polite">100%</output><button id="invoicePdfZoomIn" type="button" aria-label="Phóng to PDF">+</button><button id="invoicePdfZoomReset" type="button">Vừa trang</button>';
   actions.insertBefore(group,download);
   $('invoicePdfZoomOut').addEventListener('click',()=>applyZoom(zoom-.2));
   $('invoicePdfZoomIn').addEventListener('click',()=>applyZoom(zoom+.2));
   $('invoicePdfZoomReset').addEventListener('click',()=>applyZoom(1));
  }
  // Installed Lite PWA: two fingers zoom only the PDF canvas. The dialog stays
  // fixed to the viewport, while one-finger drag continues to scroll the pages.
  if(canvasHost&&!canvasHost.dataset.pinchReady){
   canvasHost.dataset.pinchReady='1';
   let pinch=null;
   const distance=touches=>{
    const [a,b]=touches;return Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
   };
   const center=touches=>({
    x:(touches[0].clientX+touches[1].clientX)/2,
    y:(touches[0].clientY+touches[1].clientY)/2
   });
   canvasHost.addEventListener('touchstart',event=>{
    if(event.touches.length!==2)return;
    const mid=center(event.touches),rect=canvasHost.getBoundingClientRect();
    pinch={
     dist:Math.max(1,distance(event.touches)),
     zoom,
     localX:mid.x-rect.left,
     localY:mid.y-rect.top,
     contentX:(canvasHost.scrollLeft+mid.x-rect.left)/Math.max(.01,zoom),
     contentY:(canvasHost.scrollTop+mid.y-rect.top)/Math.max(.01,zoom)
    };
    event.preventDefault();event.stopPropagation();
   },{passive:false});
   canvasHost.addEventListener('touchmove',event=>{
    if(!pinch||event.touches.length!==2)return;
    const next=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,
      pinch.zoom*distance(event.touches)/pinch.dist));
    applyZoom(next);
    canvasHost.scrollLeft=Math.max(0,pinch.contentX*zoom-pinch.localX);
    canvasHost.scrollTop=Math.max(0,pinch.contentY*zoom-pinch.localY);
    event.preventDefault();event.stopPropagation();
   },{passive:false});
   const endPinch=event=>{
    if(event.touches?.length>=2)return;
    pinch=null;
    if(event.cancelable)event.preventDefault();
    event.stopPropagation();
   };
   canvasHost.addEventListener('touchend',endPinch,{passive:false});
   canvasHost.addEventListener('touchcancel',endPinch,{passive:false});
   let gestureStartZoom=1;
   canvasHost.addEventListener('gesturestart',event=>{
    gestureStartZoom=zoom;event.preventDefault();event.stopPropagation();
   },{passive:false});
   canvasHost.addEventListener('gesturechange',event=>{
    applyZoom(gestureStartZoom*(Number(event.scale)||1));
    event.preventDefault();event.stopPropagation();
   },{passive:false});
   canvasHost.addEventListener('gestureend',event=>{
    event.preventDefault();event.stopPropagation();
   },{passive:false});
  }
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',clear);
  download.addEventListener('click',()=>{
   if(!bytes||!url)return;
   const a=document.createElement('a');a.href=url;a.download=filename;
   document.body.append(a);a.click();a.remove();
  });
  let resizeTimer=0;
  window.addEventListener('resize',()=>{
   clearTimeout(resizeTimer);
   resizeTimer=setTimeout(()=>{
    if(zoom!==1||!canvasHost||canvasHost.hidden)return;
    const target=Math.max(220,Math.min(canvasHost.clientWidth-8,1100));
    canvasHost.querySelectorAll('canvas[data-base-width]').forEach(canvas=>{
     canvas.dataset.baseWidth=String(target);
     canvas.style.width=target+'px';
    });
   },80);
  },{passive:true});
  window.addEventListener('pagehide',clear);
 }
 window.WebPdfPreview={open};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();