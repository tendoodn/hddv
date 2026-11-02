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
const assist=read('autotax/src/content/issuer-assist.js');
const bytes=Uint8Array.from([37,80,68,70,45,49,46,55,10]);

assert.equal(manifest.version,'1.1.1');
assert(manifest.host_permissions.includes('https://*.kiotviet.vn/*'));
assert(manifest.host_permissions.includes('https://*.vinvoice.vn/*'));
assert(manifest.host_permissions.includes('https://*.viettel.vn/*'));
assert(manifest.host_permissions.includes('https://*.vnpt-invoice.com.vn/*'));
assert(manifest.content_scripts[0].js.includes('src/content/issuer-portals.js'));
assert(manifest.content_scripts.some(s=>s.js.includes('src/content/issuer-assist.js')&&
 s.matches.includes('https://*.kiotviet.vn/*')),
 'Authorized supplier portals need manual CAPTCHA-aware PDF helper.');
assert.equal(common,read('autotax/src/content/issuer-portals.js'));
assert(panel.includes('PDF gốc')&&panel.includes('21 cổng')&&
 panel.includes('id="issuerOpenNext"'));
assert(assist.includes("type:'issuer-assist-state'")&&assist.includes("type:'issuer-assist-download'")&&
 assist.includes('Tìm PDF sau khi xác thực'));
new vm.Script(assist,{filename:'autotax/src/content/issuer-assist.js'});

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

const port={window:{},URL};vm.createContext(port);vm.runInContext(common,port);
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
const sessionStore=new Map();
const chrome={
 sidePanel:{setPanelBehavior:()=>Promise.resolve(),setOptions:()=>Promise.resolve()},
 runtime:{onMessage:{addListener(){}}},
 tabs:{create:async({url})=>({id:46,url})},
 storage:{session:{
  get:async key=>({[key]:sessionStore.get(key)}),
  set:async values=>{for(const [key,val] of Object.entries(values))sessionStore.set(key,val)},
  remove:async key=>{sessionStore.delete(key)}
 }}
};
const fetch=async(url,options)=>{
 seen.push({url,options});
 return {ok:true,headers:{get:()=>null},body:null,arrayBuffer:async()=>bytes.buffer};
};
const context={chrome,URL,fetch,AbortSignal,Uint8Array,Error,Array,Number,String,
 Set,Promise,TextEncoder,btoa};vm.createContext(context);
vm.runInContext(worker+'\nthis.testAPI={issuerPdfURL,fetchIssuerPdf,issuerAdd,issuerQueue,issuerOpenNext,issuerSession}',context);
const api=context.testAPI;
assert.throws(()=>api.issuerPdfURL('https://attacker.example/a.pdf'),/được phép/);
assert.throws(()=>api.issuerPdfURL('http://tracuuhoadon.kiotviet.vn/a.pdf'),/được phép/);
assert.throws(()=>api.issuerPdfURL('https://tracuuhoadon.kiotviet.vn/tra-cuu'),/chưa phải/);
const res=await api.fetchIssuerPdf('https://tracuuhoadon.kiotviet.vn/sample.pdf');
assert.equal(res.ok,true);
assert.equal(atob(res.pdfBase64).slice(0,5),'%PDF-');
assert.equal(seen[0].options.credentials,'omit');
assert.equal(seen[0].options.redirect,'error');
// Sensitive lookup codes are queued only from a GDT tab, per MST, and
// exposed only to an issuer-tab whose domain matches the original supplier.
await assert.rejects(api.issuerAdd({ownerMst:'3600675874',
 link:'https://tracuuhoadon.kiotviet.vn/',code:'TEST-ABC'},
 {url:'https://attacker.example/x'}),/trang Thuế/);
await api.issuerAdd({ownerMst:'3600675874',invoice:'C26_1',
 link:'https://tracuuhoadon.kiotviet.vn/',code:'TEST-ABC'},
 {url:'https://hoadondientu.gdt.gov.vn/tra-cuu'});
const queued=await api.issuerQueue();
assert.equal(queued.length,1);
assert.equal(queued[0].ownerMst,'3600675874');
const opened=await api.issuerOpenNext('3600675874');
assert.equal(opened.ok,true);
assert.equal(opened.tabId,46);
const session=await api.issuerSession({tab:{id:46},
 url:'https://tracuuhoadon.kiotviet.vn/xem-hoa-don'});
assert.equal(session.code,'TEST-ABC');
await assert.rejects(api.issuerSession({tab:{id:46},
 url:'https://www.meinvoice.vn/tra-cuu/'}),/không cùng nhà phát hành/);
await api.fetchIssuerPdf('https://tracuuhoadon.kiotviet.vn/sample.pdf',true);
assert.equal(seen.at(-1).options.credentials,'include');
assert.equal(seen.at(-1).options.redirect,'error');
console.log('V1.1.1: 21 suppliers, authenticated issuer-tab queue, PDF headers, CAPTCHA handoff, and fallback passed.');
