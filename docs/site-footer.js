/* AutoTax 1.1.8 – public contact footer managed by AutoTax Admin. */
(()=>{
 'use strict';
 const ENDPOINT='https://ucqqjdsoyvvaxswzbhaw.supabase.co/rest/v1/addon_site_links_v118';
 const APIKEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
 const defaults=[
  {label:'Báo giá thiết bị & HDĐT Viettel',url:'https://tracuuhoadon.top/baogia'},
  {label:'Trang tính K',url:'https://tracuuhoadon.top/k'},
  {label:'Công cụ PDF',url:'https://tracuuhoadon.top/pdf/'},
  {label:'Tra cứu hóa đơn Web',url:'https://tracuuhoadon.top/'}
 ];
 // Keep the public footer on trusted AutoTax/official support domains.
 // Admin-entered URLs can be HTTPS yet still be phishing or unsafe downloads.
 const allowedHosts=new Set(['tracuuhoadon.top','www.tracuuhoadon.top',
  'zalo.me','hoadondientu.gdt.gov.vn','tendoodn.github.io']);
 const safeUrl=value=>{
  try{
   const raw=String(value||'').trim();
   if(!raw||raw.startsWith('//'))return null;
   const url=raw.startsWith('/')?new URL(raw,'https://tracuuhoadon.top'):new URL(raw);
   if(url.protocol!=='https:'||!allowedHosts.has(url.hostname.toLowerCase())
     ||url.username||url.password)return null;
   return url.href;
  }catch{return null}
 };
 const elem=(tag,text,cls)=>{
  const el=document.createElement(tag);
  if(text!==undefined)el.textContent=text;
  if(cls)el.className=cls;
  return el;
 };
 async function getLinks(){
  try{
   const res=await fetch(ENDPOINT+'?enabled=eq.true&select=label,url,sort_order&order=sort_order.asc',{
   cache:'no-store',headers:{apikey:APIKEY},signal:AbortSignal.timeout(4500)
  });
   if(!res.ok)throw Error('Footer links unavailable');
   const rows=await res.json();
   if(!Array.isArray(rows))throw Error('Invalid response');
   return rows.filter(row=>safeUrl(row.url)&&String(row.label||'').trim()).slice(0,30);
  }catch{return defaults}
 }
 async function render(){
  if(document.querySelector('.autotax-public-footer'))return;
  const section=elem('section',undefined,'autotax-public-footer');
  section.setAttribute('aria-label','Thông tin liên hệ AutoTax');
  const heading=elem('strong','AutoTax · Phương Thảo Florist','autotax-footer-title');
  const contact=elem('div',undefined,'autotax-footer-contact');
  const link=(label,url)=>{const a=elem('a',label);a.href=url;
    if(!url.startsWith('mailto:')&&!url.startsWith('tel:')){
     a.target='_blank';a.rel='noopener noreferrer';
    }return a};
  contact.append(
   elem('span','Liên hệ: '),
   link('0868838242','tel:0868838242'),
   elem('span',' · Zalo: '),
   link('0868838242','https://zalo.me/0868838242')
  );
  const emails=elem('div',undefined,'autotax-footer-emails');
  emails.append(
   elem('span','Email: '),link('lienhe@tracuuhoadon.top','mailto:lienhe@tracuuhoadon.top'),
   elem('span',' · '),link('ptflorist68@gmail.com','mailto:ptflorist68@gmail.com')
  );
  const links=elem('nav',undefined,'autotax-footer-links');
  links.setAttribute('aria-label','Liên kết cơ bản');
  const showLinks=items=>{
   links.replaceChildren();
   for(const item of items){
    const url=safeUrl(item.url);
    if(url)links.append(link(String(item.label).trim(),url));
   }
  };
  showLinks(defaults); // Paint immediately; don't block the footer on Supabase.
  const independent=elem('p',
   'AutoTax là công cụ độc lập hỗ trợ tra cứu; không phải website hay ứng dụng chính thức của cơ quan Thuế.',
   'autotax-footer-independence');
  const copy=elem('div','Copyright © 2026 AutoTax - Phương Thảo Florist. All rights reserved.','autotax-footer-copy');
  section.append(heading,contact,emails,links,independent,copy);
  const st=document.createElement('style');
  st.textContent='.autotax-public-footer{display:grid;gap:9px;margin:16px auto 0;padding:24px clamp(15px,4vw,40px);background:#142332;color:#f3f7fa;border-top:2px solid #536e80;font:400 13px/1.6 system-ui,sans-serif;box-sizing:border-box;width:100%;max-width:none}.autotax-public-footer *{box-sizing:border-box}.autotax-public-footer .autotax-footer-title{font-size:15px;color:#fff}.autotax-public-footer a{color:#a9d9ff;text-decoration:none}.autotax-public-footer a:hover{text-decoration:underline}.autotax-footer-links{display:flex;gap:9px 17px;flex-wrap:wrap}.autotax-footer-independence{width:min(100%,850px);margin:8px auto 0;text-align:center;font-size:12px;line-height:1.7;color:#f1f5f9}.autotax-footer-copy{font-size:11px;color:#bbc9d6;border-top:1px solid #536e80;padding-top:9px}@media(max-width:600px){.autotax-public-footer{padding:18px 15px}}';
  document.head.append(st);document.body.append(section);
  void getLinks().then(showLinks).catch(e=>console.warn('Footer links unavailable:',e.message));
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void render());
 else void render();
})();
