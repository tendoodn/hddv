// AutoTax V3.2 — read-only repository consistency checks. Run: node scripts/verify-v32-sync.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const load = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const htmlIds = html => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const checkIds = (jsPath, htmlPath, rx) => {
 const source=load(jsPath), ids=htmlIds(load(htmlPath));
 const missing=[...new Set([...source.matchAll(rx)].map(m=>m[1]).filter(id=>!ids.has(id)))];
 assert.deepEqual(missing, [], jsPath+' missing IDs in '+htmlPath);
};
const testScript = (name, source) => new vm.Script(source, { filename:name });
checkIds('docs/customer.js','docs/index.html',/\$\("([^"]+)"\)/g);
checkIds('docs/admin.html','docs/admin.html',/\$\("([^"]+)"\)/g);
checkIds('docs/admin-mst.js','docs/admin.html',/getElementById\("([^"]+)"\)/g);
checkIds('autotax/src/license/license.js','autotax/src/sidepanel/index.html',/\$\('([^']+)'\)/g);
for(const path of ['docs/customer.js','docs/admin-mst.js','autotax/src/license/license.js',
'autotax/src/content/content.js','autotax/src/content/tendoo-import.js']) testScript(path,load(path));
const admin=load('docs/admin.html');
for(const match of admin.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))
 if(match[1].trim())testScript('admin-inline',match[1]);
assert(admin.indexOf('./admin-mst.js') < admin.indexOf('const client='), 'admin MST module must load before inline boot');
assert(!/\}\$\("unlockPackage"\)\.innerHTML/.test(admin),'Admin package selector must not run outside loadPlans scope');
assert(!admin.includes('addon_admin_revoke_subscription'), 'admin must use V3.2 APIs');
assert(!load('docs/index.html').includes('Gói 1 tháng'), 'legacy portal packages remain');
assert(!load('autotax/src/sidepanel/index.html').includes('trialLeft'), 'obsolete 3-search trial remains');
const migrationNames=[
 '001_addon_license_portal.sql',
 '005_package_entitlements_v32.sql',
 '006_package_admin_and_expiry_hardening.sql',
 '007_mst_capacity_enforcement.sql',
 '008_order_snapshot_and_expiry_display.sql',
 '009_initial_entitlement_mode.sql',
 '010_package_unlock_codes.sql',
 '011_atomic_invoice_quota_claim.sql',
 '012_trial_mst_assignment_controls.sql',
 '013_one_time_mst_trial.sql',
 '014_invoice_reread_entitlements.sql',
 '015_invoice_mode_claim_hardening.sql',
 '016_admin_customer_v32_snapshot.sql',
 '017_shared_catalog_and_admin_logs.sql',
 '018_remove_legacy_plan_order_dependency.sql',
 '019_bounded_invoice_claims_and_reread_mode.sql',
 '020_mst_one_year_collapsible_admin_history.sql',
 '021_admin_direct_package_grant.sql',
 '022_admin_paginated_package_transactions.sql',
 '023_fix_package_checkout_pgcrypto_schema.sql',
 '024_five_minute_qr_realtime_order_status.sql',
 '025_admin_revoke_restore_compensation_and_transaction_codes.sql',
 '026_hide_inactive_package_history.sql',
 '027_admin_order_search.sql',
 '028_mst_12_digit_trial_and_authorization.sql',
 '028_explicit_mst_profiles_and_session_lock.sql',
 '029_admin_extension_download_link.sql'
];
let sql='';
for(const name of migrationNames){
 const body=load('addon-portal/supabase/migrations/'+name);
 assert.equal((body.match(/\$\$/g)||[]).length%2,0,'Unbalanced SQL $$: '+name);
 sql+='\n'+body;
}
const defined=new Set([...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(addon_[a-z0-9_]+)/gi)].map(m=>m[1]));
const sourcePaths=['docs/customer.js','docs/admin.html','docs/admin-mst.js','autotax/src/license/license.js','autotax/src/content/content.js'];
for(const path of sourcePaths){
 const source=load(path);
 for(const match of source.matchAll(/(?:rpc\(\s*["']|\/rpc\/)(addon_[a-z0-9_]+)/gi)){
  const legacyReadOnlyFallback=path==='docs/admin.html' &&
   match[1]==='addon_admin_list_users' &&
   source.includes('error.code==="PGRST202"');
  assert(defined.has(match[1])||legacyReadOnlyFallback,'Unknown V3.2 RPC '+match[1]+' in '+path);
 }
 assert(!/addon_my_license|addon_claim_trial|addon_redeem_gift/.test(source),'Old RPC in '+path);
}
const edgeConfig=load('addon-portal/supabase/config.toml');
assert.match(edgeConfig,/\[functions\.addon-create-order\]\s*verify_jwt\s*=\s*true/,'Checkout must require a user JWT');
assert.match(edgeConfig,/\[functions\.addon-sepay-webhook\]\s*verify_jwt\s*=\s*false/,'SePay webhook must not require user JWT');
const webhook=load('addon-portal/supabase/functions/addon-sepay-webhook/index.ts');
assert(webhook.includes('X-SePay-Signature') && webhook.includes('X-SePay-Timestamp'),
 'Webhook must verify SePay request signatures before payment processing');
assert(webhook.includes('safeEqual('),'Webhook signature comparison missing');
const adminGrant=load('addon-portal/supabase/migrations/021_admin_direct_package_grant.sql');
assert(adminGrant.includes("raise exception 'admin_required'"),'Manual package grant requires admin check');
assert(adminGrant.includes("'admin_package_granted_v32'"),'Manual package grant requires audit');
assert(adminGrant.includes("p_package_code"),'Manual package grant must bind one catalog package');
const portal=load('docs/index.html');
assert(portal.includes('--tendoo:#e60012'),'Account portal must match red Tendoo panel');
assert(portal.includes('id="mstProfilesWeb"')&&portal.includes('id="giftWebDialog"'),
  'Web should have matching collapsed MST and gift UX');
assert(!load('autotax/src/sidepanel/index.html').includes('class="privacy"'),
  'Remove obsolete privacy teaser from compact panel');
const bridge=load('autotax/src/content/tendoo-import.js');
assert(bridge.includes('makePackage')&&bridge.includes("mtt"),'Tendoo import bridge must export MTT KCT');
const manifest=load('autotax/manifest.json');
assert(manifest.includes('src/content/tendoo-import.js'),'Extension must load offline Tendoo module');
const crxPanel=load('autotax/src/sidepanel/index.html');
const crxJs=load('autotax/src/sidepanel/panel.js');
const crxContent=load('autotax/src/content/content.js');
const crxLicense=load('autotax/src/license/license.js');
assert(crxPanel.includes('id="tendooSyncCheck"'),'Missing Tendoo option');
assert(crxPanel.includes('id="tendooCatalogFile"')&&crxPanel.includes('id="stockPlatform"')&&
 crxPanel.includes('id="misaWarehouse"')&&crxPanel.includes('id="misaLastDoc"'),
 'Warehouse import must support both catalog formats, warehouse and last voucher number');
assert(!crxPanel.includes('id="tendooTemplateFile"')&&bridge.includes('builtinTemplate'),
 'Warehouse templates must be bundled in AutoTax, not uploaded');
assert(bridge.includes('THIẾU MÃ')&&bridge.includes('makeMisaPackage'),
 'Unmatched product lines must remain exportable in both formats');
assert(crxPanel.includes('id="tendooMatchDialog"'),'Missing SKU mapping dialog');
assert(crxPanel.includes('id="tendooMatchClose"')&&crxPanel.includes('id="lic-account-quick-actions"'),
 'Stock mapping close and compact license controls missing');
assert(!crxPanel.includes('Quản lý số hóa đơn hoặc số MST'),'Remove obsolete package subtitle');
assert(crxPanel.indexOf('id="lic-mode-wrap"')<crxPanel.indexOf('id="lic-entitlements"'),
 'License mode must live below the package title');
for(const format of ['Excel','XML','PDF','HTML'])
 assert(crxPanel.includes('<span>'+format+'</span>'),'Missing compact format '+format);
assert(crxPanel.includes('PL giảm thuế GTGT')&&crxPanel.includes('Bảng kê HĐKD'),
 'Excel main sheet labels must be compact');
const downloadHref='https://drive.google.com/drive/folders/1q8l5pDqb0UzxFF2ma7Nm6KQyGX9UB0WF';
assert(portal.includes('id="extensionDownloadBtn"')&&portal.includes('href="'+downloadHref+'"'),
 'Download button must link directly to the requested Google Drive folder');
const accountButtons=portal.match(/<nav class="account-quick-actions"[^>]*>([\s\S]*?)<\/nav>/)?.[1]||'';
const expectedAccountButtons=['kTrackingBtn','priceToolsBtn','extensionDownloadBtn','refreshBtn','logoutBtn'];
assert(expectedAccountButtons.every(id=>accountButtons.includes('id="'+id+'"')),
 'Account action row must contain K, tools, download, refresh, and logout');
let previousPosition=-1;
for(const id of expectedAccountButtons){
 const position=accountButtons.indexOf('id="'+id+'"');
 assert(position>previousPosition,'Incorrect order for account button '+id);
 previousPosition=position;
}
assert(accountButtons.includes('href="https://tendoodn.github.io/t/k.html"')&&
 accountButtons.includes('href="https://tendoodn.github.io/t/"')&&
 accountButtons.includes('href="'+downloadHref+'"'),
 'Account links must use the supplied K, tools and Drive URLs');
assert(portal.includes('grid-template-columns:repeat(5,minmax(117px,1fr))')&&
 portal.includes('overflow-x:auto'),
 'Five account buttons must stay on one row with horizontal overflow on narrow screens');
const customerSource=load('docs/customer.js');
assert(!customerSource.includes('loadExtensionDownloadLink')&&
 !customerSource.includes('refreshAdminLink')&&
 !customerSource.includes('adminLink").hidden'),
 'The two header buttons cannot be hidden by remote configuration or account status');
assert(!admin.includes('extensionConfigPanel')&&!admin.includes('extensionDownloadUrl'),
 'Retired admin URL settings must not misleadingly override the direct link');
assert(customerSource.includes('Không giới hạn số hóa đơn tra cứu')&&
 customerSource.includes('Không giới hạn MST tra cứu'),
 'Portal plans must state unlimited invoice/MST benefits by package family');
assert(load('autotax/src/license/license.js').includes('Không giới hạn số hóa đơn tra cứu')&&
 load('autotax/src/license/license.js').includes('Không giới hạn MST tra cứu'),
 'Addon package suggestions must match the website');
const settingsSql=load('addon-portal/supabase/migrations/029_admin_extension_download_link.sql');
assert(settingsSql.includes('enable row level security')&&settingsSql.includes('addon_is_admin()'),
 'Extension link is publicly readable but writes must be restricted to admin');
assert(crxJs.includes('Sản phẩm gốc · HĐ mua vào') &&
 crxJs.includes('Sản phẩm liên kết · danh mục '),
 'SKU mapping must distinguish invoice product and linked BC product');
assert(crxJs.includes('TendooImport.searchCatalog'),
 'SKU link popup must support fast name-or-code search');
assert(bridge.includes('function searchCatalog('),
 'Tendoo catalog search must be implemented in shared offline helper');
assert(crxPanel.includes('id="lic-mst-add-form"'),'Missing MST profile add form');
assert(crxPanel.includes('id="mstGuardMessage"'),'Missing MST mismatch warning');
assert(crxPanel.includes('id="historyMst"'),'Invoice history must filter by MST');
assert(crxPanel.includes('id="lic-unlock-dialog"'),'Missing gift activation dialog');
assert(crxJs.includes('profileMatches()'),'Panel must lock search to configured MST');
assert(crxJs.includes('configuredMsts.includes(portalMst)'),'GDT login MST must match profile list');
assert(crxLicense.includes('addon_add_mst_profile_v33'),'Missing MST register RPC');
assert(crxLicense.includes('addon_remove_mst_profile_v33'),'Missing MST delete RPC');
assert(crxContent.includes('addon_verify_session_mst_v33'),'Content script must verify actual GDT MST');
assert(!crxContent.includes('addon_authorize_mst'),'Content script must never auto-assign MST on search');
assert(crxJs.includes("key: 'thisYear'"),'Missing current year date preset');
assert(crxPanel.includes('sheet-grid'),'Excel sheet options must have two-column layout');
assert(!crxPanel.includes('id="notice"')&&!crxPanel.includes('Thử thêm “Tải hồ sơ thuế hàng loạt”'),'Obsolete CRX promotions remain');
const customerHtml=load('docs/index.html');
const customerJs=load('docs/customer.js');
assert(customerHtml.includes('repeat(5,minmax(0,1fr))'),'Desktop package grid must show 5 plans per row');
assert(customerHtml.includes('id="paymentCountdown"'),'Missing five-minute QR countdown');
assert(customerHtml.includes('id="paymentSuccessDialog"'),'Missing paid success popup');
assert(customerJs.includes('addon_my_order_status'),'Payment completion must check exact order status');
assert(customerJs.includes('postgres_changes'),'Payment completion must subscribe to immediate server updates');
assert(customerJs.includes('finishPaidOrder('),'Paid QR must refresh license and show popup');
assert(!customerJs.includes('900000'),'Obsolete fifteen-minute QR remains');
const qrMigration=load('addon-portal/supabase/migrations/024_five_minute_qr_realtime_order_status.sql');
assert(qrMigration.includes("interval '5 minutes'"),'Backend QR expiry must be five minutes');
assert(qrMigration.includes('security invoker'),'Order status RPC must enforce row-level security');
assert(customerHtml.includes('id="loginForm"'),'Customer login must use a native Enter-submit form');
assert(customerHtml.includes('class="activation-grid"'),'Trial and unlock must share responsive row');
assert(customerHtml.includes('grid-template-columns:minmax(0,1fr)'),'Activation panels must stack on phones');
assert(customerHtml.indexOf('id="paymentArea"')<customerHtml.indexOf('id="packageList"'),'QR must appear above package prices');
assert(customerHtml.includes('#paymentArea #paymentQr{display:block;margin:14px auto}'),'QR should be centered');
assert(customerJs.includes('"loginForm").addEventListener("submit"'),'Enter login handler missing');
assert(customerJs.includes('scrollIntoView({behavior:reducedMotion'),'Buying must center scroll on QR');
assert(!customerHtml.includes('href="https://github.com/'), 'Customer UI must not expose GitHub source links');
const panelHtml=load('autotax/src/sidepanel/index.html');
const panelJs=load('autotax/src/sidepanel/panel.js');
const panelCss=load('autotax/src/sidepanel/panel.css');
const licenseJs=load('autotax/src/license/license.js');
assert(panelHtml.includes('id="lic-gift-open"') && panelHtml.includes('id="lic-unlock-dialog"'),'Missing gift button/dialog');
assert(panelHtml.includes('id="lic-unlock-form"'),'Gift code requires Enter-submit form');
assert(licenseJs.includes("dialog.showModal()") && licenseJs.includes("dialog.close()"),'Gift code popup open and close handlers missing');
assert(licenseJs.includes('trialActivationConfirmed=true'),'Trial panel must hide immediately after activation');
assert(panelHtml.includes('Nhập MST 10 hoặc 12 chữ số'),'Wrong MST trial hint');
assert(licenseJs.includes('Nhập MST 10 hoặc 12 chữ số hợp lệ.'),'Wrong MST trial error text');
assert(customerJs.includes('MST phải có 10 hoặc 12 chữ số.'),'Customer portal MST error mismatch');
assert(panelCss.includes('--accent:#e60012') && panelCss.includes('--accent-strong:#b80010'),'Missing Tendoo/Viettel red palette');
assert(panelCss.includes('grid-template-columns:repeat(5,minmax(0,1fr))'),'Five date preset buttons must stay on one row');
assert(panelCss.includes('.sheet-opts .sheet-grid'),'Excel sheets must form two columns');
assert(panelJs.includes("key: 'thisYear', label: 'Cả năm'"),'Missing current-year preset');
const orderedSheets=['reduction','hdkd','risk','seller','gtgt','adjust','tendoo'];
const listedSheets=[...panelHtml.matchAll(/name="sheet" value="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual(listedSheets,orderedSheets,'Incorrect Excel sheet ordering');
const visibleSheetGrid=panelHtml.match(/<div class="checks sheet-grid">([\s\S]*?)<\/div>/)?.[1]||'';
const sixSheets=[...visibleSheetGrid.matchAll(/name="sheet" value="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual(sixSheets,['reduction','hdkd','risk','seller','gtgt','adjust'],
 'Six Excel sheet options must always be visible; warehouse export is separate');
assert(/id="hdkdOpt"[^>]*><input[^>]*value="hdkd" checked/.test(panelHtml),
 'HĐKD sheet must be checked by default');
assert(!panelHtml.includes('class="sheet-more"')&&!panelHtml.includes('id="hdkdOpt" class="check" title="Mẫu 01-2/BK-HĐKD cho hộ kinh doanh, lập từ hóa đơn mua vào" hidden'),
 'No collapsed or hidden optional Excel sheets');
assert(panelCss.includes('.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))'),
 'All four download formats must stay in one row');
assert(!panelJs.includes("$(id).hidden = !show"),
 'Sheet choices must not be disabled based on the current MST business type');
assert(admin.includes('id="app"')&&admin.includes('addon_is_admin'),
 'Admin page must keep server-verified access checks');
assert(admin.includes('id="createPackageForm"')&&admin.includes('id="createPackageMessage"'),
 'Admin must expose a dedicated new-package form with local status feedback');
assert(admin.includes('normalizePackageCode')&&admin.includes('addon_admin_create_package'),
 'Admin must normalize package codes before calling the existing guarded catalog RPC');
assert(admin.includes('^[A-Z0-9_]{2,24}
assert(!panelHtml.includes('Cập nhật mới:')&&!panelHtml.includes('Phiên bản sử dụng nội bộ'),'Obsolete extension notices must be removed');
const adminHtml=load('docs/admin.html');
assert(adminHtml.includes('id="adminPackageGrant"'), 'Admin direct grant panel missing');
assert(adminHtml.includes('addon_admin_grant_package_v32'), 'Admin direct grant RPC missing');
assert(adminHtml.includes('id="packageHistoryDialog" class="history-modal"'), 'Missing modal history window');
assert(adminHtml.includes('addon_admin_search_package_transactions_v32'), 'Admin history must call server-paged transactions with search filter');
assert(adminHtml.includes('id="historyPrev"') && adminHtml.includes('id="historyNext"'), 'Missing history pager');
assert(adminHtml.includes('data-history='), 'Missing customer-specific history shortcut');
assert(!adminHtml.includes('id="packageHistoryBody"'), 'Old inline expanded history must not be present');
assert(adminHtml.includes('id="packageAdjustmentDialog"'),'Missing audited package revocation dialog');
assert(adminHtml.includes('addon_admin_adjust_package_lot_v32'),'Missing revoke/restore RPC hookup');
assert(adminHtml.includes('addon_admin_compensate_failed_order_v32'),'Missing failed/refunded compensation RPC hookup');
assert(adminHtml.includes('<th>Mã đơn</th><th>Mã giao dịch</th>'),'Missing order and transaction ID columns');
assert(adminHtml.includes('id="packageOrderSearch"'),'Missing order search input');
assert(adminHtml.includes('addon_admin_search_package_transactions_v32'), 'Admin history must filter on server');
assert(adminHtml.includes('id="packageOrderClearBtn"'), 'Admin history must permit clearing order search');
assert(adminHtml.includes('addon_admin_hide_package_history_v32'), 'Admin history hide RPC must be wired');
assert(adminHtml.includes('data-adjust="hide"'), 'Admin history must provide hide button for eligible records');
assert(adminHtml.includes('h.can_hide'), 'Admin hide button must depend on server authorization');
assert(adminHtml.includes('days=family==="mst"?365:null'), 'MST family must default to 365 days in admin');
const candidate=load('addon-portal/supabase/PRODUCTION_UPGRADE_V32_ONE_TIME.sql');
for(let number=5;number<=19;number++)assert(candidate.includes('-- =========== '+String(number).padStart(3,'0')+'_'),'Missing migration '+number);
const truncate=candidate.split('truncate table')[1]?.split('restart identity restrict')[0]||'';
assert(!truncate.includes('auth.users'),'auth.users is in truncate');
assert(!truncate.includes('addon_admins'),'admin roles are in truncate');
assert(candidate.includes('v32_already_installed_or_partial_state_stop'),'Missing one-time migration guard');
assert(candidate.includes('v32_backup_stale_content_for_'),'Production reset must verify all snapshot data');
assert(candidate.includes('v32_backup_required_missing_manifest'),'Production reset must refuse missing snapshots');
assert(!/create\s+temp(?:orary)?\s+table/i.test(candidate),'Production upgrade must not create an RLS-less baseline table');
assert(candidate.includes("set_config('autotax_v32.auth_count'"),'Production upgrade must record auth count transaction-locally');
assert(candidate.includes("set_config('autotax_v32.admin_count'"),'Production upgrade must record admin count transaction-locally');
assert(candidate.includes('v32_backup_rls_or_grant_invalid'),'Production reset must reject exposed backups');
assert(!/drop\s+table\s+[^;]*cascade/i.test(candidate),'Unsafe drop table cascade');
assert.equal((candidate.match(/\$\$/g)||[]).length%2,0,'Unbalanced upgrade $$');
console.log('V3.2 sync source checks passed: UI IDs, JS syntax, RPCs, SQL quote balance, legacy guards and account preservation.');
)&&admin.includes('Mã gói phải dài 2–24'),
 'Admin must validate the same package code rules as Supabase');
assert(admin.includes('Mã "+code+" đã tồn tại')&&admin.includes('Đang tạo gói'),
 'Admin must reject duplicate codes and prevent repeated submissions');
assert(!admin.includes('</div></div></div>\\n<section id="adminPackageGrant"'),
 'Invalid extra closing div must not break admin-only panel containment');
assert(!admin.includes('@media(max-width:520px){</style>'),
 'Admin stylesheet must not contain an unterminated media query');
assert(!admin.includes('một trong 10 gói'),
 'Admin product catalog must not be described as fixed to 10 plans');
assert(!panelHtml.includes('Cập nhật mới:')&&!panelHtml.includes('Phiên bản sử dụng nội bộ'),'Obsolete extension notices must be removed');
const adminHtml=load('docs/admin.html');
assert(adminHtml.includes('id="adminPackageGrant"'), 'Admin direct grant panel missing');
assert(adminHtml.includes('addon_admin_grant_package_v32'), 'Admin direct grant RPC missing');
assert(adminHtml.includes('id="packageHistoryDialog" class="history-modal"'), 'Missing modal history window');
assert(adminHtml.includes('addon_admin_search_package_transactions_v32'), 'Admin history must call server-paged transactions with search filter');
assert(adminHtml.includes('id="historyPrev"') && adminHtml.includes('id="historyNext"'), 'Missing history pager');
assert(adminHtml.includes('data-history='), 'Missing customer-specific history shortcut');
assert(!adminHtml.includes('id="packageHistoryBody"'), 'Old inline expanded history must not be present');
assert(adminHtml.includes('id="packageAdjustmentDialog"'),'Missing audited package revocation dialog');
assert(adminHtml.includes('addon_admin_adjust_package_lot_v32'),'Missing revoke/restore RPC hookup');
assert(adminHtml.includes('addon_admin_compensate_failed_order_v32'),'Missing failed/refunded compensation RPC hookup');
assert(adminHtml.includes('<th>Mã đơn</th><th>Mã giao dịch</th>'),'Missing order and transaction ID columns');
assert(adminHtml.includes('id="packageOrderSearch"'),'Missing order search input');
assert(adminHtml.includes('addon_admin_search_package_transactions_v32'), 'Admin history must filter on server');
assert(adminHtml.includes('id="packageOrderClearBtn"'), 'Admin history must permit clearing order search');
assert(adminHtml.includes('addon_admin_hide_package_history_v32'), 'Admin history hide RPC must be wired');
assert(adminHtml.includes('data-adjust="hide"'), 'Admin history must provide hide button for eligible records');
assert(adminHtml.includes('h.can_hide'), 'Admin hide button must depend on server authorization');
assert(adminHtml.includes('days=family==="mst"?365:null'), 'MST family must default to 365 days in admin');
const candidate=load('addon-portal/supabase/PRODUCTION_UPGRADE_V32_ONE_TIME.sql');
for(let number=5;number<=19;number++)assert(candidate.includes('-- =========== '+String(number).padStart(3,'0')+'_'),'Missing migration '+number);
const truncate=candidate.split('truncate table')[1]?.split('restart identity restrict')[0]||'';
assert(!truncate.includes('auth.users'),'auth.users is in truncate');
assert(!truncate.includes('addon_admins'),'admin roles are in truncate');
assert(candidate.includes('v32_already_installed_or_partial_state_stop'),'Missing one-time migration guard');
assert(candidate.includes('v32_backup_stale_content_for_'),'Production reset must verify all snapshot data');
assert(candidate.includes('v32_backup_required_missing_manifest'),'Production reset must refuse missing snapshots');
assert(!/create\s+temp(?:orary)?\s+table/i.test(candidate),'Production upgrade must not create an RLS-less baseline table');
assert(candidate.includes("set_config('autotax_v32.auth_count'"),'Production upgrade must record auth count transaction-locally');
assert(candidate.includes("set_config('autotax_v32.admin_count'"),'Production upgrade must record admin count transaction-locally');
assert(candidate.includes('v32_backup_rls_or_grant_invalid'),'Production reset must reject exposed backups');
assert(!/drop\s+table\s+[^;]*cascade/i.test(candidate),'Unsafe drop table cascade');
assert.equal((candidate.match(/\$\$/g)||[]).length%2,0,'Unbalanced upgrade $$');
console.log('V3.2 sync source checks passed: UI IDs, JS syntax, RPCs, SQL quote balance, legacy guards and account preservation.');
