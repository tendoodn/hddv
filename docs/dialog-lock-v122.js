/* AutoTax V1.2.2: sensitive account dialogs close only through explicit UI controls. */
(()=>{
 'use strict';
 const selector=[
  'dialog.web-account-dialog',
  '#webLoginDialog','#webSignupDialog','#webForgotDialog','#webResetDialog',
  '#webRecoveryDialog','#profileDialog','#passwordDialog'
 ].join(',');
 const lock=dialog=>{
  if(!dialog||dialog.dataset.autotaxExplicitClose==='1')return;
  dialog.dataset.autotaxExplicitClose='1';
  dialog.addEventListener('cancel',event=>event.preventDefault());
  dialog.addEventListener('click',event=>{
   if(event.target===dialog){event.preventDefault();event.stopImmediatePropagation()}
  },true);
 };
 const scan=()=>document.querySelectorAll(selector).forEach(lock);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});
 else scan();
 new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
