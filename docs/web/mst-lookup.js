(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state=[];
const fields=['MST','Tên đơn vị','Địa chỉ','Trạng thái','Nguồn'];
function setStatus(value){$('noticeMst').style.display='block';$('noticeMst').textContent=value}
function cell(tr,text){const td=document.createElement('td');td.textContent=String(text??'');tr.append(td)}
function normalize(s){const x=s.trim().replace(/[\s-]/g,'');return /^\d{10}(?:\d{3})?$/.test(x)?x:null}
function getValue(value,...keys){for(const key of keys){const v=value?.[key];if(v!==null&&v!==undefined&&String(v).trim())return String(v)}return ''}
function render(){
 const body=$('mstResults');body.replaceChildren();
 for(const item of state){
  const tr=document.createElement('tr');
  for(const field of fields)cell(tr,item[field]);body.append(tr);
 }
 $('downloadMst').disabled=!state.length;
}
async function queryMst(mst){
 const url='https://invoy.io.vn/api/v1/public/lookup-mst?mst='+encodeURIComponent(mst);
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),11000);
 try{
  const res=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/json'}});
  if(!res.ok)throw Error('HTTP '+res.status);
  const payload=await res.json(),o=payload?.data?.data||payload?.data||payload?.result||payload;
  if(!o||typeof o!=='object')throw Error('Định dạng phản hồi không hợp lệ');
  return {'MST':mst,'Tên đơn vị':getValue(o,'name','companyName','tenNNT','ten','taxpayerName'),
   'Địa chỉ':getValue(o,'address','diaChi','registeredAddress'),
   'Trạng thái':getValue(o,'status','statusName','trangThai','tinhTrang'),
   'Nguồn':'API dữ liệu công khai – cần đối chiếu Tổng cục Thuế'};
 }finally{clearTimeout(timer)}
}
$('startMst').onclick=async()=>{
 const raw=$('mstInput').value.split(/[,\n;]+/).map(x=>x.trim()).filter(Boolean);
 const codes=[...new Set(raw.map(normalize).filter(Boolean))].slice(0,20);
 if(!codes.length)return setStatus('Nhập tối thiểu một MST hợp lệ: 10 hoặc 13 chữ số.');
 const button=$('startMst');button.disabled=true;state.length=0;render();
 try{
  for(let i=0;i<codes.length;i++){
   setStatus('Đang tra '+(i+1)+'/'+codes.length+' mã số thuế…');
   try{state.push(await queryMst(codes[i]))}
   catch(e){state.push({'MST':codes[i],'Tên đơn vị':'Không truy xuất được từ trình duyệt',
    'Địa chỉ':'','Trạng thái':String(e.message||e),'Nguồn':'Cổng tra cứu Tổng cục Thuế (kiểm tra thủ công)'})}
   render();
  }
  setStatus('Đã xử lý '+codes.length+' MST. Kết quả từ bên thứ ba cần đối chiếu với Tổng cục Thuế.');
 }finally{button.disabled=false}
};
$('clearMst').onclick=()=>{$('mstInput').value='';state.length=0;render();setStatus('Đã xóa kết quả.')};
$('downloadMst').onclick=()=>{
 if(!state.length||!window.Xlsx)return;
 const cells=state.map(r=>fields.map(k=>r[k]||''));
 const book=[{name:'Tra cứu MST',columns:fields.map(header=>({header,width:30})),rows:cells}];
 const bytes=window.Xlsx.buildXlsx(book),blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='AutoTax_TraCuu_MST.xlsx';
 a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
})();