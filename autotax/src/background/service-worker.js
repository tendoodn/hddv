// Mở side panel khi bấm icon; ghi file qua chrome.downloads.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
// Global panel stays available across tab switches; only a user action closes it.
chrome.sidePanel.setOptions({path:'src/sidepanel/index.html',enabled:true}).catch(()=>{});

// Chỉ báo thành công khi Chrome xác nhận tệp đã tải xong, không phải chỉ mới nhận lệnh.
function waitForDownload(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(new Error(error)) : resolve({ id, complete: true });
    };
    const onChanged = (delta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish();
      else if (delta.state?.current === 'interrupted') finish(delta.error?.current || 'Tải xuống bị gián đoạn.');
    };
    const timer = setTimeout(() => finish('Quá thời gian chờ Chrome hoàn tất tải xuống.'), 10 * 60 * 1000);
    chrome.downloads.onChanged.addListener(onChanged);
    // Kiểm tra trạng thái hiện tại để tránh bỏ lỡ sự kiện complete đến trước khi listener kịp xử lý.
    chrome.downloads.search({ id }, (items) => {
      if (chrome.runtime.lastError) return finish(chrome.runtime.lastError.message);
      const item = items?.[0];
      if (!item) return finish('Không tìm thấy tác vụ tải xuống trong Chrome.');
      if (item.state === 'complete') finish();
      else if (item.state === 'interrupted') finish(item.error || 'Tải xuống bị gián đoạn.');
    });
  });
}

// Provider PDF retrieval is strictly opt-in and domain-scoped. Never proxy
// arbitrary URLs, attach browser cookies, follow redirects, or mislabel HTML as PDF.
// Only approved consumer invoice domains from AutoTax's 21-provider catalog.
const ISSUER_DOMAINS=new Set([
 'meinvoice.vn','fpt.com.vn','kiotviet.vn','vnpt-invoice.com.vn',
 'ehoadon.vn','easyinvoice.vn','minvoice.com.vn','thaison.vn',
 'mobifone.vn','fast.com.vn','nacencomm.vn','hilo.com.vn',
 'matbao.in','vinvoice.vn','viettel.vn','smartsign.com.vn',
 'xuathoadon.vn','cloudinvoice.vn','vietinvoice.vn','oinvoice.vn',
 'ehoadon.online'
]);
const approvedIssuerHost=host=>[...ISSUER_DOMAINS].some(domain=>
 host===domain||host.endsWith('.'+domain));
function issuerPdfURL(value){
 let u;
 try{u=new URL(String(value||''))}catch{throw Error('Đường dẫn PDF không hợp lệ.')}
 if(u.protocol!=='https:'||u.username||u.password||
    (u.port&&u.port!=='443')||!approvedIssuerHost(u.hostname.toLowerCase()))
  throw Error('Nhà phát hành chưa nằm trong danh sách miền được phép.');
 if(!/(?:\.pdf$|\/pdf(?:\/|$)|(?:download|export)[^/]*(?:pdf|invoice)?|format=pdf|type=pdf)/i.test(u.pathname+u.search))
  throw Error('Đây là trang tra cứu, chưa phải liên kết tải PDF trực tiếp.');
 return u;
}
async function fetchIssuerPdf(value,authenticated=false){
 const u=issuerPdfURL(value);
 // All issuer domains are declared as required host permissions in V1.1.
 // Authentication is used ONLY after an explicit click in the real issuer tab.
 // Default automated requests never attach login cookies or security codes.
 const res=await fetch(u.href,{method:'GET',credentials:authenticated?'include':'omit',redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(16000),headers:{Accept:'application/pdf,application/octet-stream'}});
 if(!res.ok)throw Error('Máy chủ nhà phát hành trả HTTP '+res.status);
 const cap=12*1024*1024,n=Number(res.headers.get('content-length')||0);
 if(n>cap)throw Error('PDF lớn hơn 12 MB.');
 const pieces=[];let size=0;
 if(res.body){
  const reader=res.body.getReader();
  for(;;){
   const {value,done}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>cap){await reader.cancel();throw Error('PDF lớn hơn 12 MB.')}
   pieces.push(value);
  }
 }else{
  const data=new Uint8Array(await res.arrayBuffer());size=data.byteLength;
  if(size>cap)throw Error('PDF lớn hơn 12 MB.');pieces.push(data);
 }
 const data=new Uint8Array(size);let offset=0;
 for(const part of pieces){data.set(part,offset);offset+=part.byteLength}
 if(size<5||data[0]!==37||data[1]!==80||data[2]!==68||data[3]!==70||data[4]!==45)
  throw Error('Nhà phát hành không trả PDF thực (có thể yêu cầu CAPTCHA hoặc đăng nhập).');
 let chars='';
 for(let i=0;i<data.length;i+=8192)
  chars+=String.fromCharCode(...data.subarray(i,i+8192));
 return {ok:true,pdfBase64:btoa(chars),origin:u.hostname};
}

// V1.1 assisted retrieval: the issuer's own CAPTCHA/authentication happens in
// its real page. Only the user can start a lookup and authorize PDF capture.
// Never persist PDF bytes or tax passwords; session queue expires after 2h.
const ISSUER_QUEUE='autotax_issuer_lookup_queue_v11';
const ISSUER_TTL=2*60*60*1000;
const issuerGroup=host=>[...ISSUER_DOMAINS].find(domain=>
 host===domain||host.endsWith('.'+domain));
function lookupURL(value){
 const u=new URL(String(value||''));
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||
  !issuerGroup(u.hostname.toLowerCase()))throw Error('Link không thuộc 21 cổng nhà phát hành được duyệt.');
 return u;
}
async function issuerQueue(){
 const a=(await chrome.storage.session.get(ISSUER_QUEUE))[ISSUER_QUEUE];
 return (Array.isArray(a)?a:[]).filter(x=>x.addedAt>Date.now()-ISSUER_TTL).slice(-100);
}
async function issuerAdd(record,sender){
 if(!/^https:\/\/hoadondientu\.gdt\.gov\.vn\//.test(sender?.url||''))
  throw Error('Chỉ trang Thuế đã đăng nhập được thêm link tra cứu hóa đơn.');
 const u=lookupURL(record?.link),code=String(record?.code||'').trim();
 if(!code||code.length>300||u.href.length>2048)throw Error('Thiếu mã hoặc link tra cứu hợp lệ.');
 const invoice=String(record?.invoice||'').replace(/[^0-9A-Za-z_.-]/g,'_').slice(0,90);
 const key=[u.hostname,invoice,code].join('|');
 const a=await issuerQueue();
 if(!a.some(x=>x.key===key))a.push({
  key,link:u.href,code,invoice,addedAt:Date.now(),opened:false
 });
 await chrome.storage.session.set({[ISSUER_QUEUE]:a.slice(-100)});
 return {ok:true,count:a.length};
}
async function issuerOpenNext(){
 const all=await issuerQueue();
 const item=all.find(x=>!x.opened)||all[0];
 if(!item)return {ok:false,error:'Chưa có hóa đơn cần mở. Hãy bật PDF gốc và tải hóa đơn trên cổng Thuế trước.'};
 const tab=await chrome.tabs.create({url:item.link,active:true});
 await chrome.storage.session.set({['autotax_issuer_tab_'+tab.id]:{...item,tabId:tab.id}});
 item.opened=true;
 await chrome.storage.session.set({[ISSUER_QUEUE]:all});
 return {ok:true,tabId:tab.id,invoice:item.invoice,count:all.length};
}
async function issuerSession(sender){
 const tabId=sender?.tab?.id;
 if(!Number.isInteger(tabId))throw Error('Yêu cầu cần xuất phát từ trang nhà phát hành.');
 const item=(await chrome.storage.session.get('autotax_issuer_tab_'+tabId))
  ['autotax_issuer_tab_'+tabId];
 if(!item||Date.now()-item.addedAt>ISSUER_TTL)throw Error('Phiên tra cứu đã hết hạn.');
 const current=lookupURL(sender?.url),initial=lookupURL(item.link);
 if(issuerGroup(current.hostname)!==issuerGroup(initial.hostname))
  throw Error('Trang hiện tại không cùng nhà phát hành với hóa đơn.');
 return item;
}
async function issuerDownloadFromPage(message,sender){
 const item=await issuerSession(sender);
 const candidate=issuerPdfURL(message?.url);
 if(issuerGroup(candidate.hostname)!==issuerGroup(new URL(item.link).hostname))
  throw Error('PDF phải cùng nhà phát hành của hóa đơn.');
 const pdf=await fetchIssuerPdf(candidate.href,true);
 const safeInvoice=(item.invoice||'HoaDon').replace(/[^0-9A-Za-z_.-]/g,'_');
 const filename='AutoTax/PDF_Goc_Nha_Phat_Hanh/'+safeInvoice+'.pdf';
 const downloadId=await chrome.downloads.download({
  url:'data:application/pdf;base64,'+pdf.pdfBase64,filename,
  conflictAction:'uniquify',saveAs:false
 });
 await waitForDownload(downloadId);
 const list=await issuerQueue();
 await chrome.storage.session.set({[ISSUER_QUEUE]:list.filter(x=>x.key!==item.key)});
 await chrome.storage.session.remove('autotax_issuer_tab_'+item.tabId);
 return {ok:true,filename,remaining:Math.max(0,list.length-1),
  note:'Đã tải PDF thực. Chữ ký và nội dung hóa đơn cần được đối chiếu riêng.'};
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(msg?.type==='issuer-queue-add'){
    issuerAdd(msg,sender).then(reply,e=>reply({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==='issuer-queue-count'){
    issuerQueue().then(a=>reply({ok:true,count:a.length}),
      e=>reply({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==='issuer-open-next'){
    if(!sender?.url?.startsWith(chrome.runtime.getURL('src/sidepanel/')))
      return reply({ok:false,error:'Chỉ Add-on mới mở phiên tra cứu.'}),false;
    issuerOpenNext().then(reply,e=>reply({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==='issuer-assist-state'){
    issuerSession(sender).then(item=>reply({ok:true,invoice:item.invoice,code:item.code}),
      e=>reply({ok:false,error:e.message}));
    return true;
  }
  if(msg?.type==='issuer-assist-download'){
    issuerDownloadFromPage(msg,sender).then(reply,e=>reply({ok:false,error:e.message}));
    return true;
  }

  if (msg.type === 'stock-tab-mapping') {
    (async()=>{
      const tabId=msg.portalTabId,requestId=String(msg.requestId||'');
      if(!Number.isInteger(tabId)||!/^tendoo-map-[a-zA-Z0-9.-]+$/.test(requestId))
        throw Error('Phiên liên kết không hợp lệ.');
      const key='autotax-tendoo-request-'+requestId;
      const payload=(await chrome.storage.session.get(key))[key];
      if(!payload||payload.portalTabId!==tabId)
        throw Error('Phiên ánh xạ đã hết hạn hoặc trang Thuế đã thay đổi.');
      const validKeys=new Set(payload.names.map(n=>n.key));
      const validCodes=new Set(payload.products.map(p=>p.sku));
      for(const [name,sku] of Object.entries(msg.mapping||{})){
        if(!validKeys.has(name)||!validCodes.has(sku))
          throw Error('Tên sản phẩm hoặc mã SKU không hợp lệ.');
      }
      const result=await chrome.tabs.sendMessage(tabId,{
        type:'tendoo-map-response',requestId,mapping:msg.mapping||{}
      });
      if(!result?.ok)throw Error('Không tìm thấy tác vụ nhập kho đang chờ trên tab Thuế.');
      await chrome.storage.session.remove(key);
      return {ok:true};
    })().then(reply,e=>reply({ok:false,error:e.message}));
    return true;
  }
  if (msg.type === 'fetch-issuer-pdf') {
    fetchIssuerPdf(msg.url).then(reply,e=>reply({ok:false,error:e.message||String(e)}));
    return true;
  }
  if (msg.type === 'download') {
    // Tải lại cùng hóa đơn thì ghi đè, không sinh file trùng.
    chrome.downloads.download({ url: msg.url, filename: msg.filename, conflictAction: 'overwrite', saveAs: false })
      .then((id) => waitForDownload(id).then(reply, (e) => reply({ error: e.message })))
      .catch((e) => reply({ error: e.message }));
    return true;
  }
});
