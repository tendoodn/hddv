import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const html=read('docs/web.html'),logic=read('docs/web/web-results.js'),base=read('docs/web/web.js');
const addon=read('autotax/src/sidepanel/panel.js'),admin=read('docs/admin.html');
const newSql=read('addon-portal/supabase/migrations/030_custom_package_delete_and_order.sql');
const syncSql=read('addon-portal/supabase/migrations/031_user_sku_mapping_sync.sql');
assert.equal(read('docs/web/tendoo-import.js'),read('autotax/src/content/tendoo-import.js'),
 'The SKU mapping and import exporter must be byte-for-byte shared between website and addon.');
for(const id of ['totalPayments','totalVat','purchaseSaleTotals','kRatio','selectAllInvoices',
 'exportScope','exportMonth','exportMonthWrap','invoiceDetailDialog','detailRows','detailTax',
 'detailTotal','stockCatalog','stockMapBtn','stockDownloadBtn','skuMapDialog',
 'kWarningDialog','disableKPopup','stockPlatform','stockWarehouse','stockLastDoc']){
 assert(html.includes('id="'+id+'"'),'Missing Web control '+id);
}
assert(html.includes('web-results.js')&&html.includes('tendoo-import.js'),'Required stock/selection scripts not loaded');
assert(base.includes('WebResults?.exportRows?.()')&&base.includes('loadDetails(targetRows)')&&
 base.includes('Report.buildSheets(targetRows'),'All downloads must respect selected/month scope');
assert(base.includes('addon_claim_invoice_quota'),'Quota must stay in canonical Web backend');
assert(logic.includes('WebInvoiceApp')&&logic.includes('window.TendooImport.makePackage')&&
 logic.includes('window.TendooImport.missing'),'Stock export must reuse core invoice and SKU mapping modules');
assert(logic.includes("localStorage.getItem(alertPref)")&&
 logic.includes("stats.sold/stats.buy>2")&&logic.includes("searchedBothKinds"),
 'K alert must trigger only for sold/purchase ratio greater than two when both kinds are searched.');
assert(logic.includes("client.from('addon_user_sku_mappings')")&&
 addon.includes('addon_user_sku_mappings')&&addon.includes('tendooCatalogKey()'),
 'Web and extension must sync mappings through the same account RLS table.');
assert(newSql.includes('addon_admin_delete_custom_package')&&
 newSql.includes("v_mode='archived'")&&newSql.includes("v_mode='deleted'")&&
 newSql.includes('addon_orders')&&newSql.includes('addon_package_lots'),
 'Admin deletion must preserve purchased package history and delete only unused custom packages.');
assert(admin.includes('id="packageCustomPrices"')&&admin.includes('data-delete-package')&&
 admin.includes('addon_admin_delete_custom_package'),
 'Admin must display a separate, deletable custom package section');
assert(syncSql.includes('enable row level security')&&syncSql.includes('auth.uid()')&&
 syncSql.includes('addon_user_sku_update_own'),'SKU mapping must be isolated by logged-in user.');
for(const file of ['docs/web/web-results.js','docs/web/web.js','autotax/src/sidepanel/panel.js',
 'autotax/src/license/license.js','docs/customer.js']){
 new vm.Script(read(file),{filename:file});
}
const nodes=new Map();
function node(id=''){
 return {id,hidden:false,value:'',checked:false,indeterminate:false,textContent:'',
  dataset:{},children:[],style:{},classList:{toggle(){}},open:false,
  append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},
  setAttribute(){},addEventListener(){},showModal(){this.open=true},close(){this.open=false}};
}
const elements=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)};
elements('fromDate').value='2026-10-01';
elements('exportScope').value='all';
const doc={readyState:'loading',getElementById:elements,createElement:()=>node(),
 addEventListener(){},querySelectorAll(){return []}};
const window={HDDT:{TTHAI:{}},WebInvoiceApp:{
 searchedBothKinds:()=>true,show(){},getAccount:()=>({id:'test-user'})}};
const store={getItem:()=>null,setItem(){}};
vm.runInNewContext(logic,{window,document:doc,localStorage:store,Date,Number,String,Math,
 URL,console,Set,Map,Object,Array,JSON});
const purchase={key:'buy',kind:'purchase',tdlap:'2026-10-04T12:00:00Z',
 tgtttbso:100,tgtthue:8,tthai:1,khhdon:'A',shdon:'1',nbten:'A'};
const sale={key:'sold',kind:'sold',tdlap:'2026-11-09T12:00:00Z',
 tgtttbso:250,tgtthue:20,tthai:1,khhdon:'B',shdon:'2',nbten:'B'};
window.WebResults.render([purchase,sale]);
assert.equal(elements('totalPayments').textContent,'350 ₫');
assert.equal(elements('totalVat').textContent,'28 ₫');
assert.equal(elements('kRatio').textContent,'2.50');
assert.equal(elements('kWarningDialog').open,true,'K>2 must open red warning popup');
assert.equal(window.WebResults.exportRows().length,2,'All scope exports both records');
elements('exportScope').value='month';elements('exportMonth').value='2026-10';
assert.deepEqual(Array.from(window.WebResults.exportRows(),x=>x.key),['buy'],'Month scope selects October invoice only');
elements('exportScope').value='selected';
assert.equal(window.WebResults.exportRows().length,0,'Selected scope should require an actual checkbox selection');
console.log('Web enhancements: 5 JS files parse; invoice totals, K popup and all/selected/month scope are tested.');
