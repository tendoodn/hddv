/* AutoTax V1.2.0: scoped install action for standalone Web / Lite / User / Admin / Price / PDF. */
(()=>{'use strict';
 const current=new URL(location.href);
 const scope=current.pathname.split('/').filter(Boolean)[0]||'';
 if(!['lite','user','admin','baogia','pdf','hddt'].includes(scope))return;
 const base='/'+scope+'/';
 if('serviceWorker' in navigator&&isSecureContext)
  window.addEventListener('DOMContentLoaded',()=>navigator.serviceWorker.register(
    base+'sw.js'+(scope==='lite'?'?v=123-fast1':''),
    {scope:base,updateViaCache:'none'}
  ).then(reg=>{if(scope==='lite')void reg.update().catch(()=>{})})
   .catch(error=>console.warn('Không thể đăng ký cài ứng dụng:',error.message)),{once:true});
 const showInstallButton=scope==='lite';
 if(!showInstallButton)return;
 let deferred=null,button=null;
 const standalone=window.matchMedia?.('(display-mode: standalone)').matches||
  window.navigator.standalone===true;
 function attach(){
  if(standalone||document.getElementById('autotaxInstallApp'))return;
  button=document.createElement('button');button.type='button';button.id='autotaxInstallApp';
  button.textContent='Cài ứng dụng';
  button.title='Thêm trang này như một ứng dụng riêng trên màn hình chính';
  button.style.cssText='position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:900;min-height:38px;padding:8px 13px;border-radius:10px;background:#116b4b;border:1px solid #58d9a0;color:white;box-shadow:0 6px 22px #0005;font:700 12px system-ui;cursor:pointer';
  button.addEventListener('click',async()=>{
   if(deferred){const event=deferred;deferred=null;event.prompt();await event.userChoice.catch(()=>{});button.hidden=true;return}
   alert(/iPhone|iPad/i.test(navigator.userAgent)?
    'Trong Safari, bấm Chia sẻ → Thêm vào Màn hình chính.':
    'Trong Chrome, mở menu ⋮ → Thêm vào màn hình chính hoặc Cài đặt ứng dụng.');
  });
  document.body.append(button);
 }
 window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();deferred=e;attach();
 });
 window.addEventListener('appinstalled',()=>{deferred=null;if(button)button.remove()});
 // Manual Add to Home Screen is always available in the browser menu;
 // install button offers the app installation gesture when supported.
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});else attach();
})();