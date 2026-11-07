/* AutoTax V1.2.0 standalone app scope /baogia/. No credential/invoice caching. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate'&&event.request.method==='GET')
  event.respondWith(fetch(event.request));
});
