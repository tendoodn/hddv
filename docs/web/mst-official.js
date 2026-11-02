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
function parseCopiedRow(raw,requested){
 const id=normalize(requested);
 if(!id)return {ok:false,reason:'Mã được chọn không hợp lệ.'};
 const src=String(raw??'');
 if(!src.trim()||src.length>5000)
  return {ok:false,reason:'Chỉ dán một dòng kết quả đã tra tại cổng Thuế (tối đa 5.000 ký tự).'};
 // Only a single selected row; do not guess names from pages or many results.
 const cells=src.split(/\t|\r?\n/).map(x=>safeText(x,500)).filter(Boolean);
 if(cells.length<3||cells.length>12)
  return {ok:false,reason:'Hãy sao chép đúng một dòng kết quả trong bảng, không dán cả trang.'};
 const matches=cells.map((cell,i)=>normalize(cell)?.digits===id.digits?i:-1).filter(i=>i>=0);
 if(matches.length!==1)
  return {ok:false,reason:'Nội dung dán phải chứa đúng một mã trùng với mã đang tra cứu.'};
 const at=matches[0];
 // Business result: STT, tax code, name, address, tax office, tax status.
 // Personal result may display an older 10-digit MST before the 12-digit CCCD:
 // STT, old tax code, name, tax office, citizen ID, update date, notes.
 const isPersonalSecondary=id.kind==='personal'&&at>=3&&
   !!normalize(cells[at-3])&&normalize(cells[at-3]).kind==='business';
 const name=isPersonalSecondary?cells[at-2]:cells[at+1];
 if(!goodName(name||''))
  return {ok:false,reason:'Không đọc được tên người nộp thuế; hãy sao chép một dòng kết quả đầy đủ.'};
 return {
  ok:true,code:id.display,
  name:safeText(name,250),
  address:id.kind==='personal'?'':safeText(cells[at+2]||'',450),
  office:safeText(isPersonalSecondary?cells[at-1]:id.kind==='personal'?cells[at+2]:cells[at+3],250),
  status:safeText(isPersonalSecondary?cells[at+2]:id.kind==='personal'?cells[at+3]:cells[at+4],250),
  previousTaxCode:isPersonalSecondary?normalize(cells[at-3]).display:'',
  source:OFFICIAL[id.kind],
  // This flag only means the copied row matches the searched ID.
  // It NEVER means we verified this against the government server.
  matchedClipboard:true
 };
}
window.MstOfficial=Object.freeze({normalize,parseCopiedRow,officialUrl:code=>{
 const n=normalize(code);return n?OFFICIAL[n.kind]:null;
}});
})();