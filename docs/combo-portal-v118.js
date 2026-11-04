/* AutoTax V1.1.18: display both entitlements for combo products on the existing portal. */
(()=>{
'use strict';
const list=document.getElementById('packageList');
if(!list||!window.supabase)return;
const db=window.supabase.createClient('https://ucqqjdsoyvvaxswzbhaw.supabase.co','sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ');
const defaults=['T100','T200','T500','T1000','T5000','MST1','MST5','MST10','MST20','MST50'];
let pending=false,lastAt=0,cache=null;
async function getCatalog(){
 if(cache&&Date.now()-lastAt<60000)return cache;
 const [r,c]=await Promise.all([
  db.rpc('addon_list_packages'),
  db.from('autotax_combo_catalog_v118').select('package_code,invoice_quantity,invoice_validity_days')
 ]);
 if(r.error)throw r.error;if(c.error)throw c.error;
 const rows=Array.isArray(r.data)?r.data:[];
 const combos=new Map((c.data||[]).map(x=>[x.package_code,x]));
 const sorted=[...defaults.map(code=>rows.find(p=>p.code===code)).filter(Boolean),
  ...rows.filter(p=>!defaults.includes(p.code)).sort((a,b)=>(a.code==='DATA365'?-1:b.code==='DATA365'?1:0))];
 cache={sorted,combos};lastAt=Date.now();return cache;
}
async function decorate(){
 if(pending||!list.querySelector(':scope > .plan'))return;
 pending=true;
 try{
  const {sorted,combos}=await getCatalog();
  const cards=[...list.querySelectorAll(':scope > .plan')];
  for(let i=0;i<sorted.length;i++){
   const item=sorted[i],combo=combos.get(item.code);
   if(!combo)continue;
   const card=cards[i];if(!card||card.querySelector('h3')?.textContent!==item.name)continue;
   const p=card.querySelector('p');if(!p)continue;
   const msg=item.quantity+' MST · '+item.validity_days+' ngày, kèm '+
    Number(combo.invoice_quantity).toLocaleString('vi-VN')+' lượt hóa đơn'+
    (combo.invoice_validity_days?' · hạn số tờ '+combo.invoice_validity_days+' ngày':' · cùng hạn MST')+
    '. Hai quyền được cấp cùng lúc; có thể chuyển chế độ sử dụng khi cần.';
   if(p.textContent!==msg)p.textContent=msg;
   card.dataset.autotaxCombo=item.code;
  }
 }catch(e){console.warn('AutoTax: chưa hiển thị được quyền lợi combo',e)}
 finally{pending=false}
}
async function decorateTeamBalance(){
 try{
  const {data:{session}}=await db.auth.getSession();
  if(!session?.user)return;
  const {data,error}=await db.rpc('autotax_my_entitlements_v118');
  if(error)throw error;
  const remaining=Number(data?.team_invoice_remaining||0);
  let hint=document.getElementById('autotaxTeamInvoiceBalanceHint');
  if(!hint){hint=document.createElement('small');hint.id='autotaxTeamInvoiceBalanceHint';hint.className='muted';document.getElementById('invoiceBalance')?.after(hint)}
  hint.hidden=remaining<=0;
  const teamMstCount=Number(data?.team_mst_count||0);
  let mstHint=document.getElementById('autotaxTeamMstBalanceHint');
  if(!mstHint){mstHint=document.createElement('small');mstHint.id='autotaxTeamMstBalanceHint';mstHint.className='muted';document.getElementById('mstExpiry')?.after(mstHint)}
  mstHint.hidden=teamMstCount<=0;
  if(teamMstCount>0)mstHint.textContent='Nhóm cấp quyền xem '+teamMstCount.toLocaleString('vi-VN')+' MST: '+(data.team_mst_allowed_msts||[]).join(', ')+'. Không sử dụng suất MST cá nhân.';
  if(remaining>0){
   hint.textContent='Nhóm dùng chung còn '+remaining.toLocaleString('vi-VN')+' lượt (ưu tiên trừ trước gói cá nhân).';
   const title=document.getElementById('licenseTitle');
   if(title&&title.textContent==='Chưa có gói hiệu lực')title.textContent='Đang có quyền sử dụng qua nhóm';
  }
 }catch(e){console.warn('AutoTax: chưa đồng bộ được lượt nhóm',e)}
}
const observer=new MutationObserver(()=>{void decorate()});
observer.observe(list,{childList:true});
void decorate();void decorateTeamBalance();
window.addEventListener('focus',()=>{cache=null;void decorate();void decorateTeamBalance()});
})();