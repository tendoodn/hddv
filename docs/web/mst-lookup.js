/* AutoTax public MST lookup. Only the AutoTax Edge broker calls upstream APIs:
   the browser never sends identifiers directly to an opaque third-party endpoint. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const API='https://ucqqjdsoyvvaxswzbhaw.supabase.co/functions/v1/autotax-mst-lookup';
const state=[];
let running=false,sequence=0,total=0,completed=0;
let officialSelection=null,officialParsed=null;
const columns=['STT','Mã số thuế','Loại mã','Thông tin API','Địa chỉ API',
 'Cơ quan quản lý API','Trạng thái API','Kết quả API','Nguồn API',
 'Cổng DN - Ghi nhận','Cổng DN - Tên','Cổng DN - Địa chỉ','Cổng DN - CQT','Cổng DN - Trạng thái',
 'Cổng TNCN - Ghi nhận','Cổng TNCN - Tên','Cổng TNCN - Địa chỉ','Cổng TNCN - CQT',
 'Cổng TNCN - Trạng thái','So sánh tên 2 cổng'];
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
  const checks=v.officialChecks||{},numberOfChecks=Number(!!checks.business)+Number(!!checks.personal);
  name.textContent=v.name||checks.business?.name||checks.personal?.name||'Chưa có dữ liệu xác minh';
  const address=document.createElement('div');
  address.className='mst-address';
  address.textContent=v.address||v.source||'—';
  if(numberOfChecks){
   const compare=document.createElement('div');compare.className='mst-source';
   compare.textContent='Đối chiếu thủ công: '+(checks.business?'DN ✓':'DN —')+
    ' · '+(checks.personal?'TNCN ✓':'TNCN —')+
    (numberOfChecks===2?' · '+window.MstOfficial.comparePortalNames(checks):'');
   info.append(compare);
   for(const [portal,label] of [['business','Cổng DN'],['personal','Cổng TNCN']]){
    const record=checks[portal];
    if(!record)continue;
    const source=document.createElement('div');source.className='mst-address';
    source.textContent=label+' (người dùng dán): '+record.name+
      (record.status?' · '+record.status:'');
    info.append(source);
   }
  }
  info.append(tag,name,address);
  // Official portals require their own CAPTCHA session. We do not send tax IDs
  // in query strings and we never claim that an arbitrary pasted row is verified.
  const actions=document.createElement('div');
  actions.className='mst-personal-actions';
  for(const [portal,label] of [['business','Mở cổng DN'],['personal','Mở cổng TNCN']]){
   const official=document.createElement('a');
   official.href=window.MstOfficial.officialUrl(v.mst,portal);
   official.target='_blank';official.rel='noopener noreferrer';
   official.textContent=label;
   actions.append(official);
  }
  const copy=document.createElement('button');
  copy.type='button';copy.className='mst-personal-copy';
  copy.textContent='Sao chép mã';
  copy.addEventListener('click',async()=>{
   try{
    await navigator.clipboard.writeText(v.mst);
    status('Đã sao chép mã. Hãy dán vào cổng Thuế chính thức và nhập mã xác nhận trên trang đó.');
   }catch{
    status('Không thể sao chép tự động. Hãy chọn mã trong bảng và bấm Ctrl+C.');
   }
  });
  actions.append(copy);
  for(const [portal,label] of [['business','Ghi nhận từ DN'],['personal','Ghi nhận từ TNCN']]){
   const importButton=document.createElement('button');
   importButton.type='button';importButton.className='mst-personal-copy';
   importButton.textContent=checks[portal]?'Sửa kết quả '+(portal==='business'?'DN':'TNCN'):label;
   importButton.addEventListener('click',()=>openOfficial(i,portal));
   actions.append(importButton);
  }
  info.append(actions);
  tr.append(info);
  createCell(tr,v.office||'Chưa có dữ liệu');
  const cell=document.createElement('td'),pill=document.createElement('span');
  pill.className='mst-pill '+(v.verified?'ok':'error');
  pill.textContent=numberOfChecks===2?'Đã nhập cả 2 cổng · chưa xác minh tự động':
   numberOfChecks===1?'Đã nhập 1 cổng · chưa xác minh tự động':v.verified?
   (v.status&&v.status!=='Chưa có dữ liệu trạng thái'?v.status:'Có dữ liệu API · chưa xác minh trạng thái'):
   '⚠ Chưa có dữ liệu xác minh';
  cell.append(pill);
  const small=document.createElement('div');small.className='mst-source';
  small.textContent=numberOfChecks?
   'Dữ liệu từ người dùng dán vào: không tự động kiểm chứng tại máy chủ Cục Thuế.':
   v.verified?(v.source||'Nguồn API tham khảo, không phải xác nhận của Cục Thuế'):
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
  // Retry only transport/provider outages. Never amplify upstream 429 quotas or
  // repeat definitive no-data responses across geographic Edge regions.
  // Never retry personal IDs without an approved private-taxpayer source.
  const pending=(result||batch.map(()=>null))
   .map((value,index)=>({value,item:batch[index],index}))
   .filter(({value,item})=>item.kind!=='personal'&&
     (!value||(!value.verified&&value.error==='upstream_unavailable')));
  const first=!result;
  const items=first?batch:pending.map(x=>x.item);
  if(!items.length)break;
  try{
   const data=await requestRegion(items,zone);
   if(first)result=data;
   else for(let i=0;i<pending.length;i++){
    if(data[i]?.verified)result[pending[i].index]=data[i];
   }
  }catch(error){
   lastError=error;
   // Server-side 429 is not a regional outage; honor the retry window.
   if(error?.message?.includes('giới hạn lượt'))break;
   continue;
  }
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
 if($('mstOfficialDialog').open)$('mstOfficialDialog').close();
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
 const array=rows.map((r,i)=>{
  const checks=r.officialChecks||{};
  const fields=(p)=>p?['Đã nhập thủ công · chưa xác minh máy chủ',p.name||'',
    p.address||'',p.office||'',p.status||'']:
    ['Chưa đối chiếu','','','',''];
  return [i+1,r.mst,r.type==='personal'?'Cá nhân':r.type==='branch'?'Chi nhánh':'Tổ chức',
   r.name||'',r.address||'',r.office||'',r.status||'',
   r.verified?'Có dữ liệu API tham khảo':'Chưa xác minh API',r.source||'',
   ...fields(checks.business),...fields(checks.personal),
   window.MstOfficial.comparePortalNames(checks)];
 });
 const book=[{name:'Tra cứu MST',columns:columns.map(header=>({header,width:32})),rows:array}];
 try{
  const data=window.Xlsx.buildXlsx(book),blob=new Blob([data],
   {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='AutoTax_TraCuu_MST_'+new Date().toISOString().slice(0,10)+'.xlsx';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){status('Không xuất được Excel: '+(e.message||e))}
}
// Clipboard data is ephemeral. No localStorage and no server upload.
function clearOfficial(){
 officialSelection=null;officialParsed=null;
 $('mstOfficialPaste').value='';
 for(const id of ['mstOfficialName','mstOfficialAddress','mstOfficialOffice','mstOfficialStatus'])
  $(id).value='';
 $('mstOfficialConfirm').checked=false;
 $('mstOfficialSave').disabled=true;
 $('mstOfficialNotice').textContent='';
}
function openOfficial(index){
 const v=state[index];
 if(!v||running)return status('Chỉ đối chiếu khi kết quả tra cứu đã tải xong.');
 clearOfficial();
 officialSelection={index,code:v.mst,stamp:sequence};
 const url=window.MstOfficial.officialUrl(v.mst);
 $('mstOfficialCode').textContent=v.mst;
 $('mstOfficialPortal').href=url;
 $('mstOfficialType').textContent=v.type==='personal'?
  'Chọn ô Số CMND/Thẻ căn cước tại mục người nộp thuế TNCN.':
  'Chọn mục Thông tin người nộp thuế và nhập MST doanh nghiệp/chi nhánh.';
 $('mstOfficialNotice').textContent='Mở cổng Thuế, nhập mã và CAPTCHA, tra cứu rồi sao chép CHỈ MỘT DÒNG kết quả trong bảng. Không dán cả trang.';
 $('mstOfficialDialog').showModal();
}
function officialSaveState(){
 $('mstOfficialSave').disabled=!officialSelection||!officialParsed?.ok||
  !$('mstOfficialConfirm').checked||!$('mstOfficialName').value.trim();
}
$('mstOfficialParse').addEventListener('click',()=>{
 if(!officialSelection)return;
 const parsed=window.MstOfficial.parseCopiedRow(
  $('mstOfficialPaste').value,officialSelection.code);
 officialParsed=parsed.ok?parsed:null;
 $('mstOfficialNotice').textContent=parsed.ok?
  'Mã đã khớp với dòng dán. Hãy kiểm tra các trường trước khi lưu. KHÔNG phải xác minh qua API.':
  parsed.reason;
 for(const [id,key] of [['mstOfficialName','name'],['mstOfficialAddress','address'],
  ['mstOfficialOffice','office'],['mstOfficialStatus','status']])
  $(id).value=parsed.ok?parsed[key]||'':'';
 $('mstOfficialConfirm').checked=false;
 officialSaveState();
});
for(const id of ['mstOfficialName','mstOfficialAddress','mstOfficialOffice','mstOfficialStatus'])
 $(id).addEventListener('input',officialSaveState);
$('mstOfficialConfirm').addEventListener('change',officialSaveState);
$('mstOfficialSave').addEventListener('click',()=>{
 const s=officialSelection;
 if(!s||!officialParsed?.ok||!$('mstOfficialConfirm').checked||
  !String($('mstOfficialName').value||'').trim())return;
 const row=state[s.index];
 if(running||sequence!==s.stamp||!row||
  normalize(row.mst)?.digits!==normalize(s.code)?.digits)
  return $('mstOfficialNotice').textContent='Danh sách đã đổi. Hãy tra cứu và đối chiếu lại.';
 state[s.index]={...row,name:$('mstOfficialName').value.trim().slice(0,250),
  address:$('mstOfficialAddress').value.trim().slice(0,450),
  office:$('mstOfficialOffice').value.trim().slice(0,250),
  status:$('mstOfficialStatus').value.trim().slice(0,250),
  verified:false,manual:true,error:'user_copied_official_row',
  source:'Người dùng đối chiếu thủ công tại '+window.MstOfficial.officialUrl(s.code),
  manuallyCheckedAt:new Date().toISOString()};
 $('mstOfficialDialog').close();render();
 status('Đã lưu kết quả do người dùng đối chiếu cho '+s.code+
  ' trong tab hiện tại. AutoTax chưa xác minh độc lập thông tin này.');
});
$('mstOfficialClose').addEventListener('click',()=>$('mstOfficialDialog').close());
$('mstOfficialDialog').addEventListener('close',clearOfficial);

$('mstInput').addEventListener('input',()=>{
 const x=parseInput(),n=x.valid.length;
 $('mstInputCount').textContent=n+' mã'+(x.invalid.length?' · '+x.invalid.length+' sai định dạng':'');
});
$('mstFilter').addEventListener('change',render);
$('startMst').addEventListener('click',()=>void run());
$('downloadMst').addEventListener('click',exportXlsx);
render();
})();