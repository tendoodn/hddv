import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=p=>fs.readFileSync(p,'utf8');
const portal=file('docs/index.html'),customer=file('docs/customer.js');
const panel=file('autotax/src/sidepanel/index.html');
const license=file('autotax/src/license/license.js');
const ui=file('autotax/src/sidepanel/panel.js');
const web=file('docs/web.html'),webjs=file('docs/web/web.js');
const picker=file('docs/web/vault.js');
const results=file('docs/web/web-results.js');
const pdf=file('docs/web/web-pdf.js');
const admin=file('docs/admin.html'),adminjs=file('docs/admin-mst.js');
const sql=file('addon-portal/supabase/migrations/036_account_mst_profile_names.sql');
const adminSql=file('addon-portal/supabase/migrations/037_admin_mst_profile_rename.sql');
const logo=file('autotax/icons/icon.svg');

assert(portal.includes('<section id="mstProfilesWeb"')&&
 !portal.includes('<details id="mstProfilesWeb"')&&
 customer.includes('addon_set_mst_profile_name'),
 'Customer portal must always list profiles and edit names on the account.');
assert(license.includes('addon_set_mst_profile_name')&&
 license.includes("if(mstPanel)mstPanel.hidden=!active||mode!=='mst'")&&
 panel.includes('id="lic-mst-toggle"')&&panel.includes('id="lic-mst-details"'),
 'Extension must display MST manager toggle only in MST mode.');
assert(panel.includes('https://tendoodn.github.io/hddv/docs/web.html')&&
 (panel.match(/data-close-panel/g)||[]).length>=3&&
 ui.includes('chrome.tabs.create')&&ui.includes('chrome.sidePanel?.close'),
 'K, package store and Web shortcut must open sites and close sidepanel where possible.');
assert(web.includes('id="mstPickerMenu"')&&web.includes('id="mstPickerToggle"')&&
 web.includes('id="gdtLoginErrorDialog"')&&webjs.includes('gdtLoginErrorDialog'),
 'Web must provide profile card selector and wrong tax password warning.');
assert(!web.includes('id="vaultPassphrase"')&&!web.includes('id="vaultUnlock"')&&
 !admin.includes('data-reset-vault'),'Legacy vault management controls must be gone.');
assert(webjs.includes('assignAutoMstName')&&webjs.includes('nameFromMatchedInvoices')&&
 license.includes('autoNameFromGdt')&&ui.includes('AutoTaxGdtProfile'),
 'Profile name must come from verified GDT account or matching invoice buyer/seller.');
assert(picker.includes("display_name")&&picker.includes('indexedDB.open(DB_NAME,1)')&&
 picker.includes('crypto.subtle.encrypt')&&picker.includes('crypto.subtle.decrypt')&&
 picker.includes("false,['encrypt','decrypt']")&&picker.includes("entryKey(mst)"),
 'GDT credentials must be encrypted and isolated by AutoTax user and MST.');
assert(!picker.includes('SUPABASE_SERVICE_ROLE_KEY')&&
 !picker.includes('localStorage.setItem(storageKey()'),
 'Never upload/store plaintext GDT credentials or service secrets.');
assert(!web.includes('id="exportScope"')&&
 results.includes('return selected.length?selected:shown;'),
 'Export selected visible invoices or all filtered invoices automatically.');
assert(pdf.includes('PDF_goc_nha_phat_hanh')&&
 pdf.includes('window.Pdf.buildInvoicePdf(row,detail,lookup)')&&
 pdf.includes('decision.shouldReconstruct')&&
 pdf.includes('NGUON_PDF_MA_TRA_CUU.txt'),
 'V1.1 must prioritize issuer originals and rebuild PDF only without lookup metadata.');
assert(adminjs.includes('addon_admin_set_mst_profile_name')&&
 adminjs.includes('a.display_name')&&
 admin.includes('<th>Tên hồ sơ</th>'),
 'Admin MST management must use same names as the account.');
assert(sql.includes('alter table public.addon_mst_assignments')&&
 sql.includes('display_name')&&
 sql.includes('addon_list_my_mst_assignments')&&
 sql.includes('addon_admin_list_mst_assignments')&&
 sql.includes('v_user uuid := auth.uid()')&&
 sql.includes('revoke all on function public.addon_set_mst_profile_name')&&
 adminSql.includes('if not public.addon_is_admin()'),
 'Shared MST labels must be account-authorized and admin protected.');
assert(logo.includes('#070D15')&&logo.includes('#21CEFF')&&
 !logo.includes('#FF2449'),'Original dark AutoTax logo must replace old Tendoo-red logo.');
for(const filePath of ['docs/customer.js','docs/web/web.js','docs/web/vault.js',
 'docs/web/web-results.js','docs/web/web-pdf.js','docs/admin-mst.js',
 'autotax/src/license/license.js']){
 new vm.Script(file(filePath),{filename:filePath});
}
console.log('AutoTax 1.1 account naming, mode toggle, credential privacy and PDF routing passed.');
