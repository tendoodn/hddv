/* AutoTax public MST lookup. Only the AutoTax Edge broker calls upstream APIs:
   the browser never sends identifiers directly to an opaque third-party endpoint. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const API='https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-mst-lookup';
const state=[];
let running=false,sequence=0,total=0,completed=0;
const columns=['STT','Mã số thuế','Loại mã','Thông tin người nộp thuế','Địa chỉ',
 'Cơ quan quản lý','Trạng thái','Kết quả','Nguồn dữ liệu'];
function normalize(value){
 const s=String(value||'').trim();
 if(!/^\d{10}(?:-\d{3}|\d{3})?$/.test(s)&&!/^\d{12}$/.test(s))return null;
 const digits=s.replace(/\D/g,'');
 if(![10,12,13].includes(digits.length))return null;
 return {digits,display:digits.length===13?digits.slice(0,10)+'-'+digits.slice(10):digits,
  kind:digits.length===12?'personal':digits.length===13?'branch':'business'};
}
function parseInput(){
 const tokens=$('mstInput').value.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
 const valid=[],invalid=[],seen=new Set();
 for(const token of tokens){
  const n=normalize(token);
  if(!n){invalid.push(token);continue}
  if(!seen.has(n.digits)){seen.add(n.digits);valid.push(n)}
 }
 return {valid,invalid};
}
function status(msg){$('noticeMst').textContent=msg}
function counts(){
 const good=state.filter(x=>x?.verified).length;
 const fail=state.filter(x=>x&&!x.verified).length;
 $('mstTotal').textContent=String(total);
 $('mstPending').textContent=String(total-completed);
 $('mstSuccess').textContent=String(good);
 $('mstFailed').textContent=String(fail);
 $('mstProgressText').textContent='Đã xử lý: '+completed+'/'+total+' mã số thuế';
 const percent=total?Math.round(completed/total*100):0;
 $('mstPercent').textContent=percent+'%';
 $('mstProgressFill').style.width=percent+'%';
 $('mstProgress').setAttribute('aria-valuenow',String(percent));
 $('downloadMst').disabled=!completed;
 $('downloadCount').textContent=completed?'('+completed+')':'';
}
function createCell(tr,value){
 const td=document.createElement('td');
 td.textContent=String(value??'');
 tr.append(td);return td;
}
function render(){
 const kind=$('mstFilter').value,tbody=$('mstResults');
 tbody.replaceChildren();
 const subset=state.map((value,index)=>({value,index})).filter(({value})=>
  value&&(kind==='all'||(kind==='ok'?value.verified:!value.verified)));
 for(const {value:v,index:i} of subset){
  const tr=document.createElement('tr');
  createCell(tr,i+1);
  createCell(tr,v.mst);
  const info=document.createElement('td');
  const tag=document.createElement('span');
  tag.className='mst-kind';tag.textContent=v.type==='personal'?'CÁ NHÂN / 12 SỐ':
   v.type==='branch'?'CHI NHÁNH':'DOANH NGHIỆP / MST';
  const name=document.createElement('div');
  name.className='mst-entity';
  name.textContent=v.name||'Chưa có dữ liệu xác minh';
  const address=document.createElement('div');
  address.className='mst-address';
  address.textContent=v.address||v.source||'—';
  info.append(tag,name,address);tr.append(info);
  createCell(tr,v.office||'Chưa có dữ liệu');
  const cell=document.createElement('td'),pill=document.createElement('span');
  pill.className='mst-pill '+(v.verified?'ok':'error');
  pill.textContent=v.verified?
   (v.status&&v.status!=='Chưa có dữ liệu trạng thái'?v.status:'✓ Có thông tin · Chưa xác minh trạng thái'):
   '⚠ Chưa xác minh';
  cell.append(pill);
  const small=document.createElement('div');small.className='mst-source';
  small.textContent=v.verified?(v.source||'Nguồn không xác định'):
   (v.error==='personal_source_not_configured'?
    'Nguồn mã 12 số chưa được cấp quyền API. Xác minh qua cổng Thuế cá nhân.':
    v.error==='rate_limited'?'Nguồn giới hạn lượt; hãy thử lại sau.':
    v.error==='upstream_unavailable'?'Dịch vụ nguồn tạm thời không truy cập được.':
    'Chưa tìm thấy thông tin đủ để xác minh.');
  cell.append(small);tr.append(cell);tbody.append(tr);
 }
 if(!subset.length){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=5;td.className='mst-empty';
  td.textContent=completed?'Không có kết quả theo bộ lọc này.':'Chưa có kết quả tra cứu.';
  tr.append(td);tbody.append(tr);
 }
 $('mstResultCount').textContent='Danh sách chi tiết ('+subset.length+'/'+completed+')';
 counts();
}
async function requestRegion(batch,region){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),22000);
 try{
  const target=API+'?forceFunctionRegion='+encodeURIComponent(region);
  const res=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({codes:batch.map(x=>x.display)}),signal:ctrl.signal,cache:'no-store'});
  const body=await res.json().catch(()=>null);
  if(!res.ok)throw Error(body?.error==='rate_limited'?
   'Máy chủ tạm giới hạn lượt, thử lại sau.':
   body?.error==='invalid_tax_code'?'Có MST không đúng định dạng.':
   'Máy chủ tra cứu tạm lỗi HTTP '+res.status);
  if(!Array.isArray(body?.data)||body.data.length!==batch.length)
   throw Error('Máy chủ chưa trả đủ kết quả.');
  return body.data;
 }finally{clearTimeout(timer)}
}
async function requestBatch(batch){
 const zones=['ap-southeast-1','eu-west-1','ap-northeast-1'];
 let result=null,lastError=null;
 for(const zone of zones){
  // Retry only IDs without verified responses. Never retry personal IDs without licensed source.
  const pending=(result||batch.map(()=>null))
   .map((value,index)=>({value,item:batch[index],index}))
   .filter(({value,item})=>item.kind!=='personal'&&(!value||!value.verified)&&
     (!value||['rate_limited','upstream_unavailable','not_found_or_unavailable'].includes(value.error)));
  const first=!result;
  const items=first?batch:pending.map(x=>x.item);
  if(!items.length)break;
  try{
   const data=await requestRegion(items,zone);
   if(first)result=data;
   else for(let i=0;i<pending.length;i++){
    if(data[i]?.verified)result[pending[i].index]=data[i];
   }
  }catch(error){lastError=error;continue}
 }
 if(result)return result;
 throw lastError||Error('Nguồn dữ liệu chưa phản hồi sau các tuyến được phép.');
}
const errorFor=(item,error)=>({mst:item.display,type:item.kind,name:'',
 address:'',office:'',status:'Chưa xác minh',verified:false,
 source:'Không có phản hồi xác thực',error:error?.name==='AbortError'?'upstream_unavailable':
  error?.message?.includes('giới hạn')?'rate_limited':'upstream_unavailable'});
async function run(){
 if(running)return;
 const parsed=parseInput();
 if(!parsed.valid.length){status('Vui lòng nhập ít nhất một MST hợp lệ: 10 số, 10 số–3 số hoặc 12 số.');return}
 if(parsed.valid.length>20){status('Chỉ hỗ trợ tối đa 20 MST một lượt. Hãy giảm danh sách.');return}
 running=true;const stamp=++sequence;
 $('startMst').disabled=true;$('mstFilter').value='all';
 state.length=0;total=parsed.valid.length;completed=0;render();
 $('mstState').textContent='Đang truy xuất thông tin từ dịch vụ trung gian…';
 status(parsed.invalid.length?'Bỏ qua '+parsed.invalid.length+' mã sai định dạng: '+
  parsed.invalid.slice(0,3).join(', '):'');
 const chunks=[];
 for(let i=0;i<parsed.valid.length;i+=4)chunks.push({
  index:i,items:parsed.valid.slice(i,i+4)
 });
 try{
  // Two server batches at once, each broker batch is internally bounded to 3 queries.
  let next=0;
  async function worker(){
   for(;;){
    const i=next++;if(i>=chunks.length||stamp!==sequence)return;
    const {index,items}=chunks[i];
    let data;
    try{data=await requestBatch(items)}
    catch(error){data=items.map(item=>errorFor(item,error))}
    if(stamp!==sequence)return;
    for(let j=0;j<items.length;j++){
     const item=items[j],out=data[j]||errorFor(item);
     // Never invent CQT status or personal taxpayer names.
     state[index+j]={...out,mst:item.display,type:item.kind,
      verified:out.verified===true&&!!String(out.name||'').trim()};
     completed++;
    }
    render();
    $('mstState').textContent='Đang xử lý '+completed+'/'+total+' mã số thuế';
   }
  }
  await Promise.all(Array.from({length:Math.min(chunks.length,2)},()=>worker()));
  $('mstState').textContent='Đã xử lý toàn bộ danh sách.';
  status('Tra được '+state.filter(x=>x?.verified).length+'/'+total+
   ' MST có dữ liệu. Các MST chưa xác minh cần đối chiếu nguồn chính thức'+
   (parsed.valid.some(x=>x.kind==='personal')?
    '; mã định danh 12 số cần nguồn được cấp quyền tra cứu cá nhân.':'.'));
 }finally{running=false;$('startMst').disabled=false;render()}
}
function exportXlsx(){
 const rows=state.filter(Boolean);
 if(!rows.length||!window.Xlsx)return status('Chưa có kết quả để xuất Excel.');
 const array=rows.map((r,i)=>[i+1,r.mst,r.type==='personal'?'Cá nhân':r.type==='branch'?'Chi nhánh':'Tổ chức',
  r.name||'',r.address||'',r.office||'',r.status||'',
  r.verified?'Có thông tin':'Chưa xác minh',r.source||'']);
 const book=[{name:'Tra cứu MST',columns:columns.map(header=>({header,width:32})),rows:array}];
 try{
  const data=window.Xlsx.buildXlsx(book),blob=new Blob([data],
   {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='AutoTax_TraCuu_MST_'+new Date().toISOString().slice(0,10)+'.xlsx';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){status('Không xuất được Excel: '+(e.message||e))}
}
$('mstInput').addEventListener('input',()=>{
 const x=parseInput(),n=x.valid.length;
 $('mstInputCount').textContent=n+' mã'+(x.invalid.length?' · '+x.invalid.length+' sai định dạng':'');
});
$('mstFilter').addEventListener('change',render);
$('startMst').addEventListener('click',()=>void run());
$('downloadMst').addEventListener('click',exportXlsx);
render();
})();