import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const html=read('docs/web.html'),vault=read('docs/web/vault.js'),admin=read('docs/admin.html');
const logic=read('docs/web/web-results.js'),pdf=read('docs/web/web-pdf.js'),main=read('docs/web/web.js');
const quick=read('docs/mst.html'),quickJs=read('docs/web/mst-lookup.js');
for(const id of ['mstPickerToggle','mstPickerMenu','mstPickerNotice','mstProfileCount',
 'mstForgetPassword','gdtLoginErrorDialog','gdtLoginErrorText','visibleKind','visibleMonth',
 'clearVisibleMonth'])
 assert(html.includes('id="'+id+'"'),'Missing new Web control: '+id);
for(const removed of ['vaultPanel','vaultPassphrase','vaultUnlock','vaultRecovery',
 'vaultConfirmRecovery','vaultReveal','vaultChangePass','rememberGdt','exportScope'])
 assert(!html.includes('id="'+removed+'"'),'Obsolete vault/export-scope UI still exposed: '+removed);
assert(!admin.includes('data-reset-vault'),'Admin should no longer expose obsolete vault reset.');
assert(html.includes('K = Tổng bán ra / (Tồn trước kỳ + Tổng mua vào)')&&
 html.includes('Không xác định được tồn đầu'),'K formula needs opening-inventory caveat.');
assert(html.includes('href="./mst.html"')&&quick.includes('id="mstInput"')&&
 quickJs.includes('autotax-mst-lookup'),'Quick taxpayer lookup must remain available.');
assert(logic.includes('selected.length?selected:shown')&&
 logic.includes("shown.filter(r=>checked.has(keyOf(r)))"),
 'Export checked visible invoices, otherwise all visible.');
assert(logic.includes('Do không biết tồn trước kỳ'),'K popup must show approximation warning.');
assert(main.includes('Math.min(3,queue.length)')&&main.includes('pendingDetails'),
 'Retain bounded detail download concurrency.');
assert(pdf.includes('Math.min(2,rows.length)')&&pdf.includes('lookupCode:lookup.code')&&
 pdf.includes('NGUON_PDF_MA_TRA_CUU.txt'),'Failed PDFs must report issuer lookup details.');
assert(vault.includes('indexedDB.open(DB_NAME,1)')&&
 vault.includes('crypto.subtle.generateKey')&&
 vault.includes("false,['encrypt','decrypt']")&&
 vault.includes("name:'AES-GCM'")&&vault.includes('crypto.subtle.encrypt')&&
 vault.includes('crypto.subtle.decrypt'),
 'Device-local tax credentials require nonextractable AES-GCM keys.');
assert(vault.includes("owner+':'+mst")&&vault.includes('display_name')&&
 vault.includes("entryKey(mst)")&&vault.includes('window.WebInvoiceApp?.getClient?.()'),
 'Password storage and MST picker must remain tied to the signed-in owner.');
assert(!vault.includes('localStorage.setItem(storageKey()')&&
 !vault.includes('localStorage.setItem(entryKey(')&&
 !vault.includes('SUPABASE_SERVICE_ROLE_KEY'),'Never store plaintext or send tax credentials to server.');
assert(main.includes('window.GdtVault?.saveAfterLogin(mst,password)')&&
 main.includes('setUser(account.id,profiles.data||[])')&&
 main.includes('gdtLoginErrorDialog'),'Auto-fill and password error UI must be wired to account session.');
for(const file of ['docs/web/vault.js','docs/web/web.js','docs/web/web-results.js',
 'docs/web/web-pdf.js','docs/web/mst-lookup.js'])
 new vm.Script(read(file),{filename:file});
console.log('Device-encrypted account MST picker, removal of passphrase vault, automatic export and K verified.');
