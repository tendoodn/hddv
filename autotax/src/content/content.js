// Nhận lệnh từ side panel và chạy trong tab hoadondientu đã đăng nhập.
// 1 lần bấm "Tải dữ liệu": tra cứu từng tháng → (nếu cần) tải chi tiết từng hóa đơn → zip XML/HTML/PDF từng tháng
// → Excel bảng kê. Mọi xử lý trong bộ nhớ của tab, file ghi thẳng vào Downloads.
let stopFlag = false;
let busy = false;

const safeName = (s) => (s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 120);
const waitText = ({ secs, attempt, max, rate }) => (rate
  ? `cổng thuế báo gửi quá nhiều yêu cầu (429), tự thử lại sau ${secs} giây (lần ${attempt}/${max})`
  : `cổng thuế chưa trả lời, đã chờ ${secs} giây${max > 1 ? ` (lần ${attempt}/${max})` : ''}`);
const isoOf = (vn) => vn.split('/').reverse().join('-'); // dd/mm/yyyy → yyyy-mm-dd
const DOWNLOAD_ROOT = 'HoaDon'; // Downloads/HoaDon/<MST – Tên công ty>/<từ ngày>_<đến ngày>/
const ZIP_PART_BYTES = 40 * 1024 * 1024; // ~40 MB/zip: data URL base64 còn ~55 MB, dưới giới hạn 64 MB của tin nhắn Chrome

const HISTORY_KEY = 'autotax_invoice_history_v1';
const HISTORY_LIMIT = 20000;
const invoiceHistoryKey = (r, mst) => [mst || '', r.kind || '', r.form || '', r.khmshdon || '', r.khhdon || '', r.shdon || ''].join('|');
// Reserve quota before any file is produced. Previously charged invoice identities
// are returned as allowed without consuming another unit.
// Bound each atomic claim request to prevent huge transactions on large invoice searches.
const INVOICE_CLAIM_BATCH_SIZE = 250;
async function claimInvoiceQuota(rows, mst) {
  if (!rows?.length) return { rows: [], deducted: 0, previously: 0, denied: 0 };
  const stored = await chrome.storage.local.get('autotax_license_session_v1');
  const token = stored.autotax_license_session_v1?.access_token;
  if (!token) throw new Error('Phiên đăng nhập AutoTax không hợp lệ. Vui lòng đăng nhập lại.');
  const base = 'https://ucqqjdsoyvvaxswzbhaw.supabase.co';
  const key = 'sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
  const headers = { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const allowedRows = [];
  let deducted = 0, previously = 0, denied = 0;
  const invoiceKey = item => JSON.stringify([
    item.mst, item.direction, item.form_code, item.series, item.invoice_number
  ]);
  for (let offset = 0; offset < rows.length; offset += INVOICE_CLAIM_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INVOICE_CLAIM_BATCH_SIZE);
    const items = batch.map(r => ({
      mst: mst || '', direction: r.kind || '',
      form_code: [r.form || '', r.khmshdon || ''].join(':'),
      series: r.khhdon || '', invoice_number: String(r.shdon ?? '')
    }));
    const res = await fetch(base + '/rest/v1/rpc/addon_claim_invoice_quota', {
      method: 'POST', headers, body: JSON.stringify({ p_items: items })
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(result.message || result.error ||
        'Không xác minh được lượt sử dụng. Hãy liên hệ quản trị AutoTax.');
    }
    const allowed = new Set((result.allowed_items || []).map(invoiceKey));
    for (let i = 0; i < batch.length; i++) {
      if (allowed.has(invoiceKey(items[i]))) allowedRows.push(batch[i]);
    }
    deducted += Number(result.deducted || 0);
    previously += Number(result.previously_deducted || 0);
    denied += Number(result.denied || 0);
  }
  return { rows: allowedRows, deducted, previously, denied };
}

async function updateInvoiceHistory(rows, mst, mode, formats = {}) {
  if (!rows?.length) return;
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const db = stored[HISTORY_KEY] || { version: 1, records: {} };
  const now = new Date().toISOString();
  for (const r of rows) {
    const key = invoiceHistoryKey(r, mst);
    const old = db.records[key] || {};
    const rec = {
      key, mst: mst || '', kind: r.kind || '', form: r.form || '',
      invoiceNo: String(r.shdon ?? ''), series: r.khhdon || '', template: r.khmshdon || '',
      sellerTax: r.nbmst || '', sellerName: r.nbten || '',
      buyerTax: r.nmmst || '', buyerName: r.nmten || '',
      date: r.tdlap || '', status: r.tthai ?? null, processing: r.ttxly ?? null,
      firstSeenAt: old.firstSeenAt || now,
      lastSearchedAt: mode === 'searched' ? now : (old.lastSearchedAt || ''),
      searchedCount: (old.searchedCount || 0) + (mode === 'searched' ? 1 : 0),
      downloadedAt: mode === 'downloaded' ? now : (old.downloadedAt || ''),
      downloadedFormats: mode === 'downloaded' ? [...new Set([...(old.downloadedFormats || []), ...Object.keys(formats[invoiceHistoryKey(r, mst)] || formats).filter(k => (formats[invoiceHistoryKey(r, mst)] || formats)[k])])] : (old.downloadedFormats || []),
    };
    db.records[key] = rec;
  }
  const entries = Object.entries(db.records).sort((a,b) => (b[1].lastSearchedAt || b[1].firstSeenAt).localeCompare(a[1].lastSearchedAt || a[1].firstSeenAt));
  db.records = Object.fromEntries(entries.slice(0, HISTORY_LIMIT));
  await chrome.storage.local.set({ [HISTORY_KEY]: db });
}

function toDataUrl(bytes, mime) {
  return new Promise((ok, fail) => {
    const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail;
    r.readAsDataURL(new Blob([bytes], { type: mime }));
  });
}
async function save(bytes, mime, filename) {
  const r = await chrome.runtime.sendMessage({ type: 'download', url: await toDataUrl(bytes, mime), filename });
  if (r?.error) throw new Error(r.error);
}

async function assertPackageAccessForMst(mst) {
  const stored=await chrome.storage.local.get('autotax_license_session_v1');
  const token=stored.autotax_license_session_v1?.access_token;
  if(!token)throw new Error('Vui lòng đăng nhập AutoTax và cấu hình hồ sơ MST.');
  const base='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
  const key='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
  const headers={apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'};
  // A server-side READ-ONLY check against the ACTUAL GDT session MST.
  // Never auto-assign unknown MSTs just because a package has spare capacity.
  const response=await fetch(base+'/rest/v1/rpc/addon_verify_session_mst_v33',{
    method:'POST',headers,body:JSON.stringify({p_mst:mst})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.message||
    'Không kiểm tra được danh sách hồ sơ MST. Tìm kiếm đã bị khóa.');
  if(!result.allowed){
    const messages={
      mst_profile_not_configured:'Chưa cấu hình MST '+(mst||'đang đăng nhập')+
        '. Hãy thêm MST này trong danh sách hồ sơ của AutoTax.',
      mst_capacity_reduced:'MST này vượt quá số hồ sơ còn hiệu lực trong gói.',
      mst_package_expired:'Gói MST đã hết hạn.',
      invoice_package_required:'Gói số tờ không còn quyền tra cứu.',
      invalid_mst:'MST của phiên đăng nhập cổng Thuế không hợp lệ.'
    };
    throw new Error(messages[result.reason]||
      'MST đang đăng nhập không được phép tra cứu với tài khoản AutoTax.');
  }
  return {mode:result.mode||'mst',remaining:null};
}
async function runJob({ tuNgay, denNgay, kinds, forms, filters, formats, adjOnly, sheets = {}, tendoo = null }, send, linkSku) {
  stopFlag = false;
  const shouldStop = () => stopFlag;
  const profile = await HDDT.getSessionInfo();
  if (!profile.ready) throw new Error('Chưa đăng nhập hoadondientu – hãy đăng nhập rồi bấm ↻');
  const packageAccess = await assertPackageAccessForMst(profile.mst);
  const dir = `${DOWNLOAD_ROOT}/${safeName([profile.mst, profile.company].filter(Boolean).join(' – ')) || 'CongTy'}/${isoOf(tuNgay)}_${isoOf(denNgay)}`;

  // 1. Tra cứu
  // Hóa đơn điện tử tra theo tháng; máy tính tiền chia đoạn tối đa 10 ngày, mỗi đoạn có CAPTCHA riêng.
  // V3: số ngày MTT được cố định ở HDDT.FORMS.mtt.days = 10, không ghi đè từ storage.
  const parts = forms.map((f) => `${HDDT.splitFor(f, tuNgay, denNgay).length} ${HDDT.FORMS[f].days ? `đoạn ${HDDT.FORMS[f].days} ngày` : 'tháng'}`);
  send({ type: 'status', text: `Đang tra cứu ${parts.join(' + ')}…` });
  const res = await HDDT.search({ tuNgay, denNgay, kinds, forms, filters, shouldStop,
    onProgress: (p) => send({ type: 'status', text: `${p.label}: đã đọc ${p.count} hóa đơn` }),
    onWarn: (text) => send({ type: 'log', level: 'warn', text }),
    // Cổng chậm: đếm giây ngay trên dòng trạng thái để người dùng biết vẫn đang chờ, không phải treo
    onWait: (w) => send({ type: 'status', text: `${w.label}: ${waitText(w)}${w.slow && !w.rate ? ' (tra máy tính tiền thường chậm, chờ tối đa 90 giây)' : ''}` }) });
  let rows = res.rows;
  // Chỉ HĐ thay thế / điều chỉnh / hủy: lọc theo tthai ngay sau tra cứu, trước khi tải chi tiết (tthai 1 = hóa đơn mới)
  if (adjOnly) {
    rows = rows.filter((r) => r.tthai && Number(r.tthai) !== 1);
    send({ type: 'log', level: 'ok', text: `Chỉ lấy hóa đơn thay thế/điều chỉnh/hủy: ${rows.length}/${res.rows.length} hóa đơn` });
  }
  // Filter selected invoices first, then reserve only what is actually eligible.
  // Do not count already charged invoices against remaining quota.
  if (packageAccess.mode === 'invoice') {
    const claim = await claimInvoiceQuota(rows, profile.mst);
    rows = claim.rows;
    send({ type: 'log', level: claim.denied ? 'warn' : 'ok',
      text: 'Đã ghi nhận '+claim.deducted+' lượt mới; '+claim.previously+
        ' hóa đơn đã trừ từ trước được đọc lại miễn phí.'+
        (claim.denied ? ' '+claim.denied+' hóa đơn không đủ lượt, đã bỏ qua.' : '') });
  }
  await updateInvoiceHistory(rows, profile.mst, 'searched');
  const count = (k, f) => rows.filter((r) => r.kind === k && (!f || r.form === f)).length;
  // Mỗi loại 1 phần; chọn cả 2 hình thức thì tách thêm điện tử / máy tính tiền
  const byForm = (k) => (forms.length > 1 ? ` (${forms.map((f) => `${f === 'mtt' ? 'máy tính tiền' : 'điện tử'} ${count(k, f)}`).join(', ')})` : '');
  const found = kinds.map((k) => `${HDDT.KINDS[k].act} ${count(k)}${byForm(k)}`).join('; ');
  send({ type: 'log', level: 'ok', text: `Tìm thấy ${rows.length} hóa đơn: ${found}` });
  send({ type: 'summary', total: rows.length, purchase: count('purchase'), sold: count('sold') });
  if (!rows.length) return send({ type: 'done', total: 0, saved: 0, errors: 0, stopped: res.stopped });

  // 2. Chi tiết từng hóa đơn, gom zip theo loại + tháng.
  // Hóa đơn không mã (ttxly 6): cổng không lưu XML gốc → chỉ gọi API chi tiết khi cần dòng hàng hóa cho Excel.
  // PDF: bản thể hiện tự dựng trên máy từ XML (HĐ không mã: JSON chi tiết), không phải PDF gốc của nhà cung cấp
  const needDetail = formats.xml || formats.html || formats.pdf || formats.lines;
  const details = new Map();
  let errors = 0, saved = 0, done = 0;
  if (needDetail && !res.stopped) {
    const order = rows.filter((r) => formats.lines || formats.pdf || r.ttxly !== 6)
      .sort((a, b) => `${a.kind}|${a.month}|${a.form}`.localeCompare(`${b.kind}|${b.month}|${b.form}`));
    let bucket = null, files = [], bytes = 0, part = 1, bucketInvoiceFormats = new Map();
    const flush = async (last) => {
      if (!bucket || !files.length) return;
      const [kind, month] = bucket.split('|');
      // Zip quá lớn (gói HTML ~300 KB/hóa đơn) → tách phần để không vượt giới hạn truyền dữ liệu của Chrome
      const suffix = part > 1 || !last ? `_phan${part}` : '';
      await save(Zip.writeZip(files), 'application/zip', `${dir}/${HDDT.KINDS[kind].folder}_${month}${suffix}.zip`);
      const keys = new Set(bucketInvoiceFormats.keys());
      if (keys.size) {
        const downloadedRows = rows.filter(r => keys.has(invoiceHistoryKey(r, profile.mst)));
        await updateInvoiceHistory(downloadedRows, profile.mst, 'downloaded', Object.fromEntries(bucketInvoiceFormats));
        // Quota was already reserved atomically before any invoice was read.
      }
      saved++; files = []; bytes = 0; bucketInvoiceFormats = new Map(); part++;
    };
    const add = (name, data) => { files.push({ name, data }); bytes += data.length; };
    for (const row of order) {
      if (stopFlag) break;
      const b = `${row.kind}|${row.month}`;
      if (b !== bucket) { await flush(true); bucket = b; part = 1; }
      if (bytes > ZIP_PART_BYTES) await flush(false);
      // Bán cho khách lẻ thường không có MST người mua → "KhachLe"
      const base = safeName(`${(row.kind === 'purchase' ? row.nbmst : row.nmmst) || 'KhachLe'}_${row.khmshdon}${row.khhdon}_${row.shdon}`);
      const sub = HDDT.FORMS[row.form].ep === 'sco-query' ? 'MayTinhTien/' : '';
      try {
        const inv = await HDDT.fetchInvoice(row, shouldStop,
          (w) => send({ type: 'status', text: `Đang tải chi tiết ${done + 1}/${order.length}: ${waitText(w)}` }));
        // head (chữ ký số, ngày ký, hình thức thanh toán…) dùng cho DS hóa đơn + Kiểm tra rủi ro HĐ; dòng hàng chỉ giữ khi cần
        details.set(row.key, { source: inv.source, head: inv.head, ...(formats.lines ? { lines: inv.lines, fees: inv.fees } : {}) });
        const invoiceFormats = {};
        if (inv.source === 'xml') {
          // Nguyên bytes gốc của cổng (không giải mã/mã hóa lại) để mở được bằng phần mềm của Cục Thuế
          if (formats.xml && inv.xml) { add(`XML/${sub}${base}.xml`, inv.xml); invoiceFormats.xml = true; }
          // HTML: chỉ ghi nhận khi thực sự thêm được ít nhất một tệp HTML/tài nguyên vào ZIP.
          if (formats.html) for (const [n, data] of Object.entries(inv.files || {})) if (!/\\.xml$/i.test(n)) {
            add(`HTML/${sub}${base}/${n}`, data); invoiceFormats.html = true;
          }
        } else if (row.ttxly !== 6 && (formats.xml || formats.html)) {
          send({ type: 'log', level: 'warn', text: `${row.khhdon}-${row.shdon}: cổng không trả được XML gốc (chỉ có trong Excel${formats.pdf ? ', PDF' : ''})` });
        }
        if (formats.pdf) {
          try {
            const pdf = await Pdf.buildInvoicePdf(row, inv, HDDT.originalLookup(row, inv.head));
            if (pdf) { add(`PDF/${sub}${base}.pdf`, pdf); invoiceFormats.pdf = true; }
          } catch (e) {
            send({ type: 'log', level: 'warn', text: `${row.khhdon}-${row.shdon}: không dựng được PDF (${e.message})` });
          }
        }
        // Lưu chính xác các định dạng hóa đơn đã đóng góp tệp vào ZIP.
        if (Object.values(invoiceFormats).some(Boolean)) bucketInvoiceFormats.set(invoiceHistoryKey(row, profile.mst), invoiceFormats);
      } catch (e) {
        if (e.status === 401) throw e;
        if (stopFlag) break; // Dừng: request đang chờ bị hủy, không tính là lỗi
        errors++;
        const mst = row.kind === 'purchase' ? row.nbmst : row.nmmst;
        send({ type: 'log', level: 'error', text: `Không tải được hóa đơn ${row.khhdon}-${row.shdon} (${mst ? `MST ${mst}` : 'khách lẻ'}): ${e.message}` });
      }
      send({ type: 'progress', done: ++done, total: order.length });
      await HDDT.sleep(HDDT.DELAY);
    }
    await flush(true);
    const khongMa = rows.filter((r) => r.ttxly === 6).length;
    if (khongMa && (formats.xml || formats.html)) send({ type: 'log', text: `${khongMa} hóa đơn không mã (ký hiệu bắt đầu bằng K): cổng thuế không lưu file XML/HTML gốc nên chỉ có trong Excel – bình thường, không phải lỗi` });
  }

  // 3. Sheet HĐ thay thế / điều chỉnh: cần dòng hàng của cả 2 hóa đơn → tải thêm HĐ thay thế/điều chỉnh chưa có chi tiết
  // và hóa đơn gốc (kể cả gốc nằm ngoài khoảng ngày). Thường chỉ vài hóa đơn nên tải luôn, tuần tự như bước 2.
  const originals = new Map();
  if (formats.excel && sheets.adjust && !stopFlag && !res.stopped) {
    const adj = rows.filter((r) => Report.isAdjusting(r));
    const { unique: byRef, ambiguous: ambiguousRefs } = Report.indexByRef(rows);
    const todo = [];
    for (const r of adj) {
      if (!details.get(r.key)?.lines) todo.push({ row: r, get: () => HDDT.fetchInvoice(r, shouldStop), put: (inv) => details.set(r.key, { source: inv.source, head: inv.head, lines: inv.lines, fees: inv.fees }) });
      const k = Report.refKey(r.gocRef), inRange = byRef.get(k);
      if (ambiguousRefs.has(k)) { originals.set(k, { ambiguous: true }); continue; }
      if (inRange ? details.get(inRange.key)?.lines || todo.some((t) => t.row === inRange) : originals.has(k)) continue;
      if (inRange) todo.push({ row: inRange, get: () => HDDT.fetchInvoice(inRange, shouldStop), put: (inv) => details.set(inRange.key, { source: inv.source, head: inv.head, lines: inv.lines, fees: inv.fees }) });
      else { originals.set(k, null); todo.push({ row: r, gocOf: true, originalKey: k, get: () => HDDT.fetchOriginal(r, shouldStop), put: (inv) => originals.set(k, inv) }); }
    }
    let i = 0;
    for (const t of todo) {
      if (stopFlag) break;
      send({ type: 'status', text: `Đang tải hóa đơn gốc để so sánh HĐ thay thế/điều chỉnh ${++i}/${todo.length}` });
      try { t.put(await t.get()); } catch (e) {
        if (e.status === 401) throw e;
        if (stopFlag) break;
        if (t.gocOf && t.originalKey) originals.set(t.originalKey, { error: e.message || 'Lỗi không xác định' });
        const ref = t.gocOf ? t.row.goc : `${t.row.khhdon}-${t.row.shdon}`;
        send({ type: 'log', level: 'warn', text: `Không tải được hóa đơn ${t.gocOf ? 'gốc ' : ''}${ref}: ${e.message}` });
      }
      await HDDT.sleep(HDDT.DELAY);
    }
  }

  // 3b. Sheet Kiểm tra rủi ro MST: đối chiếu MST người bán (mua vào) / người mua (bán ra) với danh sách công khai sử dụng hóa đơn
  // không hợp pháp của cổng (cache trên máy, tra gộp nhiều MST / request). Lỗi → chỉ cảnh báo, Excel vẫn lưu.
  let illegal = null;
  if (formats.excel && sheets.seller && !stopFlag && !res.stopped) {
    const msts = rows.map((r) => (r.kind === 'purchase' ? r.nbmst : r.nmmst)).filter(Boolean);
    try {
      illegal = await HDDT.illegalCheck(msts, { shouldStop, onStatus: (text) => send({ type: 'status', text }) });
      const hits = Object.values(illegal).filter((e) => e.recs.length).length;
      send({ type: 'log', level: hits ? '' : 'ok', text: hits ? `${hits} người bán/người mua có tên trong danh sách sử dụng hóa đơn không hợp pháp của Cục Thuế – xem cột "Kiểm tra rủi ro MST" trong Excel` : 'Không người bán/người mua nào có tên trong danh sách sử dụng hóa đơn không hợp pháp của Cục Thuế' });
    } catch (e) {
      if (e.status === 401) throw e;
      if (!stopFlag) send({ type: 'log', level: 'warn', text: `Không đối chiếu được danh sách công khai hóa đơn không hợp pháp: ${e.message}` });
    }
  }

  // 4. Excel bảng kê (kể cả khi đã bấm Dừng: lưu với dữ liệu đã có)
  if (formats.excel) {
    const name = `${dir}/BangKe_${kinds.map((k) => HDDT.KINDS[k].folder).join('-')}_${isoOf(tuNgay)}_${isoOf(denNgay)}.xlsx`;
    const book = Report.buildSheets(rows, details, { withLines: formats.lines, withPdf: formats.pdf, sheets, originals, illegal, tuNgay, denNgay, mst: profile.mst, company: profile.company,
      kinds, adjOnly, skipped: res.skipped || [], stopped: stopFlag || res.stopped });
    await save(Xlsx.buildXlsx(book), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name);
    // Excel invoices were already included in the quota claim before export.
    // 1 dòng: số sheet + tóm tắt rủi ro (chỉ nêu khi có cảnh báo / lưu ý)
    const risk = book.find((x) => x.summary)?.summary;
    const flags = risk ? [risk.bad && `${risk.bad} hóa đơn bị cảnh báo`, risk.warn && `${risk.warn} hóa đơn cần lưu ý`].filter(Boolean).join(', ') : '';
    send({ type: 'log', level: 'ok', text: `Đã lưu file Excel bảng kê (${book.length} sheet)` });
    if (flags) send({ type: 'log', text: `Có ${flags} – xem lý do trong sheet "Kiểm tra rủi ro HĐ"` });
    else if (risk) send({ type: 'log', level: 'ok', text: 'Kiểm tra rủi ro: tất cả hóa đơn hợp lệ' });
    for (const note of book.notes || []) send({ type: 'log', level: 'warn', text: note });
    saved++;
  }
  // Offline MISA/Tendoo warehouse export. Unmatched goods keep the invoice name
  // and use THIẾU MÃ, so the user can correct the import before submitting it.
  if(sheets.tendoo&&formats.excel&&!stopFlag&&!res.stopped){
    try{
      if(!tendoo?.products?.length||!tendoo?.template?.headers?.length)
        throw new Error('Thiếu danh mục sản phẩm hoặc mẫu nhập kho tích hợp.');
      const purchases=rows.filter(r=>r.kind==='purchase');
      if(!purchases.length)throw new Error('Không có hóa đơn mua vào trong khoảng ngày này.');
      const skuLinks={...(tendoo.links||{})};
      const unknown=TendooImport.missing(purchases,details,tendoo.products,skuLinks);
      if(unknown.length){
        send({type:'log',level:'warn',text:'Có '+unknown.length+
          ' tên hàng chưa khớp danh mục. Có thể bỏ qua để Excel ghi THIẾU MÃ.'});
        const match=await linkSku(unknown);
        if(match?.cancel)throw new Error('Đã hủy xuất nhập kho.');
        Object.assign(skuLinks,match?.mapping||{});
      }
      const packageFile=TendooImport.makePackage(purchases,details,tendoo.products,
        tendoo.template,skuLinks,tendoo.settings||{});
      const platform=tendoo.template.platform==='misa'?'MISA':'Tendoo';
      await save(packageFile.zip,'application/zip',dir+'/'+platform+'_NhapKho_'+
        isoOf(tuNgay)+'_'+isoOf(denNgay)+'.zip');
      if(platform==='MISA'&&packageFile.lastIssued)
        await chrome.storage.local.set({autotax_misa_last_document_v1:packageFile.lastIssued});
      saved++;
      send({type:'log',level:'ok',text:platform+': đã xuất '+packageFile.count+
        ' file nhập kho Excel, mỗi hóa đơn một file trong ZIP.'});
      if(packageFile.missing)send({type:'log',level:'warn',text:
        packageFile.missing+' tên hàng chưa khớp: đã giữ tên và ghi THIẾU MÃ trong file.'});
      if(packageFile.skipped)send({type:'log',level:'warn',text:
        packageFile.skipped+' hóa đơn không có chi tiết hàng, chưa xuất nhập kho.'});
    }catch(e){errors++;send({type:'log',level:'warn',
      text:'Không tạo được ZIP nhập kho: '+e.message})}
  }
  send({ type: 'done', total: rows.length, saved, errors, stopped: stopFlag || res.stopped, dir });
}

// The job runs in the GDT page's content script, independent of sidepanel life.
// Keep the GDT tab open during downloads; reloading it will terminate the job.
const jobPorts=new Set(),pendingSku=new Map(),jobEvents=[];
function sendJob(event){
  if(event.type==='progress'||event.type==='status'){
    for(let i=jobEvents.length-1;i>=0;i--)
      if(jobEvents[i].type===event.type)jobEvents.splice(i,1);
  }
  jobEvents.push(event);
  if(jobEvents.length>250)jobEvents.splice(0,jobEvents.length-250);
  for(const port of [...jobPorts]){
    try{port.postMessage(event)}catch{jobPorts.delete(port)}
  }
}
function finishSkuMapping(msg){
  const task=pendingSku.get(msg.requestId);
  if(!task)return false;
  clearTimeout(task.timeout);pendingSku.delete(msg.requestId);
  task.resolve(msg);return true;
}
function linkSku(names){
  if(!jobPorts.size)return Promise.resolve({mapping:{}});
  return new Promise(resolve=>{
    const requestId='tendoo-map-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    const timeout=setTimeout(()=>{
      pendingSku.delete(requestId);resolve({mapping:{}});
      sendJob({type:'log',level:'warn',text:'Hết thời gian ánh xạ; tiếp tục xuất với mã THIẾU MÃ.'});
    },900000);
    pendingSku.set(requestId,{resolve,timeout,keepTab:false});
    sendJob({type:'tendoo-map-request',requestId,names});
  });
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async()=>{
    switch(msg.type){
      case 'info':return {...await HDDT.getSessionInfo(),busy};
      case 'stop':stopFlag=true;return {ok:true};
      case 'tendoo-map-response':return {ok:finishSkuMapping(msg)};
    }
  })().then(reply,e=>reply({error:e.message}));
  return true;
});
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='job')return;
  jobPorts.add(port);
  port.onDisconnect.addListener(()=>{
    jobPorts.delete(port);
    if(!jobPorts.size){
      for(const [id,task] of pendingSku){
        if(task.keepTab)continue;
        clearTimeout(task.timeout);pendingSku.delete(id);task.resolve({mapping:{}});
      }
    }
  });
  port.onMessage.addListener(async msg=>{
    if(msg.type==='attach'){
      for(const event of jobEvents)try{port.postMessage(event)}catch{break}
      return;
    }
    if(msg.type==='tendoo-mapping-tab-open'){
      const task=pendingSku.get(msg.requestId);
      if(task)task.keepTab=true;
      return;
    }
    if(msg.type==='tendoo-map-response'){finishSkuMapping(msg);return}
    if(msg.type!=='run')return;
    if(busy)return sendJob({type:'log',level:'warn',
      text:'Đang có tác vụ chạy, hãy đợi hoặc bấm Dừng.'});
    busy=true;jobEvents.length=0;sendJob({type:'run-started'});
    try{await runJob(msg,sendJob,linkSku)}
    catch(e){sendJob({type:'error',text:e.message})}
    finally{busy=false;sendJob({type:'idle'})}
  });
});
