/* AutoTax V1.1.7 shared accessible show/hide password controls. */
(()=>{
 'use strict';
 function attach(){
  for(const input of document.querySelectorAll('input[type="password"]')){
   if(input.dataset.autotaxEye==='1'||input.id==='gdtPassword'||input.closest('.password-wrap,.demo-gdt-password'))continue;
   input.dataset.autotaxEye='1';
   const wrapper=document.createElement('span');
   wrapper.className='autotax-password-eye';
   input.parentNode.insertBefore(wrapper,input);
   wrapper.appendChild(input);
   const button=document.createElement('button');
   button.type='button';button.className='autotax-eye-button';
   button.textContent='👁';button.title='Hiện mật khẩu';
   button.setAttribute('aria-label','Hiện mật khẩu');
   button.setAttribute('aria-pressed','false');
   button.addEventListener('click',()=>{
    const revealed=input.type==='password';input.type=revealed?'text':'password';
    button.title=revealed?'Ẩn mật khẩu':'Hiện mật khẩu';
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed',String(revealed));
   });
   wrapper.appendChild(button);
  }
 }
 const style=document.createElement('style');
 style.textContent='.autotax-password-eye{display:inline-flex;align-items:stretch;position:relative;max-width:100%;width:100%;vertical-align:middle}.autotax-password-eye>input{padding-right:44px;min-width:0;max-width:100%}.autotax-eye-button{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:transparent!important;border:0!important;box-shadow:none!important;color:inherit!important;padding:5px 8px!important;min-width:0!important;cursor:pointer;line-height:1.3}';
 document.head.append(style);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach);else attach();
 const observer=new MutationObserver(attach);
 observer.observe(document.documentElement,{childList:true,subtree:true});
})();