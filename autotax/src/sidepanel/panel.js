import { createRangePicker } from './datepicker.js';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toVN = (s) => s.split('-').reverse().join('/'); // yyyy-mm-dd -> dd/mm/yyyy
const PORTAL = 'https://hoadondientu.gdt.gov.vn/*';
const isPortal = (url) => /^https:\/\/hoadondientu\.gdt\.gov\.vn\//.test(url || '');
let tabId = null;
let connected = false;
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

// V3: không giới hạn tổng khoảng ngày. Hóa đơn điện tử tự chia theo tháng;
// MTT tự chia thành các đợt tối đa 10 ngày ở tầng API.
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
  $('rangeHint').textContent = err || `Không giới hạn tổng khoảng ngày. Hóa đơn điện tử tự chia theo tháng${checked('form').includes('mtt') ? ' · Hóa đơn máy tính tiền tự chia tối đa 10 ngày/đợt, mỗi đợt xử lý CAPTCHA riêng' : ''}`;
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
const SHEETS = ['risk', 'seller', 'adjust', 'reduction', 'hdkd', 'gtgt'];
const sheets = () => Object.fromEntries(SHEETS.map((k) => [k, checked('sheet').includes(k)]));
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

let port = null;
function job(msg) {
  if (!port) {
    port = chrome.tabs.connect(tabId, { name: 'job' });
    port.onDisconnect.addListener(() => {
      port = null;
      if (busy) { log('Bị gián đoạn vì trang hoadondientu vừa tải lại/chuyển trang – hãy bấm Tìm kiếm lại', 'warn'); setBusy(false); }
    });
    port.onMessage.addListener(onJobMessage);
  }
  setBusy(true);
  port.postMessage(msg);
}

function onJobMessage(m) {
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
  $('run').disabled = busy || !connected || !licenseAllowed;
  $('run').title = !licenseAllowed ? 'Đăng nhập AutoTax và kích hoạt dùng thử hoặc gói sử dụng' : (connected ? '' : 'Hãy đăng nhập hoadondientu trước');
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
  if (!checkRange()) { $('toText').focus(); return; }
  // Hình thức: hóa đơn điện tử (query, chia tháng) và/hoặc máy tính tiền (sco-query, đoạn 10 ngày + captcha)
  const kinds = checked('kind'), forms = checked('form'), f = formats();
  if (!forms.length) return log('Hãy chọn hình thức hóa đơn (điện tử / máy tính tiền)', 'warn');
  if (!kinds.length) return log('Hãy chọn loại hóa đơn (mua vào / bán ra)', 'warn');
  if (!Object.values(f).some(Boolean)) return log('Hãy chọn ít nhất 1 loại file cần tải', 'warn');
  const msg = { type: 'run', tuNgay: toVN($('from').value), denNgay: toVN($('to').value), kinds, forms, formats: f, sheets: sheets(), adjOnly: $('adjOnly').checked };
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
function applyLicense(st){licenseAllowed=['trial','paid'].includes(st?.tier);syncRun()}
document.addEventListener('autotax-license-change',e=>applyLicense(e.detail?.license));
document.addEventListener('autotax-license-gate',e=>{licenseAllowed=!!e.detail?.allowed;syncRun()});
init().catch((e) => log(e.message, 'error'));
