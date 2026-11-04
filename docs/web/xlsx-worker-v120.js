/* AutoTax 1.1.20 — build XLSX in a dedicated thread to avoid freezing UI. */
self.window=self;
importScripts('./zip.js','./xlsx.js');
self.onmessage=event=>{
 try{
  const out=self.Xlsx.buildXlsx(event.data.sheets);
  if(!(out instanceof Uint8Array)||out.byteLength===0)throw Error('Empty workbook');
  self.postMessage({ok:true,data:out.buffer},[out.buffer]);
 }catch(error){
  self.postMessage({ok:false,error:String(error?.message||error)});
 }
};
