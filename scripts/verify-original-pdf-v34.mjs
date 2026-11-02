import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const manifest=JSON.parse(read('autotax/manifest.json'));
const worker=read('autotax/src/background/service-worker.js');
const addon=read('autotax/src/content/content.js');
const web=read('docs/web/web-pdf.js');
const common=read('docs/web/issuer-portals.js');
const panel=read('autotax/src/sidepanel/index.html');
const bytes=Uint8Array.from([37,80,68,70,45,49,46,55,10]);

assert.equal(manifest.version,'1.1.0');
assert(manifest.host_permissions.includes('https://*.kiotviet.vn/*'));
assert(manifest.host_permissions.includes('https://*.vinvoice.vn/*'));
assert(manifest.host_permissions.includes('https://*.viettel.vn/*'));
assert(manifest.host_permissions.includes('https://*.vnpt-invoice.com.vn/*'));
assert(manifest.content_scripts[0].js.includes('src/content/issuer-portals.js'));
assert.equal(common,read('autotax/src/content/issuer-portals.js'));
assert(panel.includes('PDF gốc')&&panel.includes('21 cổng'));

for(const [path,js] of [
 ['docs/web/web-pdf.js',web],['docs/web/issuer-portals.js',common],
 ['autotax/src/content/content.js',addon],
 ['autotax/src/background/service-worker.js',worker]])
 new vm.Script(js,{filename:path});
assert(web.includes('decision.shouldReconstruct')&&
 web.includes('window.Pdf.buildInvoicePdf(row,detail,lookup)')&&
 web.includes('PDF_DUNG_LAI_TU_DU_LIEU_CQT_KHONG_PHAI_GOC'));
assert(addon.includes('decision.shouldReconstruct')&&
 addon.includes('Pdf.buildInvoicePdf(row,inv,source)')&&
 addon.includes('PDF_Dung_Lai_Tu_CQT_Khong_Phai_Goc'));
assert(addon.includes('PDF_Chua_Lay_Duoc_Goc')&&
 web.includes('Link tra cứu: '),'Link/code must be reported for issuer failures.');

const port={window:{}};vm.createContext(port);vm.runInContext(common,port);
const catalog=port.window.IssuerPortals;
assert.equal(catalog.sources.length,21);
for(const x of catalog.sources){
 if(!x.portal)continue;
 assert.equal(catalog.describe(x.portal)?.id,x.id,x.name);
}
assert.equal(catalog.describe('https://vinvoice.viettel.vn/utilities/invoice-search')?.id,'viettel');
assert.equal(catalog.describe('https://tracuu.vinvoice.vn/')?.id,'megabiz');
assert.equal(catalog.describe('https://tenant.vnpt-invoice.com.vn/Portal/Index')?.id,'vnpt');
assert.equal(catalog.describe('https://tracuuhoadon.kiotviet.vn/')?.id,'kiotviet');
assert.equal(catalog.route({link:'https://tracuuhoadon.kiotviet.vn/',code:'ABCD'}).shouldReconstruct,false);
assert.equal(catalog.route({link:'https://tracuuhoadon.kiotviet.vn/',code:''}).shouldReconstruct,true);
assert.equal(catalog.route({link:'',code:'ABCD'}).shouldReconstruct,true);
assert.equal(catalog.route({link:'https://other-issuer.example/portal',code:'ABCD'}).shouldReconstruct,false);
assert.equal(catalog.route({link:'https://other-issuer.example/file.pdf',code:''}).directPdf,true);
assert.equal(catalog.route({link:'http://127.0.0.1/x',code:'123'}).hasLookup,false);

// Simulate direct issuer PDF service worker; no cookies or redirects.
const seen=[];
const chrome={sidePanel:{setPanelBehavior:()=>Promise.resolve(),setOptions:()=>Promise.resolve()},
 runtime:{onMessage:{addListener(){}}}};
const fetch=async(url,options)=>{
 seen.push({url,options});
 return {ok:true,headers:{get:()=>null},body:null,arrayBuffer:async()=>bytes.buffer};
};
const context={chrome,URL,fetch,AbortSignal,Uint8Array,Error,Array,Number,String,
 Set,Promise,TextEncoder,btoa};vm.createContext(context);
vm.runInContext(worker+'\nthis.testAPI={issuerPdfURL,fetchIssuerPdf}',context);
const api=context.testAPI;
assert.throws(()=>api.issuerPdfURL('https://attacker.example/a.pdf'),/cho phép/);
assert.throws(()=>api.issuerPdfURL('http://tracuuhoadon.kiotviet.vn/a.pdf'),/cho phép/);
assert.throws(()=>api.issuerPdfURL('https://tracuuhoadon.kiotviet.vn/tra-cuu'),/chưa phải/);
const res=await api.fetchIssuerPdf('https://tracuuhoadon.kiotviet.vn/sample.pdf');
assert.equal(res.ok,true);
assert.equal(atob(res.pdfBase64).slice(0,5),'%PDF-');
assert.equal(seen[0].options.credentials,'omit');
assert.equal(seen[0].options.redirect,'error');
console.log('V1.1: 21 supplier domains incl KiotViet, issuer-first and reconstructed-only-if-missing routing passed.');
