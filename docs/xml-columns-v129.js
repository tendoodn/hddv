/* AutoTax v1.1.28 — chọn trường XML cho hai sheet chi tiết.
   Chọn và lưu theo tài khoản trên Supabase, đồng bộ Web và Chrome Add-on. */
(()=>{
'use strict';
const normalize=k=>String(k||'').replace(/\[\d+\]/g,'').replace(/\s*\/\s*/g,'/').trim();
const LS='autotax_xml_selected_fields_v129';
let selected=[],known=new Set(),dialog=null,loaded=false;
const allow=k=>/^HDon\//.test(k)&&k.length<320;
function getSelected(){return [...selected]}
function registerFields(keys){
 for(const key of keys||[]){const norm=normalize(key);if(allow(norm))known.add(norm)}
 if(dialog?.open)render();
}
const client=()=>window.AutoTaxSharedClient;
async function rpc(name,params){
 if(window.License?.xmlRpc)return window.License.xmlRpc(name,params||{});
 if(client()){
  const {data,error}=await client().rpc(name,params||{});
  if(error)throw error;return data;
 }
 throw Error('Đăng nhập tài khoản AutoTax để đồng bộ cột XML.');
}
async function load(){
 if(loaded)return selected;
 try{
  const data=await rpc('autotax_get_xml_columns_v129');
  if(Array.isArray(data))selected=data.map(normalize).filter(allow);
  loaded=true;
 }catch(e){
  try{selected=JSON.parse(localStorage.getItem(LS)||'[]').map(normalize).filter(allow)}
  catch{selected=[]}
 }
 return getSelected();
}
async function save(next){
 const fields=[...new Set((next||[]).map(normalize).filter(allow))].sort();
 selected=fields;
 try{localStorage.setItem(LS,JSON.stringify(fields))}catch{}
 try{await rpc('autotax_set_xml_columns_v129',{p_fields:fields});setStatus('Đã đồng bộ '+fields.length+' trường lên tài khoản AutoTax.')}
 catch(e){setStatus('Đã lưu tạm '+fields.length+' trường trên máy; chưa đồng bộ được: '+e.message,true)}
 render();return fields;
}
function setStatus(text,error=false){
 const el=dialog?.querySelector('#autotaxXmlStatus');
 if(el){el.textContent=text;el.style.color=error?'#be123c':'#166534'}
}
function render(){
 if(!dialog)return;
 const list=dialog.querySelector('#autotaxXmlList');
 const query=dialog.querySelector('#autotaxXmlSearch').value.toLowerCase().trim();
 list.replaceChildren();
 const all=[...new Set([...known,...selected])].sort((a,b)=>a.localeCompare(b,'vi',{numeric:true}));
 for(const key of all){
  if(query&&!key.toLowerCase().includes(query))continue;
  const label=document.createElement('label');label.className='autotax-xml-field';
  const input=document.createElement('input');input.type='checkbox';input.checked=selected.includes(key);
  input.addEventListener('change',()=>{if(input.checked)selected.push(key);else selected=selected.filter(x=>x!==key);setStatus('Đã chọn '+selected.length+' trường. Bấm Lưu cấu hình để đồng bộ.')});
  const span=document.createElement('span');span.textContent=key;
  label.append(input,span);list.append(label);
 }
 dialog.querySelector('#autotaxXmlCount').textContent=selected.length+' trường đã chọn / '+all.length+' trường đã đọc';
}
function open(){
 if(!dialog)build();
 void load().then(()=>render());
 dialog.showModal();
}
function build(){
 dialog=document.createElement('dialog');dialog.id='autotaxXmlDialog';
 dialog.style.cssText='width:min(740px,94vw);max-height:92dvh;border:1px solid #f3aab8;border-radius:14px;padding:18px;color:#3b1520;background:#fff';
 dialog.innerHTML='<h2 style="margin:0 0 7px;font-size:18px">Chọn trường XML cho 2 sheet Chi tiết</h2>'+
  '<p style="font-size:12px">Tick trường cần xuất. Cấu hình được lưu trên tài khoản và dùng chung cho Web / Add-on. Có thể nhập JSON đã tải từ bộ chọn 3 XML mẫu.</p>'+
  '<label style="font-size:12px">Nhập file cấu hình JSON <input id="autotaxXmlImport" type="file" accept=".json,application/json"></label>'+
  '<input id="autotaxXmlSearch" type="search" placeholder="Lọc trường XML..." style="width:100%;padding:10px;margin:10px 0">'+
  '<p id="autotaxXmlCount" style="font-size:12px"></p>'+
  '<div id="autotaxXmlList" style="max-height:48dvh;overflow:auto;border:1px solid #f5c8d0;border-radius:10px;padding:7px"></div>'+
  '<p id="autotaxXmlStatus" role="status" style="font-size:12px"></p>'+
  '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:11px">'+
  '<button type="button" id="autotaxXmlClose">Đóng</button>'+
  '<button type="button" id="autotaxXmlSave" style="background:#e60012;color:white">Lưu cấu hình</button></div>';
 document.body.append(dialog);
 const style=document.createElement('style');
 style.textContent='.autotax-xml-field{display:flex;align-items:start;gap:8px;border-bottom:1px solid #fbe8ec;padding:6px;font:11px/1.6 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}.autotax-xml-field input{accent-color:#e60012;flex:none;margin-top:3px}';
 document.head.append(style);
 dialog.querySelector('#autotaxXmlClose').onclick=()=>dialog.close();
 dialog.querySelector('#autotaxXmlSave').onclick=()=>void save(selected);
 dialog.querySelector('#autotaxXmlSearch').oninput=render;
 dialog.querySelector('#autotaxXmlImport').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
   const json=JSON.parse(await file.text());
   const fields=Array.isArray(json)?json:json.fields;
   if(!Array.isArray(fields))throw Error('JSON phải có mảng fields.');
   selected=fields.map(x=>normalize(typeof x==='string'?x:(x.key||x.k))).filter(allow);
   registerFields(selected);render();
   setStatus('Đã nhập '+selected.length+' trường. Bấm Lưu cấu hình để áp dụng cả Web và Add-on.');
  }catch(error){setStatus('Không đọc được file chọn cột: '+error.message,true)}
 };
 render();
}
function init(){
 const anchor=document.getElementById('exportExcel')?.parentElement ||
  document.getElementById('skuQuickSettings');
 if(!anchor)return;
 const btn=document.createElement('button');btn.id='autotaxXmlColumnsOpen';btn.type='button';
 btn.className='outline';btn.textContent='Chọn cột XML cho 2 sheet chi tiết';
 btn.style.cssText='font-size:11px;padding:8px;border:1px solid #f3aab8;border-radius:9px;color:#aa1027;white-space:normal';
 btn.onclick=open;anchor.append(btn);
 void load();
}
window.AutoTaxXmlColumns=Object.freeze({getSelected,registerFields,load,save,open});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
