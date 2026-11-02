/* Assist human-reviewed official tax lookup; NEVER fetch, solve CAPTCHA, or
   claim that clipboard content was authenticated by the Tax Department.
   Pasted personal data stays in memory of this tab only. */
(()=>{
'use strict';
const OFFICIAL={
 business:'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp',
 branch:'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp',
 personal:'https://tracuunnt.gdt.gov.vn/tcnnt/mstcn.jsp'
};
function normalize(value){
 const s=String(value??'').trim();
 if(!/^(?:\d{10}(?:-\d{3}|\d{3})?|\d{12})$/.test(s))return null;
 const digits=s.replace(/\D/g,'');
 return {digits,kind:digits.length===12?'personal':digits.length===13?'branch':'business',
  display:digits.length===13?digits.slice(0,10)+'-'+digits.slice(10):digits};
}
const safeText=(value,max=350)=>{
 const s=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 return s.length<=max?s:s.slice(0,max);
};
const goodName=s=>/[\p{L}]/u.test(s)&&!/(?:mã số thuế|người nộp thuế|họ và tên)/i.test(s);
function parseCopiedRow(raw,requested,portal){
 const id=normalize(requested);
 if(!id)return {ok:false,reason:'Mã được chọn không hợp lệ.'};
 const selectedPortal=portal==='business'||portal==='personal'?portal:
  id.kind==='personal'?'personal':'business';
 const src=String(raw??'');
 if(!src.trim()||src.length>5000)
  return {ok:false,reason:'Chỉ dán một dòng kết quả đã tra tại cổng Thuế (tối đa 5.000 ký tự).'};
 // Only a single selected row; do not guess names from pages or many results.
 const cells=src.split(/\t|\r?\n/).map(x=>safeText(x,500)).filter(Boolean);
 if(cells.length<3||cells.length>12)
  return {ok:false,reason:'Hãy sao chép đúng một dòng kết quả trong bảng, không dán cả trang.'};
 const ids=cells.map((cell,i)=>({id:normalize(cell),index:i})).filter(x=>x.id);
 const matches=ids.filter(x=>x.id.digits===id.digits);
 if(!matches.length)
  return {ok:false,reason:'Dòng kết quả không chứa CCCD/MST đã chọn. Kiểm tra số 0 đầu và đúng người nộp thuế.'};
 // The TNCN portal may return either:
 // (A) STT, legacy 10-digit MST, name, office, CCCD12, update date, notes;
 // (B) STT, current 12-digit citizen ID, name, office, same CCCD12, date, notes.
 // An old 10-digit tax code and its linked CCCD in ONE row are NOT two people.
 const primary=normalize(cells[1]);
 const personalId=selectedPortal==='personal'?normalize(cells[4]):null;
 const personalLayout=selectedPortal==='personal'&&cells.length>=5&&
  !!primary&&!!personalId&&personalId.kind==='personal'&&
  [primary.digits,personalId.digits].includes(id.digits);
 const legitimate=personalLayout&&ids.every(x=>
  x.id.digits===primary.digits||x.id.digits===personalId.digits);
 // For the new CCCD-as-tax-code format the same 12 digits may occur twice;
 // uniqueness must be by VALUE, not by number of table cells.
 if(ids.some(x=>x.id.digits!==id.digits)&&!legitimate)
  return {ok:false,reason:'Dòng chứa số định danh khác. Hãy chọn đúng một người và sao chép trọn dòng.'};
 if(!legitimate&&matches.length>2)
  return {ok:false,reason:'Đã sao chép quá nhiều vị trí mã số. Chỉ dán một dòng dữ liệu.'};
 // Normal business rows have their ID in column 1 (after STT).
 // TNCN legacy rows identify the person by CCCD in column 4.
 const at=personalLayout?1:matches[0].index;
 const name=personalLayout?cells[2]:cells[at+1];
 if(!goodName(name||''))
  return {ok:false,reason:'Không đọc được tên người nộp thuế; hãy sao chép một dòng kết quả đầy đủ.'};
 const previousTaxCode=personalLayout&&primary.kind==='business'?primary.display:'';
 const office=personalLayout?cells[3]:
  selectedPortal==='personal'?cells[at+2]:cells[at+3];
 const status=personalLayout?cells[6]||'':
  selectedPortal==='personal'?cells[at+3]:cells[at+4];
 return {
  ok:true,code:id.display,
  name:safeText(name,250),
  address:selectedPortal==='personal'?'':safeText(cells[at+2]||'',450),
  office:safeText(office||'',250),
  status:safeText(status||'',250),
  previousTaxCode,
  portal:selectedPortal,source:OFFICIAL[selectedPortal],
  // This flag only means the copied row matches the searched ID.
  // It NEVER means we verified this against the government server.
  matchedClipboard:true
 };
}
window.MstOfficial=Object.freeze({normalize,parseCopiedRow,
 officialUrl:(code,portal)=>{
  const n=normalize(code);
  if(!n)return null;
  return OFFICIAL[portal==='business'||portal==='personal'?portal:n.kind];
 },
 comparePortalNames:(checks)=>{
  const a=checks?.business?.name,b=checks?.personal?.name;
  if(!a||!b)return 'Chưa đối chiếu đủ 2 cổng';
  const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/đ/gi,'d').toLowerCase().replace(/\s+/g,' ').trim();
  return norm(a)===norm(b)?'Tên khớp giữa 2 nguồn nhập thủ công':'Tên khác nhau giữa 2 cổng — cần kiểm tra';
 }
});
})();