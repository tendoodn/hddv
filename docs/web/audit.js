/* Per-invoice risk inspection, reusing the exact financial/sig/MST checks from
   the extension's Report risk sheet. Never claims legal or cryptographic validation. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const label={bad:'Cảnh báo',warn:'Cần rà soát',ok:'Không phát hiện vấn đề',info:'Thông tin'};
let latest=0;
const append=(kind,name,message)=>{
 const row=document.createElement('tr'),a=document.createElement('td'),
  b=document.createElement('td'),c=document.createElement('td');
 a.textContent=label[kind]||kind;a.className='audit-'+kind;
 b.textContent=name;c.textContent=message;
 row.append(a,b,c);$('invoiceAuditRows').append(row);
};
const money=v=>Number(v||0).toLocaleString('vi-VN')+' ₫';
async function open(row){
 const stamp=++latest,dlg=$('invoiceAuditDialog');
 $('invoiceAuditTitle').textContent='Kiểm tra hóa đơn '+String(row.shdon||'');
 $('invoiceAuditMeta').textContent=['MST bên bán '+(row.nbmst||'—'),
  'Ký hiệu '+(row.khhdon||'—'),'Ngày '+(row.tdlap||'—')].join(' · ');
 $('invoiceAuditStatus').textContent='Đang lấy chi tiết hóa đơn và đối chiếu…';
 $('invoiceAuditRows').replaceChildren();
 $('invoiceAuditSummary').textContent='';
 $('invoiceAuditSummary').className='invoice-audit-summary';
 if(!dlg.open)dlg.showModal();
 try{
  const app=window.WebInvoiceApp;
  const detail=await app.fetchDetail(row);
  if(!dlg.open||stamp!==latest)return;
  const m=new Map([[row.key,detail]]);
  // The same engine already used in the addon for the "Kiểm tra rủi ro HĐ" sheet.
  const sheets=window.Report.buildSheets([row],m,{
   mst:app.getMst(),withPdf:false,withLines:false,
   sheets:{risk:true,adjust:false,reduction:false,seller:false,hdkd:false,gtgt:false}
  });
  const risk=sheets.find(s=>s.name==='Kiểm tra rủi ro HĐ');
  if(!risk||!risk.rows?.length)throw Error('Bộ kiểm tra chưa trả kết quả.');
  const line=risk.rows[0],result=String(line[1]||'');
  const severity=result==='Cảnh báo'?'bad':result==='Lưu ý'?'warn':'ok';
  $('invoiceAuditSummary').classList.add('audit-'+severity);
  $('invoiceAuditSummary').textContent=severity==='ok'?
    'Chưa phát hiện rủi ro qua các phép kiểm tra có sẵn — không phải xác nhận pháp lý.':
    severity==='bad'?'Có dấu hiệu đáng chú ý cần kiểm tra hóa đơn và chứng từ.':
    'Có điểm cần rà soát trước khi sử dụng hoặc kê khai hóa đơn.';
  const notes=String(line[2]||'').split(/;\s*/).map(x=>x.trim()).filter(x=>x&&x!=='Không phát hiện vấn đề');
  if(notes.length)for(const [i,note] of notes.entries())
   append(severity,'Vấn đề '+(i+1),note);
  else append('ok','Kiểm tra rủi ro','Không phát hiện vấn đề theo các phép đối chiếu hiện có.');
  if(!/^\d{10}(?:\d{2,3})?$/.test(String(row.nbmst||'')))
   append('warn','MST người bán','MST không có dạng 10, 12 hoặc 13 chữ số hoặc chưa có dữ liệu.');
  else append('ok','MST người bán','Đã có MST theo định dạng: '+row.nbmst+' (chưa đối chiếu trạng thái đăng ký thuế).');
  if(!row.tdlap||Number.isNaN(new Date(row.tdlap).getTime()))
   append('warn','Ngày lập hóa đơn','Không đọc được ngày lập hợp lệ từ dữ liệu.');
  else append('ok','Ngày lập hóa đơn','Có thông tin ngày lập: '+new Date(row.tdlap).toLocaleDateString('vi-VN'));
  append('info','Trạng thái từ cổng Thuế',window.HDDT?.TTHAI?.[row.tthai]||'Chưa xác định ('+String(row.tthai??'—')+')');
  if(detail.source==='xml'){
   const sign=detail.head?.seller;
   append(sign?'ok':'warn','Chữ ký người bán',
    sign?'XML có trường chữ ký số của người bán. Không xác minh mật mã/chứng thư thu hồi.':
     'Chưa thấy dữ liệu chữ ký của người bán trong XML. Cần kiểm tra XML gốc và trạng thái hóa đơn.');
  }else append('info','Dữ liệu chữ ký','Chi tiết lấy qua API JSON, chưa có XML để kiểm tra sự hiện diện chữ ký số.');
  append('info','Đối chiếu giá trị','Tổng thanh toán '+money(row.tgtttbso)+
   ' · tiền thuế '+money(row.tgtthue)+
   ' · '+(detail.lines?.length||0)+' dòng hàng hóa.');
  $('invoiceAuditStatus').textContent='Đã hoàn thành kiểm tra sơ bộ theo dữ liệu nhận từ cổng Thuế.';
 }catch(error){
  if(stamp!==latest||!dlg.open)return;
  $('invoiceAuditSummary').className='invoice-audit-summary audit-warn';
  $('invoiceAuditSummary').textContent='Không đủ dữ liệu để đưa ra kết quả.';
  append('warn','Lỗi đối chiếu',error.message||String(error));
  $('invoiceAuditStatus').textContent='Chưa hoàn thành. Hóa đơn không được đánh dấu hợp lệ khi kiểm tra bị lỗi.';
 }
}
function init(){
 $('closeInvoiceAudit').addEventListener('click',()=>{
  latest++;$('invoiceAuditDialog').close();
 });
}
window.WebAudit={open};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();