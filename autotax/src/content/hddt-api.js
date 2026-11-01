// Mọi URL + tham số API của hoadondientu.gdt.gov.vn nằm ở đây.
// Khi Tổng cục Thuế đổi API, chỉ cần sửa file này.
(() => {
  // Không thao tác giao diện của cổng: mọi việc đi qua fetch tới API của cổng, kèm đúng các header
  // mà axios của cổng tự gắn (Authorization, request-id, Action, End-Point). Thiếu header → 403
  // "Hệ thống phát hiện hành vi không hợp lệ".
  const API = 'https://hoadondientu.gdt.gov.vn/api';
  const URL_PROFILE = `${API}/security-taxpayer/profile`;
  const URL_CAPTCHA = `${API}/captcha`; // → { key, content: "<svg …>" } (svg-captcha)
  const URL_SEARCH = (ep, path, search, state) =>
    `${API}/${ep}/invoices/${path}?sort=tdlap:desc&size=${PAGE_SIZE}${state ? `&state=${encodeURIComponent(state)}` : ''}&search=${search}`;
  const invParams = (inv) => new URLSearchParams({ nbmst: inv.nbmst, khhdon: inv.khhdon, shdon: inv.shdon, khmshdon: inv.khmshdon });
  const URL_XML = (ep, inv) => `${API}/${ep}/invoices/export-xml?${invParams(inv)}`;
  const URL_DETAIL = (ep, inv) => `${API}/${ep}/invoices/detail?${invParams(inv)}`;
  const END_POINT = '/tra-cuu/tra-cuu-hoa-don';
  // Danh sách công khai "Người mua / người bán sử dụng hóa đơn không hợp pháp" (trang /nguoi-su-dung-hoa-don-bat-hop-phap
  // của cổng, không cần đăng nhập). Lấy từ JS của cổng 26/10/2026: search kiểu RSQL như tra cứu hóa đơn, mst=in=(a,b,…)
  // tra nhiều MST trong 1 request; bản ghi { id, mst, nbten, loai (1 người bán, 2 người mua), cqt, ldo, nckhai, ncnhat }.
  // DS hóa đơn của 1 bản ghi: findByNNT/{id}/{mst} ở invoice (HĐĐT) và mtt-invoice (máy tính tiền), trả mảng hóa đơn.
  const URL_BHP = (search, state, size) => `${API}/invoice/nbhdbhp/guest?sort=ncnhat:desc&size=${size}${state ? `&state=${encodeURIComponent(state)}` : ''}&search=${search}`;
  const URL_BHP_INV = (ep, rec) => `${API}/${ep}/hdbhp/guest/findByNNT/${rec.id}/${rec.mst}?byNmua=${rec.loai !== 1}`;
  const BHP_END_POINT = '/nguoi-su-dung-hoa-don-bat-hop-phap';

  // Cổng tra cứu của nhà cung cấp HĐĐT (theo MSTTCGP – MST tổ chức cung cấp giải pháp) để người dùng TỰ mở và tải
  // PDF gốc khi cần. Extension không gọi các cổng này (đa số có captcha) – chỉ ghi link vào Excel / PDF.
  // Khảo sát 24/10/2026 (docs/FINDINGS.md). Link trong XML (TTKhac, vd PortalLink) được ưu tiên hơn link ở đây.
  const PROVIDERS = {
    '0101243150': { name: 'MISA meInvoice', url: 'https://www.meinvoice.vn/tra-cuu' },
    '0105987432': { name: 'EasyInvoice', url: 'https://tracuu.easyinvoice.vn' },
    '0101300842': { name: 'Thái Sơn E-invoice', url: 'https://einvoice.vn/tra-cuu' },
    '0100109106': { name: 'Viettel SInvoice', url: 'https://vinvoice.viettel.vn/utilities/invoice-search' },
    '0100727825': { name: 'FAST e-Invoice', url: 'https://einvoice.fast.com.vn' },
    '0106713804': { name: 'Hilo', url: 'https://tracuuhddt78.hilo.com.vn' },
    '0100684378': { name: 'VNPT Invoice' },
    '0101360697': { name: 'BKAV eHoaDon' },
    '0104128565': { name: 'FPT eInvoice' },
  };

  // Loại hóa đơn (mua vào / bán ra) × hình thức (tab trên trang tra cứu của cổng).
  const KINDS = {
    purchase: { path: 'purchase', label: 'Mua vào', folder: 'MuaVao', act: 'mua vào' },
    sold: { path: 'sold', label: 'Bán ra', folder: 'BanRa', act: 'bán ra' },
  };
  // query không lọc ttxly = có mã (5) + không mã (6) (kiểm chứng 14/10/2026: 154 = 95 + 59).
  // Máy tính tiền mua vào: cổng luôn gửi ttxly==8; bán ra: mặc định "Tất cả" (không lọc).
  const FORMS = {
    hddt: { ep: 'query', label: 'Hóa đơn điện tử', name: 'hóa đơn điện tử', act: 'hóa đơn', filter: { purchase: '', sold: '' } },
    // sco-query chậm hơn hẳn: 22/10/2026 mỗi lần tra ~46–49 s (kể cả 1 ngày, 0 kết quả), query ~0,3 s.
    // Từ bản cổng 26/10/2026 mỗi lần tra sco-query (cả lật trang) cần 1 captcha mới (ckey + cvalue ở query string và header).
    // V3 cố định đoạn tra cứu MTT tối đa 10 ngày; không phụ thuộc cấu hình cũ trong storage.
    mtt: { ep: 'sco-query', label: 'Máy tính tiền', name: 'hóa đơn máy tính tiền', act: 'hóa đơn máy tính tiền', filter: { purchase: ';ttxly==8', sold: '' }, timeout: 90000, retries: 0, captcha: true, days: 10 },
  };
  const action = (verb, row) => `${verb} (${FORMS[row.form].act} ${KINDS[row.kind].act})`;

  // Nhãn lấy từ JS của cổng
  const TTHAI = { 1: 'Hóa đơn mới', 2: 'Hóa đơn thay thế', 3: 'Hóa đơn điều chỉnh', 4: 'Hóa đơn đã bị thay thế', 5: 'Hóa đơn đã bị điều chỉnh', 6: 'Hóa đơn đã bị hủy' };
  const TTXLY = { 0: 'Cục Thuế đã nhận', 5: 'Đã cấp mã hóa đơn', 6: 'Cục Thuế đã nhận không mã', 8: 'Có mã khởi tạo từ máy tính tiền' };
  const TCHAT = { 1: 'Hàng hóa, dịch vụ', 2: 'Khuyến mại', 3: 'Chiết khấu thương mại', 4: 'Ghi chú, diễn giải' };

  // Máy chủ chặn khoảng > 1 tháng ("Khoảng thời gian tìm kiếm không được lớn hơn 1 tháng."), cả tra cứu
  // lẫn xuất Excel → tự chia khoảng người dùng chọn thành từng tháng dương lịch.
  const PAGE_SIZE = 50;    // size=100 → HTTP 500 (kiểm chứng 14/10/2026)
  const DELAY = 2000;      // nghỉ giữa 2 request (cả khi thử lại), không gửi song song – 1 s hay bị 429
  const TIMEOUT = 20000;   // mặc định; FORMS[…].timeout ghi đè cho nguồn chậm
  const RETRIES = 3;       // lỗi 500 tạm thời / 429 / mạng / hết giờ
  const TOTAL_RETRIES = 3; // cổng đôi khi trả total/trang lệch → đọc lại cả tháng
  // Lỗi 500 mang thông báo này là lỗi cố định (vd. hóa đơn không mã không có XML gốc) → không thử lại
  const PERMANENT = /không tồn tại|không có quyền|không tìm thấy|chưa có thông tin/i;
  // Captcha giải sai → lấy captcha mới, tối đa ngần ấy lần cho 1 request. Cổng báo sai captcha thế nào chưa kiểm chứng
  // (26/10/2026): coi là sai captcha khi thông báo nhắc tới captcha / mã xác nhận, hoặc mã 400.
  const CAPTCHA_TRIES = 3;
  const CAPTCHA_ERR = /captcha|mã xác nhận|mã kiểm tra|cvalue|ckey/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Chờ được ngắt bằng Dừng (kiểm tra mỗi giây); onSec(giây còn lại) để giao diện đếm ngược
  async function pause(ms, shouldStop = () => false, onSec) {
    for (let left = Math.ceil(ms / 1000); left > 0; left--) {
      if (shouldStop()) throw new Error(STOPPED);
      onSec?.(left);
      await sleep(1000);
    }
  }

  // 429 Too Many Requests: cổng giới hạn tần suất theo phiên (cả /api/captcha). Mọi request đi qua get() cách nhau
  // ≥ gap; mỗi lần 429 thì gap tăng gấp đôi (tối đa MAX_GAP), sau mỗi RECOVER request thành công liền thì giảm một nửa
  // (không dưới DELAY). Chờ Retry-After (không có: RATE_WAITS) rồi thử lại – tối đa RATE_RETRIES lần, kể cả nguồn không
  // thử lại lỗi khác (máy tính tiền). 26/10/2026: lúc tải chi tiết, 429 lác đác (~1/10 request) và gọi lại ngay là được
  // → lần đầu chỉ chờ ngắn; không giữ gap 8 s cho cả job (400 hóa đơn sẽ mất gần 1 giờ).
  const RATE_RETRIES = 3;
  const RATE_WAITS = [5000, 30000, 60000];
  const MAX_GAP = 8000;
  const RECOVER = 20;
  let gap = DELAY, lastAt = 0, okRun = 0;
  const slowDown = () => { gap = Math.min(gap * 2, MAX_GAP); okRun = 0; };
  const recovered = () => { if (++okRun >= RECOVER && gap > DELAY) { gap = Math.max(DELAY, gap / 2); okRun = 0; } };
  const rateWait = (e, n) => Math.min(e.retryAfter ? e.retryAfter * 1000 : RATE_WAITS[Math.min(n, RATE_WAITS.length) - 1], 120000);
  const pad = (n) => String(n).padStart(2, '0');
  const vn = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parseVN = (s) => { const [d, m, y] = s.split('/').map(Number); return new Date(y, m - 1, d); };

  // Token đăng nhập: cổng tự lưu trong cookie "jwt" và gửi dạng Bearer. Đọc lại mỗi lần gọi, không lưu.
  function token() {
    const m = document.cookie.match(/(?:^|;\s*)jwt=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function tokenInfo() {
    const t = token();
    if (!t) return null;
    try {
      const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { mst: p.sub, exp: p.exp ? p.exp * 1000 : null };
    } catch { return null; }
  }

  // Như axios của cổng: GET /api/captcha không kèm Authorization / Accept-Language; sco-query thêm ckey, cvalue
  const headers = (act = '', { auth = true, extra = {}, endPoint = END_POINT } = {}) => ({
    ...(auth ? { Authorization: `Bearer ${token()}`, 'Accept-Language': 'vi' } : {}),
    'request-id': crypto.randomUUID(),
    Action: encodeURIComponent(act),
    'End-Point': endPoint,
    ...extra,
  });

  class HttpError extends Error {
    constructor(message, status, raw = '') { super(message); this.status = status; this.raw = raw; }
  }
  // 503 = cổng đang bảo trì: trang của cổng báo ngay "Hệ thống đang bảo trì. Xin vui lòng thử lại sau." (errorStrict
  // trong _app.js) → không thử lại, báo ngay như cổng.
  const retryable = (e) => !(e instanceof HttpError) || ((e.status === 500 || e.status === 429 || e.status >= 502) && e.status !== 503 && !PERMANENT.test(e.message));
  // Thông báo cho người dùng: chỉ giữ thông báo tiếng Việt của cổng (vd "Không tồn tại hồ sơ gốc…");
  // câu mặc định tiếng Anh của máy chủ ("Internal Server Error"…) đổi thành câu dễ hiểu theo mã lỗi.
  const VIET = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  const statusText = (s) =>
    s === 429 ? 'Cổng thuế đang giới hạn số lần tra cứu'
      : s === 403 ? 'Cổng thuế từ chối yêu cầu'
        : s === 503 ? 'Cổng thuế đang bảo trì'
          : s >= 500 ? 'Cổng thuế đang gặp sự cố hoặc quá tải'
            : `Cổng thuế báo lỗi (mã ${s})`;
  // Cổng (hoặc tường lửa phía trước) có lúc trả trang HTML kèm mã 200 thay cho JSON (22/10/2026: detail
  // "Unexpected token '<'", gọi lại vài phút sau thì bình thường) → coi là lỗi tạm thời, thử lại.
  const HTML_PAGE = 'Cổng thuế trả về trang lỗi thay vì dữ liệu (có thể đang quá tải hoặc bảo trì)';
  const json = async (res) => { try { return await res.json(); } catch { throw new Error(HTML_PAGE); } };
  async function errorOf(res) {
    if (res.status === 401) return new HttpError('Phiên đăng nhập đã hết hạn – hãy đăng nhập lại hoadondientu', 401);
    let msg = '';
    try { const j = JSON.parse(await res.text()); msg = j.message || j.error || ''; } catch { /* không phải JSON */ }
    const e = new HttpError(res.status !== 503 && VIET.test(msg) ? msg : statusText(res.status), res.status, msg);
    e.retryAfter = Number(res.headers.get('retry-after')) || 0; // giây; dạng ngày giờ → 0 (dùng RATE_WAIT)
    return e;
  }

  // GET kèm header của cổng; tự thử lại khi lỗi tạm thời. Lỗi cố định (4xx, "không tồn tại"…) ném ngay.
  // Hết giờ chỉ thử lại 1 lần: với timeout dài (sco-query 90 s), thử lại 3 lần là treo ~6 phút mỗi tháng.
  // Nguồn hay lỗi (FORMS[…].retries, máy tính tiền = 0) lỗi là báo ngay, không thử lại. Trong lúc chờ: onWait({ secs, attempt, max }) mỗi giây
  // để giao diện đếm giây; onRetry({ err, attempt, max }) ngay khi 1 lần thất bại (báo sớm, không đợi hết lượt).
  // Bấm Dừng (shouldStop) hủy luôn request đang chờ thay vì đợi hết timeout.
  const STOPPED = 'Đã dừng theo yêu cầu';
  // 429 có lượt thử lại riêng (RATE_RETRIES); request kèm captcha (extra) thì ném ngay để searchGet chờ rồi lấy captcha mới.
  async function get(url, act, { shouldStop = () => false, timeout = TIMEOUT, retries = RETRIES, onWait, onRetry, auth, extra, endPoint } = {}) {
    for (let i = 0, rated = 0; ; i++) {
      if (auth !== false && !token()) throw new HttpError('Chưa đăng nhập hoadondientu – hãy đăng nhập rồi bấm ↻', 401);
      const wait = lastAt + gap - Date.now();
      if (wait > 0) await sleep(wait);
      if (shouldStop()) throw new Error(STOPPED);
      lastAt = Date.now();
      let err, timedOut = false, secs = 0;
      const max = 1 + Math.min(retries, RETRIES), ctrl = new AbortController();
      const tick = setInterval(() => {
        secs++;
        if (shouldStop()) ctrl.abort(new DOMException(STOPPED, 'AbortError'));
        else if (secs * 1000 >= timeout) ctrl.abort(new DOMException('', 'TimeoutError'));
        else if (secs >= 5) onWait?.({ secs, attempt: i + 1, max });
      }, 1000);
      try {
        const res = await fetch(url, { credentials: 'include', headers: headers(act, { auth, extra, endPoint }), cache: 'no-store', signal: ctrl.signal });
        if (res.ok && !/text\/html/i.test(res.headers.get('content-type') || '')) { recovered(); return res; }
        err = res.ok ? new Error(HTML_PAGE) : await errorOf(res);
      } catch (e) {
        if (shouldStop()) throw new Error(STOPPED);
        timedOut = e.name === 'TimeoutError' || ctrl.signal.reason?.name === 'TimeoutError';
        err = new Error(timedOut ? 'Cổng thuế phản hồi quá chậm (hết thời gian chờ)' : 'Không kết nối được tới cổng thuế – hãy kiểm tra mạng');
      } finally {
        clearInterval(tick);
        lastAt = Date.now();
      }
      if (err.status === 429) {
        slowDown();
        if (extra || rated >= RATE_RETRIES || shouldStop()) throw err;
        const ms = rateWait(err, ++rated);
        onRetry?.({ err: new Error(`${err.message} – chờ ${Math.round(ms / 1000)} giây`), attempt: rated + 1, max: RATE_RETRIES + 1 });
        await pause(ms, shouldStop, (left) => onWait?.({ secs: left, rate: true, attempt: rated + 1, max: RATE_RETRIES + 1 }));
        i--; // không tính vào lượt thử lại lỗi khác
        continue;
      }
      const last = Math.min(timedOut ? 1 : RETRIES, retries);
      if (!retryable(err) || i >= last || shouldStop()) throw err;
      onRetry?.({ err, attempt: i + 2, max: last + 1 });
      await sleep(DELAY * 2 ** i);
    }
  }

  let profile = null; // { mst, company } – chỉ trong bộ nhớ
  async function getSessionInfo() {
    const info = tokenInfo();
    if (!info || (info.exp && info.exp < Date.now())) { profile = null; return { ready: false }; }
    if (profile?.mst !== info.mst) {
      const p = await json(await get(URL_PROFILE, ''));
      profile = { mst: p.username || info.mst, company: p.name || p.fullName || null };
    }
    return { ready: true, ...profile };
  }

  // Chia [from, to] thành các đoạn trong cùng 1 tháng dương lịch (máy chủ chỉ nhận ≤ 1 tháng).
  function parseRange(tuNgay, denNgay) {
    const from = parseVN(tuNgay), to = parseVN(denNgay);
    if (from > to) throw new Error('Từ ngày không được sau Đến ngày');
    return { from, to };
  }
  function splitMonths(tuNgay, denNgay) {
    const { from, to } = parseRange(tuNgay, denNgay);
    const out = [];
    for (let a = from; a <= to; a = new Date(a.getFullYear(), a.getMonth() + 1, 1)) {
      const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
      out.push({ month: ym(a), tuNgay: vn(a), denNgay: vn(end < to ? end : to) });
    }
    return out;
  }
  // Chia [from, to] thành các đoạn liên tiếp tối đa `days` ngày (tính cả 2 đầu), đoạn sau bắt đầu ngay ngày kế tiếp;
  // được vắt qua tháng / năm. month: null → tháng của từng hóa đơn lấy theo ngày lập (pick).
  function splitDays(tuNgay, denNgay, days) {
    const { from, to } = parseRange(tuNgay, denNgay);
    const out = [];
    for (let a = from; a <= to; a = new Date(a.getFullYear(), a.getMonth(), a.getDate() + days)) {
      const end = new Date(a.getFullYear(), a.getMonth(), a.getDate() + days - 1);
      out.push({ month: null, tuNgay: vn(a), denNgay: vn(end < to ? end : to) });
    }
    return out;
  }
  const splitFor = (form, tuNgay, denNgay) => (FORMS[form].days ? splitDays(tuNgay, denNgay, FORMS[form].days) : splitMonths(tuNgay, denNgay));
  const chunkLabel = (c) => (c.month ? `tháng ${c.month}` : `${c.tuNgay.slice(0, 5)}–${c.denNgay}`);

  const MST_RE = /^\d{10}(-\d{3})?$/;
  function searchString(kind, form, chunk, { nbmst, nmmst } = {}) {
    let s = `tdlap=ge=${chunk.tuNgay}T00:00:00;tdlap=le=${chunk.denNgay}T23:59:59${FORMS[form].filter[kind]}`;
    if (nbmst && MST_RE.test(nbmst)) s += `;nbmst==${nbmst}`;
    if (nmmst && MST_RE.test(nmmst)) s += `;nmmst==${nmmst}`;
    return s;
  }

  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  // Chỉ giữ các trường cần cho bảng kê + xuất XML (giữ ít để đỡ tốn bộ nhớ)
  const pick = (d, kind, form, month) => ({
    key: `${kind}:${FORMS[form].ep}:${d.id}`, kind, form, month, id: d.id,
    nbmst: d.nbmst, nbten: d.nbten, nmmst: d.nmmst, nmten: d.nmten || d.nmtnmua,
    khmshdon: d.khmshdon, khhdon: d.khhdon, shdon: d.shdon, tdlap: d.tdlap,
    // tgtphi: phí, lệ phí ngoài hàng hóa (XML: TToan/DSLPhi) – đã nằm trong tgtttbso nhưng không trong tgtcthue
    tgtcthue: num(d.tgtcthue), tgtthue: num(d.tgtthue), tgtphi: num(d.tgtphi), tgtttbso: num(d.tgtttbso), dvtte: d.dvtte || 'VND', tgia: num(d.tgia),
    tthai: d.tthai, ttxly: d.ttxly,
    rates: (d.thttltsuat || []).map((r) => ({ tsuat: r.tsuat, thtien: num(r.thtien), tthue: num(r.tthue) })),
    goc: d.khhdgoc ? `${d.khmshdgoc || ''}${d.khhdgoc}-${d.shdgoc || ''}` : '',
    // Hóa đơn gốc của HĐ thay thế / điều chỉnh: cùng người bán → đủ tham số để tải XML của hóa đơn gốc
    gocRef: d.khhdgoc && d.shdgoc ? { nbmst: d.nbmst, khmshdon: d.khmshdgoc, khhdon: d.khhdgoc, shdon: d.shdgoc } : null,
    // Hình thức thanh toán (TM, CK, TM/CK…) – có ở danh sách của cổng; XML (HTTToan) ghi đè khi tải chi tiết
    httt: d.thtttoan || null,
    msttcgp: d.msttcgp || '',
  });

  // 1 captcha mới của cổng, giải ngay trên máy (captcha-svg.js). Giữ nguyên hoa/thường như kết quả giải.
  async function solveCaptcha(shouldStop) {
    const c = await json(await get(URL_CAPTCHA, '', { shouldStop, auth: false }));
    if (!c?.key || !c?.content) throw new Error('Cổng thuế không trả captcha');
    // Như người gõ captcha: chờ ngẫu nhiên 2, 3 hoặc 4 giây rồi mới gửi
    await sleep(1000 * (2 + Math.floor(Math.random() * 3)));
    return { ckey: c.key, cvalue: SvgCaptcha.solve(c.content).text };
  }
  const captchaError = (e) => e instanceof HttpError && (e.status === 400 || CAPTCHA_ERR.test(`${e.raw} ${e.message}`));

  // GET 1 trang danh sách. Nguồn cần captcha (sco-query): mỗi lần gọi 1 captcha mới, gửi ckey + cvalue ở cả query string
  // lẫn header như trang của cổng; giải sai thì lấy captcha khác, tối đa CAPTCHA_TRIES lần. 429: captcha có thể đã bị dùng
  // → chờ như get() rồi lấy captcha mới (lượt riêng, không tính vào lượt giải sai).
  async function searchGet(form, url, act, opts) {
    if (!FORMS[form].captcha) return get(url, act, opts);
    for (let i = 1, rated = 0; ; i++) {
      const c = await solveCaptcha(opts.shouldStop);
      try {
        return await get(`${url}&${new URLSearchParams(c)}`, act, { ...opts, extra: c });
      } catch (e) {
        if (e.status === 429 && rated < RATE_RETRIES && !opts.shouldStop()) {
          const ms = rateWait(e, ++rated);
          opts.onRetry?.({ err: new Error(`${e.message} – chờ ${Math.round(ms / 1000)} giây`), attempt: rated + 1, max: RATE_RETRIES + 1 });
          await pause(ms, opts.shouldStop, (left) => opts.onWait?.({ secs: left, rate: true, attempt: rated + 1, max: RATE_RETRIES + 1 }));
          i--;
          continue;
        }
        if (!captchaError(e) || opts.shouldStop()) throw e;
        if (i >= CAPTCHA_TRIES) throw new HttpError(`Không qua được captcha của cổng sau ${CAPTCHA_TRIES} lần thử (${e.message.replace(/\.+$/, '')})`, e.status, e.raw);
        opts.onRetry?.({ err: new Error('Giải captcha sai'), attempt: i + 1, max: CAPTCHA_TRIES });
      }
    }
  }

  // Đọc hết các trang của 1 (loại, hình thức, đoạn ngày), phân trang bằng "state" của máy chủ.
  // Cổng đôi khi trả total/trang lệch nhau → đọc lại cả đoạn (gộp theo id) tới khi đủ total.
  async function readMonth(kind, form, chunk, filters, { onPage, shouldStop, onWait, onRetry }) {
    const s = searchString(kind, form, chunk, filters), ep = FORMS[form].ep, map = new Map();
    const act = `Tìm kiếm (${FORMS[form].act} ${KINDS[kind].act})`;
    // Đoạn ngày (máy tính tiền) có thể vắt qua tháng → tháng (gom zip) theo ngày lập của từng hóa đơn; tdlap là giờ UTC → đổi sang giờ máy
    const monthOf = (d) => chunk.month || ym(d.tdlap ? new Date(d.tdlap) : parseVN(chunk.tuNgay));
    let total = 0;
    for (let attempt = 0; attempt <= TOTAL_RETRIES; attempt++) {
      let state = null;
      do {
        if (shouldStop()) return { rows: [...map.values()], total, stopped: true };
        const j = await json(await searchGet(form, URL_SEARCH(ep, KINDS[kind].path, s, state), act, { shouldStop, timeout: FORMS[form].timeout, retries: FORMS[form].retries, onWait, onRetry }));
        total = j.total || 0;
        for (const d of j.datas || []) map.set(d.id, pick(d, kind, form, monthOf(d)));
        state = j.state;
        onPage(map.size);
        await sleep(DELAY);
      } while (state && map.size < total);
      if (map.size >= total) break;
    }
    return { rows: [...map.values()], total };
  }

  // Tra cứu tuần tự từng loại × hình thức × đoạn ngày (hóa đơn điện tử: tháng; máy tính tiền: đoạn tối đa 10 ngày).
  async function search({ tuNgay, denNgay, kinds, forms, filters = {}, onProgress = () => {}, onWarn = () => {}, onWait = () => {}, shouldStop = () => false }) {
    kinds = kinds.filter((k) => KINDS[k]); forms = forms.filter((f) => FORMS[f]);
    if (!kinds.length) throw new Error('Hãy chọn loại hóa đơn (mua vào / bán ra)');
    if (!forms.length) throw new Error('Hãy chọn hình thức hóa đơn');
    const rows = [];
    // sco-query (máy tính tiền) có lúc treo cả phút (22/10/2026: > 30 s mọi tháng, query vẫn ~0,3 s) và hay lỗi → 1 nguồn
    // lỗi không được làm hỏng cả job: bỏ qua nguồn đó cho mọi tháng/loại còn lại, vẫn lưu phần đã tra được.
    // Tra hết hóa đơn điện tử (nhanh) của mọi loại trước, máy tính tiền sau cùng; lỗi đầu tiên báo ngay vào nhật ký.
    const down = new Set();
    for (const form of forms) for (const kind of kinds) for (const chunk of splitFor(form, tuNgay, denNgay)) {
      if (down.has(form)) continue;
      const label = `${KINDS[kind].label} · ${FORMS[form].label} · ${chunkLabel(chunk)}`;
      const base = rows.length;
      let r;
      try {
        r = await readMonth(kind, form, chunk, filters, { shouldStop,
          onPage: (n) => onProgress({ label, count: base + n }),
          onWait: (w) => onWait({ label, slow: !!FORMS[form].timeout, ...w }),
          onRetry: ({ err, attempt, max }) => onWarn(`${label}: ${err.message.replace(/\.+$/, '')} – đang thử lại (lần ${attempt}/${max})…`) });
      } catch (e) {
        if (shouldStop()) return { rows, stopped: true };
        if (e.status === 401) throw e;
        down.add(form);
        const [y, m] = (chunk.month || '').split('-'), what = FORMS[form].name, why = e.message.replace(/\.+$/, '');
        const when = chunk.month ? `tháng ${m}/${y}` : `từ ${chunk.tuNgay} (và các đoạn sau)`;
        onWarn(`Bỏ qua ${what} ${KINDS[kind].act} ${when} (${why[0].toLowerCase()}${why.slice(1)}) – hóa đơn khác vẫn lưu đủ, hãy thử lại sau`);
        continue;
      }
      rows.push(...r.rows);
      if (r.stopped) return { rows, stopped: true };
      if (r.rows.length < r.total) onWarn(`${label}: cổng báo ${r.total} hóa đơn nhưng chỉ đọc được ${r.rows.length}`);
    }
    // skipped: nguồn bị bỏ qua vì lỗi (vd "hóa đơn máy tính tiền") → số liệu tổng hợp như tờ khai chưa đủ
    return { rows, skipped: [...down].map((f) => FORMS[f].name) };
  }

  // Dòng hàng hóa chuẩn hóa từ XML (HHDVu) hoặc JSON detail (hdhhdvu).
  // Dòng chiết khấu thương mại (TChat 3) ghi số dương trong hóa đơn nhưng làm giảm tổng → đổi đơn giá, thành tiền,
  // tiền thuế sang số âm để cộng các dòng ra đúng tiền chưa thuế của hóa đơn.
  // tthueTinh: tiền thuế tự tính (thành tiền × thuế suất, làm tròn) khi hóa đơn không ghi → có thể lệch 1 đồng.
  const rateOf = (s) => { const m = /^(\d+(?:[.,]\d+)?)%$/.exec(String(s || '').trim()); return m ? Number(m[1].replace(',', '.')) / 100 : null; };
  const signed = (tchat, v) => (String(tchat) === '3' && v !== null ? -Math.abs(v) : v);
  // Phần đầu hóa đơn trong XML (TT78): người bán / mua, tổng tiền, hình thức thanh toán, hóa đơn liên quan,
  // mã + link tra cứu (TTKhac) và chữ ký số (DSCKS). Thẻ chữ ký có tiền tố "ds:" → tìm theo tên cục bộ.
  const byName = (el, tag) => (el ? [...el.getElementsByTagNameNS('*', tag)] : []);
  const kid = (el, tag) => (el ? [...el.children].find((c) => c.localName === tag) : undefined);
  const txt = (el) => el?.textContent?.trim() ?? '';
  // Tên trường theo nhà cung cấp (khảo sát 24/10/2026): Thái Sơn "Mã TC" + "DC TC", FAST "KeySearch", Viettel "Mã số bí mật"
  const LOOKUP = /tra\s*c[ứu]u|tracuu|searchkey|keysearch|lookup|reservation|fkey|transaction|portal|website|url|link|^m[ãa]\s*tc$|^dc\s*tc$|bí mật/i;
  function lookupOf(doc) {
    let code = '', link = '';
    for (const tin of byName(doc, 'TTin')) {
      if (tin.closest('HHDVu, NBan, NMua, DSCKS')) continue;
      const k = txt(kid(tin, 'TTruong')), v = txt(kid(tin, 'DLieu'));
      if (!v || !LOOKUP.test(k)) continue;
      if (/^https?:\/\//i.test(v)) { link ||= v; } else if (/^dc\s*tc$/i.test(k)) { link ||= `https://${v}`; } else if (!/link|url|website|portal/i.test(k)) { code ||= v; }
    }
    return { code, link };
  }
  // Chữ ký số: tên đơn vị ký (CN, hoặc O), MST trong chứng thư (UID=MST:…), thời điểm ký (SigningTime)
  function signerOf(box) {
    const sig = byName(box, 'Signature')[0];
    if (!sig) return null;
    const subject = txt(byName(sig, 'X509SubjectName')[0]);
    const cn = /(?:^|,)\s*CN=([^,]+)/.exec(subject)?.[1] || /(?:^|,)\s*O=([^,]+)/.exec(subject)?.[1] || '';
    return { subject, name: cn.trim(), mst: /MST:\s*(\d{10}(?:-\d{3})?)/i.exec(subject)?.[1] || '',
      time: txt(byName(sig, 'SigningTime')[0]), hasCert: !!byName(sig, 'X509Certificate')[0] };
  }
  function headFromXml(doc) {
    const tc = byName(doc, 'TTChung')[0], nb = byName(doc, 'NBan')[0], nm = byName(doc, 'NMua')[0], tt = byName(doc, 'TToan')[0];
    const ck = byName(doc, 'DSCKS')[0], lq = kid(tc, 'TTHDLQuan');
    const v = (el, tag) => txt(kid(el, tag));
    return {
      khmshdon: v(tc, 'KHMSHDon'), khhdon: v(tc, 'KHHDon'), shdon: v(tc, 'SHDon'), nlap: v(tc, 'NLap'),
      dvtte: v(tc, 'DVTTe') || 'VND', tgia: num(v(tc, 'TGia')), httt: v(tc, 'HTTToan'),
      nbmst: v(nb, 'MST'), nbten: v(nb, 'Ten'), nbdchi: v(nb, 'DChi'), nmmst: v(nm, 'MST'), nmten: v(nm, 'Ten') || v(nm, 'HVTNMHang'), nmdchi: v(nm, 'DChi'),
      tgtcthue: num(v(tt, 'TgTCThue')), tgtthue: num(v(tt, 'TgTThue')), tgtttbso: num(v(tt, 'TgTTTBSo')), ttcktmai: num(v(tt, 'TTCKTMai')),
      // TCHDon: 1 thay thế, 2 điều chỉnh; GChu: lý do (nhiều phần mềm ghi "Điều chỉnh cho hóa đơn …")
      related: lq ? { tchdon: v(lq, 'TCHDon'), khmshdon: v(lq, 'KHMSHDCLQuan'), khhdon: v(lq, 'KHHDCLQuan'), shdon: v(lq, 'SHDCLQuan'), nlap: v(lq, 'NLHDCLQuan'), gchu: v(lq, 'GChu') } : null,
      mccqt: txt(byName(doc, 'MCCQT')[0]),
      seller: signerOf(kid(ck, 'NBan')), cqtSigned: !!signerOf(kid(ck, 'CQT')), hasSignBox: !!ck,
      lookup: lookupOf(doc), msttcgp: v(tc, 'MSTTCGP'),
    };
  }
  // Cùng các trường từ JSON chi tiết (hóa đơn không mã): tên trường như danh sách của cổng
  function headFromDetail(d) {
    return {
      khmshdon: String(d.khmshdon ?? ''), khhdon: d.khhdon || '', shdon: String(d.shdon ?? ''), nlap: d.tdlap || '',
      dvtte: d.dvtte || 'VND', tgia: num(d.tgia), httt: d.thtttoan || '',
      nbmst: d.nbmst || '', nbten: d.nbten || '', nbdchi: d.nbdchi || '', nmmst: d.nmmst || '', nmten: d.nmten || d.nmtnmua || '', nmdchi: d.nmdchi || '',
      tgtcthue: num(d.tgtcthue), tgtthue: num(d.tgtthue), tgtttbso: num(d.tgtttbso), ttcktmai: num(d.ttcktmai),
      related: null, mccqt: d.mhdon || '', seller: null, cqtSigned: false, hasSignBox: false, lookup: { code: '', link: '' },
      msttcgp: d.msttcgp || '',
    };
  }

  function invoiceFromXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const t = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
    // Thông tin khác của dòng (TTKhac/TTin): nhiều phần mềm hóa đơn ghi tiền thuế từng dòng ở "VATAmount"
    const extra = (h, re) => {
      const tin = [...h.getElementsByTagName('TTin')].find((x) => re.test(t(x, 'TTruong')));
      return tin ? num(t(tin, 'DLieu')) : null;
    };
    const lines = [...doc.getElementsByTagName('HHDVu')].map((h) => {
      const tc = t(h, 'TChat'), thtien = signed(tc, num(t(h, 'ThTien'))), tsuat = t(h, 'TSuat'), r = rateOf(tsuat);
      const tinh = r !== null && thtien !== null ? Math.round(thtien * r) : null;
      // Có phần mềm ghi VATAmount = 0 cho dòng 8% (trường để trống) → coi như không ghi khi tự tính ra khác 0
      let ghi = signed(tc, extra(h, /^(VATAmount|TThue|TienThue)$/i));
      if (ghi === 0 && tinh) ghi = null;
      return { tchat: TCHAT[tc] || tc, ma: t(h, 'MHHDVu'), ten: t(h, 'THHDVu'), dvt: t(h, 'DVTinh'),
        sl: num(t(h, 'SLuong')), dgia: signed(tc, num(t(h, 'DGia'))), ck: num(t(h, 'STCKhau')), thtien, tsuat,
        tthue: ghi ?? tinh, tthueTinh: ghi === null && tinh !== null };
    });
    // Phí, lệ phí ngoài hàng hóa (vd lệ phí đăng kiểm, thuế/phí khác của vé máy bay)
    const fees = [...doc.getElementsByTagName('LPhi')]
      .map((p) => ({ ten: t(p, 'TLPhi'), tien: num(t(p, 'TPhi')) }))
      .filter((p) => p.tien);
    return { lines, fees, head: headFromXml(doc) };
  }
  function linesFromDetail(det) {
    return (det.hdhhdvu || []).map((h) => ({
      tchat: TCHAT[h.tchat] || h.tchat || '', ma: h.mhhdvu || '', ten: h.ten, dvt: h.dvtinh, sl: num(h.sluong), dgia: signed(h.tchat, num(h.dgia)), ck: num(h.stckhau),
      thtien: signed(h.tchat, num(h.thtien)), tsuat: h.ltsuat || (h.tsuat !== null && h.tsuat !== undefined ? `${Math.round(h.tsuat * 100)}%` : ''),
      tthue: signed(h.tchat, num(h.tthue)), tthueTinh: false,
    }));
  }

  // Lấy dữ liệu gốc của 1 hóa đơn: zip "Xuất xml" (invoice.xml + invoice.html) nếu cổng có hồ sơ gốc;
  // hóa đơn không mã (ttxly 6) không có XML gốc ("Không tồn tại hồ sơ gốc của hóa đơn.") → dùng API chi tiết (JSON).
  async function fetchInvoice(row, shouldStop, onWait) {
    const ep = FORMS[row.form].ep;
    if (row.ttxly !== 6) {
      try {
        const buf = new Uint8Array(await (await get(URL_XML(ep, row), action('Xuất xml', row), { shouldStop, timeout: FORMS[row.form].timeout, retries: FORMS[row.form].retries, onWait })).arrayBuffer());
        if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('Cổng không trả file zip');
        const files = await Zip.readZip(buf);
        const name = (re) => Object.keys(files).find((n) => re.test(n));
        // Giữ NGUYÊN bytes gốc (XML có chữ ký số, có thể có BOM): giải mã rồi mã hóa lại làm phần mềm
        // của Cục Thuế (iTaxViewer) báo "Tệp hồ sơ không đúng định dạng". Chỉ giải mã để đọc dòng hàng hóa.
        const xmlName = name(/\.xml$/i);
        if (xmlName) return { source: 'xml', xml: files[xmlName], files, ...invoiceFromXml(Zip.text(files[xmlName])) };
      } catch (e) {
        if (shouldStop() || e.status === 401) throw e;
        // không có hồ sơ gốc / lỗi khác sau khi đã thử lại → thử API chi tiết
      }
      await sleep(DELAY);
    }
    const det = await json(await get(URL_DETAIL(ep, row), action('Xem hóa đơn', row), { shouldStop, timeout: FORMS[row.form].timeout, retries: FORMS[row.form].retries, onWait }));
    // JSON chi tiết không có danh sách phí riêng → Excel bù dòng phí từ tgtphi của danh sách
    return { source: 'detail', json: det, lines: linesFromDetail(det), fees: [], head: headFromDetail(det) };
  }

  // Hóa đơn gốc có thể thuộc hình thức khác với HĐ thay thế/điều chỉnh.
  // Thử endpoint của hình thức hiện tại trước, nếu không tìm thấy mới thử endpoint còn lại; khóa MST + mẫu + ký hiệu + số giữ nguyên.
  async function fetchOriginal(row, shouldStop, onWait) {
    const forms = [row.form, ...Object.keys(FORMS).filter((form) => form !== row.form)];
    let lastError;
    for (const form of forms) {
      if (shouldStop()) throw new Error(STOPPED);
      try {
        return await fetchInvoice({ ...row.gocRef, kind: row.kind, form, ttxly: null }, shouldStop, onWait);
      } catch (e) {
        if (shouldStop() || e.status === 401) throw e;
        // Chỉ đổi endpoint khi cổng xác nhận không có hóa đơn ở nguồn hiện tại; lỗi mạng/429/5xx không được nhân đôi request.
        if (!(e.status === 404 || /không tồn tại|không tìm thấy|chưa có thông tin|not found/i.test(e.message || ''))) throw e;
        lastError = e;
      }
    }
    throw lastError || new Error('Không tìm thấy hóa đơn gốc ở các hình thức tra cứu');
  }

  // Tra cứu hóa đơn gốc (PDF của nhà cung cấp) để người dùng tự tải: { name, link, code } – cột Excel (khi chọn PDF) và chân trang PDF
  function originalLookup(row, head) {
    const mst = head?.msttcgp || row.msttcgp || '', p = PROVIDERS[mst] || {};
    return { name: p.name || (mst ? `MST ${mst}` : ''), link: head?.lookup?.link || p.url || '', code: head?.lookup?.code || '' };
  }

  // ---- Đối chiếu MST với DS công khai sử dụng hóa đơn không hợp pháp ----
  // CQT cập nhật danh sách thưa → cache trên máy (chrome.storage.local: chỉ MST + bản ghi công khai của cổng, không có hóa đơn
  // của người dùng). Mỗi lần chạy (quá BHP_FRESH kể từ lần kiểm trước): 1 request lấy bản ghi mới cập nhật nhất + tổng số làm
  // "chữ ký" của danh sách; khác lần trước → bỏ cache. MST chưa có trong cache tra gộp BHP_BATCH MST / request.
  // MST có trong danh sách → tải thêm DS hóa đơn không hợp pháp của MST đó (để biết đúng hóa đơn nào bị nêu tên).
  const BHP_KEY = 'bhp', BHP_BATCH = 40, BHP_FRESH = 24 * 3600e3, BHP_MAX = 5000;
  const bhpGet = async (url, act, shouldStop) => json(await get(url, act, { shouldStop, auth: false, endPoint: BHP_END_POINT }));
  async function illegalCheck(msts, { shouldStop = () => false, onStatus = () => {} } = {}) {
    msts = [...new Set(msts)].filter((m) => MST_RE.test(m));
    const store = (await chrome.storage.local.get(BHP_KEY))[BHP_KEY] || { sig: '', checkedAt: 0, msts: {} };
    try {
      if (Date.now() - store.checkedAt > BHP_FRESH) {
        onStatus('Kiểm tra danh sách công khai hóa đơn không hợp pháp có cập nhật mới…');
        const j = await bhpGet(URL_BHP('', null, 1), 'Tìm kiếm', shouldStop);
        const top = j.datas?.[0] || {};
        const sig = `${j.total || 0}|${top.ncnhat || ''}|${top.id || ''}`;
        if (sig !== store.sig) store.msts = {};
        Object.assign(store, { sig, checkedAt: Date.now() });
        await sleep(DELAY);
      }
      const todo = msts.filter((m) => !store.msts[m]);
      for (let i = 0; i < todo.length && !shouldStop(); i += BHP_BATCH) {
        const part = todo.slice(i, i + BHP_BATCH), found = Object.fromEntries(part.map((m) => [m, []]));
        onStatus(`Đối chiếu danh sách công khai hóa đơn không hợp pháp: ${Math.min(i + BHP_BATCH, todo.length)}/${todo.length} MST`);
        let state = null, read = 0, total = 0;
        do {
          const j = await bhpGet(URL_BHP(`mst=in=(${part.join(',')})`, state, PAGE_SIZE), 'Tìm kiếm', shouldStop);
          for (const d of j.datas || []) {
            (found[d.mst] ||= []).push({ id: d.id, loai: Number(d.loai), ten: d.nbten || '', ldo: d.ldo || '', nckhai: d.nckhai || '', cqt: d.cqt || '' });
          }
          read += (j.datas || []).length; total = j.total || 0; state = j.state;
          await sleep(DELAY);
        } while (state && read < total && !shouldStop());
        if (read < total) break; // dừng giữa chừng → không ghi kết quả thiếu vào cache
        for (const [m, recs] of Object.entries(found)) store.msts[m] = { recs };
      }
      // Hóa đơn bị nêu tên của các MST có trong danh sách (HĐ điện tử + máy tính tiền); lỗi → để lần sau tải lại
      for (const m of msts) {
        const e = store.msts[m];
        if (!e?.recs.length || e.invs || shouldStop()) continue;
        onStatus(`Tải danh sách hóa đơn không hợp pháp của MST ${m}`);
        const invs = [];
        try {
          for (const r of e.recs) for (const ep of ['invoice', 'mtt-invoice']) {
            const list = await bhpGet(URL_BHP_INV(ep, { ...r, mst: m }), 'Xem chi tiết', shouldStop);
            for (const x of Array.isArray(list) ? list : []) invs.push({ khmshdon: x.khmshdon, khhdon: x.khhdon, shdon: x.shdon });
            await sleep(DELAY);
          }
          e.invs = invs;
        } catch (err) {
          if (err.status === 401 || shouldStop()) throw err;
        }
      }
    } finally {
      const keys = Object.keys(store.msts);
      for (const k of keys.slice(0, Math.max(0, keys.length - BHP_MAX))) delete store.msts[k];
      await chrome.storage.local.set({ [BHP_KEY]: store });
    }
    // { mst: { recs: [...], invs?: [...] } } – MST chưa tra được (dừng giữa chừng) không có trong kết quả
    return Object.fromEntries(msts.filter((m) => store.msts[m]).map((m) => [m, store.msts[m]]));
  }

  window.HDDT = { KINDS, FORMS, TTHAI, TTXLY, DELAY, originalLookup, getSessionInfo, splitMonths, splitDays, splitFor, search, fetchInvoice, fetchOriginal, invoiceFromXml, illegalCheck, sleep };
})();
