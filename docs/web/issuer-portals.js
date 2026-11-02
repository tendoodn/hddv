/* AutoTax V1.1 — 21 consumer-facing invoice portals, 02/11/2026.
 * Lookup pages ≠ PDF download endpoints. Supplier-specific customer subdomains
 * (especially VNPT) must use the URL from the real invoice, never an inferred URL.
 * The lookup/security code is separate from CAPTCHA; no automatic bypass.
 */
(()=>{
'use strict';
const SOURCES=Object.freeze([
 {
  "id": "viettel",
  "name": "Viettel S-Invoice",
  "portal": "https://vinvoice.viettel.vn/utilities/invoice-search",
  "domain": "vinvoice.viettel.vn"
 },
 {
  "id": "misa",
  "name": "MISA meInvoice",
  "portal": "https://www.meinvoice.vn/tra-cuu/",
  "domain": "meinvoice.vn"
 },
 {
  "id": "fpt",
  "name": "FPT.eInvoice",
  "portal": "https://tracuuhoadon.fpt.com.vn/",
  "domain": "fpt.com.vn"
 },
 {
  "id": "kiotviet",
  "name": "KiotViet KV-EINVOICE",
  "portal": "https://tracuuhoadon.kiotviet.vn/",
  "domain": "kiotviet.vn"
 },
 {
  "id": "vnpt",
  "name": "VNPT Invoice",
  "portal": "",
  "domain": "vnpt-invoice.com.vn"
 },
 {
  "id": "bkav",
  "name": "BKAV eHoadon",
  "portal": "https://tchd.ehoadon.vn/TCHD",
  "domain": "ehoadon.vn"
 },
 {
  "id": "easyinvoice",
  "name": "EasyInvoice / SoftDreams",
  "portal": "https://tracuu.easyinvoice.vn/Search/Index",
  "domain": "easyinvoice.vn"
 },
 {
  "id": "minvoice",
  "name": "M-Invoice",
  "portal": "https://tracuuhoadon.minvoice.com.vn/",
  "domain": "minvoice.com.vn"
 },
 {
  "id": "thaison",
  "name": "E-Invoice / Thái Sơn",
  "portal": "https://hoadon.thaison.vn/",
  "domain": "thaison.vn"
 },
 {
  "id": "mobifone",
  "name": "MobiFone Invoice",
  "portal": "https://tracuuhoadon.mobifone.vn/",
  "domain": "mobifone.vn"
 },
 {
  "id": "fast",
  "name": "FAST e-Invoice",
  "portal": "https://einvoice.fast.com.vn/",
  "domain": "fast.com.vn"
 },
 {
  "id": "ca2",
  "name": "CA2 eInvoice / Nacencomm",
  "portal": "https://hoadon78.nacencomm.vn/tracuuhd.aspx",
  "domain": "nacencomm.vn"
 },
 {
  "id": "hilo",
  "name": "HILO Invoice",
  "portal": "https://tracuuhddt78.hilo.com.vn/",
  "domain": "hilo.com.vn"
 },
 {
  "id": "matbao",
  "name": "Mắt Bão Invoice",
  "portal": "https://matbao.in/tra-cuu-hoa-don/",
  "domain": "matbao.in"
 },
 {
  "id": "megabiz",
  "name": "V-Invoice / Megabiz",
  "portal": "https://tracuu.vinvoice.vn/",
  "domain": "vinvoice.vn"
 },
 {
  "id": "smartsign",
  "name": "Vi Na / SmartSign",
  "portal": "https://tracuuhd.smartsign.com.vn/",
  "domain": "smartsign.com.vn"
 },
 {
  "id": "ts24",
  "name": "TS24 / XuatHoaDon",
  "portal": "https://tracuu.xuathoadon.vn/",
  "domain": "xuathoadon.vn"
 },
 {
  "id": "cloudinvoice",
  "name": "CloudInvoice / ITT",
  "portal": "https://tracuu.cloudinvoice.vn/",
  "domain": "cloudinvoice.vn"
 },
 {
  "id": "vietinvoice",
  "name": "Viet-Invoice / iCorp",
  "portal": "https://tracuuhoadon.vietinvoice.vn/",
  "domain": "vietinvoice.vn"
 },
 {
  "id": "oinvoice",
  "name": "Oinvoice",
  "portal": "https://oinvoice.vn/tracuu/",
  "domain": "oinvoice.vn"
 },
 {
  "id": "ehoadononline",
  "name": "eHoaDon Online / Công Nghệ Kết Nối",
  "portal": "https://ehoadon.online/einvoice/lookup",
  "domain": "ehoadon.online"
 }
]);
const isInDomain=(host,domain)=>host===domain||host.endsWith('.'+domain);
function describe(link){
 let url;
 try{url=new URL(String(link||''))}catch{return null}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')return null;
 const source=SOURCES.find(x=>isInDomain(url.hostname.toLowerCase(),x.domain));
 return source?Object.freeze({...source,actualUrl:url.href}):null;
}
const validCode=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=300;
function route(info){
 const link=String(info?.link||'').trim(),code=String(info?.code||'').trim();
 const source=describe(link);
 let trustedLookup=false;
 try{const u=new URL(link);trustedLookup=u.protocol==='https:'&&!u.username&&!u.password&&
   (!u.port||u.port==='443')&&!/^(?:localhost|127\.|10\.|192\.168\\.|169\.254\\.|0\.)/i.test(u.hostname)}
 catch{}
 let directPdf=false;
 try{const u=new URL(link);directPdf=u.protocol==='https:'&&
  (/\.pdf$/i.test(u.pathname)||/\/pdf(?:\/|$)|download[^/]*(?:pdf|invoice)|format=pdf|type=pdf/i.test(u.pathname+u.search))}
 catch{}
 return {source,link,code,directPdf,hasLookup:!!(trustedLookup&&validCode(code)),
  // A direct PDF URL may carry an existing access token in its URL.
  // Never append the security code to it or guess provider API endpoints.
  // A real HTTPS lookup URL from an invoice has priority even if its
  // supplier is not yet included in the catalog of 21.
  shouldReconstruct:!directPdf&&!(trustedLookup&&validCode(code))};
}
window.IssuerPortals=Object.freeze({sources:SOURCES,describe,route});
})();
