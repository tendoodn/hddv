/* V1.2.0 purchase intent and six Add-on visual states, offline static guards.
   Server financial flows are tested separately with rolled-back SQL fixtures. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const user=read('user/index.html'),customer=read('customer.js'),
 demo=read('demo-addon-6/index.html'),demoCss=read('demo-addon-6/panel.css');
assert.match(user,/id="mstPurchaseModeDialog"/);
for(const id of ['mstPurchaseQuantity','mstPurchaseDuration','mstPurchaseCancel','mstPurchaseModePreview']){
 assert(user.includes('id="'+id+'"'),'Missing MST mode modal '+id);
}
for(const label of ['Tăng số lượng dùng','Tăng thời gian dùng']){
 assert(user.includes(label),'MST purchase mode label missing: '+label);
}
assert.match(customer,/chooseMstPurchaseMode\(packageCode\)/);
assert.match(customer,/autotax_set_mst_purchase_mode_v120/);
assert.match(customer,/p_order_id:result\.order\.order_id/);
assert.match(customer,/purchaseMode:paymentOrder\.purchaseMode/);
assert.match(customer,/mst\.expiring_quantity/);
assert.match(customer,/Math\.max\(0,quantity-renew\)/);
assert.match(user,/customer\.js\?v=20261107mstmodes120/);
assert.match(user,/release-notice-v128\.js\?v=1200/,'Existing release notice must remain unchanged.');
assert.match(demo,/<meta name="robots" content="noindex,nofollow">/);
assert.match(demo,/<link rel="stylesheet" href="\.\/panel\.css\?v=1206">/);
for(let i=0;i<6;i++)assert(demo.includes('data-state="'+i+'"'),'Missing simulated Add-on scene '+i);
for(const state of ['Đăng nhập AutoTax','Đăng nhập cổng Thuế','Sẵn sàng tra cứu','Đang chạy','Hoàn tất','Thiếu quyền / hết lượt'])
 assert(demo.includes(state),'Missing visual scenario '+state);
assert.match(demoCss,/--accent:#0f766e/,'Demo must keep current Add-on theme tokens');
assert.match(demoCss,/\.license-card/,'Demo CSS must include real license card');
assert.match(demoCss,/\.autotax-kind-row/,'Demo CSS must include real invoice controls');
console.log('AutoTax MST purchase and six-scene Add-on visual demo checks PASSED');
