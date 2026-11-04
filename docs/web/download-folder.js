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

const DEFAULT_DIR='HoaDon';
function folderFor(path){
 const all=String(path||'').replace(/\\/g,'/').split('/').filter(Boolean);
 const profile=all.find(p=>/^(?:\d{10}|\d{12}|\d{13})(?:\s|$|[-–_])/.test(p))||'';
 const fromFile=(profile.match(/^(\d{10,13})/)||[])[1]||'';
 const fromWeb=String(window.WebInvoiceApp?.getMst?.()||window.AutoTaxGdtProfile?.mst||'').replace(/\D/g,'');
 const mst=fromFile||(/^(?:\d{10}|\d{12}|\d{13})$/.test(fromWeb)?fromWeb:'Chua_Xac_Dinh_MST');
 return [DEFAULT_DIR,mst,...outputPath(path)];
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function restored(){
 // A blocked IDB must never prevent an invoice from being downloaded.
 await Promise.race([restore,delay(650)]);
}
function shownName(){
 if(root?.name)return root.name.toLowerCase()===DEFAULT_DIR.toLowerCase()?
  root.name:root.name+'/'+DEFAULT_DIR;
 return 'Downloads/'+DEFAULT_DIR;
}
async function prepare(){
 await restored();
 return shownName();
}
async function pickChange(){
 await restored();
 const previous=root;
 const isPanel=window.location?.protocol==='chrome-extension:'&&
  /\/index\.html$/i.test(window.location?.pathname||'');
 if(isPanel){
  try{return await fromFullTab()}catch(error){root=previous;throw error}
 }
 if(typeof window.showDirectoryPicker!=='function')
  throw Error('Trình duyệt không hỗ trợ chọn thư mục. AutoTax vẫn tải vào Downloads/Hoa Don.');
 try{
  const chosen=await window.showDirectoryPicker({id:'autotax-invoices-v113',mode:'readwrite',startIn:'downloads'});
  if(await chosen.queryPermission({mode:'readwrite'})!=='granted'){
   const allowed=await chosen.requestPermission({mode:'readwrite'});
   if(allowed!=='granted')throw Error('Bạn chưa cấp quyền ghi thư mục.');
  }
  await access('put',chosen);root=chosen;
  // IndexedDB persists a serializable FileSystemDirectoryHandle across openings.
  // Metadata is supplementary only: it cannot replace actual Chrome permission.
  try{
   if(window.location?.protocol==='chrome-extension:'){
    await chrome.storage.local.set({autotax_folder_preference_v115:{
      label:shownName(),saved_at:new Date().toISOString()
    }});
   }else{
    localStorage.setItem('autotax_folder_preference_v115',shownName());
   }
  }catch{}
  return shownName();
 }catch(error){root=previous;throw error}
}
async function tryHandle(parts,data,mime){
 if(!root)return false;
 const permission=await root.queryPermission({mode:'readwrite'}).catch(()=>null);
 if(permission!=='granted')return false;
 try{
  let folder=root;
  for(const segment of parts.slice(0,-1))
   folder=await folder.getDirectoryHandle(segment,{create:true});
  const fh=await folder.getFileHandle(parts.at(-1),{create:true});
  const writable=await fh.createWritable();
  try{await writable.write(data instanceof Blob?data:new Blob([data],{type:mime}));await writable.close()}
  catch(error){try{await writable.abort()}catch{}throw error}
  return true;
 }catch(error){
  // An invalid/revoked directory cannot hold a tax invoice hostage.
  console.warn('AutoTax: using browser download fallback:',error.message);
  return false;
 }
}
function dataURL(data,mime){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(reader.error||Error('Không đọc được tệp để tải.'));
  reader.readAsDataURL(data instanceof Blob?data:new Blob([data],{type:mime}));
 });
}
async function browserDownload(parts,data,mime){
 const path=parts.join('/');
 if(window.location?.protocol==='chrome-extension:'&&typeof chrome!=='undefined'&&chrome.runtime?.sendMessage){
  const answer=await chrome.runtime.sendMessage({type:'download',url:await dataURL(data,mime),filename:path});
  if(answer?.error||(!answer?.accepted&&!answer?.complete))
   throw Error(answer?.error||'Chrome chưa nhận lệnh tải tệp.');
  return path;
 }
 // HTTPS cannot place downloads into arbitrary directories without user permission.
 // If permission expired, download the file anyway with its logical folder in its filename.
 const name=parts.length===1?parts[0]:parts.slice(1).join('__'),blob=data instanceof Blob?data:new Blob([data],{type:mime});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 return name;
}
async function save(path,data,mime='application/octet-stream'){
 await restored();
 const parts=folderFor(path);
 const relative=root?.name?.toLowerCase()===DEFAULT_DIR.toLowerCase()?parts.slice(1):parts;
 if(await tryHandle(relative,data,mime))return relative.join('/');
 return browserDownload(parts,data,mime);
}
async function saveRootFile(filename,data,mime='application/octet-stream'){
 await restored();
 const name=safe(filename);
 if(await tryHandle([name],data,mime))return name;
 if(window.location?.protocol==='chrome-extension:')
  return browserDownload(['HoaDon',name],data,mime);
 const blob=data instanceof Blob?data:new Blob([data],{type:mime});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 return name;
}
async function saveRootArchive(filename,bytes){
 await restored();
 const name=safe(filename);
 if(!/\.zip$/i.test(name))throw Error('Tệp xuất phải là ZIP.');
 if(await tryHandle([name],bytes,'application/zip'))return name;
 return browserDownload([name],bytes,'application/zip');
}
async function saveMany(files){
 let count=0;
 for(const file of files){await save(file.name,file.data,file.mime);count++}
 return count;
}
async function change(){return pickChange()}
window.AutoTaxDownloadFolder=Object.freeze({
 prepare,change,save,saveRootFile,saveRootArchive,saveMany,outputPath,folderFor,
 get label(){return shownName()}
});
})();
