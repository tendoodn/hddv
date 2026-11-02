import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const html=read('docs/web.html'),admin=read('docs/admin.html'),mst=read('docs/admin-mst.js'),
 vault=read('docs/web/vault.js'),pdf=read('docs/web/web-pdf.js'),
 renderer=read('docs/web/pdf.js'),audit=read('docs/web/audit.js'),
 results=read('docs/web/web-results.js'),main=read('docs/web/web.js'),
 report=read('autotax/src/content/report.js');
for(const id of ['mst','vaultPassphrase','rememberGdt','vaultUnlock','vaultForget','vaultStatus',
 'invoiceAuditDialog','invoiceAuditRows','invoiceAuditSummary','closeInvoiceAudit','exportPdf']){
 assert(html.includes('id="'+id+'"'),'Missing Web control '+id);
}
assert(!html.includes('id="exportTax"')&&!html.includes('id="mstList"'),
 'Web must use MST dropdown and single PDF button rather than obsolete tax/lookup buttons');
assert(html.includes('Tải PDF gốc')&&html.includes('không gọi bản đó là PDF gốc'),
 'PDF fallback must be clearly distinguished from original PDF');
assert(admin.includes('id="customerMstSearch"')&&admin.includes('id="customerPackageFilter"')&&
 admin.includes('id="packageStatusFilter"')&&admin.includes('id="mstAssignmentSearch"'),
 'Admin must have MST and package-status filters');
assert(admin.includes('filtered=allUsers.filter')&&mst.includes('renderMstAssignments'),
 'MST/customer filters must update rendered rows');
assert(vault.includes('AES-GCM')&&vault.includes('PBKDF2')&&vault.includes('260000')&&
 vault.includes("const storageKey=()=> 'autotax_gdt_secret_v1_'+owner"),
 'Vault must encrypt locally with a distinct per-account key');
assert(!vault.includes('localStorage.setItem(storageKey(),JSON.stringify(entries))')&&
 vault.includes("data:b64(ciphertext)")&&vault.includes('await crypto.subtle.encrypt'),
 'Vault must never store cleartext password values');
assert(main.includes('window.GdtVault?.saveAfterLogin(mst,password)')&&
 main.includes('window.GdtVault?.setUser(account.id,profileMsts)'),
 'Save only after confirmed GDT login and show only account-linked MSTs');
assert(pdf.includes("source.protocol!=='https:'")&&pdf.includes("b[0]!==37||b[1]!==80")&&
 pdf.includes("BanTheHien_GDT")&&pdf.includes("PDF_goc_nha_phat_hanh"),
 'Source provider PDF must be verified; tax representations labelled distinctly');
assert(renderer.includes('raw.githubusercontent.com/tendoodn/hddv/main/autotax/src/content/fonts/')&&
 !renderer.includes('chrome.runtime.getURL('),
 'Web renderer must use allowed browser-accessible font URLs');
assert(audit.includes('window.Report.buildSheets')&&audit.includes("s.name==='Kiểm tra rủi ro HĐ'")&&
 audit.includes('Không đủ dữ liệu'),
 'Audit popup must use canonical risk checker and avoid false positive on data failures');
assert(report.includes("name: 'Kiểm tra rủi ro HĐ'"),'The canonical engine must still expose risk sheet');
assert(results.includes("audit.dataset.audit=keyOf(r)")&&results.includes('window.WebAudit?.open(row)'),
 'Row action must open validity check alongside details');

const pdfBytes=Uint8Array.from([37,80,68,70,45,49,46,55,10]);
const createContext=(lookup,sourcePdf)=>{
 let download=null,rendered=0,originalsRead=0;
 const app={fetchDetail:async()=>({source:'xml',head:{},xml:new Uint8Array(),lines:[]}),
  progress(){},download:(name,bytes,mime)=>download={name,bytes,mime},getMst:()=> '0123456789'};
 const window={WebInvoiceApp:app,
  HDDT:{originalLookup:()=>({link:lookup}),fetchOriginal:async()=>{originalsRead++;return {source:'xml',head:{}}}},
  Pdf:{buildInvoicePdf:async()=>{rendered++;return pdfBytes}},
  Zip:{writeZip:files=>files}};
 const fetch=async()=>({ok:true,headers:{get:()=>null},arrayBuffer:async()=>pdfBytes.buffer});
 vm.runInNewContext(pdf,{window,fetch,URL,AbortController,setTimeout,clearTimeout,
  Uint8Array,Date,Error,Array,Number,String,Math,Promise,console});
 return {window,getState:()=>({download,rendered,originalsRead})};
};
{
 const c=createContext('https://example.org/hddt.pdf',true);
 const x=await c.window.WebPdfExport.create([{khhdon:'C26',shdon:'1',kind:'purchase'}]);
 assert.equal(x.originals,1,'Direct PDF must be first priority');
 assert.equal(x.rendered,0,'Do not render when real original PDF was downloaded');
 assert.equal(c.getState().download.mime,'application/pdf');
}
{
 const c=createContext('https://example.org/tim-hoa-don',false);
 const x=await c.window.WebPdfExport.create([{khhdon:'C26',shdon:'2',kind:'purchase',
  gocRef:{nbmst:'0123456789',shdon:'1'}}]);
 assert.equal(x.originals,0,'Provider search page is never treated as PDF');
 assert.equal(x.rendered,1,'Render from GDT data when original cannot be reached');
 assert.equal(x.sourceOriginals,1,'Try original invoice from GDT data first when adjustment has a source');
}
console.log('Web PDF priority, fallback labelling, MST/profile filters, encrypted vault and invoice audit regression checks passed.');
