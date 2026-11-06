/* AutoTax 1.1.23 — local, account-scoped invoice detail cache.
 * Stores invoice payloads only (never passwords, GDT/AutoTax tokens, CAPTCHA).
 * Live server entitlement and quota checks MUST happen before every search.
 */
(()=>{
'use strict';
const DB='autotax_invoice_details_v120', STORE='invoices', VERSION=1;
const MAX_ITEMS=600, MEMORY_ITEMS=90, MAX_ITEM_BYTES=3*1024*1024;
// Independent of the Web result/history retention window (e.g. 7 days).
const DETAIL_RETENTION_DAYS=10, DETAIL_TTL_MS=DETAIL_RETENTION_DAYS*24*60*60*1000;
let opening, writes=0, hits=0, misses=0;
const memory=new Map();
const validScope=s=>!!s&&typeof s.userId==='string'&&s.userId.length>0&&
 typeof s.mst==='string'&&/^\d{10,13}$/.test(s.mst);
const identity=r=>[r?.kind,r?.form,r?.khmshdon,r?.khhdon,r?.shdon,r?.nbmst,r?.nmmst].map(v=>String(v??'')).join('|');
const fingerprint=r=>[r?.tdlap,r?.tthai,r?.ttxly,r?.tgtttbso,r?.tgtthue,r?.id].map(v=>String(v??'')).join('|');
const keyOf=(scope,row)=>'xmlmeta3|'+scope.userId+'|'+scope.mst+'|'+identity(row)+'|'+fingerprint(row);
const ttl=()=>DETAIL_TTL_MS;
function remember(key,record){
 memory.delete(key);memory.set(key,record);
 while(memory.size>MEMORY_ITEMS)memory.delete(memory.keys().next().value);
}
function open(){
 if(!('indexedDB' in globalThis))return Promise.resolve(null);
 if(opening)return opening;
 opening=new Promise(resolve=>{
  let req;
  try{req=indexedDB.open(DB,VERSION)}catch{return resolve(null)}
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains(STORE)){
    const store=db.createObjectStore(STORE,{keyPath:'key'});
    store.createIndex('savedAt','savedAt');
   }
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>resolve(null);
  req.onblocked=()=>resolve(null);
 });
 return opening;
}
async function query(key){
 const db=await open();if(!db)return null;
 return new Promise(resolve=>{
  try{
   const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(key);
   req.onsuccess=()=>resolve(req.result||null);
   req.onerror=()=>resolve(null);
  }catch{resolve(null)}
 });
}
async function remove(key){
 memory.delete(key);const db=await open();if(!db)return;
 try{db.transaction(STORE,'readwrite').objectStore(STORE).delete(key)}catch{}
}
function measure(detail){
 let size=0;
 try{
  for(const data of Object.values(detail?.files||{}))
   size+=data?.byteLength??(typeof data==='string'?data.length*2:0);
  size+=detail?.xml?.byteLength||0;
  size+=JSON.stringify({head:detail?.head,lines:detail?.lines,fees:detail?.fees,json:detail?.json})?.length*2||0;
 }catch{return Infinity}
 return size;
}
async function trim(){
 const db=await open();if(!db)return;
 try{
  await new Promise(resolve=>{
   const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE),records=[];
   st.openCursor().onsuccess=e=>{
    const cursor=e.target.result;
    if(cursor){records.push({key:cursor.primaryKey,savedAt:cursor.value.savedAt,expiresAt:cursor.value.expiresAt});cursor.continue()}
    else{
     const now=Date.now(),expired=records.filter(r=>r.expiresAt<=now).map(r=>r.key);
     const rest=records.filter(r=>r.expiresAt>now).sort((a,b)=>a.savedAt-b.savedAt);
     const extra=Math.max(0,rest.length-MAX_ITEMS);
     for(const id of [...expired,...rest.slice(0,extra).map(r=>r.key)])st.delete(id);
    }
   };
   tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
  });
 }catch{}
}
async function get(scope,row){
 if(!validScope(scope)||!row)return null;
 const key=keyOf(scope,row),now=Date.now();
 let record=memory.get(key);
 if(!record)record=await query(key);
 if(record?.expiresAt>now&&record.detail){
  hits++;remember(key,record);return record.detail;
 }
 misses++;
 if(record)void remove(key);
 return null;
}
async function put(scope,row,detail){
 if(!validScope(scope)||!row||!detail||detail.error||!['xml','detail'].includes(detail.source))return false;
 const size=measure(detail);
 if(!Number.isFinite(size)||size>MAX_ITEM_BYTES)return false;
 const key=keyOf(scope,row),record={key,savedAt:Date.now(),expiresAt:Date.now()+ttl(row),detail};
 remember(key,record);
 const db=await open();if(!db)return true; // memory fallback, never blocks export
 try{
  await new Promise(resolve=>{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(record);
   tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
  });
  if(++writes%32===0)void trim();
  return true;
 }catch{return false}
}
// Explicit deletion of local invoice history also removes its cached payloads.
 // Merely expiring a 7-day Web history listing does not remove a 10-day cache entry.
async function clearForAccount(userId,mst=''){
 if(!userId||typeof userId!=='string')return 0;
 const prefix='xmlmeta3|'+userId+'|'+(mst?mst+'|':'');
 for(const key of [...memory.keys()])if(key.startsWith(prefix))memory.delete(key);
 const db=await open();if(!db)return 0;
 return new Promise(resolve=>{
  let count=0;
  try{
   const transaction=db.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE);
   store.openKeyCursor().onsuccess=event=>{
    const cursor=event.target.result;
    if(!cursor)return;
    if(String(cursor.primaryKey).startsWith(prefix)){store.delete(cursor.primaryKey);count++}
    cursor.continue();
   };
   transaction.oncomplete=()=>resolve(count);
   transaction.onerror=()=>resolve(count);
   transaction.onabort=()=>resolve(count);
  }catch{resolve(count)}
 });
}
function stats(){return {hits,misses,memoryItems:memory.size,persistent:!!('indexedDB' in globalThis),retentionDays:DETAIL_RETENTION_DAYS}}
window.AutoTaxInvoiceCache=Object.freeze({get,put,stats,identity,fingerprint,clearForAccount});
})();
