/* AutoTax Web V1.1.22: calendar with left/right month navigation and touch swipe.
 * Keep the exact DD/MM/YYYY fields; never invoke Chrome's native date picker.
 */
(()=>{
 'use strict';
 const dayISO=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 const fromISO=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null};
 const fromVN=s=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s||'');return m?new Date(+m[3],+m[2]-1,+m[1]):null};
 const vn=d=>String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
 function attach({from,to,fromButton,toButton,onSelect}){
  if(!from||!to||!fromButton||!toButton)return;
  const root=from.closest('.date-pair')||from.parentElement;
  const popup=document.createElement('div');
  popup.className='autotax-slide-calendar';
  popup.setAttribute('role','dialog');
  popup.setAttribute('aria-label','Chọn ngày theo tháng');
  popup.hidden=true;root.append(popup);
  let field='from',shown=new Date(),touchX=null;
  const btn=(caption,cls,click,title)=>{
   const b=document.createElement('button');
   b.type='button';b.className=cls;b.textContent=caption;
   if(title)b.title=title;
   b.addEventListener('click',click);
   return b;
  };
  const shift=delta=>{shown=new Date(shown.getFullYear(),shown.getMonth()+delta,1);draw()};
  const close=()=>{popup.hidden=true;fromButton.setAttribute('aria-expanded','false');toButton.setAttribute('aria-expanded','false')};
  function pick(date){
   const iso=dayISO(date);
   onSelect(field==='from'?'fromDate':'toDate',iso);
   close();
  }
  function open(which){
   field=which;
   const value=which==='from'?from:to;
   const d=fromVN(value.value)||new Date();
   shown=new Date(d.getFullYear(),d.getMonth(),1);
   popup.hidden=false;
   fromButton.setAttribute('aria-expanded',String(which==='from'));
   toButton.setAttribute('aria-expanded',String(which==='to'));
   draw();
  }
  function draw(){
   popup.replaceChildren();
   const head=document.createElement('div');head.className='autotax-calendar-header';
   head.append(btn('‹','autotax-calendar-arrow',()=>shift(-1),'Tháng trước'));
   const label=btn('Tháng '+(shown.getMonth()+1)+' / '+shown.getFullYear(),'autotax-calendar-title',()=>{
    // Month/year selection without native browser date UI.
    const chooser=document.createElement('div');chooser.className='autotax-calendar-chooser';
    const mm=document.createElement('select');mm.setAttribute('aria-label','Tháng');
    for(let n=0;n<12;n++){const o=new Option('Tháng '+(n+1),String(n));mm.add(o)}
    mm.value=String(shown.getMonth());
    const yyyy=document.createElement('select');yyyy.setAttribute('aria-label','Năm');
    for(let n=2000;n<=Math.max(2099,new Date().getFullYear()+5);n++){
     const o=new Option(String(n),String(n));yyyy.add(o);
    }
    yyyy.value=String(shown.getFullYear());
    const apply=btn('Chọn','autotax-calendar-apply',()=>{
      shown=new Date(Number(yyyy.value),Number(mm.value),1);draw();
    });
    chooser.append(mm,yyyy,apply);
    popup.replaceChildren(head,chooser);
   },'Bấm để chọn tháng và năm');
   head.append(label,btn('›','autotax-calendar-arrow',()=>shift(1),'Tháng sau'));
   popup.append(head);
   const grid=document.createElement('div');grid.className='autotax-calendar-grid';
   ['T2','T3','T4','T5','T6','T7','CN'].forEach(t=>{
     const node=document.createElement('span');node.className='autotax-calendar-weekday';node.textContent=t;grid.append(node);
   });
   const first=new Date(shown.getFullYear(),shown.getMonth(),1);
   const offset=(first.getDay()+6)%7;
   const active=fromVN((field==='from'?from:to).value);
   for(let i=0;i<42;i++){
    const date=new Date(first.getFullYear(),first.getMonth(),1-offset+i);
    const b=btn(String(date.getDate()),'autotax-calendar-day',()=>pick(date));
    const yr=date.getFullYear();
    if(date.getMonth()!==shown.getMonth())b.classList.add('outside');
    if(active&&dayISO(active)===dayISO(date))b.classList.add('selected');
    if(dayISO(date)===dayISO(new Date()))b.classList.add('today');
    // For the end date, avoid choosing a date earlier than the beginning.
    const start=fromVN(from.value);
    if(yr<2000||yr>2099||(field==='to'&&start&&date<start))b.disabled=true;
    grid.append(b);
   }
   popup.append(grid);
   const foot=document.createElement('div');foot.className='autotax-calendar-footer';
   foot.append(btn('Hôm nay','autotax-calendar-link',()=>{const d=new Date();shown=new Date(d.getFullYear(),d.getMonth(),1);draw()}),
    btn('Đóng','autotax-calendar-link',close));
   popup.append(foot);
  }
  [[from,fromButton,'from'],[to,toButton,'to']].forEach(([input,trigger,kind])=>{
    trigger.setAttribute('aria-haspopup','dialog');
    trigger.setAttribute('aria-expanded','false');
    trigger.addEventListener('click',event=>{event.preventDefault();popup.hidden||kind!==field?open(kind):close()});
    input.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
  });
  popup.addEventListener('touchstart',event=>{touchX=event.touches[0]?.clientX??null},{passive:true});
  popup.addEventListener('touchend',event=>{
    if(touchX===null)return;
    const dx=(event.changedTouches[0]?.clientX??touchX)-touchX;touchX=null;
    if(Math.abs(dx)>55)shift(dx<0?1:-1);
  },{passive:true});
  document.addEventListener('pointerdown',event=>{
   if(!popup.hidden&&!root.contains(event.target))close();
  });
  return {open,close};
 }
 window.AutoTaxWebDatePicker=Object.freeze({attach});
})();
