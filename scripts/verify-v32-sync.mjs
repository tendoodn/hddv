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
for(const path of ['docs/customer.js','docs/admin-mst.js','autotax/src/license/license.js','autotax/src/content/content.js']) testScript(path,load(path));
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
 '018_remove_legacy_plan_order_dependency.sql'
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
  assert(defined.has(match[1]),'Unknown V3.2 RPC '+match[1]+' in '+path);
 }
 assert(!/addon_my_license|addon_claim_trial|addon_redeem_gift/.test(source),'Old RPC in '+path);
}
const candidate=load('addon-portal/supabase/UPGRADE_V32_CANDIDATE_DO_NOT_RUN.sql');
for(let number=5;number<=18;number++)assert(candidate.includes('-- =========== '+String(number).padStart(3,'0')+'_'),'Missing migration '+number);
const truncate=candidate.split('truncate table')[1]?.split('restart identity restrict')[0]||'';
assert(!truncate.includes('auth.users'),'auth.users is in truncate');
assert(!truncate.includes('addon_admins'),'admin roles are in truncate');
assert(candidate.includes('v32_already_installed_or_partial_state_stop'),'Missing one-time migration guard');
assert(!/drop\s+table\s+[^;]*cascade/i.test(candidate),'Unsafe drop table cascade');
assert.equal((candidate.match(/\$\$/g)||[]).length%2,0,'Unbalanced upgrade $$');
console.log('V3.2 sync source checks passed: UI IDs, JS syntax, RPCs, SQL quote balance, legacy guards and account preservation.');
