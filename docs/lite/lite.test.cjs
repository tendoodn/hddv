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
for(const label of ['Trở lại trang chủ','Tra Cứu','Dừng','Xem PDF','Ngày ký','Tên đối tác','Tổng thanh toán','Mua vào','Bán ra']){
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
console.log('AutoTax Lite static checks PASSED: shared auth, PDF, pagination and lean bundle.');
