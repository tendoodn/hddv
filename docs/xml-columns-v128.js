/* AutoTax XML columns v1.1.28.
 * Selection is applied only to "Chi tiết mua vào" / "Chi tiết bán ra".
 * Original XML remains readable in memory for trusted extraction even when
 * not exported, and no old full-XML columns pollute invoice summary sheets.
 */
(()=>{
 'use strict';
 const KEY='autotax_xml_columns_v128';
 const defaults=[
 'HDon/DLHDon/TTChung/KHHDon',
 'HDon/DLHDon/TTChung/NLap',
 'HDon/DLHDon/TTChung/SHDon',
 'HDon/DLHDon/NDHDon/NBan/DChi',
 'HDon/DLHDon/NDHDon/NBan/MST',
 'HDon/DLHDon/NDHDon/NBan/Ten',
 'HDon/DLHDon/NDHDon/NMua/DChi',
 'HDon/DLHDon/NDHDon/NMua/MST',
 'HDon/DLHDon/NDHDon/NMua/Ten',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/DGia',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/DVTinh',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/MHHDVu',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/SLuong',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/STT',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/TChat',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/THHDVu',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/TSuat',
 'HDon/DLHDon/NDHDon/DSHHDVu/HHDVu/ThTien',
 'HDon/DLHDon/NDHDon/TToan/THTTLTSuat/LTSuat/TSuat',
 'HDon/DLHDon/NDHDon/TToan/THTTLTSuat/LTSuat/ThTien',
 'HDon/DLHDon/NDHDon/TToan/TgTTTBSo',
 'HDon/DLHDon/NDHDon/TToan/TgTThue'
 ];
 const normal=k=>String(k||'').replace(/\[(?:\d+)?\]/g,'').replace(/\s*\/\s*/g,'/');
 const allow=a=>Array.isArray(a)&&a.length<=300&&a.every(k=>typeof k==='string'&&k.length<300&&/^HDon\//.test(k)&&!/[<>]/.test(k));
 let selection=null;
 function getSelected(){
  if(selection)return selection.slice();
  try{const raw=JSON.parse(localStorage.getItem(KEY));if(allow(raw)){selection=raw;return raw.slice()}}catch{}
  return defaults.slice();
 }
 function importConfig(data){
  const selected=Array.isArray(data)?data:(data?.fields||data?.selected);
  if(!allow(selected))throw Error('Cấu hình XML không hợp lệ: cần danh sách tối đa 300 mã trường từ HDon.');
  const unique=[...new Set(selected.map(normal))];selection=unique;
  try{localStorage.setItem(KEY,JSON.stringify(unique))}catch{}
  document.dispatchEvent(new CustomEvent('autotax-xml-columns-changed',{detail:{count:unique.length}}));
  return unique.length;
 }
 function value(detail,key,rowIndex){
  const fields=detail?.xmlFields||{};
  const matches=Object.entries(fields).filter(([path])=>normal(path)===key);
  if(!matches.length)return '';
  const item=key.includes('/HHDVu/');
  if(item){
   const line=matches.find(([k])=>new RegExp('\\/\\s*HHDVu\\['+(rowIndex+1)+'\\]/').test(k));
   return String((line||[])[1]??'');
  }
  return String(matches[0]?.[1]??'');
 }
 function bindImport(buttonSelector){
  const target=document.querySelector(buttonSelector);
  if(!target)return;
  const btn=document.createElement('button');btn.type='button';btn.className='outline';
  btn.textContent='Chọn cột XML ('+getSelected().length+')';
  btn.title='Nhập file JSON chọn các cột XML cho hai sheet Chi tiết mua vào và Chi tiết bán ra';
  const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
  btn.addEventListener('click',()=>file.click());
  file.addEventListener('change',async()=>{
   const chosen=file.files?.[0];if(!chosen)return;
   try{const count=importConfig(JSON.parse(await chosen.text()));
    btn.textContent='Chọn cột XML ('+count+')';btn.title='Đã lưu '+count+' cột XML cho hai sheet chi tiết.';
   }catch(error){alert('Không tải được cấu hình: '+error.message)}
   file.value='';
  });
  target.append(btn,file);
 }
 const api=Object.freeze({defaults,getSelected,importConfig,value,bindImport,normal});
 window.AutoTaxXmlColumns=api;
 const init=()=>bindImport(document.querySelector('#skuQuickSettings')?'#skuQuickSettings':'.exports');
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
