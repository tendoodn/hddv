import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const manifest=JSON.parse(read('autotax/manifest.json'));
const worker=read('autotax/src/background/service-worker.js');
const content=read('autotax/src/content/content.js');
const panel=read('autotax/src/sidepanel/index.html');
const panelJs=read('autotax/src/sidepanel/panel.js');
const webPdf=read('docs/web/web-pdf.js');
const mime=Uint8Array.from([37,80,68,70,45,49,46,55,10]);
assert.equal(manifest.version,'3.4.0');
assert(manifest.permissions.includes('permissions'));
assert(manifest.optional_host_permissions.length>=6);
assert(panel.includes('id="issuerPdfPermission"'));
assert(panel.includes('PDF gốc')&&panelJs.includes('chrome.permissions.request({origins})'));
assert(content.includes("type: 'fetch-issuer-pdf'")&&
 content.includes('PDF_Goc_Nha_Phat_Hanh/')&&
 content.includes('PDF_Chua_Tai_Goc/')&&
 !content.includes('Pdf.buildInvoicePdf(row, inv'),
 'Extension must download actual issuer PDF or produce missing-source guide.');
assert(webPdf.includes('PDF_goc_nha_phat_hanh')&&
 !webPdf.includes('window.Pdf.buildInvoicePdf('),
 'Web must not fabricate supplier PDF originals.');
for(const [path,source] of [
 ['autotax/src/background/service-worker.js',worker],
 ['autotax/src/content/content.js',content],
 ['docs/web/web-pdf.js',webPdf]])new vm.Script(source,{filename:path});

const seen=[];
const chrome={
 sidePanel:{setPanelBehavior:()=>Promise.resolve(),setOptions:()=>Promise.resolve()},
 permissions:{contains:async({origins})=>origins.includes('https://www.meinvoice.vn/*')},
 runtime:{onMessage:{addListener(){}}}
};
const goodPdfFetch=async (url,options)=>{
 seen.push({url,options});
 return {ok:true,headers:{get:()=>null},body:null,arrayBuffer:async()=>mime.buffer};
};
const context={chrome,URL,fetch:goodPdfFetch,AbortSignal,Uint8Array,Error,
 Array,Number,String,Set,Promise,TextEncoder,btoa};
vm.createContext(context);
vm.runInContext(worker+'\nthis.testAPI={issuerPdfURL,fetchIssuerPdf}',context);
const api=context.testAPI;
assert.throws(()=>api.issuerPdfURL('http://www.meinvoice.vn/file.pdf'),/được phép|không hợp lệ/i);
assert.throws(()=>api.issuerPdfURL('https://attacker.example/fake.pdf'),/được phép/i);
assert.throws(()=>api.issuerPdfURL('https://www.meinvoice.vn/tra-cuu'),/chưa phải/i);
const response=await api.fetchIssuerPdf('https://www.meinvoice.vn/invoices/sample.pdf');
assert.equal(response.ok,true);
assert.equal(response.origin,'www.meinvoice.vn');
assert.equal(seen[0].options.credentials,'omit');
assert.equal(seen[0].options.redirect,'error');
assert.equal(seen[0].options.method,'GET');
assert.equal(seen.length,1);
assert.equal(atob(response.pdfBase64).slice(0,5),'%PDF-');
await assert.rejects(api.fetchIssuerPdf('https://vinvoice.viettel.vn/file.pdf'),/Chưa cấp quyền/);
assert.equal(seen.length,1,'No fetch when optional issuer permission missing.');
console.log('AutoTax 3.4 Chrome issuer-PDF permissions, allowlist, original signature and missing-source policy passed.');
