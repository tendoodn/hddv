/* AutoTax Lite PWA static accelerator v1.2.3.
   Cache only public static runtime assets. Never cache invoice/API responses,
   credentials, Supabase requests, GDT requests, or HTML navigation responses. */
const STATIC_CACHE='autotax-lite-static-v125-mst1';
const STATIC_ASSETS=[
 '/web/web.css?v=125',
 '/lite/lite.css?v=125',
 '/auth-extension-bridge.js?v=20261107sync121b',
 '/account-flow.js?v=20261107pass8',
 '/web/account-modal.js?v=20261107pass8',
 '/web/captcha-svg-templates.js?v=1',
 '/web/captcha-svg.js?v=1',
 '/web/hddt-api.js?v=20261106xmlfull2',
 '/mst-sync.js?v=118',
 '/team-shared-v119.js?v=20261106teamsync',
 '/web/vault.js?v=20261107mstlist125a',
 '/web/invoice-cache-v120.js?v=20261107cache30',
 '/web/date-slide-picker.js?v=1122b',
 '/web/web.js?v=20261107mstlist125a',
 '/web/web-results.js?v=20261107lite1',
 '/web/pdf.js?v=20261107fontpath123',
 '/web/pdf-preview-v120a.js?v=20261107pwa-fullpinch124',
 '/lite/lite.js?v=20261107lite1',
 '/password-toggle.js?v=116',
 '/favicon.svg?v=20261102b',
 '/apple-touch-icon.png?v=20261102b'
];

self.addEventListener('install',event=>{
 self.skipWaiting();
 event.waitUntil((async()=>{
  const cache=await caches.open(STATIC_CACHE);
  await Promise.allSettled(STATIC_ASSETS.map(async url=>{
   const res=await fetch(url,{cache:'reload'});
   if(res.ok)await cache.put(url,res);
  }));
 })());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('autotax-lite-static-')&&k!==STATIC_CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});

self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 // Navigations are always fresh. This prevents an old app shell after deploy.
 if(req.mode==='navigate'){
  event.respondWith(fetch(req));
  return;
 }
 // Only cache same-origin public static files. API/data requests always bypass SW.
 if(url.origin!==self.location.origin)return;
 if(!/\.(?:js|css|svg|png|ico|ttf|webmanifest)$/.test(url.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(STATIC_CACHE);
  const hit=await cache.match(req);
  const fresh=fetch(req).then(res=>{
   if(res.ok)void cache.put(req,res.clone());
   return res;
  }).catch(()=>null);
  if(hit){event.waitUntil(fresh);return hit}
  return await fresh||Response.error();
 })());
});
