import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const html=read('docs/web.html'),vault=read('docs/web/vault.js'),admin=read('docs/admin.html');
const logic=read('docs/web/web-results.js'),pdf=read('docs/web/web-pdf.js'),main=read('docs/web/web.js');
const sql=read('addon-portal/supabase/migrations/032_vault_admin_reset_state.sql');
const quick=read('docs/mst.html'),quickJs=read('docs/web/mst-lookup.js');
for(const v of ['vaultRecovery','vaultRecoveryCode','vaultConfirmRecovery','vaultAfterUnlock',
 'vaultList','vaultReveal','vaultNewPassphrase','vaultChangePass','visibleKind','visibleMonth',
 'clearVisibleMonth','exportScope'])assert(html.includes('id="'+v+'"'),'Missing UI '+v);
assert(html.indexOf('id="vaultPanel"')<html.indexOf('id="searchTotals"'),
 'Credential management must be directly under AutoTax session and before period totals');
assert(html.includes('K = Tổng bán ra / (Tồn trước kỳ + Tổng mua vào)'),
 'K calculation must acknowledge beginning inventory');
assert(html.includes('Không xác định được tồn đầu'),
 'K formula caveat must be visible');
assert(html.includes('href="./mst.html"'),'Top bar must expose quick taxpayer lookup');
assert(quick.includes('id="mstInput"')&&quick.includes('id="downloadMst"')&&
 quickJs.includes('https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-mst-lookup'),
 'Quick MST lookup must exist with clearly identified public data provider');
assert(logic.includes("filterRows()")&&logic.includes("kind==='all'||row.kind===kind")&&
 logic.includes("shown.filter(r=>checked.has(keyOf(r)))"),
 'Export scope must be derived from filtered invoice rows and checked selection');
assert(logic.includes("selected.length?selected:shown"),
 'Empty checkbox selection must default to all visible invoice rows');
assert(logic.includes("ratio.toFixed(2)")&&logic.includes('Do không biết tồn trước kỳ'),
 'K popup must disclose missing opening inventory');
assert(main.includes('Math.min(3,queue.length)')&&main.includes('pendingDetails'),
 'Invoice details should fetch using bounded deduplicated concurrency');
assert(pdf.includes('Math.min(2,rows.length)')&&pdf.includes('lookupCode:lookup.code')&&
 pdf.includes("const guide=[")&&pdf.includes('NGUON_PDF_MA_TRA_CUU.txt'),
 'Supplier PDF download must use bounded workers and retain provider lookup codes');
assert(sql.includes("REVOKE ALL ON public.addon_vault_reset_state FROM PUBLIC, anon, authenticated")&&
 sql.includes("addon_is_admin()")&&sql.includes('generation=public.addon_vault_reset_state.generation+1'),
 'Admin reset is authorized and versioned without exposing a secret data table');
assert(vault.includes("await client.rpc('addon_my_vault_reset_state')")&&
 vault.includes("localStorage.removeItem(storageKey())")&&
 vault.includes("if($('vaultRecoveryCode').value!=='0000')")&&
 vault.includes("const next=$('vaultNewPassphrase').value")&&
 vault.includes("return 'autotax_last_mst_")===false,
 'Vault must check server reset, wipe old ciphertext, require recovery and allow password rotation');
assert(admin.includes('addon_admin_reset_vault')&&admin.includes('data-reset-vault')&&
 admin.includes('Mã khôi phục tạm 0000'),'Admin must explicitly warn on vault reset');
for(const file of ['docs/web/vault.js','docs/web/web.js','docs/web/web-results.js',
 'docs/web/web-pdf.js','docs/web/mst-lookup.js'])new vm.Script(read(file),{filename:file});
console.log('K disclaimer, visible export scopes, fast detail/PDF, secure vault recovery and quick MST lookup verified.');
