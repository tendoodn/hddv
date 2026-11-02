import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const page=read('docs/mst.html'),frontend=read('docs/web/mst-lookup.js');
const broker=read('addon-portal/supabase/functions/autotax-mst-lookup/index.ts');
const customer=read('docs/customer.js'),webTax=read('docs/web/hddt-api.js'),
addonTax=read('autotax/src/content/hddt-api.js'),
trial=read('autotax/src/license/license.js'),portal=read('docs/index.html');
assert(page.includes('id="mstResults"')&&page.includes('id="mstProgressFill"')&&
 page.includes('id="mstFilter"')&&page.includes('id="mstSuccess"'),'Progress UI and status filter present');
assert(frontend.includes("autotax-mst-lookup")&&!frontend.includes("invoy.io.vn"),
 'Browser must use AutoTax server broker instead of direct cross-origin third-party lookup.');
assert(broker.includes('api.vietqr.io/v2/business/')&&
 broker.includes('PAY2S_PERSONAL_ENABLED')&&broker.includes('PAY2S_SECRET_KEY'),
 'Broker must use documented providers, protecting personal identifiers unless approved.');
assert(broker.includes('method:"POST"')&&broker.includes('body.codes.length>20')&&
 broker.includes('recentRequests'),'Broker must rate limit and cap batches.');
assert(broker.includes('if(n.kind==="personal")return null'),'Never send 12-digit personal IDs to public business API.');
assert(customer.includes('10, 12 hoặc 13 chữ số')&&
 trial.includes('10, 12 hoặc 13 chữ số')&&portal.includes('maxlength="14"'),
 'Customer, trial and profile must accept branch and personal tax IDs');
assert(webTax.includes('const MST_RE = /^(?:')&&addonTax.includes('const MST_RE = /^(?:'),
 'Shared tax search engines must permit personal and 13-digit branch codes.');
new vm.Script(frontend,{filename:'docs/web/mst-lookup.js'});
console.log('MST front-end, broker, source labels, three tax-ID kinds and app/extension validators passed.');
if(process.env.LIVE_MST_LOOKUP==='1'){
 // This is a publicly documented demo corporate tax ID, NOT a personal identifier.
 const url='https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-mst-lookup';
 try{
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({codes:['0316794479']}),signal:AbortSignal.timeout(17000)});
  const data=await res.json();
  assert.equal(res.status,200,'Public MST broker must return HTTP 200');
  assert.equal(data?.count,1);
  assert.equal(data.data[0].mst,'0316794479');
  console.log('LIVE MST broker:',JSON.stringify({
   http:res.status,verified:data.data[0].verified,
   source:data.data[0].source,error:data.data[0].error||null}));
  if(!data.data[0].verified)console.log('::warning::MST provider not verified; page must show unverified rather than fabricate taxpayer details.');
 }catch(e){
  console.log('::warning::Broker live check unreachable: '+e.message);
 }
}