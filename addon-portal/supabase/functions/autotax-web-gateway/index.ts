// AutoTax Web proxy for the fixed, official GDT host.
// Requires a logged-in AutoTax user; never stores GDT passwords, JWTs, or invoice files.
const ALLOWED_ORIGIN = 'https://tendoodn.github.io';
const GDT_BASE = 'https://hoadondientu.gdt.gov.vn';
const MAX_BODY = 12000;
const JSON_HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const headersFor = (origin) => ({
  ...JSON_HEADERS,'Access-Control-Allow-Origin':origin==='https://tendoodn.github.io'?origin:ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin',
  'X-Content-Type-Options':'nosniff',
});
const response = (data, status, origin) => new Response(JSON.stringify(data), {status,headers:headersFor(origin)});
const cleanMst = (text) => String(text||'').replace(/[^0-9]/g,'');
const bearer = (v) => /^Bearer ([^\s]+)$/i.exec(v||'')?.[1]||'';
const parseJwtSub = (jwt) => {
  try {
    const segment=jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const payload=JSON.parse(atob(segment));
    if(payload.exp && payload.exp*1000 < Date.now()) return '';
    return cleanMst(payload.sub);
  }catch{return '';}
};
async function upstream(url, init, timeout=25000) {
  return await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(timeout)});
}
Deno.serve(async(req) => {
  const origin=req.headers.get('origin')||'';
  if(req.method==='OPTIONS')
    return new Response(null,{status:204,headers:headersFor(origin)});
  if(req.method!=='POST')
    return response({error:'method_not_allowed'},405,origin);
  if(origin!==ALLOWED_ORIGIN)
    return response({error:'origin_not_allowed'},403,origin);
  const autoToken=bearer(req.headers.get('authorization'));
  if(!autoToken) return response({error:'autotax_sign_in_required'},401,origin);
  const supaUrl=Deno.env.get('SUPABASE_URL')||'';
  const supaKey=Deno.env.get('SUPABASE_ANON_KEY')||'';
  if(!supaUrl||!supaKey)
    return response({error:'gateway_not_configured'},503,origin);
  try {
    // Verify the user session server-side. JWT validation is also enforced by Supabase gateway.
    const userRes=await upstream(supaUrl+'/auth/v1/user',{
      headers:{apikey:supaKey,Authorization:'Bearer '+autoToken}},7000);
    if(!userRes.ok) return response({error:'autotax_session_expired'},401,origin);
    if(Number(req.headers.get('content-length')||0)>MAX_BODY)
      return response({error:'payload_too_large'},413,origin);
    const text=await req.text();
    if(text.length>MAX_BODY) return response({error:'payload_too_large'},413,origin);
    const input=JSON.parse(text);
    const op=input.op;
    if(op==='captcha'){
      const r=await upstream(GDT_BASE+'/api/captcha',{
        headers:{Accept:'application/json','request-id':crypto.randomUUID()}},15000);
      return new Response(r.body,{status:r.status,headers:{...headersFor(origin),'Content-Type':r.headers.get('content-type')||'application/json'}});
    }
    if(op==='authenticate'){
      const username=String(input.username||'').trim();
      const password=String(input.password||'');
      const ckey=String(input.ckey||'');
      const cvalue=String(input.cvalue||'').trim();
      if(!/^[0-9]{10}(?:-[0-9]{3})?(?:-U[0-9]{3})?$/.test(username)||
          password.length<1||password.length>256||ckey.length>150||!cvalue||cvalue.length>20)
        return response({error:'invalid_login_details'},400,origin);
      const r=await upstream(GDT_BASE+'/api/security-taxpayer/authenticate',{
        method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',
          'request-id':crypto.randomUUID(),Action:encodeURIComponent('Đăng nhập'),
          'End-Point':'/dang-nhap'},
        body:JSON.stringify({username,password,ckey,cvalue})},25000);
      const payload=await r.text();
      // GDT upstream responses are relayed with no credential logging or database persistence.
      return new Response(payload,{status:r.status,headers:headersFor(origin)});
    }
    if(op!=='get') return response({error:'unsupported_operation'},400,origin);
    const url=new URL(String(input.url||''));
    if(url.origin!==GDT_BASE||!url.pathname.startsWith('/api/'))
      return response({error:'invalid_upstream_host'},400,origin);
    const allowed=[
      /^\/api\/security-taxpayer\/profile$/,
      /^\/api\/(?:query|sco-query)\/invoices\/(?:purchase|sold)$/,
      /^\/api\/(?:query|sco-query)\/invoices\/(?:detail|export-xml)$/,
    ];
    if(!allowed.some(re=>re.test(url.pathname)))
      return response({error:'upstream_path_not_allowed'},403,origin);
    const govtToken=String(input.gdtToken||'');
    if(!govtToken||govtToken.length>5000)
      return response({error:'gdt_sign_in_required'},401,origin);
    const govtMst=parseJwtSub(govtToken);
    const requestedMst=cleanMst(input.mst);
    if(!govtMst||!requestedMst||govtMst!==requestedMst)
      return response({error:'gdt_mst_mismatch'},403,origin);
    const entitlement=await upstream(supaUrl+'/rest/v1/rpc/addon_verify_session_mst_v33',{
      method:'POST',headers:{apikey:supaKey,Authorization:'Bearer '+autoToken,
        'Content-Type':'application/json'},
      body:JSON.stringify({p_mst:requestedMst})},9000);
    if(!entitlement.ok)
      return response({error:'autotax_entitlement_unavailable'},403,origin);
    const permission=await entitlement.json();
    if(!permission?.allowed)
      return response({error:permission?.reason||'mst_not_authorized'},403,origin);
    const extra=input.headers&&typeof input.headers==='object'?input.headers:{};
    const h={'Authorization':'Bearer '+govtToken,'Accept':'application/json',
      'Accept-Language':'vi','request-id':crypto.randomUUID(),
      'Action':String(extra.Action||'').slice(0,220),
      'End-Point':'/tra-cuu/tra-cuu-hoa-don'};
    for(const k of ['ckey','cvalue']){
      if(extra[k])h[k]=String(extra[k]).slice(0,150);
    }
    const r=await upstream(url.toString(),{headers:h},90000);
    const ct=r.headers.get('content-type')||'application/octet-stream';
    return new Response(r.body,{status:r.status,
      headers:{...headersFor(origin),'Content-Type':ct,
        'Cache-Control':'no-store'}});
  }catch(e){
    // Do not include request payload, passwords, tokens, or upstream details in errors.
    const status=e?.name==='TimeoutError'?504:502;
    return response({error:status===504?'gdt_timeout':'gdt_connection_unavailable'},status,origin);
  }
});