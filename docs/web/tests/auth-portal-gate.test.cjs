/* AutoTax security regression: account/Admin must never collect login credentials.
 * Run with: node docs/web/tests/auth-portal-gate.test.cjs
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const publicWeb=read('index.html');
const user=read('user/index.html');
const admin=read('admin/index.html');
const customer=read('customer.js');
const sdk='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js';
for(const [name,html] of [['user',user],['admin',admin]]){
  assert.doesNotMatch(html,/localStorage\.getItem\('sb-ucqqjdsoyvvaxswzbhaw-auth-token'\)/,
    name+' must not race token refresh with a synchronous localStorage redirect');
  assert.ok(html.includes(sdk),name+' must load a pinned Supabase SDK');
  for(const id of ['loginForm','signupForm','resetPasswordForm','authSection','login']){
    assert.ok(!new RegExp('<(?:form|section|button|input)\\b[^>]*\\bid=["\\\']'+id+'["\\\']').test(html),
      name+' must not expose '+id);
  }
  assert.doesNotMatch(html,/auth\.signInWithPassword\s*\(/,
    name+' must not accept passwords directly');
}
assert.ok(publicWeb.includes('id="webLoginForm"'),'Main Web must retain sign-in');
assert.ok(publicWeb.includes('id="webSignupForm"'),'Main Web must retain sign-up');
assert.match(customer,/if\(!signedIn\)\{location\.replace\('\/'\);return;\}/,
 'User page redirects only after Supabase confirms no session');
assert.match(customer,/if\(!userResult\?\.user\)throw Error/,
 'User page must validate the current identity before displaying account data');
assert.match(admin,/if\(!session\)\{location\.replace\('\/'\);return;\}/,
 'Admin page must redirect when Supabase confirms no session');
assert.doesNotMatch(customer,/\$\("loginForm"\)|\$\("signupForm"\)|\$\("authSection"\)/,
 'Customer script cannot reference removed login controls');
assert.match(admin,/await client\.auth\.getUser\(\)/,
 'Admin must authenticate identity with Supabase Auth');
assert.match(admin,/client\.rpc\("addon_is_admin"\)/,
 'Admin must authorize with the server-side RPC');
assert.match(user,/customer\.js\?v=[^"']+/, 'User must use a versioned customer JS URL to invalidate old sign-in code');
new vm.Script(customer,{filename:'customer.js'});
for(const [i,script] of [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).entries()){
 if(script.trim())new vm.Script(script,{filename:'admin inline script '+i});
}
console.log('PASS AutoTax /user and /admin session-only access, no credential forms; Web login intact.');
