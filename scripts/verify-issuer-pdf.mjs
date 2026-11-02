import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Pure offline regression: no invoice data ever leaves the process.
const page=fs.readFileSync('docs/web.html','utf8');
const pdf=fs.readFileSync('docs/web/web-pdf.js','utf8');
const issuer=fs.readFileSync('docs/web/issuer-pdf.js','utf8');
new vm.Script(pdf,{filename:'web-pdf.js'});
new vm.Script(issuer,{filename:'issuer-pdf.js'});
for(const id of ['issuerPdfFile','issuerPdfAttach','issuerPdfHelp','issuerPdfStatus']){
 assert(page.includes('id="'+id+'"'), 'Missing issuer dialog control: '+id);
}
const downloaded=[];
const session={user:{id:'account-1'}};
const ctx={window:{
 WebInvoiceApp:{
  getAccount:()=>session.user,
  progress:()=>{},
  async fetchDetail(){return {head:{}};},
  getMst:()=> '3600675874',
  download:(name,content,type)=>downloaded.push({name,content,type})
 },
 HDDT:{originalLookup:()=>({name:'MISA meInvoice',link:'',code:'TEST-CODE'})},
 Pdf:{buildInvoicePdf:()=>{throw Error('Must not build a representation for attached PDF');}},
 Zip:{writeZip:files=>files}
}};
vm.createContext(ctx);
vm.runInContext(pdf,ctx);
const api=ctx.window.WebPdfExport;
assert.equal(typeof api.attachUserPdf,'function');
assert.equal(typeof api.hasUserPdf,'function');
const row={kind:'purchase',form:'normal',nbmst:'3600675874',
 khmshdon:'1',khhdon:'C26TAA',shdon:'42'};
const bytes=vm.runInContext('new Uint8Array([37,80,68,70,45,49,46,55,10])',ctx);
const badBytes=vm.runInContext('new Uint8Array([60,104,116,109,108,62])',ctx);
assert.throws(()=>api.attachUserPdf(row,badBytes,'fake.pdf'),/PDF/);
assert.equal(api.hasUserPdf(row),false);
api.attachUserPdf(row,bytes,'downloaded.pdf');
assert.equal(api.hasUserPdf(row),true);
assert.equal(api.hasUserPdf({...row,shdon:'43'}),false,
 'Attached files must never bleed into a different invoice.');
const result=await api.create([row]);
assert.equal(result.originals,0,'User-supplied PDF must never be reported as verified issuer original.');
assert.equal(result.userSupplied,1);
assert.equal(result.rendered,0);
assert.equal(downloaded.length,1);
assert.equal(downloaded[0].type,'application/zip');
const files=downloaded[0].content;
assert(files.some(f=>f.name.startsWith('PDF_nguoi_dung_cung_cap_CHUA_XAC_MINH/')),
 'Unverified PDF must be in an explicitly labelled folder.');
assert(files.some(f=>f.name==='NGUON_PDF_MA_TRA_CUU.txt'));
assert(files.find(f=>f.name==='NGUON_PDF_MA_TRA_CUU.txt').data
 .includes('khong tu dong xac minh chu ky so'),'Provenance guide missing.');
session.user={id:'account-2'};
assert.equal(api.hasUserPdf(row),false,'Previously attached PDFs must not leak across signed-in accounts.');
assert.throws(()=>api.attachUserPdf({...row,shdon:''},bytes,'unbound.pdf'),/hóa đơn/);
console.log('Invoice issuer PDF local attachment, session scoping, validation and provenance tests passed.');
