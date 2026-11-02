// Public AutoTax MST lookup broker: browser never contacts 3rd-party tax APIs directly.
// Do not log tax identifiers. Personal 12-digit identifiers are never sent to a
// public business-only API: require an approved private-taxpayer provider credential.
const ALLOWED_ORIGINS=new Set([
 "https://tendoodn.github.io","http://localhost:3000","http://127.0.0.1:5500"
]);
const json=(data:unknown,status=200,origin="")=>new Response(JSON.stringify(data),{
 status,headers:{"Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
 "Vary":"Origin",...(ALLOWED_ORIGINS.has(origin)?{"Access-Control-Allow-Origin":origin}:{})}
});
const normalize=(value:unknown)=>{
 const x=String(value||"").trim();
 if(!/^\d{10}(?:-\d{3}|\d{3})?$/.test(x)&&!/^\d{12}$/.test(x))return null;
 const digits=x.replace(/\D/g,"");
 if(![10,12,13].includes(digits.length))return null;
 return {digits,display:digits.length===13?digits.slice(0,10)+"-"+digits.slice(10):digits,
  kind:digits.length===12?"personal":digits.length===13?"branch":"business"};
};
const fetchJson=async(url:string,headers:Record<string,string>,timeout=9500)=>{
 const signal=AbortSignal.timeout(timeout);
 const res=await fetch(url,{method:"GET",headers:{Accept:"application/json",...headers},
  signal,redirect:"error",cache:"no-store"});
 if(res.status===429)throw new Error("upstream_rate_limit");
 if(res.status===404)return null;
 if(!res.ok)throw new Error("upstream_http_"+res.status);
 const data=await res.json().catch(()=>null);
 if(!data||typeof data!=="object")throw new Error("invalid_upstream_response");
 return data;
};
const trim=(v:unknown,max=300)=>typeof v==="string"?v.trim().slice(0,max):"";
function normalizeResult(o:any,src:string,n:any){
 const obj=o?.data?.data||o?.data||o?.result||o;
 if(!obj||typeof obj!=="object")return null;
 const name=trim(obj.name||obj.companyName||obj.company_name||obj.taxpayerName||
  obj.tenNNT||obj.ten||obj.Title||obj.TenCongTy||obj.Name||obj.name_vi);
 if(!name)return null;
 const statusVal=obj.status;
 const status=trim(typeof statusVal==="object"?statusVal?.name:
  (obj.statusName||obj.trangThai||obj.TinhTrang||obj.Status||statusVal));
 const office=trim(obj.taxOffice||obj.taxAuthority||obj.cqt||obj.managingTaxOffice||obj.CoQuanThue);
 return {
  mst:n.display,type:n.kind,name,
  address:trim(obj.address||obj.registeredAddress||obj.address_full||obj.diaChi||
   obj.DiaChiCongTy||obj.Address,450),
  office,status:status||"Chưa có dữ liệu trạng thái",
  source:src,verified:true
 };
}
async function pay2s(n:any){
 const secret=Deno.env.get("PAY2S_SECRET_KEY");
 if(!secret)return null;
 // 12-digit personal lookup must be approved by provider in advance.
 if(n.kind==="personal"&&Deno.env.get("PAY2S_PERSONAL_ENABLED")!=="true")return null;
 const utf=new TextEncoder().encode(secret);
 const token=btoa(String.fromCharCode(...utf));
 const params=new URLSearchParams({mst:n.display});
 const data=await fetchJson("https://api.pay2s.vn/userapi/tax-lookup?"+params.toString(),
  {"pay2s-token":token},10000);
 if(data?.status===false)return null;
 return normalizeResult(data,"Pay2S (API có xác thực)",n);
}
async function vietqr(n:any){
 if(n.kind==="personal")return null; // published endpoint is only for businesses.
 const data=await fetchJson("https://api.vietqr.io/v2/business/"+n.digits,{},10500);
 if(data?.code!=="00")return null;
 return normalizeResult(data,"VietQR — dữ liệu doanh nghiệp",n);
}
async function thongtindoanhnghiep(n:any){
 if(n.kind==="personal")return null; // Its API is for publicly registered companies.
 // Documented public REST route. No API key, redirects or arbitrary URLs.
 const data=await fetchJson("https://thongtindoanhnghiep.co/api/company/"+n.digits,
  {"User-Agent":"AutoTax/3.3.7 (public business lookup)"},9500);
 const from=data?.MaSoThue||data?.maSoThue||data?.TaxCode||data?.taxCode||"";
 if(from&&String(from).replace(/\D/g,"")!==n.digits)return null;
 return normalizeResult(data,"ThongTinDoanhNghiep.co (dữ liệu doanh nghiệp công khai)",n);
}
async function lookup(n:any){
 const problems:string[]=[];
 for(const source of [pay2s,vietqr,thongtindoanhnghiep]){
  try{
   const got=await source(n);if(got)return got;
  }catch(e){problems.push(String(e instanceof Error?e.message:"upstream_error").slice(0,90))}
 }
 const unconfigured=n.kind==="personal"&&
  (!Deno.env.get("PAY2S_SECRET_KEY")||Deno.env.get("PAY2S_PERSONAL_ENABLED")!=="true");
 return {
  mst:n.display,type:n.kind,verified:false,name:"",
  office:"",address:"",status:"Chưa xác minh",
  source:unconfigured?"Chưa có API tra cứu cá nhân được cấp quyền":"Nguồn tra cứu chưa trả dữ liệu xác minh",
  error:unconfigured?"personal_source_not_configured":
   problems.includes("upstream_rate_limit")?"rate_limited":
   problems.length?"upstream_unavailable":"not_found_or_unavailable"
 };
}
const recentRequests=new Map<string,{count:number,time:number}>();
Deno.serve(async(req)=>{
 const origin=req.headers.get("origin")||"";
 if(origin&&!ALLOWED_ORIGINS.has(origin))return json({error:"origin_forbidden"},403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization, apikey",
  "Access-Control-Max-Age":"600","Vary":"Origin"}});
 if(req.method!=="POST")return json({error:"method_not_allowed"},405,origin);
 const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown";
 const now=Date.now(),item=recentRequests.get(ip);
 const quota=item&&now-item.time<60000?item:{count:0,time:now};
 if(++quota.count>8)return json({error:"rate_limited",retry_after_seconds:60},429,origin);
 recentRequests.set(ip,quota);
 if(recentRequests.size>500)for(const [k,v] of recentRequests)
  if(now-v.time>60000)recentRequests.delete(k);
 const body=await req.json().catch(()=>null);
 if(!body||!Array.isArray(body.codes)||!body.codes.length||body.codes.length>20)
  return json({error:"codes_required_max_20"},400,origin);
 const normalized=body.codes.map(normalize);
 if(normalized.some(n=>!n))return json({error:"invalid_tax_code"},400,origin);
 const nums=[...new Map(normalized.map(n=>[n!.digits,n!])).values()];
 const out=new Array(nums.length);let next=0;
 const work=async()=>{
  for(;;){
   const i=next++;if(i>=nums.length)return;
   out[i]=await lookup(nums[i]);
  }
 };
 await Promise.all(Array.from({length:Math.min(nums.length,3)},()=>work()));
 return json({data:out,count:out.length,source:"autotax-mst-lookup",
  notice:"Dữ liệu doanh nghiệp từ API được cấp. Không tự kết luận hoạt động khi nguồn không trả trạng thái."},200,origin);
});