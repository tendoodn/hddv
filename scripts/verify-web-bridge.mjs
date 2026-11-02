/* Keep the Website's invoice engine in sync with the extension's source of truth. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const code=read('docs/web/hddt-api.js');
let canonical=read('autotax/src/content/hddt-api.js');
canonical=canonical.replace(
  "  function token() {\n    const m = document.cookie.match(/(?:^|;\\s*)jwt=([^;]+)/);\n    return m ? decodeURIComponent(m[1]) : null;\n  }",
  "  function token() {\n    // Web session lives only in JavaScript memory, never in cookies or localStorage.\n    return window.WebTaxState?.token || null;\n  }"
).replace(
  "const res = await fetch(url, { credentials: 'include', headers: headers(act, { auth, extra, endPoint }), cache: 'no-store', signal: ctrl.signal });",
  "const res = await window.WebTaxTransport(url, { headers: headers(act, { auth, extra, endPoint }), signal: ctrl.signal });"
);
assert.equal(code,"// AutoTax Web adapter — copied from the extension's invoice engine; only token and fetch transport differ.\n"+canonical,
  'GDT Web adapter drifted from the extension. Apply the two web transport changes again.');
for(const filename of ['zip.js','xlsx.js','report.js','captcha-svg.js','captcha-svg-templates.js'])
  assert.equal(read('docs/web/'+filename),read('autotax/src/content/'+filename),
    filename+' in the website must match the extension.');
const html=read('docs/web.html'),frontend=read('docs/web/web.js');
const gateway=read('addon-portal/supabase/functions/autotax-web-gateway/index.ts');
for(const id of ['searchForm','mst','gdtPassword','captchaInput','fromDate','toDate',
  'searchBtn','exportExcel','exportXml','exportTax','exportPdf','resultRows']){
  assert(html.includes('id="'+id+'"'),'Missing Web form field: '+id);
}
for(const s of ['./web/zip.js','./web/xlsx.js','./web/report.js','./web/hddt-api.js','./web/web.js'])
  assert(html.includes(s),'Missing shared client module '+s);
assert(frontend.includes('addon_verify_session_mst_v33')&&
 frontend.includes('addon_claim_invoice_quota'),'Web must use same server entitlement and atomic quota RPC');
assert(frontend.includes('webTax')===false,'No dead web tax adapter references');
assert(!/localStorage\s*\.|sessionStorage\s*\./.test(frontend),'Do not store GDT credentials/tokens in browser storage');
assert(html.includes('id="captchaBox" class="captcha-row" hidden')&&html.includes('id="captchaStatus"'),
 'CAPTCHA should default to automatic mode, with a hidden manual fallback');
assert(frontend.includes('window.SvgCaptcha?.solve(svg)')&&
 frontend.includes("captchaMode='automatic'")&&
 frontend.includes("captchaMode='manual'"),
 'Auto CAPTCHA recognition must use the shared engine and retain a manual fallback');
assert(frontend.includes("confidence>=80")&&frontend.includes("attempt<2"),
 'CAPTCHA recognition must have a confidence threshold and bounded retries');
assert(html.includes('id="gdtConnectionHelp"')&&html.includes('id="retryConnectionBtn"'),
 'Show actionable connectivity help when a GDT CAPTCHA cannot be fetched');
assert(frontend.includes("await img.decode()")&&frontend.includes("resetCaptchaImage()")&&
 frontend.includes("showGatewayHelp(true)")&&
 !frontend.includes("$('captchaBox').hidden=false;\n  $('captchaStatus').textContent='Không tải được"),
 'Never show a manual CAPTCHA field without an image that actually decoded');
assert(!frontend.includes(");await getCaptcha()}"),
 'Do not fetch captcha in the background during account refresh');
assert(frontend.includes("forceFunctionRegion=")&&frontend.includes("ap-southeast-1")&&
 frontend.includes("ap-northeast-1"),
 'Use official regional Edge routing and allow a user-requested retry via another region');
assert(gateway.includes("'gdt_captcha_timeout'")&&gateway.includes("stage='gdt_captcha'"),
 'Gateway must distinguish CAPTCHA upstream failure from other upstream timeouts');
assert(!/localStorage\s*\.|sessionStorage\s*\./.test(frontend),
 'No password or CAPTCHA token may be stored persistently');
assert(gateway.includes('origin!==ALLOWED_ORIGIN')&&
 gateway.includes("const GDT_BASE = 'https://hoadondientu.gdt.gov.vn'"),'Gateway must restrict browser origins and fixed GDT host');
assert(gateway.includes('addon_verify_session_mst_v33')&&
 gateway.includes('parseJwtSub(govtToken)'),'Gateway must verify both GDT MST and AutoTax entitlement');
assert(!gateway.includes('SUPABASE_SERVICE_ROLE_KEY'),'Gateway must not use service-role DB privileges');
for(const file of ['docs/web/web.js','docs/web/hddt-api.js','docs/web/report.js',
  'docs/web/zip.js','docs/web/xlsx.js','docs/web/captcha-svg-templates.js',
  'docs/web/captcha-svg.js']){
  new vm.Script(read(file),{filename:file});
}
console.log('AutoTax Web: 7 scripts parse, form controls present, gateway authorization, extension data adapters in sync.');
