/* Large-screen SKU mapper, opened from the AutoTax side panel.
   Data lives in chrome.storage.session only until the originating job consumes it. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const requestId=new URLSearchParams(location.search).get('rid')||'';
  const sessionKey='autotax-tendoo-request-'+requestId;
  let entries=[],products=[],portalTabId=null;
  const choices=new Map();
  const norm=value=>TendooImport.normalize(value);
  function status(message,error=true){
    $('status').textContent=message;
    $('status').style.color=error?'#b91c1c':'#15803d';
  }
  function updateProgress(){
    $('progress').textContent=choices.size+' / '+entries.length+' đã liên kết · '+(entries.length-choices.size)+' sẽ ghi THIẾU MÃ';
    $('save').disabled=!entries.length;
  }
  function optionFor(product,onPick){
    const button=document.createElement('button');
    button.type='button';button.className='option';
    const name=document.createElement('strong');
    name.textContent=product.name;
    const sku=document.createElement('small');
    sku.textContent='SKU: '+product.sku+(product.unit?' · '+product.unit:'');
    button.append(name,sku);
    button.addEventListener('click',()=>onPick(product));
    return button;
  }
  function addRow(entry,index){
    const row=document.createElement('section');row.className='pair';
    const left=document.createElement('div');
    const origin=document.createElement('span');origin.className='caption';origin.textContent='Tên trên hóa đơn mua vào · '+(index+1);
    const name=document.createElement('div');name.className='original';name.textContent=entry.name;
    left.append(origin,name);
    const right=document.createElement('div');
    const label=document.createElement('label');label.className='caption';
    const search=document.createElement('input');
    search.type='search';search.id='skuSearch-'+index;
    label.htmlFor=search.id;label.textContent='Chọn sản phẩm trong BC_San_Pham';
    search.placeholder='Gõ tên, model hoặc SKU để tìm...';search.autocomplete='off';
    const results=document.createElement('div');results.className='results';
    const selected=document.createElement('div');selected.className='selection';
    selected.textContent='Chưa liên kết · sẽ ghi THIẾU MÃ';
    const choose=product=>{
      choices.set(entry.key,product.sku);
      search.value=product.name+' · '+product.sku;
      selected.textContent='Đã liên kết: '+product.name+' ('+product.sku+')';
      selected.classList.add('ok');
      results.replaceChildren();updateProgress();status('',false);
    };
    function filter(term){
      results.replaceChildren();
      const matched=TendooImport.searchCatalog(products,term,15);
      for(const p of matched)results.append(optionFor(p,choose));
      if(!matched.length){
        const empty=document.createElement('small');
        empty.textContent='Không tìm thấy: có thể bỏ qua, Excel sẽ ghi THIẾU MÃ.';
        results.append(empty);
      }
    }
    search.addEventListener('focus',()=>filter(search.value));
    search.addEventListener('input',()=>{
      choices.delete(entry.key);selected.classList.remove('ok');
      selected.textContent='Chưa liên kết · sẽ ghi THIẾU MÃ';updateProgress();filter(search.value);
    });
    search.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();results.querySelector('button')?.click()}
      if(e.key==='ArrowDown'){const first=results.querySelector('button');if(first){e.preventDefault();first.focus()}}
    });
    right.append(label,search,selected,results);row.append(left,right);
    $('rows').append(row);
  }
  async function init(){
    if(!/^tendoo-map-[a-zA-Z0-9.-]+$/.test(requestId))throw Error('Mã phiên liên kết không hợp lệ.');
    const saved=await chrome.storage.session.get(sessionKey);
    const payload=saved[sessionKey];
    if(!payload||!Array.isArray(payload.names)||!Array.isArray(payload.products))throw Error('Phiên liên kết đã hết hạn. Vui lòng mở lại từ sidepanel AutoTax.');
    entries=payload.names;products=payload.products;portalTabId=payload.portalTabId;
    if(!products.length||!entries.length)throw Error('Không có sản phẩm cần liên kết.');
    $('overview').textContent=entries.length+' tên hàng chưa khớp · '+products.length+' SKU có trong danh mục';
    for(const [index,entry] of entries.entries())addRow(entry,index);
    updateProgress();
  }
  $('linkForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const mapping=Object.fromEntries(choices);
    $('save').disabled=true;status('Đang gửi kết quả liên kết...',false);
    try{
      const answer=await chrome.runtime.sendMessage({type:'stock-tab-mapping',portalTabId,requestId,mapping});
      if(!answer?.ok)throw Error(answer?.error||'Trang hóa đơn đã đóng hoặc phiên liên kết hết hạn.');
      await chrome.storage.session.remove(sessionKey);
      status('Đã lưu các mã đã chọn. Những mã còn thiếu sẽ được đánh dấu THIẾU MÃ.',false);
      const tab=await chrome.tabs.getCurrent();
      if(tab?.id)await chrome.tabs.remove(tab.id);
    }catch(error){status(error.message);$('save').disabled=false}
  });
  init().catch(error=>{
    $('overview').textContent='Không mở được phiên liên kết';
    status(error.message);$('save').disabled=true;
  });
})();
