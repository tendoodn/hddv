import { createRangePicker } from './datepicker.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toVN = (s) => s.split('-').reverse().join('/'); // yyyy-mm-dd -> dd/mm/yyyy
const PORTAL = 'https://hoadondientu.gdt.gov.vn/*';
const isPortal = (url) => /^https:\/\/hoadondientu\.gdt\.gov\.vn\//.test(url || '');
let tabId = null;
let connected = false;
let portalMst = '';
let configuredMsts = [];
let profilesLoaded = false;
const normalizeMst = value => String(value || '').replace(/\D/g, '');
const profileMatches = () => connected && !!portalMst && profilesLoaded && configuredMsts.includes(portalMst);
let busy = false;
let stopped = false;

async function findTab() {
  // Không cần quyền "tabs": quyền host hoadondientu đủ để lọc tab theo URL
  const tabs = await chrome.tabs.query({ url: PORTAL });
  return (tabs.find((t) => t.active) || tabs[0])?.id ?? null;
}
const ask = (msg) => chrome.tabs.sendMessage(tabId, msg);

// Nhật ký nằm dưới các lựa chọn: dòng đầu tiên thì cuộn xuống, sau đó bám cuối trang
// trừ khi người dùng đã cuộn lên xem chỗ khác
const page = document.documentElement;
let followLog = true;
addEventListener('scroll', () => { followLog = innerHeight + scrollY >= page.scrollHeight - 40; }, { passive: true });
// Theo thứ tự thời gian (1 = việc đầu tiên), dòng mới ở cuối và khung nhật ký tự cuộn tới dòng mới
function log(text, level = '') {
  const box = $('log');
  if (box.lastElementChild?.textContent === text) return box.lastElementChild;
  if (!box.firstElementChild) followLog = true;
  const li = document.createElement('li'); li.textContent = text; li.className = level; box.append(li);
  box.scrollTop = box.scrollHeight;
  if (followLog) requestAnimationFrame(() => window.scrollTo(0, page.scrollHeight));
  return li;
}
let connErr = null;

// Bảng kê HĐKD (01-2/BK-HĐKD) chỉ dành cho hộ / cá nhân kinh doanh, tờ khai 01/GTGT (khấu trừ) cho tổ chức →
// theo tên người nộp thuế (công ty, chi nhánh, DNTN, HTX…) chỉ hiện ô phù hợp để không chọn nhầm. Chưa đăng nhập
// (chưa biết tên) thì hiện tờ khai – phần lớn người dùng là doanh nghiệp; Bảng kê HĐKD chỉ hiện khi biết chắc là hộ KD
const ORG = /\b(CONG TY|CTY|TNHH|CO PHAN|CHI NHANH|DOANH NGHIEP|DNTN|HOP TAC XA|HTX|TAP DOAN|VAN PHONG DAI DIEN|NGAN HANG|TRUONG (DAI HOC|CAO DANG|TRUNG CAP|THPT|THCS|TIEU HOC|MAM NON|MAU GIAO)|BENH VIEN|UBND|LIEN HIEP)\b/;
const isOrg = (name) => ORG.test(String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').toUpperCase());
function syncHousehold(info) {
  const household = !!info.company && !isOrg(info.company);
  for (const [id, show] of [['hdkdOpt', household], ['gtgtOpt', !household]]) {
    $(id).hidden = !show;
    if (!show) $(id).querySelector('input').checked = false;
  }
  summarize();
}

function setConnected(on, info = {}) {
  connected = on;
  portalMst = on ? normalizeMst(info.mst) : '';
  syncHousehold(on ? info : {});
  const name = on ? [info.mst, info.company].filter(Boolean).join(' – ') : '';
  $('company').hidden = !name; $('company').textContent = name; $('company').title = name;
  $('noCompany').hidden = !!name;
  $('session').className = `badge ${on ? 'on' : 'off'}`;
  $('session').textContent = on ? 'Đã kết nối' : 'Chưa kết nối – hãy đăng nhập';
  syncRun();
}

async function init() {
  tabId = await findTab();
  if (!tabId) { setConnected(false); return; }
  let info;
  try { info = await ask({ type: 'info' }); } catch {
    // Tab mở trước khi cài/tải lại extension → chưa có content script
    setConnected(false);
    connErr = log('Hãy đăng nhập vào trang hoadondientu.gdt.gov.vn rồi bấm ↻', 'error');
    tabId = null; return;
  }
  connErr?.remove(); connErr = null;
  if (info.error) log(info.error, 'error');
  setConnected(!!info.ready, info);
  setBusy(!!info.busy);
  if(info.busy)ensureJobPort().postMessage({type:'attach'});
}

// Khoảng chọn nhanh
function presets() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), q = Math.floor(m / 3);
  const r = (a, b) => [iso(a), iso(b)];
  return [
    { key: 'thisMonth', label: 'Tháng này', range: r(new Date(y, m, 1), now) },
    { key: 'lastMonth', label: 'Tháng trước', range: r(new Date(y, m - 1, 1), new Date(y, m, 0)) },
    { key: 'thisQuarter', label: 'Quý này', range: r(new Date(y, q * 3, 1), now) },
    { key: 'lastQuarter', label: 'Quý trước', range: r(new Date(y, (q - 1) * 3, 1), new Date(y, q * 3, 0)) },
    { key: 'thisYear', label: 'Cả năm', range: r(new Date(y, 0, 1), now) },
  ];
}
let activePreset = null;
function preset(kind) {
  const p = presets().find((x) => x.key === kind);
  if (!p) return;
  [$('from').value, $('to').value] = p.range;
  activePreset = kind; renderPresets();
  checkRange();
  picker?.refresh(true);
}
function renderPresets() {
  $('presets').replaceChildren(...presets().map((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (p.key === activePreset ? ' active' : ''); b.textContent = p.label;
    b.title = `${toVN(p.range[0])} – ${toVN(p.range[1])}`;
    b.setAttribute('aria-pressed', String(p.key === activePreset));
    b.addEventListener('click', () => { preset(p.key); picker?.close(); });
    return b;
  }));
}

// Khoảng ngày người dùng chọn được chia thành các đợt tra cứu ở tầng API.
const fullDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && +v.slice(0, 4) >= 2000;
const limits = () => ({ min: '2018-01-01', max: iso(new Date()) });
function maxTo(_from) { return limits().max; }
function rangeError() {
  const from = $('from').value, to = $('to').value;
  if (!fullDate(from) || !fullDate(to)) return 'Hãy chọn Từ ngày và Đến ngày';
  if (to > limits().max) return 'Đến ngày không được sau hôm nay';
  if (from > to) return 'Từ ngày không được sau Đến ngày';
  return null;
}
function checkRange() {
  const err = rangeError();
  $('rangeHint').textContent = err || (checked('form').includes('mtt') ?
    'HĐ máy tính tiền: tối đa 10 ngày/đợt, CAPTCHA mỗi đợt.' : '');
  $('rangeHint').classList.toggle('error', !!err);
  $('toText').classList.toggle('invalid', !!err);
  summarize();
  return !err;
}
function clampTo() {
  const from = $('from').value, to = $('to').value;
  if (!fullDate(from)) return;
  const max = maxTo(from), today = iso(new Date());
  if (!fullDate(to) || to < from || to > max) { $('to').value = today >= from && today <= max ? today : max; picker?.refresh(); }
}
$('from').addEventListener('input', () => { activePreset = null; renderPresets(); checkRange(); });
$('from').addEventListener('change', () => { clampTo(); checkRange(); });
$('to').addEventListener('input', () => { activePreset = null; renderPresets(); checkRange(); });

const checked = (name) => [...document.querySelectorAll(`input[name=${name}]:checked`)].map((i) => i.value);
function formats() {
  const f = Object.fromEntries(['excel', 'xml', 'html', 'pdf'].map((k) => [k, checked('fmt').includes(k)]));
  // Chi tiết sản phẩm là sheet cố định của Excel → luôn tải chi tiết từng hóa đơn khi chọn Excel
  f.lines = f.excel;
  return f;
}
const SHEETS = ['risk', 'seller', 'adjust', 'reduction', 'hdkd', 'gtgt', 'tendoo'];
const sheets = () => Object.fromEntries(SHEETS.map((k) => [k, checked('sheet').includes(k)]));

/* Stock import templates are bundled, only the product catalog is uploaded. */
let stockPlatform='tendoo',tendooCatalog=null;
let tendooTemplate=TendooImport.builtinTemplate(stockPlatform);
let tendooMappingRequest=null,tendooPendingNames=[],tendooSavedLinks={};
const TENDOO_LINKS_KEY='autotax_tendoo_sku_links_v1';
const STOCK_SETTINGS_KEY='autotax_stock_import_settings_v1';
function tendooCatalogKey(){
  if(!tendooCatalog?.length)return '';
  let hash=2166136261;
  for(const product of tendooCatalog){
    const value=product.sku+'|'+product.name+'\n';
    for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619)>>>0;
  }
  return stockPlatform+'-catalog-'+tendooCatalog.length+'-'+hash.toString(16);
}
async function loadTendooLinks(){
  tendooSavedLinks={};
  if(!tendooCatalog?.length)return;
  const data=(await chrome.storage.local.get(TENDOO_LINKS_KEY))[TENDOO_LINKS_KEY]||{};
  const known=new Set(tendooCatalog.map(p=>p.sku));
  tendooSavedLinks=Object.fromEntries(Object.entries(data[tendooCatalogKey()]||{})
    .filter(([name,sku])=>name&&known.has(sku)));
}
async function keepTendooLinks(mapping){
  const known=new Set((tendooCatalog||[]).map(p=>p.sku));
  const accepted=Object.fromEntries(Object.entries(mapping||{}).filter(([k,v])=>k&&known.has(v)));
  if(!Object.keys(accepted).length)return;
  const data=(await chrome.storage.local.get(TENDOO_LINKS_KEY))[TENDOO_LINKS_KEY]||{};
  tendooSavedLinks={...tendooSavedLinks,...accepted};
  data[tendooCatalogKey()]=tendooSavedLinks;
  await chrome.storage.local.set({[TENDOO_LINKS_KEY]:data});
  updateTendooUi();
}
const tendooDialog=$('tendooSettingsDialog');
function tendooStatus(message,error=false){
  const el=$('tendooSetupStatus');el.textContent=message;
  el.style.color=error?'#b91c1c':'#166534';
}
const misaSettings=()=>({
  warehouse:$('misaWarehouse').value.trim(),
  lastDocNumber:$('misaLastDoc').value.trim()
});
function stockSettingsValid(){
  if(stockPlatform!=='misa')return true;
  const settings=misaSettings();
  if(!settings.warehouse)return false;
  try{TendooImport.nextDocumentNumber(settings.lastDocNumber,1);return true}
  catch{return false}
}
const tendooReady=()=>Array.isArray(tendooCatalog)&&tendooCatalog.length>0&&
  !!tendooTemplate?.headers?.length&&stockSettingsValid();
function updateTendooUi(){
  $('tendooSummary').hidden=!$('tendooSyncCheck').checked;
  const label=stockPlatform==='misa'?'MISA':'Tendoo';
  $('tendooSummaryText').textContent=tendooReady()?
    label+': '+tendooCatalog.length+' mã hàng · '+Object.keys(tendooSavedLinks).length+
      ' liên kết đã lưu · mẫu đã tích hợp':
    label+': cần tải '+(stockPlatform==='misa'?'Danh sách hàng hóa':'BC_San_Pham')+
      (stockPlatform==='misa'?' và nhập Mã kho / Mã chứng từ gần nhất.':'.');
}
function refreshPlatformFields(){
  const misa=stockPlatform==='misa';
  $('misaStockSettings').hidden=!misa;
  $('stockCatalogLabel').textContent=misa?
    '2. Tải Danh sách hàng hóa MISA (.xlsx)':
    '2. Tải báo cáo sản phẩm BC_San_Pham_*.xlsx';
  $('stockTemplateInfo').textContent=misa?
    'MISA eShop: mẫu nhap_khau_hang_hoa (22 cột phiếu nhập kho) tích hợp sẵn.':
    'Tendoo: mẫu nhập kho GTGT (11 cột) tích hợp sẵn.';
  $('stockPlatform').value=stockPlatform;
  tendooTemplate=TendooImport.builtinTemplate(stockPlatform);
  updateTendooUi();
}
function openTendooSettings(){
  refreshPlatformFields();
  if(!tendooDialog.open)tendooDialog.showModal();
  tendooStatus(tendooReady()?
    'Đã đọc '+tendooCatalog.length+' mã hàng, mẫu '+stockPlatform.toUpperCase()+' tích hợp.':
    'Chọn file danh mục sản phẩm, rồi hoàn tất các ô bắt buộc.');
}
async function storeStockSettings(){
  await chrome.storage.local.set({[STOCK_SETTINGS_KEY]:{platform:stockPlatform,...misaSettings()}});
}
$('tendooSyncCheck').addEventListener('change',()=>{
  updateTendooUi();
  if($('tendooSyncCheck').checked)openTendooSettings();
  summarize();
});
$('tendooConfigureBtn').addEventListener('click',openTendooSettings);
$('stockPlatform').addEventListener('change',()=>{
  stockPlatform=$('stockPlatform').value;
  tendooCatalog=null;tendooSavedLinks={};$('tendooCatalogFile').value='';
  refreshPlatformFields();
  tendooStatus('Hãy tải danh sách hàng hóa '+stockPlatform.toUpperCase()+'.');
});
$('tendooCatalogFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  tendooCatalog=null;updateTendooUi();tendooStatus('Đang đọc danh mục sản phẩm...');
  try{
    tendooCatalog=await TendooImport.catalog(file);await loadTendooLinks();
    tendooStatus('Đã đọc '+tendooCatalog.length+' mã hàng, '+
      Object.keys(tendooSavedLinks).length+' liên kết đã lưu.');
  }catch(err){tendooStatus('Danh mục không hợp lệ: '+err.message,true)}
  updateTendooUi();
});
for(const id of ['misaWarehouse','misaLastDoc'])$(id).addEventListener('input',updateTendooUi);
$('tendooSettingsApply').addEventListener('click',async()=>{
  if(!tendooReady())return tendooStatus('Thiếu danh mục, mã kho hoặc mã chứng từ gần nhất không hợp lệ.',true);
  try{
    await storeStockSettings();tendooDialog.close();
    log(stockPlatform.toUpperCase()+': đã cấu hình '+tendooCatalog.length+
      ' mã hàng và mẫu nhập kho tích hợp.','ok');
  }catch(e){tendooStatus('Lỗi lưu cấu hình: '+e.message,true)}
});
$('tendooSettingsCancel').addEventListener('click',()=>{
  tendooDialog.close();
  if(!tendooReady())$('tendooSyncCheck').checked=false;
  updateTendooUi();summarize();
});
chrome.storage.local.get([STOCK_SETTINGS_KEY,'autotax_misa_last_document_v1']).then(data=>{
  const old=data[STOCK_SETTINGS_KEY]||{};
  stockPlatform=old.platform==='misa'?'misa':'tendoo';
  $('misaWarehouse').value=old.warehouse||'';
  $('misaLastDoc').value=data.autotax_misa_last_document_v1||old.lastDocNumber||'';
  refreshPlatformFields();
}).catch(()=>{});
async function openTendooMatchTab(){
  if(!tendooMappingRequest||!tendooPendingNames.length)return;
  const sessionKey='autotax-tendoo-request-'+tendooMappingRequest;
  await chrome.storage.session.set({[sessionKey]:{names:tendooPendingNames,
    products:tendooCatalog||[],portalTabId:tabId}});
  await chrome.tabs.create({url:chrome.runtime.getURL(
    'src/sidepanel/tendoo-match.html?rid='+encodeURIComponent(tendooMappingRequest)),active:true});
  port?.postMessage({type:'tendoo-mapping-tab-open',requestId:tendooMappingRequest});
}
$('tendooOpenMatchTab').addEventListener('click',()=>{
 openTendooMatchTab().catch(error=>log('Không mở được tab liên kết: '+error.message,'warn'));
});
async function finishTendooMapping(requestId,mapping){
  if(!port||requestId!==tendooMappingRequest)throw Error('Phiên liên kết đã kết thúc.');
  if(!mapping||typeof mapping!=='object')throw Error('Dữ liệu liên kết không hợp lệ.');
  const known=new Set((tendooCatalog||[]).map(p=>p.sku));
  const accepted=Object.fromEntries(Object.entries(mapping).filter(([,sku])=>!!sku));
  for(const [key,sku] of Object.entries(accepted)){
    if(!tendooPendingNames.some(entry=>entry.key===key)||!known.has(sku))
      throw Error('Mã sản phẩm không hợp lệ: '+key);
  }
  const skipped=tendooPendingNames.length-Object.keys(accepted).length;
  await keepTendooLinks(accepted);
  port.postMessage({type:'tendoo-map-response',requestId,
    mapping:{...tendooSavedLinks,...accepted}});
  tendooMappingRequest=null;tendooPendingNames=[];
  const dialog=$('tendooMatchDialog');
  if(dialog.open)dialog.close();
  log('Đã ghép '+Object.keys(accepted).length+' sản phẩm; '+
    skipped+' sản phẩm chưa khớp sẽ ghi THIẾU MÃ.','ok');
}
function mapUnknownTendoo(message){
 const requestId=message.requestId,names=message.names||[];
 tendooMappingRequest=requestId;tendooPendingNames=names;
 const box=$('tendooMissingList');box.replaceChildren();
 for(const [index,entry] of names.entries()){
   const row=document.createElement('div');row.className='tendoo-missing-row';

   // Left: original product name read directly from the purchase invoice.
   const original=document.createElement('div');original.className='tendoo-original-product';
   const sourceLabel=document.createElement('span');sourceLabel.className='tendoo-field-label';
   sourceLabel.textContent='Sản phẩm gốc · HĐ mua vào';
   const originalName=document.createElement('strong');originalName.textContent=entry.name;
   original.append(sourceLabel,originalName);

   // Right: a searchable and explicitly selected product from BC_San_Pham.
   const target=document.createElement('div');target.className='tendoo-linked-product';
   const label=document.createElement('label');label.className='tendoo-field-label';
   const searchId='tendoo-product-search-'+index;
   label.htmlFor=searchId;label.textContent='Sản phẩm liên kết · danh mục '+stockPlatform.toUpperCase();
   const search=document.createElement('input');search.type='search';
   search.id=searchId;search.className='tendoo-product-search';
   search.placeholder='Tìm tên sản phẩm hoặc SKU...';search.autocomplete='off';
   search.setAttribute('aria-label','Tìm sản phẩm BC_San_Pham liên kết với '+entry.name);
   const hidden=document.createElement('input');hidden.type='hidden';
   hidden.dataset.key=entry.key;
   const selected=document.createElement('div');selected.className='tendoo-selected-product';
   selected.textContent='Chưa liên kết: sẽ ghi THIẾU MÃ nếu bỏ qua.';
   selected.setAttribute('aria-live','polite');
   const results=document.createElement('div');results.className='tendoo-search-results';
   results.setAttribute('role','listbox');
   results.setAttribute('aria-label','Kết quả tìm sản phẩm cho '+entry.name);
   const showResults=term=>{
     results.replaceChildren();
     const matched=TendooImport.searchCatalog(tendooCatalog||[],term,12);
     if(!matched.length){
       const empty=document.createElement('small');
       empty.textContent='Không tìm thấy sản phẩm. Bỏ qua để xuất với mã THIẾU MÃ.';
       results.append(empty);return;
     }
     for(const product of matched){
       const option=document.createElement('button');option.type='button';
       option.className='tendoo-product-option';
       const productName=document.createElement('strong');productName.textContent=product.name;
       const sku=document.createElement('span');
       sku.textContent='SKU: '+product.sku+(product.unit?' · '+product.unit:'');
       option.append(productName,sku);
       option.addEventListener('click',()=>{
         hidden.value=product.sku;
         search.value=product.name+' · '+product.sku;
         selected.textContent='Đã liên kết: '+product.name+' ('+product.sku+')';
         selected.classList.add('tendoo-selected-valid');
         results.replaceChildren();
       });
       results.append(option);
     }
   };
   search.addEventListener('focus',()=>showResults(search.value));
   search.addEventListener('input',()=>{
     hidden.value='';selected.textContent='Chưa liên kết: sẽ ghi THIẾU MÃ nếu bỏ qua.';
     selected.classList.remove('tendoo-selected-valid');
     showResults(search.value);
   });
   search.addEventListener('keydown',event=>{
     if(event.key==='ArrowDown'){
       const first=results.querySelector('button');
       if(first){event.preventDefault();first.focus()}
     }else if(event.key==='Enter'){
       // Enter inside search selects the first match, not the entire form.
       event.preventDefault();results.querySelector('button')?.click();
     }
   });
   target.append(label,search,hidden,selected,results);
   row.append(original,target);
   box.append(row);
 }
 const dialog=$('tendooMatchDialog');
 if(!dialog.open)dialog.showModal();
 box.querySelector('.tendoo-product-search')?.focus();
  openTendooMatchTab().catch(error=>
   log('Không tự mở được tab riêng, có thể liên kết trong popup: '+error.message,'warn'));
}
$('tendooMatchForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!tendooMappingRequest)return;
 const inputs=[...$('tendooMissingList').querySelectorAll('input[type="hidden"][data-key]')];
 const known=new Set((tendooCatalog||[]).map(p=>p.sku)),mapping={};
 for(const input of inputs){
   const sku=input.value.trim();
   if(!sku)continue;
   if(!known.has(sku))return log('Mã SKU không hợp lệ; vui lòng chọn lại.','warn');
   mapping[input.dataset.key]=sku;
 }
 try{await finishTendooMapping(tendooMappingRequest,mapping)}catch(error){log('Không lưu được SKU: '+error.message,'warn')}
 // Popup closed by finishTendooMapping on success.
});
// Hiding the popup must never leave a warehouse ZIP waiting forever.
$('tendooMatchClose').addEventListener('click',async()=>{
 if(!tendooMappingRequest){$('tendooMatchDialog').close();return}
 const mapping={};
 for(const input of $('tendooMissingList').querySelectorAll('input[data-key]')){
   if(input.value)mapping[input.dataset.key]=input.value;
 }
 try{await finishTendooMapping(tendooMappingRequest,mapping)}
 catch(error){log('Không đóng được popup ánh xạ: '+error.message,'warn')}
});
$('tendooMatchCancel').addEventListener('click',()=>{
 if(tendooMappingRequest){
  port?.postMessage({type:'tendoo-map-response',requestId:tendooMappingRequest,cancel:true});
  chrome.storage.session.remove('autotax-tendoo-request-'+tendooMappingRequest).catch(()=>{});
 }
 tendooMappingRequest=null;tendooPendingNames=[];$('tendooMatchDialog').close();
});

// Bỏ Excel thì nhóm Sheet thêm mờ đi, không tính
function syncFormats(e) {
  const box = (v) => document.querySelector(`input[name=fmt][value=${v}]`);
  $('sheetOpts').disabled = !box('excel').checked;
  // Tô ô đang chọn bằng class (không dùng :has() – side panel có bản Chrome không vẽ lại sau cú bấm đầu)
  document.querySelectorAll('input[name=fmt]').forEach((i) => i.closest('.tile').classList.toggle('on', i.checked));
  summarize();
}
document.querySelectorAll('input[name=fmt]').forEach((i) => i.addEventListener('change', syncFormats));
// Tóm tắt lựa chọn ở footer
const LABELS = { hddt: 'HĐ điện tử', mtt: 'HĐ máy tính tiền', purchase: 'Mua vào', sold: 'Bán ra', excel: 'Excel', xml: 'XML', html: 'HTML', pdf: 'PDF' };
const names = (vals) => vals.map((v) => LABELS[v]).join(' + ') || '—';
function summarize() {
  const from = $('from').value, to = $('to').value;
  $('sumRange').textContent = fullDate(from) && fullDate(to) ? `${toVN(from)} – ${toVN(to)}` : '—';
  const kinds = checked('kind');
  $('sumKinds').textContent = names(checked('form')) + ' · ' + names(kinds) + (kinds.length && $('adjOnly').checked ? ' · chỉ HĐ thay thế/điều chỉnh/hủy' : '');
  const extra = checked('fmt').includes('excel') ? checked('sheet').length : 0;
  $('sumFmt').textContent = names(checked('fmt')).replaceAll(' + ', ', ') + (extra ? ` · ${extra} sheet thêm` : '');
}
document.querySelectorAll('input[name=kind], input[name=sheet], #adjOnly').forEach((i) => i.addEventListener('change', summarize));
document.querySelectorAll('input[name=form]').forEach((i) => i.addEventListener('change', checkRange));
$('clearFmt').addEventListener('click', () => {
  document.querySelectorAll('input[name=fmt]').forEach((i) => { i.checked = false; });
  syncFormats();
});

syncFormats();

function guard(btn, fn) {
  btn.addEventListener('click', async (e) => {
    if (btn.dataset.running) return;
    btn.dataset.running = '1';
    try { await fn(e); } finally { delete btn.dataset.running; }
  });
}
$('hideSidepanel').addEventListener('click',async()=>{
  // An unfinished mapping becomes a valid import with THIẾU MÃ when hidden.
  if(tendooMappingRequest&&port){
    const mapping={};
    for(const input of $('tendooMissingList').querySelectorAll('input[data-key]')){
      if(input.value)mapping[input.dataset.key]=input.value;
    }
    try{await finishTendooMapping(tendooMappingRequest,mapping)}
    catch(e){log('Không chuyển được ánh xạ hiện có: '+e.message,'warn')}
  }
  try{
    if(typeof chrome.sidePanel.close!=='function')
      throw Error('Chrome cần phiên bản 141 trở lên để dùng nút Ẩn.');
    const window=await chrome.windows.getCurrent();
    await chrome.sidePanel.close({windowId:window.id});
  }catch(e){log('Không ẩn được sidepanel: '+e.message,'warn')}
});
guard($('reconnect'), async () => {
  const b = $('reconnect');
  b.classList.add('spin');
  $('session').className = 'badge'; $('session').textContent = 'Đang kết nối…';
  try { await init(); } catch (e) { setConnected(false); log(e.message, 'error'); }
  b.classList.remove('spin');
});

// Tự kết nối lại khi người dùng đăng nhập / chuyển trang sau khi đã mở panel
chrome.tabs.onRemoved.addListener((id) => { if (id === tabId) { tabId = null; setConnected(false); } });
let recheckTimer = null;
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (id === tabId && change.url && !isPortal(change.url)) { tabId = null; setConnected(false); }
  if (change.status !== 'complete' || !isPortal(tab.url)) return;
  clearTimeout(recheckTimer);
  recheckTimer = setTimeout(() => init().catch((e) => log(e.message, 'error')), 500);
});

// Bản nội bộ: không gửi thống kê hoặc dữ liệu sử dụng ra ngoài.
$('run').addEventListener('click', run);
$('stop').addEventListener('click', () => { stopped = true; if (tabId) ask({ type: 'stop' }); });

let port=null,portTabId=null;
function ensureJobPort(){
  if(port&&portTabId===tabId)return port;
  if(port)try{port.disconnect()}catch{}
  port=chrome.tabs.connect(tabId,{name:'job'});portTabId=tabId;
  port.onDisconnect.addListener(()=>{
    port=null;portTabId=null;
    if(busy){
      log('Kết nối trang Thuế bị ngắt. Nếu trang vừa tải lại thì tác vụ đã dừng.','warn');
      setBusy(false);
    }
  });
  port.onMessage.addListener(onJobMessage);
  return port;
}
function job(msg){
  const current=ensureJobPort();
  setBusy(true);
  current.postMessage(msg);
}
function onJobMessage(m) {
  if (m.type === 'run-started')setBusy(true);
  if (m.type === 'tendoo-map-request')return mapUnknownTendoo(m);
  if (m.type === 'status') $('status').textContent = m.text;
  if (m.type === 'summary') { $('bar').max = Math.max(m.total, 1); $('bar').value = 0; }
  if (m.type === 'progress') { $('bar').max = m.total || 1; $('bar').value = m.done; $('status').textContent = `Đang tải chi tiết ${m.done}/${m.total} hóa đơn`; }
  if (m.type === 'log') log(m.text, m.level);
  if (m.type === 'error') { log(m.text, 'error'); $('status').textContent = 'Lỗi – xem chi tiết bên dưới'; }
  if (m.type === 'done') {
    $('status').textContent = m.stopped ? 'Đã dừng – đã lưu phần dữ liệu tải được' : `Hoàn tất. File nằm trong Downloads/${m.dir || 'HoaDon'}/`;
    if (!m.stopped && !stopped && m.total) showDone(m);
  }
  if (m.type === 'idle') setBusy(false);
}

function showDone(m) {
  $('doneText').textContent = `Đã xử lý ${m.total} hóa đơn, lưu ${m.saved} file vào thư mục Downloads/${m.dir}/`
    + (m.errors ? ` (${m.errors} hóa đơn lỗi – xem nhật ký).` : '.');
  $('doneModal').showModal();
}

// Chưa đăng nhập hoặc đang chạy → khóa nút Tìm kiếm
function syncRun() {
  const matched=profileMatches();
  $('run').disabled = busy || !connected || !licenseAllowed || !matched;
  const warning=$('mstGuardMessage');
  const needsProfile=connected && licenseAllowed && !matched;
  warning.hidden=!needsProfile;
  if(needsProfile){
    $('mstGuardReason').textContent=!profilesLoaded?
      'Chưa tải được danh sách hồ sơ MST. Hãy làm mới gói AutoTax rồi thử lại.':
      'MST đang đăng nhập cổng Thuế ('+(portalMst||'không xác định')+
      ') chưa có trong danh sách hồ sơ MST AutoTax. Hãy thêm đúng MST ở trên rồi tìm kiếm lại.';
  }
  $('run').title=!licenseAllowed?'Đăng nhập AutoTax và kích hoạt gói sử dụng':
   !connected?'Hãy đăng nhập hoadondientu trước':
   !matched?'Chưa cấu hình MST đang đăng nhập trên cổng Thuế':'';
}

function setBusy(on) {
  busy = on;
  document.body.classList.toggle('busy', on);
  $('stop').hidden = !on;
  syncRun();
  $('run').textContent = on ? 'Đang xử lý…' : 'Tìm kiếm';
}

async function run() {
  if (busy) return;
  if (!License.canUse()) { log('Tài khoản AutoTax chưa có quyền sử dụng còn hiệu lực. Hãy đăng nhập/kích hoạt tại mục Quản lý bản quyền.', 'warn'); return; }
  if (!tabId || !connected) return init();
  if (!profileMatches()) {
    log('Chưa cấu hình MST '+(portalMst||'đang đăng nhập')+
      ' trong danh sách hồ sơ AutoTax. Thêm MST rồi thử lại.', 'warn');
    syncRun();return;
  }
  if (!checkRange()) { $('toText').focus(); return; }
  // Hình thức: hóa đơn điện tử (query, chia tháng) và/hoặc máy tính tiền (sco-query, đoạn 10 ngày + captcha)
  const kinds = checked('kind'), forms = checked('form'), f = formats();
  if (!forms.length) return log('Hãy chọn hình thức hóa đơn (điện tử / máy tính tiền)', 'warn');
  if (!kinds.length) return log('Hãy chọn loại hóa đơn (mua vào / bán ra)', 'warn');
  if (!Object.values(f).some(Boolean)) return log('Hãy chọn ít nhất 1 loại file cần tải', 'warn');
  const options=sheets();
  if(options.tendoo&&!kinds.includes('purchase'))return log('Xuất nhập kho cần chọn Mua vào.','warn');
  if(options.tendoo&&!tendooReady()){
    openTendooSettings();return log('Cần tải danh mục sản phẩm và hoàn tất cấu hình nhập kho.','warn');
  }
  const msg = { type: 'run', tuNgay: toVN($('from').value), denNgay: toVN($('to').value),
    kinds, forms, formats: f, sheets: options, adjOnly: $('adjOnly').checked,
    ...(options.tendoo?{tendoo:{products:tendooCatalog,template:tendooTemplate,
      links:tendooSavedLinks,settings:misaSettings()}}:{}) };
  $('log').innerHTML = ''; $('bar').value = 0; $('status').textContent = '';
  stopped = false;
  job(msg);
}

document.querySelectorAll('input[name=form]').forEach((el) => el.addEventListener('change', checkRange));

const picker = createRangePicker({
  from: $('from'), to: $('to'), fromText: $('fromText'), toText: $('toText'), anchor: $('dateRange'), maxTo, limits,
});
preset('lastMonth');

// Gate the existing invoice workflow using the server-verified license.
let licenseAllowed=false;
function applyLicense(st){licenseAllowed=!!st?.allowed;syncRun()}
document.addEventListener('autotax-license-change',e=>applyLicense(e.detail?.license));
document.addEventListener('autotax-license-gate',e=>{licenseAllowed=!!e.detail?.allowed;syncRun()});
document.addEventListener('autotax-mst-profiles',e=>{
 configuredMsts=(e.detail?.msts||[]).map(normalizeMst);
 profilesLoaded=!!e.detail?.userId;
 syncRun();
});

const HISTORY_KEY = 'autotax_invoice_history_v1';
let historyRecords = [];
const historyDate = value => { if(!value) return ''; const d=new Date(value); return Number.isNaN(d.getTime()) ? String(value).slice(0,10) : d.toLocaleDateString('vi-VN'); };
function renderHistory() {
  const q=($('historySearch')?.value||'').trim().toLocaleLowerCase('vi');
  const f=$('historyFilter')?.value||'all';
  const selectedMst=$('historyMst')?.value||'';
  const rows=historyRecords.filter(r=>{
    const text=[r.invoiceNo,r.series,r.template,r.mst,r.sellerTax,r.sellerName,r.buyerTax,r.buyerName].join(' ').toLocaleLowerCase('vi');
    return (!selectedMst||normalizeMst(r.mst)===selectedMst) && (!q||text.includes(q)) && (f==='all'||(f==='searched'&&r.lastSearchedAt)||(f==='downloaded'&&r.downloadedAt)||(f==='notDownloaded'&&!r.downloadedAt));
  }).slice(0,250);
  $('historyCount').textContent=historyRecords.length.toLocaleString('vi-VN');
  $('historySummary').textContent=historyRecords.length ? historyRecords.filter(r=>r.downloadedAt).length+' đã tải · '+historyRecords.filter(r=>r.lastSearchedAt).length+' đã tra cứu' : 'Chưa có dữ liệu lịch sử';
  const body=$('historyRows'); body.replaceChildren();
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='Không có hóa đơn phù hợp.';tr.append(td);body.append(tr);return}
  for(const r of rows){
    const tr=document.createElement('tr');
    const partner=r.kind==='purchase' ? (r.sellerName||r.sellerTax) : (r.buyerName||r.buyerTax);
    const values=[historyDate(r.date),[r.series,r.invoiceNo].filter(Boolean).join(' / ')||'—',partner||'—',r.downloadedAt?'Đã tải về':'Đã tra cứu'];
    for(let i=0;i<values.length;i++){const td=document.createElement('td');td.textContent=values[i];if(i===3)td.className=r.downloadedAt?'history-done':'history-seen';tr.append(td)}
    body.append(tr);
  }
}
async function loadHistory(){
  const data=await chrome.storage.local.get(HISTORY_KEY);
  historyRecords=Object.values(data[HISTORY_KEY]?.records||{}).sort((a,b)=>(b.lastSearchedAt||b.firstSeenAt||'').localeCompare(a.lastSearchedAt||a.firstSeenAt||''));
  const mstFilter=$('historyMst');
  const previous=mstFilter.value;
  const ids=[...new Set(historyRecords.map(r=>normalizeMst(r.mst)).filter(Boolean))].sort();
  mstFilter.replaceChildren();
  const all=document.createElement('option');all.value='';all.textContent='Tất cả MST';mstFilter.append(all);
  for(const mst of ids){const option=document.createElement('option');option.value=mst;option.textContent=mst;mstFilter.append(option)}
  mstFilter.value=ids.includes(previous)?previous:'';
  renderHistory();
}
$('historySearch')?.addEventListener('input',renderHistory);
$('historyFilter')?.addEventListener('change',renderHistory);
$('historyMst')?.addEventListener('change',renderHistory);
$('historyRefresh')?.addEventListener('click',()=>loadHistory().catch(e=>log('Không đọc được lịch sử: '+e.message,'error')));
$('historyExport')?.addEventListener('click',()=>{
  const cols=['mst','kind','form','date','series','invoiceNo','template','sellerTax','sellerName','buyerTax','buyerName','lastSearchedAt','searchedCount','downloadedAt','downloadedFormats'];
  const csv=[cols.join(','),...historyRecords.map(r=>cols.map(k=>'"'+String(Array.isArray(r[k])?r[k].join('|'):(r[k]??'')).replace(/"/g,'""')+'"').join(','))];
  const blob=new Blob(['\uFEFF'+csv.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='autotax-lich-su-hoa-don.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
loadHistory().catch(e=>log('Không đọc được lịch sử: '+e.message,'error'));
init().catch((e) => log(e.message, 'error'));
