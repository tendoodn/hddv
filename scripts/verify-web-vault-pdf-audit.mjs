import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const html=read('docs/web.html'),admin=read('docs/admin.html'),mst=read('docs/admin-mst.js'),
 vault=read('docs/web/vault.js'),pdf=read('docs/web/web-pdf.js'),
 renderer=read('docs/web/pdf.js'),audit=read('docs/web/audit.js'),
 results=read('docs/web/web-results.js'),main=read('docs/web/web.js'),
 report=read('autotax/src/content/report.js');
for(const id of ['mst','mstPickerToggle','mstPickerMenu','mstForgetPassword',
 'invoiceAuditDialog','invoiceAuditRows','invoiceAuditSummary','closeInvoiceAudit','exportPdf','exportPdfTax']){
 assert(html.includes('id="'+id+'"'),'Missing Web control '+id);
}
assert(!html.includes('id="vaultPassphrase"')&&!html.includes('id="rememberGdt"')&&
 !html.includes('id="exportScope"'),'Vault password and export scope selector must be removed.');
assert(html.includes('Tải PDF Thuế')&&html.includes('Tải PDF gốc (có dự phòng)')&&
 html.includes('KHÔNG PHẢI GỐC'),
 'V1.1 must expose independent always-tax and original-first/rebuilt-fallback buttons.');
assert(admin.includes('id="customerMstSearch"')&&admin.includes('id="mstAssignmentSearch"')&&
 admin.includes('id="packageStatusFilter"'),'Admin filters required.');
assert(mst.includes('addon_admin_set_mst_profile_name')&&mst.includes('a.display_name'),
 'Admin must manage account-linked named MST profiles.');
assert(vault.includes('AES-GCM')&&vault.includes('indexedDB.open(DB_NAME,1)')&&
 vault.includes("false,['encrypt','decrypt']")&&
 vault.includes("entryKey(mst)")&&vault.includes('await crypto.subtle.encrypt'),
 'Tax passwords must be encrypted locally with account-specific nonextractable key.');
assert(!vault.includes('localStorage.setItem(storageKey()')&&
 main.includes('window.GdtVault?.saveAfterLogin(mst,password)')&&
 main.includes('setUser(account.id,profiles.data||[])'),
 'Save password only after tax login, never as plaintext.');
assert(pdf.includes("source.protocol!=='https:'")&&pdf.includes("b[0]!==37||b[1]!==80")&&
 pdf.includes('PDF_goc_nha_phat_hanh')&&
 pdf.includes("if(mode==='tax')")&&
 pdf.includes('window.Pdf.buildInvoicePdf(row,detail,lookup)')&&
 pdf.includes('fallbackAfterFailure:true'),
 'V1.1.2 must always rebuild Tax PDFs, and rebuild on issuer-original failure.');
assert(renderer.includes('raw.githubusercontent.com/tendoodn/hddv/main/autotax/src/content/fonts/')&&
 !renderer.includes('chrome.runtime.getURL('),'Web renderer must use HTTPS font URL.');
assert(audit.includes('window.Report.buildSheets')&&audit.includes("s.name==='Kiểm tra rủi ro HĐ'")&&
 audit.includes('Không đủ dữ liệu')&&report.includes("name: 'Kiểm tra rủi ro HĐ'"),
 'Retain canonical risk checker.');
assert(results.includes("audit.dataset.audit=keyOf(r)")&&results.includes('window.WebAudit?.open(row)'),
 'Invoice rows must still open risk audit.');

const pdfBytes=Uint8Array.from([37,80,68,70,45,49,46,55,10]);
const context=link=>{
 let download=null,rendered=0;
 const app={fetchDetail:async()=>({source:'xml',head:{},lines:[]}),
  progress(){},download:(name,bytes,mime)=>download={name,bytes,mime},getMst:()=> '0123456789'};
 const window={WebInvoiceApp:app,HDDT:{originalLookup:()=>({link,code:'TEST-CODE',name:'Issuer'})},
  Pdf:{buildInvoicePdf:async()=>{rendered++;return pdfBytes}},
  Zip:{writeZip:files=>files}};
 const fetch=async()=>({ok:true,headers:{get:()=>null},arrayBuffer:async()=>pdfBytes.buffer});
 vm.runInNewContext(pdf,{window,fetch,URL,AbortController,setTimeout,clearTimeout,
  Uint8Array,Date,Error,Array,Number,String,Math,Promise,console});
 return {window,getState:()=>({download,rendered})};
};
{
 const c=context('https://example.org/hddt.pdf');
 const x=await c.window.WebPdfExport.create([{khhdon:'C26',shdon:'1',kind:'purchase'}]);
 assert.equal(x.originals,1,'Real provider PDF downloaded from direct URL.');
 assert.equal(x.rendered,0);
 assert.equal(c.getState().download.mime,'application/pdf');
}
{
 const c=context('https://example.org/tim-hoa-don');
 const x=await c.window.WebPdfExport.create([{khhdon:'C26',shdon:'2',kind:'purchase'}],'original');
 assert.equal(x.originals,0,'A lookup page cannot be mislabelled as original PDF.');
 assert.equal(x.rendered,1,'After genuine source lookup fails, fallback must be rebuilt PDF.');
 assert.equal(x.errors.length,0,'Successful fallback counts as exported PDF.');
 assert.equal(c.getState().rendered,1);
 const files=c.getState().download.bytes;
 assert.equal(c.getState().download.mime,'application/zip');
 assert(files.some(f=>f.name.startsWith('PDF_DUNG_LAI_TU_DU_LIEU_CQT_KHONG_PHAI_GOC/')));
 assert(files.some(f=>f.name==='NGUON_PDF_MA_TRA_CUU.txt'&&
  f.data.includes('TEST-CODE')&&f.data.includes('KHONG PHAI')));
}
{
 const c=context('https://example.org/hddt.pdf');
 const x=await c.window.WebPdfExport.create([{khhdon:'C26',shdon:'4',kind:'purchase'}],'tax');
 assert.equal(x.originals,0,'Tax PDF mode must never call provider PDF.');
 assert.equal(x.rendered,1,'Tax PDF mode always rebuilds.');
 assert.equal(c.getState().rendered,1);
 assert(c.getState().download.bytes.some(f=>f.name.startsWith('PDF_THUE_DUNG_TU_DU_LIEU_CQT_KHONG_PHAI_GOC/')));
}
{
 const c=context('');
 const x=await c.window.WebPdfExport.create([{khhdon:'C26',shdon:'3',kind:'purchase'}]);
 assert.equal(x.originals,0);
 assert.equal(x.rendered,1,'Missing lookup URL must trigger clearly labelled rebuilt PDF.');
 assert.equal(c.getState().rendered,1);
 assert(c.getState().download.bytes.some(f=>f.name.startsWith('PDF_DUNG_LAI_TU_DU_LIEU_CQT_KHONG_PHAI_GOC/')));
}
console.log('V1.1.2 Tax PDF mode, original-first fallback and provider metadata checks passed.');
