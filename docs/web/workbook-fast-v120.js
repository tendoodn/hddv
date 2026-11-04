/* AutoTax 1.1.20 — worker-backed XLSX export, safe synchronous fallback. */
(()=>{
 'use strict';
 const scriptUrl=document.currentScript?.src||'';
 const workerUrl=scriptUrl?new URL('./xlsx-worker-v120.js',scriptUrl).href:'';
 async function build(sheets){
  if(!workerUrl||typeof Worker!=='function')return window.Xlsx.buildXlsx(sheets);
  let worker;
  try{worker=new Worker(workerUrl)}catch{return window.Xlsx.buildXlsx(sheets)}
  try{
   return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Worker XLSX timeout')),120000);
    worker.onmessage=event=>{
     clearTimeout(timer);
     const payload=event.data;
     if(payload?.ok&&payload.data)resolve(new Uint8Array(payload.data));
     else reject(Error(payload?.error||'Worker XLSX failed'));
    };
    worker.onerror=event=>{clearTimeout(timer);reject(Error(event?.message||'Worker XLSX failed'))};
    worker.postMessage({sheets});
   });
  }catch(error){
   console.warn('AutoTax XLSX worker fallback:',error.message);
   return window.Xlsx.buildXlsx(sheets);
  }finally{worker.terminate()}
 }
 window.AutoTaxFastWorkbook=Object.freeze({build});
})();
