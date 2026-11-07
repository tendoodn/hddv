/* AutoTax V1.2.0 — install each functional route independently. */
(()=>{
'use strict';
if(!('serviceWorker' in navigator)||!location.protocol.startsWith('https'))return;
navigator.serviceWorker.register('/pwa-sw.js',{scope:'/'}).catch(error=>console.warn('Không thể kích hoạt cài đặt ứng dụng:',error.message));
let deferred=null;
const installed=window.matchMedia('(display-mode: standalone)').matches||
  window.navigator.standalone===true;
if(installed)return;
let button=null;
function show(){
 if(button)return;
 button=document.createElement('button');
 button.type='button';
 button.id='autotaxInstallApp';
 button.textContent='Cài ứng dụng lên màn hình';
 button.title='Cài đặt trang này như một ứng dụng độc lập';
 button.style.cssText='position:fixed;z-index:9000;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));padding:10px 14px;background:#0e805b;color:white;border:1px solid #84dfb3;border-radius:10px;box-shadow:0 4px 16px #0004;font:700 12px system-ui;max-width:215px';
 button.addEventListener('click',async()=>{
  if(deferred){
   const event=deferred;deferred=null;
   await event.prompt();const result=await event.userChoice;
   if(result?.outcome==='accepted')button?.remove();
  }else{
   alert('Mở menu trình duyệt (⋮) rồi chọn “Thêm vào màn hình chính” hoặc “Cài đặt ứng dụng”.');
  }
 });
 document.body.append(button);
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;show()});
window.addEventListener('appinstalled',()=>{deferred=null;button?.remove();button=null});
if(/iPad|iPhone|iPod/.test(navigator.userAgent))window.addEventListener('load',show,{once:true});
})();
