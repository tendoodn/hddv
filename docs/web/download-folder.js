/* Shared AutoTax directory output for Chrome Side Panel and HTTPS Web.
 * A user gesture selects one directory. Handles are stored in IndexedDB;
 * browsers may request permission again after a restart.
 */
(()=>{
'use strict';
const DB='autotax_selected_output_folder_v113',STORE='folders',KEY='chosen';
let root=null;
const openDB=()=>new Promise((resolve,reject)=>{
 const q=indexedDB.open(DB,1);
 q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};
 q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
});
async function access(method,value){
 const db=await openDB();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,method==='get'?'readonly':'readwrite');
  const req=method==='get'?tx.objectStore(STORE).get(KEY):
   method==='put'?tx.objectStore(STORE).put(value,KEY):tx.objectStore(STORE).delete(KEY);
  let result;
  req.onsuccess=()=>{result=req.result;if(method==='get')resolve(result)};
  req.onerror=()=>reject(req.error||Error('IndexedDB request failed'));
  tx.oncomplete=()=>{if(method!=='get')resolve(result)};
  tx.onerror=()=>reject(tx.error||Error('IndexedDB transaction failed'));
 })}finally{db.close()}
}
const restore=access('get').then(h=>{if(h?.kind==='directory')root=h}).catch(()=>{});
function safe(part){
 const v=String(part||'').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,160);
 return !v||v==='.'||v==='..'?'khong_ten':v;
}
function outputPath(input){
 const path=String(input||'').replace(/\\/g,'/').split('/').filter(Boolean);
 if(!path.length)throw Error('Đường dẫn tệp trống.');
 if(path.some(p=>p==='..'||p==='.'||!p.trim()))throw Error('Đường dẫn tệp không an toàn.');
 const names=path.map(safe);
 // Ignore old Downloads/HoaDon/MST/date scaffolding and sort strictly by format.
 const index=names.findIndex(p=>/^(xml|html|pdf_goc|pdf_dung_lai|nhap_hang|PDF_Goc_Nha_Phat_Hanh|PDF_Dung_Lai_Tu_CQT_Khong_Phai_Goc|PDF_Chua_Lay_Duoc_Goc|PDF_THUE_DUNG_TU_DU_LIEU_CQT_KHONG_PHAI_GOC|PDF_goc_nha_phat_hanh|PDF_nguoi_dung_cung_cap_CHUA_XAC_MINH)$/i.test(p));
 if(index>=0){
  const category=names[index].toLowerCase();
  const top=category==='xml'?'xml':category==='html'?'html':
   category==='nhap_hang'?'nhap_hang':
   /^(pdf_goc|pdf_goc_nha_phat_hanh)$/i.test(category)?'pdf_goc':'pdf_dung_lai';
  return [top,...names.slice(index+1)];
 }
 const last=names.at(-1),extension=last.toLowerCase().split('.').at(-1);
 if(extension==='xlsx'||extension==='xls'||extension==='csv')return [last];
 if(extension==='xml')return ['xml',last];
 if(extension==='html'||extension==='htm')return ['html',last];
 if(extension==='pdf')return ['pdf_goc',last];
 return [last];
}
let waitingForPicker=null;
async function fromFullTab(){
 if(waitingForPicker)return waitingForPicker;
 if(typeof chrome==='undefined'||!chrome.tabs?.create||typeof BroadcastChannel==='undefined')
  throw Error('Không mở được tab chọn thư mục trong Chrome.');
 waitingForPicker=new Promise(async(resolve,reject)=>{
  const channel=new BroadcastChannel('autotax-folder-v113');
  let tabId=null,finished=false,timer=null;
  const cleaned=()=>{
   if(timer)clearTimeout(timer);
   channel.close();
   try{chrome.tabs.onRemoved.removeListener(onTabClosed)}catch{}
  };
  const done=(error,value)=>{
   if(finished)return;
   finished=true;cleaned();
   if(error)reject(error);else resolve(value);
  };
  const canceled=()=>new DOMException('Người dùng chưa chọn thư mục.','AbortError');
  const onTabClosed=id=>{
   if(id!==tabId||finished)return;
   // Allow a final IndexedDB write/message to settle before classifying tab closure.
   setTimeout(async()=>{
    if(finished)return;
    const h=await access('get').catch(()=>null);
    if(h?.kind==='directory'){
     root=h;
     const status=await h.queryPermission({mode:'readwrite'}).catch(()=>null);
     if(status==='granted')return done(null,h.name);
    }
    done(canceled());
   },450);
  };
  channel.onmessage=async event=>{
   if(finished)return;
   if(event.data?.status==='cancelled')return done(canceled());
   if(event.data?.status!=='chosen')return;
   try{
    const h=await access('get');
    if(h?.kind!=='directory')throw Error('Không khôi phục được thư mục đã chọn.');
    root=h;
    if(await h.queryPermission({mode:'readwrite'})!=='granted')
     throw Error('Chrome chưa cấp quyền ghi thư mục.');
    done(null,h.name);
   }catch(error){done(error)}
  };
  timer=setTimeout(()=>done(new Error('Đã hết thời gian chọn thư mục.')),180000);
  try{
   chrome.tabs.onRemoved.addListener(onTabClosed);
   const tab=await chrome.tabs.create({
    url:chrome.runtime.getURL('folder-picker.html'),active:true
   });
   tabId=tab.id;
  }catch(error){done(error)}
 });
 try{return await waitingForPicker}
 finally{waitingForPicker=null}
}
async function prepare({force=false}={}){
 await restore;
 if(!('showDirectoryPicker' in window))
  throw Error('Chrome chưa hỗ trợ chọn thư mục theo ý người dùng.');
 const prior=root;
 if(force)root=null;
 if(root){
  const status=await root.queryPermission({mode:'readwrite'});
  if(status==='granted')return root.name;
 }
 const isExtensionSidePanel=window.location?.protocol==='chrome-extension:'&&
  /\/index\.html$/i.test(window.location?.pathname||'');
 if(isExtensionSidePanel){
  try{return await fromFullTab()}catch(error){root=prior;throw error}
 }
 try{
  root=await window.showDirectoryPicker({
   id:'autotax-invoices-v113',mode:'readwrite',startIn:'downloads'
  });
  await access('put',root);
  return root.name;
 }catch(error){root=prior;throw error}
}

async function save(path,data,mime='application/octet-stream'){
 if(!root)throw Error('Chưa chọn thư mục lưu. Hãy bấm Tìm kiếm để chọn thư mục trước.');
 if(await root.queryPermission({mode:'readwrite'})!=='granted')
  throw Error('Quyền ghi thư mục đã hết hạn. Hãy bấm Tìm kiếm để cấp quyền lại.');
 const names=outputPath(path);
 let dir=root;
 for(const p of names.slice(0,-1))dir=await dir.getDirectoryHandle(p,{create:true});
 const fh=await dir.getFileHandle(names.at(-1),{create:true});
 const writable=await fh.createWritable();
 try{await writable.write(data instanceof Blob?data:new Blob([data],{type:mime}));await writable.close()}
 catch(error){try{await writable.abort()}catch{}throw error}
 return names.join('/');
}
async function saveMany(files){
 let count=0;
 for(const file of files){await save(file.name,file.data,file.mime);count++}
 return count;
}
async function change(){return prepare({force:true})}
window.AutoTaxDownloadFolder=Object.freeze({
 prepare,change,save,saveMany,outputPath,
 get label(){return root?.name||''}
});
})();
