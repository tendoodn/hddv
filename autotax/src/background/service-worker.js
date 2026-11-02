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
const ISSUER_HOSTS=new Set([
 'www.meinvoice.vn','tra-cuu.meinvoice.vn',
 'sinvoice.viettel.vn','vinvoice.viettel.vn',
 'xemhoadon32.vnpt.vn','vinaphone-portal.vnpt-invoice.com.vn'
]);
function issuerPdfURL(value){
 let u;
 try{u=new URL(String(value||''))}catch{throw Error('Đường dẫn PDF không hợp lệ.')}
 if(u.protocol!=='https:'||u.username||u.password||!ISSUER_HOSTS.has(u.hostname))
  throw Error('Nhà phát hành chưa nằm trong danh sách miền được phép.');
 if(!/(?:\.pdf$|\/pdf(?:\/|$)|(?:download|export)[^/]*(?:pdf|invoice)?|format=pdf|type=pdf)/i.test(u.pathname+u.search))
  throw Error('Đây là trang tra cứu, chưa phải liên kết tải PDF trực tiếp.');
 return u;
}
async function fetchIssuerPdf(value){
 const u=issuerPdfURL(value),permission=u.origin+'/*';
 if(!(await chrome.permissions.contains({origins:[permission]})))
  throw Error('Chưa cấp quyền truy cập nhà phát hành. Bật tại mục định dạng PDF trong Add-on.');
 const res=await fetch(u.href,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',
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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
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
