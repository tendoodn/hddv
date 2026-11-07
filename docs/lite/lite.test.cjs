/* Static regression checks for the lightweight view.
   Offline: no real users, tax credentials, invoice quota or GDT traffic. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('lite/index.html');
const css=read('lite/lite.css');
const ui=read('lite/lite.js');
const web=read('web/web.js');
const results=read('web/web-results.js');
const home=read('index.html');
assert.match(html,/window\.AutoTaxLite=true/);
assert.match(html,/<script src="\.\.\/lite\/lite\.js\?/,'Lite bootstrap script is mandatory');
assert.match(html,/<\/body><\/html>\s*$/,'Lite HTML must end with closing tags');
assert.match(html,/href="https:\/\/tracuuhoadon\.top\/lite\/"/);
assert.match(home,/id="webLiteNow"[^>]*href="\/lite\/"/);
assert.match(home,/#webAccountModeSlot\{[^}]*flex-flow:row nowrap/);
for(const asset of [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(\.\.\/[^"]+)"/g)]){
 const filename=asset[1].split('?')[0];
 assert(fs.existsSync(path.resolve(root,'lite',filename)), 'Missing Lite asset: '+filename);
}
assert.match(html,/id="liteHome"[^>]*>Trở lại trang chủ<\/a>/,'Red home shortcut must be next to Lite logo');
assert.match(css,/#mstPickerMenu:not\(\[hidden\]\)/,'MST drawer must span the mobile viewport');
assert.match(css,/#liteHome\{[^}]*background:#9a1730!important/,'Back-home button must be red');
assert.match(home,/#webLiteNow\{background:#126b36!important/,'Lite shortcut on Home must be green');
assert.match(home,/#extensionHeaderDownloadBtn\.autotax-extension-cta\{border-color:#27cf72!important/,'Extension CTA must be green');
for(const label of ['Tra Cứu','Dừng','Xem PDF','Ngày ký','Tên đối tác','Tổng thanh toán','Mua vào','Bán ra']){
 assert(ui.includes(label), 'Missing Lite action or label: '+label);
}
assert.match(ui,/pageSize=10/);
assert.match(ui,/value="10"/);
assert.match(ui,/value="20"/);
assert.match(ui,/value="30"/);
assert.match(ui,/WebPdfPreview\?\.open/);
assert.match(ui,/autotax-lite-results/);
assert.match(ui,/requestedDetails/);
assert.match(css,/#downloadInvoicePdfPreview\{display:none!important\}/);
assert.match(web,/if\(!window\.AutoTaxLite\)\{/);
assert.match(web,/if\(!window\.AutoTaxLite\)void loadDetails/);
assert.match(results,/if\(!window\.AutoTaxLite\)updateStock\(\)/);
for(const absent of ['../web/report.js','../web/xlsx.js','../web/tendoo-import.js','../web/export-zip.js','../web/download-folder.js']){
 assert(!html.includes('<script src="'+absent), 'Heavy export script must not load in Lite: '+absent);
}
const accountModal=read('web/account-modal.js');
const cache=read('web/invoice-cache-v120.js');
for(const [name,markup] of [['Web',home],['Lite',html]]){
 assert(markup.indexOf('<div class="web-settings-wrap">')<markup.indexOf('<img id="webAvatar"'),
  name+' settings gear must appear before avatar');
 assert.match(markup,/web-greeting-text/,'Long greeting text needs marquee span');
 assert.match(markup,/autotax-mobile-layout-fix-120/,'Responsive mobile account layout required');
 assert.match(markup,/release-notice-v128\.js\?v=1200/,'Existing V1.2.0 notice must be preserved');
}
assert.match(html,/autotax-lite-actions-120/,'Lite must show grant, renew and usage on row two');
assert.match(home,/PDF hóa đơn có phải bản gốc\?/);
assert.match(home,/mã xác nhận ở chân hóa đơn/);
assert.match(accountModal,/positionAccountMenu\(/,'Settings menu should be positioned above overlays');
assert.match(accountModal,/web-greeting-long/,'Long greeting should scroll');
assert.match(cache,/DETAIL_RETENTION_DAYS=30/,'Local invoice detail cache must last 30 days');
assert.match(web,/form_code:\(row\.form\|\|''\)\+':'\+\(row\.khmshdon\|\|''\)/,'Keep safe invoice identity');
assert.match(web,/const unique=new Map\(\)/,'Deduplicate network quota claims');
// The mobile viewer JS was already present, but without these DOM targets every
// PDF click silently returned before displaying a dialog.
for(const [name,markup] of [['Web',home],['Lite',html]]){
 for(const id of ['invoicePdfPreviewDialog','invoicePdfCanvasPages',
    'invoicePdfPreviewStatus','invoicePdfPreviewFrame',
    'downloadInvoicePdfPreview','closeInvoicePdfPreview']){
  assert(markup.includes('id="'+id+'"'),name+' missing PDF viewer target '+id);
 }
 assert.match(markup,/autotax-pdf-preview-mobile-v120/,'PDF mobile canvas styling required');
 assert.match(markup,/autotax-tight-mobile-identity-v120/,'Compact mobile greeting required');
 assert.match(markup,/href="\/tracuumst\/"/,'MST navigation must point to the new route');
}
const pdfViewer=read('web/pdf-preview-v120a.js');
assert.match(pdfViewer,/WebInvoiceApp/,'Viewer must use the canonical invoice detail loader');
assert.match(pdfViewer,/pdfjs-dist@6\.5\.438/,'Canvas preview must load PDF.js on mobile');
const taxpayerLookup=read('tracuumst/index.html');
assert.match(taxpayerLookup,/\.\.\/web\/mst-lookup\.js/,'The /tracuumst route must load its correct relative scripts');
assert.match(read('mst.html'),/location\.replace\('\/tracuumst\//,'Legacy MST URL must redirect');
const portal=read('user/index.html'),checkout=read('customer.js');
assert.match(portal,/autotax-user-mobile-head-tight-v120/,'Mobile account settings alignment required');
assert.match(portal,/paymentSuccessAutoClose/,'Payment confirmation must show countdown');
assert.match(portal,/autotax-payment-success-green-v120/,'Paid modal must be green');
assert.match(checkout,/paymentSuccessTimer=setTimeout\(closePaymentSuccess,5000\)/,'Paid confirmation must close after 5 seconds');
const intro=read('gioi-thieu/index.html');
assert.match(intro,/AutoTax · V1\.2\.0/,'Current introduction version must match');
assert.match(intro,/\/tracuumst\//,'Intro must link to taxpayer lookup');
console.log('AutoTax Lite static checks PASSED: shared auth, PDF, pagination and lean bundle.');
