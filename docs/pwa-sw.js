/* AutoTax V1.2.0 installability worker. Always use fresh network responses.
   Auth, tax data and PDFs must never be cached or intercepted here. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request));
 }
});
