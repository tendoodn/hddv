/* AutoTax V1.1 — voluntarily assisted issuer lookup.
 * Only displayed when a user explicitly opens this invoice's issuer tab.
 * NEVER solves CAPTCHA, submits forms or guesses API endpoints. */
(async()=>{
'use strict';
if(window.top!==window)return;
let state;
try{state=await chrome.runtime.sendMessage({type:'issuer-assist-state'})}
catch{return}
if(!state?.ok||!state.code)return;
const host=document.createElement('div');
host.id='autotax-issuer-assist-v11';
const shadow=host.attachShadow({mode:'closed'});
const stylesheet=document.createElement('style');
stylesheet.textContent=":host{all:initial}\nsection{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;width:315px;max-width:calc(100vw - 32px);background:#0b111a;color:#edf5ff;border:1px solid #2d5264;border-radius:14px;box-shadow:0 18px 65px #0009;padding:14px;font:13px/1.5 system-ui}\nh2{all:unset;font-weight:800;font-size:15px;color:#75dfff}\np{all:unset;color:#c5d1df;font-size:12px;line-height:1.5}\nsmall{font-size:11px;color:#a4b6c6;word-break:break-all}\nbutton{font:600 12px system-ui;cursor:pointer;border:1px solid #446078;border-radius:8px;color:#fff;background:#172536;padding:8px 10px}\nbutton.primary{background:#0b79bd;border-color:#3094cd}\nbutton:disabled{opacity:.55;cursor:wait}\ncode{display:block;background:#202e3f;color:#fff;border-radius:6px;padding:5px 7px;word-break:break-all;user-select:all;font:600 12px ui-monospace,monospace}\nul{list-style:none;padding:0;margin:0;display:grid;gap:6px;max-height:180px;overflow-y:auto}\nli{display:grid;gap:4px}";
shadow.append(stylesheet);
const box=document.createElement('section'),title=document.createElement('h2');
title.textContent='AutoTax · Hỗ trợ lấy PDF gốc';
const sub=document.createElement('small');sub.textContent='Hóa đơn: '+state.invoice;
const codeEl=document.createElement('code');codeEl.textContent=state.code;
const help=document.createElement('p');
help.textContent='Nhập mã tra cứu trên trang nhà phát hành, thực hiện CAPTCHA/đăng nhập nếu cần. Sau khi có kết quả, bấm Tìm PDF.';
const feedback=document.createElement('p');
feedback.textContent='Tệp PDF nhận về chưa được tự xác minh chữ ký số.';
const copy=document.createElement('button');copy.textContent='Sao chép mã tra cứu';
copy.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(state.code);
  feedback.textContent='Đã sao chép mã tra cứu để dán vào biểu mẫu của nhà phát hành.'}
 catch{const input=document.createElement('input');input.value=state.code;
  box.append(input);input.select();
  feedback.textContent='Hãy nhấn Ctrl+C để sao chép mã đang chọn.'}
});
const scan=document.createElement('button');scan.className='primary';
scan.textContent='Tìm PDF sau khi xác thực';
const listing=document.createElement('ul');
function candidates(){
 const nodes=document.querySelectorAll('a[href],iframe[src],embed[src],object[data],[data-href]');
 const found=new Map();let count=0;
 for(const n of nodes){
  if(++count>700)break;
  const href=n.getAttribute('href')||n.getAttribute('src')||
   n.getAttribute('data')||n.getAttribute('data-href');
  if(!href)continue;
  let u;
  try{u=new URL(href,location.href)}catch{continue}
  if(u.protocol!=='https:'||u.username||u.password)continue;
  if(!/(?:\.pdf(?:$|\?)|\/pdf(?:\/|$)|download[^/]*(?:pdf|invoice)?|format=pdf|type=pdf)/i.test(u.pathname+u.search))
   continue;
  if(found.has(u.href))continue;
  const label=String(n.textContent||n.title||'Liên kết tải').trim().slice(0,85);
  found.set(u.href,{url:u.href,label});
  if(found.size>=30)break;
 }
 return [...found.values()];
}
scan.addEventListener('click',()=>{
 listing.replaceChildren();
 const items=candidates();
 feedback.textContent=items.length?
  'Tìm thấy '+items.length+' liên kết. Chọn đúng hóa đơn rồi tải từ phiên đã xác thực.':
  'Chưa thấy URL PDF. Hãy nhập mã/CAPTCHA rồi bấm lại. Nếu KiotViet trả ZIP chứa PDF+XML, bấm “Tải xuống” trên trang nhà phát hành.';
 for(const candidate of items){
  const li=document.createElement('li'),btn=document.createElement('button');
  btn.textContent='Tải PDF · '+(candidate.label||new URL(candidate.url).pathname.slice(-45));
  btn.title=candidate.url;
  btn.addEventListener('click',async()=>{
   btn.disabled=true;feedback.textContent='Đang đọc PDF từ phiên nhà phát hành...';
   try{
    const res=await chrome.runtime.sendMessage({type:'issuer-assist-download',url:candidate.url});
    if(!res?.ok)throw Error(res?.error||'Nhà phát hành không trả PDF.');
    feedback.textContent=res.note+' Lưu: '+res.filename;
    btn.textContent='Đã tải PDF';
   }catch(e){
    feedback.textContent='Chưa lấy được PDF: '+(e.message||e)+
     '. Có thể nhà phát hành dùng nút JavaScript hoặc chưa cho tải sau CAPTCHA.';
    btn.disabled=false
   }
  });
  li.append(btn);listing.append(li);
 }
});
const close=document.createElement('button');close.textContent='Ẩn hỗ trợ';
close.addEventListener('click',()=>host.remove());
box.append(title,sub,help,codeEl,copy,scan,listing,feedback,close);
shadow.append(box);document.documentElement.append(host);
})();