// Dựng các sheet Excel từ danh sách hóa đơn (+ dòng hàng hóa, chữ ký số… nếu đã tải chi tiết).
// DS hóa đơn · Chi tiết sản phẩm (chưa thuế + thuế + phí = tổng thanh toán) · Kiểm tra rủi ro HĐ · Kiểm tra rủi ro MST · HĐ thay thế, điều chỉnh
// (so sánh ngang với HĐ gốc) · Phụ lục giảm thuế GTGT · Bảng kê HĐKD (hộ kinh doanh) · Tờ khai 01/GTGT (tham khảo). Sheet thêm do người dùng chọn.
(() => {
  const pad = (n) => String(n).padStart(2, '0');
  // tdlap của cổng là giờ UTC (vd 2026-09-29T17:00:00Z = 30/09 giờ VN) → đổi sang ngày theo giờ máy
  const dateVN = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const sortKey = (r) => `${r.tdlap || ''}|${r.khhdon}|${String(r.shdon).padStart(10, '0')}`;
  const sorted = (rows) => rows.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const partner = (r) => (r.kind === 'purchase' ? [r.nbmst, r.nbten] : [r.nmmst, r.nmten]);
  // Cộng số tiền có phần lẻ (vd tiền thuế .6) → làm tròn 2 chữ số để tránh sai số dấu phẩy động
  const round2 = (n) => Math.round(n * 100) / 100;
  const total = (list, f) => round2(list.reduce((s, x) => s + (f(x) || 0), 0));

  // Tiền của 1 hóa đơn. Hóa đơn không có thuế GTGT (hóa đơn bán hàng mẫu 2, máy tính tiền của hộ kinh doanh):
  // cổng để trống tiền chưa thuế và tiền thuế, chỉ có tổng thanh toán → chưa thuế = tổng − phí, thuế = 0.
  function money(r) {
    const phi = r.tgtphi || 0;
    if (r.tgtcthue === null && r.tgtthue === null && r.tgtttbso !== null) {
      return { cthue: round2(r.tgtttbso - phi), thue: 0, phi, tong: r.tgtttbso, khongThue: true };
    }
    return { cthue: r.tgtcthue, thue: r.tgtthue, phi, tong: r.tgtttbso, khongThue: false };
  }
  // Phụ lục giảm thuế cộng theo VND: hóa đơn ngoại tệ nhân tỷ giá
  const foreign = (r) => !!(r.dvtte && r.dvtte !== 'VND' && r.tgia);
  const vnd = (r, v) => (v === null ? null : foreign(r) ? Math.round(v * r.tgia) : v);
  // Không đưa vào phụ lục giảm thuế: hóa đơn đã bị thay thế / đã bị hủy (tthai 4, 6) và chứng từ không có tiền
  // (vd phiếu xuất kho kiêm vận chuyển nội bộ, mẫu số 6)
  const counted = (r) => r.tthai !== 4 && r.tthai !== 6 && (r.tgtcthue !== null || r.tgtttbso !== null);

  const T = 'text', N = 'int', D = 'number', P = 'pct';
  const INVOICE_COLS = [
    { header: 'STT', width: 6, type: N }, { header: 'Loại', width: 9 }, { header: 'Hình thức', width: 15 },
    { header: 'Kết quả kiểm tra', width: 22 }, { header: 'Mẫu số', width: 8 }, { header: 'Ký hiệu', width: 10 },
    { header: 'Số hóa đơn', width: 11, type: T }, { header: 'Ngày lập', width: 11 },
    { header: 'MST người bán', width: 15, type: T }, { header: 'Tên người bán', width: 40 },
    { header: 'MST người mua', width: 15, type: T }, { header: 'Tên người mua', width: 40 },
    { header: 'Tiền chưa thuế', width: 16, type: N }, { header: 'Tiền thuế', width: 14, type: N },
    { header: 'Tiền phí', width: 12, type: N }, { header: 'Tổng thanh toán', width: 16, type: N },
    { header: 'Tiền tệ', width: 8 }, { header: 'Tỷ giá', width: 10, type: D },
    { header: 'Trạng thái', width: 22 }, { header: 'Hóa đơn gốc', width: 18 },
    { header: 'Ngày ký', width: 11 }, { header: 'Hình thức thanh toán', width: 14 }, { header: 'XML gốc', width: 18 },
    { header: 'Nhà cung cấp HĐĐT', width: 18 }, { header: 'Mã tra cứu', width: 18, type: T },
  ];
  // Chỉ khi chọn PDF: link tự mở tải PDF gốc ở cổng tra cứu của nhà cung cấp (extension không tự vào các cổng này – đa số có captcha)
  const PDF_COLS = [{ header: 'Link tra cứu HĐ gốc', width: 30 }];
  // Thông tin chỉ có khi đã tải chi tiết (XML): ngày ký số, hình thức thanh toán, mã + link tra cứu của nhà cung cấp
  const headOf = (details, r) => details.get(r.key)?.head || null;
  const signDate = (h) => (h?.seller?.time ? dateVN(h.seller.time) : '');
  const xmlState = (details, r) => {
    const d = details.get(r.key);
    if (r.ttxly === 6) return 'Không (HĐ không mã)';
    return d ? (d.source === 'xml' ? 'Có' : 'Không') : '';
  };

  // Link mở được bằng 1 cú bấm trong Excel (HYPERLINK chỉ nhận ≤ 255 ký tự → link dài hơn để dạng chữ)
  const linkCell = (o) => (o.link ? (o.link.length <= 255 ? { link: o.link } : o.link) : '');

  function invoiceSheet(name, rows, details, withPdf, mstCheck, illegal) {
    const list = sorted(rows).map((r) => ({ r, m: money(r) }));
    const sum = (k) => total(list, (x) => x.m[k]);
    return {
      name, columns: [...INVOICE_COLS, ...(withPdf ? PDF_COLS : []), ...(mstCheck ? MST_COLS : [])], totalRow: true,
      rows: [
        ...list.map(({ r, m }, i) => [i + 1, HDDT.KINDS[r.kind].label, HDDT.FORMS[r.form].label, HDDT.TTXLY[r.ttxly] || '', r.khmshdon, r.khhdon,
          String(r.shdon), dateVN(r.tdlap), r.nbmst, r.nbten, r.nmmst, r.nmten, m.cthue, m.thue, m.phi || null, m.tong, r.dvtte,
          r.dvtte !== 'VND' ? r.tgia : null, HDDT.TTHAI[r.tthai] || '', r.goc,
          signDate(headOf(details, r)), headOf(details, r)?.httt || r.httt || '', xmlState(details, r),
          ...((o) => [o.name, o.code, ...(withPdf ? [linkCell(o)] : [])])(HDDT.originalLookup(r, headOf(details, r))),
          ...(mstCheck ? mstRisk(r, illegal) : [])]),
        ['', 'Tổng', '', '', '', '', '', '', '', '', '', '', sum('cthue'), sum('thue'), sum('phi'), sum('tong')],
      ],
    };
  }

  // Thuế suất dạng "8%" / "8.0%" / "8,0%" → 8; KCT, KKKNT, rỗng → null
  const pctOf = (s) => { const m = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(String(s ?? '').trim()); return m ? Number(m[1].replace(',', '.')) : null; };
  const pctName = (s) => { const p = pctOf(s); return p === null ? s || '' : `${p}%`; };
  // Làm tròn đối xứng cho số âm (dòng chiết khấu): −0,5 → −1 như +0,5 → +1
  const roundVND = (v) => Math.sign(v) * Math.round(Math.abs(v));
  // Bảng thuế suất của hóa đơn (bỏ nhóm không có tiền). Hóa đơn không có thttltsuat → suy từ thuế / chưa thuế.
  function ratesOf(r) {
    if (r.rates.length) return r.rates.filter((x) => x.thtien || x.tthue).map((x) => ({ ...x, tsuat: pctName(x.tsuat) }));
    const m = money(r), g = m.khongThue ? KXD : guessRate(m);
    return g === KXD ? [] : [{ tsuat: g, thtien: m.cthue, tthue: m.thue }];
  }

  const FEE_NAMES = { OtherTaxes: 'Thuế, phí khác', OtherFees: 'Phí khác' };
  // Dòng hàng hóa của 1 hóa đơn + dòng phí, lệ phí (nằm ngoài danh sách hàng hóa nhưng có trong tổng thanh toán).
  function invoiceLines(r, d) {
    const lines = d.lines.map((l) => ({ ...l, tsuat: pctName(l.tsuat) }));
    const rates = ratesOf(r);
    // Có phần mềm hóa đơn không ghi thuế suất / tiền thuế ở từng dòng (chỉ ghi ở bảng tổng hợp thuế suất):
    // hóa đơn 1 thuế suất → dòng lấy thuế suất đó; nhiều thuế suất → nhóm duy nhất còn thiếu thành tiền.
    const blank = lines.filter((l) => !l.tsuat && l.thtien && l.tchat !== 'Ghi chú, diễn giải');
    if (blank.length && rates.length) {
      const left = rates.filter((x) => Math.abs((x.thtien || 0) - total(lines.filter((l) => l.tsuat === x.tsuat), (l) => l.thtien)) >= 1);
      const pick = rates.length === 1 ? rates[0] : left.length === 1 ? left[0] : null;
      if (pick) for (const l of blank) { l.tsuat = pick.tsuat; l.tsuatSuy = true; }
    }
    // Dòng có thuế suất nhưng không có tiền thuế (kể cả JSON chi tiết) → tự tính thành tiền × thuế suất.
    // Dòng vừa suy thuế suất mà tiền thuế ghi 0 (trường để trống) cũng tính lại.
    for (const l of lines) {
      const p = pctOf(l.tsuat);
      if ((l.tthue === null || (l.tsuatSuy && l.tthue === 0 && p)) && p !== null && l.thtien !== null) { l.tthue = roundVND((l.thtien * p) / 100); l.tthueTinh = true; }
    }
    // Tiền thuế tự tính từng dòng có thể lệch 1–2 đồng do làm tròn → bù vào dòng cuối của thuế suất đó
    // để khớp tiền thuế theo thuế suất trên hóa đơn (thttltsuat).
    for (const x of rates) {
      if (x.tthue === null) continue;
      const same = lines.filter((l) => l.tsuat === x.tsuat);
      const tinh = same.filter((l) => l.tthueTinh);
      const diff = round2(x.tthue - total(same, (l) => l.tthue));
      if (diff && tinh.length && Math.abs(diff) <= tinh.length) tinh[tinh.length - 1].tthue += diff;
    }
    const fees = (d.fees || []).map((p) => ({ ten: FEE_NAMES[p.ten] || p.ten || 'Phí, lệ phí', tien: p.tien }));
    // JSON chi tiết (hóa đơn không mã) không có danh sách phí → lấy phần còn thiếu từ tgtphi của danh sách
    const thieu = round2((r.tgtphi || 0) - total(fees, (p) => p.tien));
    if (thieu > 0) fees.push({ ten: 'Phí, lệ phí', tien: thieu });
    return [...lines, ...fees.map((p) => ({ tchat: 'Phí, lệ phí', ten: p.ten, dvt: '', sl: null, dgia: null, ck: null, thtien: p.tien, tsuat: '', tthue: null }))];
  }

  // Chi tiết của hóa đơn có dòng hàng hóa (details có thể chỉ có head khi không chọn Chi tiết sản phẩm)
  const withLinesOf = (details, r) => { const d = details.get(r.key); return d?.lines ? d : null; };

  function linesSheet(rows, details) {
    const out = [];
    let sThtien = 0, sThue = 0;
    for (const r of sorted(rows)) {
      const d = withLinesOf(details, r);
      if (!d) continue;
      const [mst, ten] = partner(r);
      for (const l of invoiceLines(r, d)) {
        // Tiền thuế làm tròn đồng (hóa đơn có thể ghi lẻ, vd 1.755.555,56); thuế suất ghi số % để Excel tính được
        const p = pctOf(l.tsuat), thue = l.tthue === null ? null : roundVND(l.tthue);
        out.push([out.length + 1, HDDT.KINDS[r.kind].label, r.khmshdon, r.khhdon, String(r.shdon), dateVN(r.tdlap), mst, ten,
          l.tchat, l.ten, l.dvt, l.sl, l.dgia, l.ck, l.thtien, p === null ? l.tsuat : p / 100, thue]);
        sThtien += l.thtien || 0; sThue += thue || 0;
      }
    }
    out.push(['', 'Tổng', '', '', '', '', '', '', '', '', '', '', '', '', round2(sThtien), '', round2(sThue)]);
    return {
      name: 'Chi tiết sản phẩm', totalRow: true,
      columns: [
        { header: 'STT', width: 6, type: N }, { header: 'Loại', width: 9 }, { header: 'Mẫu số', width: 8 }, { header: 'Ký hiệu', width: 10 },
        { header: 'Số hóa đơn', width: 11, type: T }, { header: 'Ngày lập', width: 11 }, { header: 'MST đối tác', width: 15, type: T },
        { header: 'Tên đối tác', width: 36 }, { header: 'Tính chất', width: 18 }, { header: 'Tên hàng hóa, dịch vụ', width: 48 },
        { header: 'ĐVT', width: 9 }, { header: 'Số lượng', width: 11, type: D }, { header: 'Đơn giá', width: 14, type: D },
        { header: 'Chiết khấu', width: 12, type: N }, { header: 'Thành tiền', width: 16, type: N }, { header: 'Thuế suất', width: 10, type: P },
        { header: 'Tiền thuế', width: 14, type: N },
      ],
      rows: out,
    };
  }

  const KXD = 'Không xác định';
  // Hóa đơn không có bảng thuế suất (thttltsuat) nhưng có tiền thuế → suy ra thuế suất từ tỷ lệ thuế / chưa thuế
  function guessRate(m) {
    if (!m.cthue || !m.thue) return KXD;
    const p = (m.thue / m.cthue) * 100;
    const hit = [5, 8, 10].find((x) => Math.abs(p - x) < 0.05);
    return hit ? `${hit}%` : KXD;
  }

  // Phụ lục giảm thuế GTGT: y hệt sheet "Bang ke" của mẫu tải lên HTKK (Bang_Ke_01_GiamThue_GTGT_NQ142_GTGT_TT80.xls),
  // chỉ cột B–G để tải thẳng lên HTKK. Dòng 1–22 ẩn; mục I mua vào 8% ((3) giá trị, (4) thuế được khấu trừ),
  // dữ liệu từ dòng 30; mục II bán ra 8% ((4) = 10, (5) = 8, (6) = (3) × [(4) − (5)]) nối ngay sau.
  // Không tải chi tiết hàng hóa → 1 dòng / hóa đơn theo bảng thuế suất.
  const SAU_GIAM = 8, THEO_QD = 10, TEN_MAX = 150; // HTKK: tên hàng hóa tối đa 150 ký tự
  // HTKK chỉ nhận (3), (4) > 0 → dòng âm (chiết khấu thương mại) trừ vào giá trị, tiền thuế các dòng hàng
  // cùng hóa đơn theo tỷ lệ giá trị; phần lẻ làm tròn dồn vào dòng lớn nhất. Chiết khấu lớn hơn tiền hàng
  // (vd hóa đơn chỉ có chiết khấu) → giữ nguyên dòng âm.
  function netDiscount(items) {
    const pos = items.filter((l) => l.thtien > 0), neg = items.filter((l) => l.thtien < 0);
    const P = total(pos, (l) => l.thtien), N = total(neg, (l) => l.thtien);
    if (!neg.length || !pos.length || P + N <= 0) return items;
    const out = pos.map((l) => ({ ...l })), w = pos.map((l) => l.thtien / P); // tỷ lệ theo giá trị trước khi trừ
    const big = out.reduce((a, b) => (b.thtien > a.thtien ? b : a));
    for (const k of ['thtien', 'tthue']) {
      const tru = total(neg, (l) => l[k]);
      let used = 0;
      out.forEach((l, i) => { if (l !== big) { const x = roundVND(tru * w[i]); l[k] = (l[k] || 0) + x; used += x; } });
      big[k] = round2((big[k] || 0) + tru - used);
    }
    return out;
  }
  function items8(r, details) {
    const d = withLinesOf(details, r);
    const items = d ? invoiceLines(r, d).filter((l) => pctOf(l.tsuat) === SAU_GIAM && l.thtien) : [];
    if (items.length) return netDiscount(items);
    return ratesOf(r).filter((x) => pctOf(x.tsuat) === SAU_GIAM).map((x) => ({ ten: '', thtien: x.thtien, tthue: x.tthue }));
  }

  const SECTIONS = [
    { kind: 'purchase', title: 'I. Hàng hóa, dịch vụ mua vào trong kỳ được áp dụng mức thuế suất thuế giá trị gia tăng 8% (áp dụng cho người nộp thuế kê khai theo phương pháp khấu trừ thuế)',
      heads: ['STT', 'Tên hàng hóa, dịch vụ', 'Giá trị hàng hóa, dịch vụ mua vào chưa có thuế GTGT được khấu trừ trong kỳ', 'Thuế GTGT của hàng hóa, dịch vụ mua vào được khấu trừ trong kỳ'],
      codes: ['(1)', '(2)', '(3)', '(4)'], hts: [19.5, 15.75, 21.75] },
    { kind: 'sold', title: 'II. Hàng hóa, dịch vụ bán ra trong kỳ',
      heads: ['STT', 'Tên hàng hóa, dịch vụ', 'Giá trị hàng hóa, dịch vụ chưa có thuế GTGT', 'Thuế suất thuế GTGT theo quy định', 'Thuế suất  thuế GTGT sau giảm', 'Thuế GTGT của hàng hóa, dịch vụ bán ra được giảm'],
      codes: ['(1)', '(2)', '(3)', '(4)', '(5)=(4)x80%', '(6)=(3)x[(4)-(5)]'], hts: [40.5, 15.75, 31.95] },
  ];
  function reductionSheet(rows, details) {
    const out = [], rowProps = new Map(), merges = [];
    const push = (cells, props) => { if (props) rowProps.set(out.length, props); out.push(cells); };
    for (let i = 0; i < 22; i++) push([], { ht: 15.75, hidden: true }); // vùng ẩn của mẫu HTKK
    push([]); push([]);
    for (const sec of SECTIONS) {
      push([null, { v: sec.title, s: 'title' }], { ht: 15.75 });
      const top = out.length + 1; // số dòng Excel của dòng tiêu đề đầu tiên
      sec.hts.forEach((ht, i) => push([null, ...sec.heads.map((v) => ({ v: i ? '' : v, s: 'head' }))], { ht }));
      sec.heads.forEach((_, j) => { const c = 'BCDEFG'[j]; merges.push(`${c}${top}:${c}${top + 2}`); });
      push([null, ...sec.codes.map((v) => ({ v, s: 'head' }))], { ht: 15.75 });
      let stt = 0;
      for (const r of sorted(rows)) {
        if (r.kind !== sec.kind || !counted(r)) continue;
        for (const l of items8(r, details)) {
          // HTKK nhận số nguyên đồng → làm tròn giá trị, tiền thuế (hóa đơn có thể ghi lẻ, vd 40.740.740,74)
          const gt = roundVND(vnd(r, l.thtien) || 0), ten = (l.ten || `Hàng hóa, dịch vụ theo hóa đơn ${r.khhdon}-${r.shdon}`).slice(0, TEN_MAX);
          const cells = sec.kind === 'purchase'
            ? [{ v: ten, s: 'text' }, { v: gt, s: 'int' }, { v: roundVND(vnd(r, l.tthue) || 0), s: 'int' }]
            : [{ v: ten, s: 'text' }, { v: gt, s: 'int' }, { v: THEO_QD, s: 'int' }, { v: SAU_GIAM, s: 'dec' }, { v: roundVND((gt * (THEO_QD - SAU_GIAM)) / 100), s: 'int' }];
          push([null, { v: ++stt, s: 'stt' }, ...cells], { ht: 15 });
        }
      }
    }
    return { name: 'Phụ lục giảm thuế GTGT', layout: true, rows: out, rowProps, merges, widths: [3.9, 9.1, 43.3, 19.9, 22.6, 10.3, 23.9] };
  }

  // ---- Kiểm tra rủi ro HĐ: chỉ dùng dữ liệu hóa đơn đã tải từ cổng ----
  // Chữ ký số: chỉ kiểm có chữ ký trong XML + MST trên chứng thư, KHÔNG xác thực mật mã.
  const OK = 0, WARN = 1, BAD = 2, LEVEL = ['Hợp lệ', 'Lưu ý', 'Cảnh báo'];
  const fmtVND = (n) => Math.round(n).toLocaleString('vi-VN');
  const base10 = (mst) => String(mst || '').slice(0, 10);
  // So sánh tên không phân biệt dấu, hoa thường, dấu câu, viết tắt loại hình (hóa đơn thật hay ghi
  // "CÔNG TY TRÁCH NHIỆM HỮU HẠN" trong khi tên đăng ký là "CÔNG TY TNHH")
  const ABBR = [[/\bCONG TY\b/g, 'CTY'], [/\bTRACH NHIEM HUU HAN\b/g, 'TNHH'], [/\bCO PHAN\b/g, 'CP'], [/\bMOT THANH VIEN\b/g, 'MTV'],
    [/\bDOANH NGHIEP TU NHAN\b/g, 'DNTN'], [/\bCHI NHANH\b/g, 'CN'], [/\bTHUONG MAI\b/g, 'TM'], [/\bDICH VU\b/g, 'DV'],
    [/\bXUAT NHAP KHAU\b/g, 'XNK'], [/\bSAN XUAT\b/g, 'SX'], [/\bVIET ?NAM\b/g, 'VN']];
  const plain = (s) => ABBR.reduce((x, [re, to]) => x.replace(re, to), String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim());
  const isAdjusting = (r) => (Number(r.tthai) === 2 || Number(r.tthai) === 3) && !!r.gocRef;
  const refKey = (x) => (x ? `${x.nbmst || ''}|${Number(x.khmshdon) || x.khmshdon || ''}|${String(x.khhdon || '').toUpperCase()}|${Number(x.shdon) || x.shdon || ''}` : '');
  const monthOf = (iso) => { const d = new Date(iso); return d.getFullYear() * 12 + d.getMonth(); };
  // Luật thuế GTGT 2024 (từ 01/07/2025): hóa đơn mua vào từ 5 triệu đồng (gồm thuế) cần chứng từ thanh toán
  // không dùng tiền mặt để được khấu trừ; trước đó là 20 triệu.
  const cashLimit = (r) => (String(r.tdlap || '') >= '2025-06-30T17:00:00' ? 5e6 : 2e7);
  const GOODS = (l) => l.tchat !== 'Phí, lệ phí' && l.tchat !== 'Ghi chú, diễn giải';

  function riskOf(r, details, ctx) {
    const notes = [];
    let level = OK;
    const add = (lv, text) => { notes.push(text); level = Math.max(level, lv); };
    const tthai = Number(r.tthai), m = money(r), tol = foreign(r) ? 0.05 : 1;
    if (tthai === 6) add(BAD, 'Hóa đơn đã bị hủy – không dùng để kê khai');
    if (tthai === 4) add(BAD, 'Hóa đơn đã bị thay thế – kê khai theo hóa đơn thay thế');
    if (tthai === 5) add(WARN, 'Hóa đơn đã bị điều chỉnh – xem hóa đơn điều chỉnh');
    if (tthai === 2) add(WARN, `Hóa đơn thay thế cho ${r.goc || 'hóa đơn khác'}`);
    if (tthai === 3) add(WARN, `Hóa đơn điều chỉnh cho ${r.goc || 'hóa đơn khác'}`);
    const d = details.get(r.key), h = d?.head;

    // Đối chiếu số học: tổng thanh toán = chưa thuế + thuế + phí (− chiết khấu ghi ở phần tổng); Σ dòng hàng = chưa thuế
    let math = '';
    if (!m.khongThue && m.cthue !== null && m.thue !== null && m.tong !== null) {
      const diff = round2(m.tong - (m.cthue + m.thue + (m.phi || 0)));
      if (Math.abs(diff) > tol && Math.abs(diff + (h?.ttcktmai || 0)) > tol) {
        add(BAD, `Tổng thanh toán lệch ${fmtVND(diff)} so với tiền chưa thuế + thuế + phí`); math = `Lệch ${fmtVND(diff)}`;
      }
    }
    if (d?.lines && m.cthue !== null) {
      const goods = invoiceLines(r, d).filter(GOODS);
      const sums = [total(goods, (l) => l.thtien), total(goods.filter((l) => l.tchat !== 'Khuyến mại'), (l) => l.thtien)];
      const ck = h?.ttcktmai || 0;
      if (goods.length && !sums.some((x) => Math.abs(x - m.cthue) <= tol || (ck && Math.abs(x - ck - m.cthue) <= tol))) {
        const diff = round2(sums[0] - m.cthue);
        add(WARN, `Cộng các dòng hàng lệch ${fmtVND(diff)} so với tiền chưa thuế của hóa đơn`); math ||= `Dòng hàng lệch ${fmtVND(diff)}`;
      }
    }
    // Tiền thuế từng thuế suất ≈ thành tiền × thuế suất (mỗi dòng làm tròn có thể lệch ≤ 0,5 đồng)
    if (!foreign(r)) {
      for (const x of r.rates) {
        const p = pctOf(x.tsuat);
        if (!p || x.thtien === null || x.tthue === null) continue;
        const n = d?.lines ? d.lines.filter((l) => pctOf(l.tsuat) === p).length : 0;
        const diff = round2(x.tthue - (x.thtien * p) / 100);
        if (Math.abs(diff) > Math.max(1, n ? n * 0.5 + 1 : 50)) { add(WARN, `Tiền thuế ${p}% lệch ${fmtVND(diff)} so với thành tiền × thuế suất`); math ||= `Thuế ${p}% lệch ${fmtVND(diff)}`; }
      }
    }
    if (!math && (m.tong !== null)) math = d?.lines ? 'Khớp (cả dòng hàng)' : 'Khớp';

    // Thanh toán tiền mặt (mua vào)
    if (r.kind === 'purchase' && counted(r) && m.tong !== null && (vnd(r, m.tong) || 0) >= cashLimit(r)) {
      const pay = plain(h?.httt || r.httt);
      const cash = /\b(TM|TIEN MAT)\b/.test(pay), bank = /\b(CK|CHUYEN KHOAN|NGAN HANG|THE)\b/.test(pay);
      const lim = cashLimit(r) === 5e6 ? '5' : '20';
      if (cash && !bank) add(BAD, `Từ ${lim} triệu đồng nhưng ghi thanh toán tiền mặt – không đủ điều kiện khấu trừ thuế GTGT`);
      else if (cash) add(WARN, `Từ ${lim} triệu đồng, hình thức ${h?.httt || r.httt} – cần chứng từ thanh toán không dùng tiền mặt`);
    }

    // Chữ ký số trong XML gốc
    let sig = '', signer = '';
    if (d) {
      if (d.source !== 'xml') sig = 'Không có XML gốc';
      else if (!h?.seller) { sig = 'Không có'; add(BAD, 'XML không có chữ ký số của người bán'); }
      else {
        sig = `Có chữ ký người bán${h.cqtSigned ? ' + CQT' : ''}`; signer = h.seller.name || h.seller.subject;
        if (h.seller.mst && base10(h.seller.mst) !== base10(r.nbmst)) add(WARN, `Chứng thư số của MST ${h.seller.mst}, khác MST người bán ${r.nbmst}`);
        if (h.seller.time && r.tdlap && monthOf(h.seller.time) !== monthOf(r.tdlap)) add(WARN, `Ký số ngày ${dateVN(h.seller.time)}, khác tháng lập hóa đơn – lưu ý kỳ kê khai`);
      }
    }

    // Người mua của hóa đơn mua vào = doanh nghiệp đang đăng nhập
    if (r.kind === 'purchase') {
      if (ctx.mst && r.nmmst && base10(r.nmmst) !== base10(ctx.mst)) add(WARN, `MST người mua ${r.nmmst} khác MST đang đăng nhập ${ctx.mst}`);
      else if (ctx.company && r.nmten && plain(r.nmten) !== plain(ctx.company)) add(WARN, `Tên người mua "${r.nmten}" khác tên đăng ký thuế`);
    }

    return { level, notes, math, sig, signer };
  }

  function riskSheet(rows, details, ctx) {
    const list = sorted(rows).map((r) => ({ r, x: riskOf(r, details, ctx) })).sort((a, b) => b.x.level - a.x.level);
    const summary = { ok: 0, warn: 0, bad: 0 };
    for (const { x } of list) summary[['ok', 'warn', 'bad'][x.level]]++;
    return {
      name: 'Kiểm tra rủi ro HĐ', summary,
      columns: [
        { header: 'STT', width: 6, type: N }, { header: 'Kết quả', width: 11, fills: { 'Hợp lệ': 'ok', 'Lưu ý': 'warn', 'Cảnh báo': 'bad' } },
        { header: 'Chi tiết', width: 60 }, { header: 'Loại', width: 9 }, { header: 'Hình thức', width: 15 }, { header: 'Mẫu số', width: 8 },
        { header: 'Ký hiệu', width: 10 }, { header: 'Số hóa đơn', width: 11, type: T }, { header: 'Ngày lập', width: 11 }, { header: 'Ngày ký', width: 11 },
        { header: 'MST người bán', width: 15, type: T }, { header: 'Tên người bán', width: 36 }, { header: 'MST người mua', width: 15, type: T },
        { header: 'Tên người mua', width: 36 }, { header: 'Tổng thanh toán', width: 16, type: N }, { header: 'Hình thức thanh toán', width: 14 },
        { header: 'Trạng thái', width: 22 }, { header: 'Kết quả kiểm tra', width: 22 }, { header: 'Đối chiếu số học', width: 22 },
        { header: 'Chữ ký số (có trong XML)', width: 24 }, { header: 'Đơn vị ký số', width: 40 },
      ],
      rows: list.map(({ r, x }, i) => {
        const h = headOf(details, r);
        return [i + 1, LEVEL[x.level], x.notes.join('; ') || 'Không phát hiện vấn đề', HDDT.KINDS[r.kind].label, HDDT.FORMS[r.form].label,
          r.khmshdon, r.khhdon, String(r.shdon), dateVN(r.tdlap), signDate(h), r.nbmst, r.nbten, r.nmmst, r.nmten, money(r).tong,
          h?.httt || r.httt || '', HDDT.TTHAI[r.tthai] || '', HDDT.TTXLY[r.ttxly] || '', x.math, x.sig, x.signer];
      }),
    };
  }

  // ---- Kiểm tra rủi ro MST: 2 cột cuối của DS hóa đơn. Đối tác (người bán của HĐ mua vào, người mua của HĐ bán ra) có tên
  // trong danh sách công khai người mua / người bán sử dụng hóa đơn không hợp pháp của cổng không (ctx.illegal từ
  // HDDT.illegalCheck), hóa đơn này có bị nêu tên không. Không tra trạng thái MST (03/05/06): cổng hoadondientu không có API,
  // tracuunnt là máy chủ khác + captcha ảnh. ----
  const MST_COLS = [
    { header: 'Kiểm tra rủi ro MST', width: 22, fills: { 'Không có tên': 'ok', 'Có tên': 'bad', 'Có tên – HĐ bị nêu tên': 'bad', 'Không tra được': 'warn', 'Chưa tra (đã dừng)': 'warn' } },
    { header: 'Chi tiết rủi ro MST', width: 50 },
  ];
  function mstRisk(r, illegal) {
    const mst = r.kind === 'purchase' ? r.nbmst : r.nmmst;
    if (!mst) return ['', ''];
    if (!illegal) return ['Không tra được', ''];
    const e = illegal[mst];
    if (!e) return ['Chưa tra (đã dừng)', ''];
    const rec = e.recs.find((x) => x.loai === (r.kind === 'purchase' ? 1 : 2)) || e.recs[0];
    if (!rec) return ['Không có tên', ''];
    const hit = e.invs?.some((x) => refKey({ ...x, nbmst: '' }) === refKey({ ...r, nbmst: '' }));
    const why = [rec.ldo && `lý do: ${rec.ldo}`, rec.nckhai && `công khai ${dateVN(rec.nckhai)}`, rec.cqt && `CQT ${rec.cqt}`].filter(Boolean).join(', ');
    return [hit ? 'Có tên – HĐ bị nêu tên' : 'Có tên',
      `${r.kind === 'purchase' ? 'Người bán' : 'Người mua'} ${mst} có tên trong danh sách công khai ${rec.loai === 1 ? 'người bán' : 'người mua'} sử dụng hóa đơn không hợp pháp${why ? ` (${why})` : ''}${hit ? '; hóa đơn này bị nêu tên' : ''}`];
  }

  // ---- HĐ thay thế, điều chỉnh: so sánh ngang với hóa đơn gốc ----
  // Trái: HĐ thay thế/điều chỉnh, phải: HĐ gốc. Ô khác HĐ gốc tô vàng, dòng hàng mới xanh, dòng chỉ có ở HĐ gốc đỏ,
  // HĐ gốc ngoài khoảng ngày (tải riêng) cam. Dòng hàng ghép theo tên (không phân biệt hoa thường, khoảng trắng), rồi mã hàng.
  const INFO = [['khmshdon', 'Mẫu số', 7], ['khhdon', 'Ký hiệu', 9], ['shdon', 'Số HĐ', 9], ['ngay', 'Ngày lập', 11],
    ['nbmst', 'MST người bán', 14], ['nbten', 'Tên người bán', 30], ['nbdchi', 'Địa chỉ người bán', 30],
    ['nmmst', 'MST người mua', 14], ['nmten', 'Tên người mua', 30], ['nmdchi', 'Địa chỉ người mua', 30],
    ['cthue', 'Tiền chưa thuế', 14, 'Int'], ['thue', 'Tiền thuế', 12, 'Int'], ['tong', 'Tổng thanh toán', 14, 'Int'], ['tthai', 'Trạng thái', 18]];
  const LINE = [['tchat', 'Tính chất', 14], ['ten', 'Tên hàng hóa, dịch vụ', 36], ['dvt', 'ĐVT', 8], ['sl', 'Số lượng', 10, 'Dec'],
    ['dgia', 'Đơn giá', 13, 'Dec'], ['tsuat', 'Thuế suất', 9], ['thtien', 'Thành tiền', 14, 'Int'], ['tthue', 'Tiền thuế', 12, 'Int']];
  const LEFT = [...INFO, ['lydo', 'Lý do', 30], ...LINE], RIGHT = [...INFO, ...LINE];
  const MONEY_KEYS = new Set(['cthue', 'thue', 'tong']);
  const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005
    : plain(a) === plain(b));
  const lineKey = (l) => String(l.ten || '').toLowerCase().replace(/\s+/g, ' ').trim();

  function sideInfo(row, d) {
    const h = d?.head || {}, m = money(row);
    return { khmshdon: row.khmshdon, khhdon: row.khhdon, shdon: String(row.shdon), ngay: dateVN(row.tdlap), nbmst: row.nbmst, nbten: row.nbten,
      nbdchi: h.nbdchi || '', nmmst: row.nmmst, nmten: row.nmten, nmdchi: h.nmdchi || '', cthue: m.cthue, thue: m.thue, tong: m.tong,
      tthai: HDDT.TTHAI[row.tthai] || '', lydo: h.related?.gchu || '' };
  }
  // Hóa đơn gốc ngoài khoảng ngày: chỉ có dữ liệu từ XML / JSON chi tiết → dựng dòng như danh sách
  const rowFromHead = (h, r) => ({ key: `goc:${refKey(h)}`, kind: r.kind, form: r.form, khmshdon: h.khmshdon, khhdon: h.khhdon, shdon: h.shdon,
    tdlap: h.nlap, nbmst: h.nbmst, nbten: h.nbten, nmmst: h.nmmst, nmten: h.nmten, tgtcthue: h.tgtcthue, tgtthue: h.tgtthue, tgtphi: null,
    tgtttbso: h.tgtttbso, dvtte: h.dvtte, tgia: h.tgia, tthai: null, rates: [] });
  // Phần đầu chung của 2 tên / độ dài tên dài hơn (vd chỉ đổi biển số xe ở cuối tên → gần 1)
  const prefixRatio = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i / Math.max(a.length, b.length, 1); };
  // Ghép dòng hàng 2 hóa đơn: (1) cùng tên, (2) cùng mã hàng, (3) gần đúng – cùng tính chất + ĐVT và tên chung ≥ 60%
  // phần đầu (hoặc ≥ 30% và cùng thành tiền); dòng ghép gần đúng tô vàng ô tên
  function matchLines(L, R) {
    const used = new Set(), hit = L.map(() => -1);
    const take = (test) => L.forEach((l, k) => {
      if (hit[k] >= 0) return;
      const j = R.findIndex((x, i) => !used.has(i) && test(l, x));
      if (j >= 0) { used.add(j); hit[k] = j; }
    });
    take((l, x) => lineKey(x) && lineKey(x) === lineKey(l));
    take((l, x) => l.ma && x.ma === l.ma);
    take((l, x) => String(l.dvt || '').toLowerCase() === String(x.dvt || '').toLowerCase() && l.tchat === x.tchat
      && (prefixRatio(lineKey(l), lineKey(x)) >= 0.6 || (l.thtien !== null && l.thtien === x.thtien && prefixRatio(lineKey(l), lineKey(x)) >= 0.3)));
    const pairs = L.map((l, k) => [l, hit[k] >= 0 ? R[hit[k]] : null]);
    R.forEach((x, i) => { if (!used.has(i)) pairs.push([null, x]); });
    return pairs;
  }

  function adjustSheet(rows, details, { originals = new Map(), tuNgay, denNgay }) {
    const adj = sorted(rows).filter(isAdjusting);
    if (!adj.length) return null;
    const byRef = new Map(rows.map((r) => [refKey(r), r]));
    const L0 = 1, R0 = L0 + LEFT.length + 1; // cột bắt đầu (0 = A)
    const col = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
    const out = [], rowProps = new Map(), merges = [];
    const push = (cells, props) => { if (props) rowProps.set(out.length, props); out.push(cells); };
    push([{ v: 'HÓA ĐƠN THAY THẾ, ĐIỀU CHỈNH – SO SÁNH VỚI HÓA ĐƠN GỐC', s: 'big' }], { ht: 20 });
    const legend = [];
    // Chú thích màu đặt ở các cột rộng (tên, địa chỉ) để không che dòng "Từ ngày … đến ngày …"
    legend[L0 + 5] = { v: 'Ô khác HĐ gốc', s: 'chg' }; legend[L0 + 6] = { v: 'Dòng hàng mới', s: 'new' };
    legend[L0 + 8] = { v: 'Dòng chỉ có ở HĐ gốc', s: 'gone' }; legend[L0 + 9] = { v: 'HĐ gốc ngoài khoảng ngày', s: 'out' };
    legend[0] = tuNgay ? `Từ ngày ${tuNgay} đến ngày ${denNgay}` : '';
    push(legend);
    const g = [{ v: 'STT', s: 'hd' }];
    LEFT.forEach((_, i) => { g[L0 + i] = { v: i ? '' : 'HÓA ĐƠN THAY THẾ / ĐIỀU CHỈNH', s: 'hd' }; });
    RIGHT.forEach((_, i) => { g[R0 + i] = { v: i ? '' : 'HÓA ĐƠN GỐC (BỊ THAY THẾ / ĐIỀU CHỈNH)', s: 'hd' }; });
    push(g, { ht: 18 });
    const hd = [{ v: '', s: 'hd' }];
    LEFT.forEach(([, t], i) => { hd[L0 + i] = { v: t, s: 'hd' }; });
    RIGHT.forEach(([, t], i) => { hd[R0 + i] = { v: t, s: 'hd' }; });
    push(hd, { ht: 30 });
    merges.push('A3:A4', `${col(L0)}3:${col(L0 + LEFT.length - 1)}3`, `${col(R0)}3:${col(R0 + RIGHT.length - 1)}3`);

    const st = (base, type) => (base === 'cell' ? (type ? `cell${type}` : 'cell') : `${base}${type || ''}`);
    adj.forEach((r, n) => {
      const ld = details.get(r.key), k = refKey(r.gocRef), inRange = byRef.get(k), o = inRange ? null : originals.get(k);
      const right = inRange ? { row: inRange, d: details.get(inRange.key) } : o ? { row: rowFromHead(o.head, r), d: o, out: true } : null;
      const li = sideInfo(r, ld), ri = right ? sideInfo(right.row, right.d) : null;
      if (right?.out) ri.tthai = 'Ngoài khoảng ngày đang tải';
      const lines = (row, d) => (d?.lines ? invoiceLines(row, d) : []);
      const pairs = matchLines(lines(r, ld), right ? lines(right.row, right.d) : []);
      const replace = Number(r.tthai) === 2; // thay thế: so cả tiền; điều chỉnh: tiền là phần chênh lệch nên chỉ so thông tin
      const height = Math.max(1, pairs.length);
      for (let j = 0; j < height; j++) {
        const cells = [{ v: j ? '' : n + 1, s: 'cell' }];
        const [pl, pr] = pairs[j] || [null, null];
        LEFT.forEach(([key, , , type], i) => {
          const isLine = i >= INFO.length + 1;
          let v = '', base = 'cell';
          if (!isLine) {
            if (!j) {
              v = li[key];
              if (ri && key !== 'lydo' && key !== 'tthai' && key !== 'ngay' && key !== 'shdon' && key !== 'khhdon' && key !== 'khmshdon'
                && (replace || !MONEY_KEYS.has(key)) && v !== '' && v !== null && ri[key] !== '' && ri[key] !== null && !same(v, ri[key])) base = 'chg';
            }
          } else if (pl) {
            v = pl[key];
            if (!pr) base = 'new';
            else if (key !== 'tchat' && !same(v ?? '', pr[key] ?? '')) base = 'chg';
          }
          cells[L0 + i] = { v: v ?? '', s: st(base, type) };
        });
        RIGHT.forEach(([key, , , type], i) => {
          const isLine = i >= INFO.length;
          let v = '', base = 'cell';
          if (!isLine) {
            if (!j) { v = ri ? ri[key] : i === 0 ? `Chưa có dữ liệu HĐ gốc ${r.goc}` : ''; if (right?.out) base = 'out'; }
          } else if (pr) { v = pr[key]; if (!pl) base = 'gone'; }
          cells[R0 + i] = { v: v ?? '', s: st(base, type) };
        });
        push(cells);
      }
    });
    const widths = [5];
    LEFT.forEach(([, , w], i) => { widths[L0 + i] = w; }); widths[R0 - 1] = 2;
    RIGHT.forEach(([, , w], i) => { widths[R0 + i] = w; });
    return { name: 'HĐ thay thế, điều chỉnh', layout: true, rows: out, rowProps, merges, widths, freeze: 'A5' };
  }

  // ---- Bảng kê hoạt động kinh doanh (mẫu 01-2/BK-HĐKD, hộ kinh doanh khai thuế theo phương pháp kê khai) ----
  // Từ hóa đơn mua vào: mục A gộp theo tên hàng + ĐVT, Nhập trong kỳ = giá mua gồm thuế GTGT (hộ kinh doanh không
  // khấu trừ thuế). Tồn đầu kỳ, Xuất trong kỳ (theo giá vốn) để trống cho kế toán điền, Tồn cuối kỳ là công thức.
  // Mục B chi phí: điện, nước, viễn thông, thuê mặt bằng nhận theo tên hàng hóa; dịch vụ khác, phí, lệ phí → chi phí khác.
  const COSTS = [
    ['Chi phí nhân công'],
    ['Chi phí điện', /(tiền điện|điện năng|điện sinh hoạt|điện sản xuất|điện kinh doanh|\bkwh\b)/i],
    ['Chi phí nước', /(tiền nước|nước sạch|nước sinh hoạt|cấp nước|thoát nước)/i],
    ['Chi phí viễn thông', /(viễn thông|internet|điện thoại|di động|truyền hình|wifi|cáp quang|thuê bao)/i],
    ['Chi phí thuê kho bãi, mặt bằng kinh doanh', /(tiền thuê|thuê\s+(kho|bãi|mặt bằng|nhà|căn hộ|văn phòng|cửa hàng|xưởng|ki[- ]?ốt))/i],
    ['Chi phí quản lý (văn phòng phẩm, công cụ, dụng cụ…)'],
    ['Chi phí khác (hội nghị, công tác phí, thuê ngoài khác, phí, lệ phí…)'],
  ];
  const OTHER_COST = COSTS.length - 1;
  // Dịch vụ mua ngoài (phí, cước, tư vấn, dịch thuật, vé…) không nhập kho → chi phí khác; nhận theo tên hoặc ĐVT.
  // (?<!\p{L}) thay cho \b vì \b của JS không hiểu chữ có dấu
  const SERVICE = /(?<!\p{L})(phí|cước|dịch vụ|dịch thuật|tư vấn|vận chuyển|thuê|vé)(?!\p{L})/iu;
  const SERVICE_UNIT = /^(lần|chuyến|lô|trang|vé|gói|tháng|năm|ngày|giờ|người|hợp đồng|khóa|suất)$/i;
  function hdkdSheet(rows, details, { tuNgay, denNgay, mst, company }) {
    const buys = sorted(rows).filter((r) => r.kind === 'purchase' && counted(r));
    if (!buys.length) return null;
    const items = new Map(), costs = COSTS.map(() => 0);
    for (const r of buys) {
      const d = withLinesOf(details, r);
      const all = d ? invoiceLines(r, d) : [];
      const goods = netDiscount(all.filter((l) => GOODS(l) && (l.thtien || l.sl)));
      if (!d || !goods.length && !all.some((l) => l.tchat === 'Phí, lệ phí')) {
        const ten = `Hàng hóa, dịch vụ theo hóa đơn ${r.khhdon}-${r.shdon}`;
        items.set(ten, { ten, dvt: '', sl: null, tt: vnd(r, money(r).tong) || 0 });
        continue;
      }
      for (const l of all) if (l.tchat === 'Phí, lệ phí') costs[OTHER_COST] += vnd(r, l.thtien) || 0;
      for (const l of goods) {
        const tt = vnd(r, (l.thtien || 0) + (l.tthue || 0)) || 0;
        const c = COSTS.findIndex(([, re]) => re && re.test(`${l.ten} ${l.dvt}`));
        if (c >= 0 || SERVICE.test(l.ten || '') || SERVICE_UNIT.test(String(l.dvt || '').trim())) { costs[c >= 0 ? c : OTHER_COST] += tt; continue; }
        const key = `${lineKey(l)}|${String(l.dvt || '').toLowerCase().trim()}`;
        const it = items.get(key) || items.set(key, { ten: l.ten, dvt: l.dvt, sl: null, tt: 0 }).get(key);
        if (l.sl !== null) it.sl = round2((it.sl || 0) + (l.tchat === 'Chiết khấu thương mại' ? 0 : l.sl));
        it.tt += tt;
      }
    }
    const out = [], rowProps = new Map(), merges = [];
    const push = (cells, props) => { if (props) rowProps.set(out.length, props); out.push(cells); };
    push([{ v: 'BẢNG KÊ HOẠT ĐỘNG KINH DOANH TRONG KỲ CỦA HỘ KINH DOANH, CÁ NHÂN KINH DOANH (Mẫu số 01-2/BK-HĐKD)', s: 'big' }], { ht: 20 });
    push([`Kỳ tính thuế: từ ngày ${tuNgay || ''} đến ngày ${denNgay || ''}`]);
    push([`Người nộp thuế: ${company || ''}${mst ? `   ·   Mã số thuế: ${mst}` : ''}`]);
    push([{ v: 'Lập tự động từ hóa đơn mua vào: Nhập trong kỳ = giá mua gồm thuế GTGT. Tồn đầu kỳ, Xuất trong kỳ (theo giá vốn) do kế toán điền, Tồn cuối kỳ tự tính. Chi phí ở mục B nhận theo tên hàng hóa – cần kiểm tra lại.', s: 'note' }]);
    push([]);
    push([{ v: 'A. Vật liệu, dụng cụ, sản phẩm, hàng hóa', s: 'title' }]);
    const top = out.length + 1;
    push(['STT', 'Vật liệu, dụng cụ, sản phẩm, hàng hóa', 'Đơn vị tính', 'Tồn đầu kỳ', '', 'Nhập trong kỳ', '', 'Xuất trong kỳ', '', 'Tồn cuối kỳ', ''].map((v) => ({ v, s: 'hd' })), { ht: 18 });
    push(['', '', '', ...Array(4).fill(['Số lượng', 'Thành tiền']).flat()].map((v) => ({ v, s: 'hd' })), { ht: 18 });
    merges.push(`A${top}:A${top + 1}`, `B${top}:B${top + 1}`, `C${top}:C${top + 1}`, `D${top}:E${top}`, `F${top}:G${top}`, `H${top}:I${top}`, `J${top}:K${top}`);
    const first = out.length + 1;
    const list = [...items.values()].sort((a, b) => String(a.ten).localeCompare(String(b.ten), 'vi'));
    list.forEach((it, i) => {
      const n = out.length + 1;
      push([{ v: i + 1, s: 'cell' }, { v: it.ten, s: 'cell' }, { v: it.dvt || '', s: 'cell' }, { v: '', s: 'cellDec' }, { v: '', s: 'cellInt' },
        { v: it.sl ?? '', s: 'cellDec' }, { v: round2(it.tt), s: 'cellInt' }, { v: '', s: 'cellDec' }, { v: '', s: 'cellInt' },
        { f: `D${n}+F${n}-H${n}`, s: 'cellDec' }, { f: `E${n}+G${n}-I${n}`, s: 'cellInt' }]);
    });
    const last = out.length;
    const sum = (c) => (last >= first ? { f: `SUM(${c}${first}:${c}${last})`, s: 'sum' } : { v: 0, s: 'sum' });
    push([{ v: '', s: 'sumText' }, { v: 'Tổng cộng', s: 'sumText' }, { v: '', s: 'sumText' }, { v: '', s: 'sumText' }, sum('E'),
      { v: '', s: 'sumText' }, sum('G'), { v: '', s: 'sumText' }, sum('I'), { v: '', s: 'sumText' }, sum('K')]);
    push([]);
    push([{ v: 'B. Chi phí quản lý', s: 'title' }]);
    push([{ v: 'STT', s: 'hd' }, { v: 'Chỉ tiêu', s: 'hd' }, { v: '', s: 'hd' }, { v: 'Số tiền', s: 'hd' }], { ht: 18 });
    merges.push(`B${out.length}:C${out.length}`);
    const c0 = out.length + 1;
    COSTS.forEach(([ten], i) => {
      push([{ v: i + 1, s: 'cell' }, { v: ten, s: 'cell' }, { v: '', s: 'cell' }, { v: costs[i] ? round2(costs[i]) : '', s: 'cellInt' }]);
      merges.push(`B${out.length}:C${out.length}`);
    });
    push([{ v: '', s: 'sumText' }, { v: 'Tổng cộng', s: 'sumText' }, { v: '', s: 'sumText' }, { f: `SUM(D${c0}:D${out.length})`, s: 'sum' }]);
    merges.push(`B${out.length}:C${out.length}`);
    return { name: 'Bảng kê HĐKD (01-2)', layout: true, rows: out, rowProps, merges, widths: [6, 48, 10, 11, 15, 11, 15, 11, 15, 11, 15], freeze: `A${first}` };
  }

  // ---- Tờ khai 01/GTGT (bản tham khảo, phương pháp khấu trừ) ----
  // Số mua vào / bán ra lấy từ hóa đơn của kỳ; [22], [23a]/[24a], [37]–[39a], [40b], [42] do kế toán điền (ô vàng);
  // các chỉ tiêu tổng hợp là công thức Excel. Hàng bán ra 8% (giảm thuế) kê vào [32], [33] cùng hàng 10% với số thuế
  // đã giảm, kèm Phụ lục giảm thuế (theo hướng dẫn của MISA – cần kế toán xác nhận). Chỉ lập khi khoảng ngày trọn 1 tháng / 1 quý.
  const parseVN = (s) => { const [d, m, y] = String(s || '').split('/').map(Number); return new Date(y, m - 1, d); };
  function taxPeriod(tuNgay, denNgay) {
    const a = parseVN(tuNgay), b = parseVN(denNgay);
    if (Number.isNaN(+a) || Number.isNaN(+b) || a.getDate() !== 1) return null;
    const lastOf = (y, m) => new Date(y, m + 1, 0).getDate();
    const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
    if (b.getDate() !== lastOf(b.getFullYear(), b.getMonth())) return null;
    if (months === 1) return `Tháng ${a.getMonth() + 1} năm ${a.getFullYear()}`;
    if (months === 3 && a.getMonth() % 3 === 0) return `Quý ${a.getMonth() / 3 + 1} năm ${a.getFullYear()}`;
    return null;
  }
  // Xếp bảng thuế suất của hóa đơn bán ra vào chỉ tiêu tờ khai
  const SOLD_CODE = (tsuat) => {
    const t = String(tsuat || '').trim().toUpperCase(), p = pctOf(t);
    if (t === 'KCT') return '26';
    if (t === 'KKKNT') return '32a';
    if (p === 0) return '29';
    if (p === 5) return '30';
    if (p === 10 || p === 8) return '32';
    return null; // KHAC:x%, không xác định → để kế toán xếp
  };

  // Tờ khai tính bằng đồng: làm tròn từng hóa đơn (có HĐ VND ghi thuế lẻ, vd 459.287,04 = 5.741.088 × 8%)
  const dong = (r, v) => roundVND(vnd(r, v) || 0);
  function gtgtSheet(rows, details, opts) {
    const { tuNgay, denNgay, mst, company, kinds = ['purchase', 'sold'], adjOnly, skipped = [], stopped } = opts;
    const period = taxPeriod(tuNgay, denNgay);
    if (!period) return { skip: 'Tờ khai 01/GTGT chỉ lập khi chọn trọn 1 tháng hoặc 1 quý' };
    if (adjOnly || !kinds.includes('purchase') || !kinds.includes('sold')) return { skip: 'Tờ khai 01/GTGT cần tải cả mua vào lẫn bán ra (không bật lọc HĐ thay thế/điều chỉnh/hủy)' };

    // Mua vào: hóa đơn có thuế GTGT (bỏ hủy, bị thay thế, hóa đơn bán hàng không có thuế)
    let v23 = 0, v24 = 0, noVat = 0;
    const flagged = [], lateSigned = [];
    for (const r of sorted(rows)) {
      if (r.kind !== 'purchase' || !counted(r)) continue;
      const m = money(r);
      if (m.khongThue) { noVat++; continue; }
      v23 += dong(r, m.cthue); v24 += dong(r, m.thue);
      const x = riskOf(r, details, opts);
      const bad = x.notes.filter((t) => /tiền mặt – không đủ|không có chữ ký/.test(t));
      if (bad.length) flagged.push({ r, thue: dong(r, m.thue), why: bad.join('; ') });
      const h = headOf(details, r);
      if (h?.seller?.time && monthOf(h.seller.time) !== monthOf(r.tdlap)) lateSigned.push(`${r.khhdon}-${r.shdon} (lập ${dateVN(r.tdlap)}, ký ${dateVN(h.seller.time)})`);
    }
    // Bán ra: theo bảng thuế suất từng hóa đơn
    const sold = { 26: 0, 29: 0, 30: 0, 31: 0, 32: 0, 33: 0, '32a': 0 };
    let v8 = 0, t8 = 0;
    const unknown = [];
    for (const r of sorted(rows)) {
      if (r.kind !== 'sold' || !counted(r)) continue;
      const rates = ratesOf(r);
      if (!rates.length) { unknown.push(`${r.khhdon}-${r.shdon}`); continue; }
      for (const x of rates) {
        const code = SOLD_CODE(x.tsuat), gt = dong(r, x.thtien), th = dong(r, x.tthue);
        if (!code) { unknown.push(`${r.khhdon}-${r.shdon} (${x.tsuat})`); continue; }
        sold[code] += gt;
        if (code === '30') sold[31] += th;
        if (code === '32') { sold[33] += th; if (pctOf(x.tsuat) === 8) { v8 += gt; t8 += th; } }
      }
    }

    const out = [], rowProps = new Map(), merges = [], ref = {};
    const push = (cells, props) => { if (props) rowProps.set(out.length, props); out.push(cells); return out.length; };
    const IN = (v) => ({ v, s: 'chgInt' }); // ô kế toán điền / kiểm
    const N = (v) => ({ v: round2(v), s: 'cellInt' });
    const F = (f) => ({ f, s: 'sum' });
    const C = (code) => ({ v: `[${code}]`, s: 'cell' });
    const T = (v, s = 'cell') => ({ v, s });
    // Dòng chỉ tiêu: [STT, tên, mã giá trị, giá trị, mã thuế, thuế]; ghi lại ô của từng mã để dựng công thức
    const line = (stt, ten, vCode, val, tCode, tax, head) => {
      const n = out.length + 1, st = head ? 'sumText' : 'cell';
      const cells = [T(stt, st), T(ten, st), vCode ? C(vCode) : T('', st), val ?? T('', st), tCode ? C(tCode) : T('', st), tax ?? T('', st)];
      if (vCode) ref[vCode] = `D${n}`;
      if (tCode) ref[tCode] = `F${n}`;
      push(cells);
    };
    push([T('TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (Mẫu số 01/GTGT) – BẢN THAM KHẢO', 'big')], { ht: 20 });
    push(['(Áp dụng đối với người nộp thuế tính thuế theo phương pháp khấu trừ có hoạt động sản xuất kinh doanh)']);
    push([T('Lập tự động từ hóa đơn trên hoadondientu để đối chiếu trước khi nhập HTKK / eTax. Ô vàng: kế toán điền hoặc kiểm tra lại. Chỉ tiêu tổng hợp là công thức, tự tính lại khi sửa ô vàng.', 'note')]);
    if (skipped.length || stopped) push([T(`THIẾU DỮ LIỆU: ${stopped ? 'đã bấm Dừng giữa chừng' : `chưa tải được ${skipped.join(', ')}`} – số liệu dưới đây chưa đủ, hãy tải lại trước khi dùng.`, 'gone')]);
    push([]);
    push([`[01a] Tên hoạt động sản xuất kinh doanh: Hoạt động sản xuất kinh doanh thông thường`]);
    push([`[01b] Kỳ tính thuế: ${period} (từ ngày ${tuNgay} đến ngày ${denNgay})`]);
    push(['[02] Lần đầu: X        [03] Bổ sung lần thứ:']);
    push([`[04] Tên người nộp thuế: ${company || ''}`]);
    push([`[05] Mã số thuế: ${mst || ''}`]);
    push([]);
    push([T('STT', 'hd'), T('Chỉ tiêu', 'hd'), T('', 'hd'), T('Giá trị hàng hóa, dịch vụ (chưa có thuế GTGT)', 'hd'), T('', 'hd'), T('Thuế giá trị gia tăng', 'hd')], { ht: 30 });
    merges.push(`B${out.length}:C${out.length}`, `D${out.length}:E${out.length}`);
    // Đơn vị: đồng Việt Nam
    line('A', 'Không phát sinh hoạt động mua, bán trong kỳ (đánh dấu "X")', '21', IN(''));
    line('B', 'Thuế giá trị gia tăng còn được khấu trừ kỳ trước chuyển sang', null, null, '22', IN(0));
    line('C', 'Kê khai thuế giá trị gia tăng phải nộp ngân sách nhà nước', null, null, null, null, true);
    line('I', 'Hàng hoá, dịch vụ mua vào trong kỳ', null, null, null, null, true);
    line('1', 'Giá trị và thuế giá trị gia tăng của hàng hóa, dịch vụ mua vào', '23', N(v23), '24', N(v24));
    line('', 'Trong đó: hàng hóa, dịch vụ nhập khẩu', '23a', IN(0), '24a', IN(0));
    line('2', 'Thuế giá trị gia tăng của hàng hóa, dịch vụ mua vào được khấu trừ kỳ này', null, null, '25', F('__25__'));
    line('II', 'Hàng hoá, dịch vụ bán ra trong kỳ', null, null, null, null, true);
    line('1', 'Hàng hóa, dịch vụ bán ra không chịu thuế giá trị gia tăng', '26', N(sold[26]));
    line('2', 'Hàng hóa, dịch vụ bán ra chịu thuế giá trị gia tăng ([27]=[29]+[30]+[32]+[32a]; [28]=[31]+[33])', '27', F('__27__'), '28', F('__28__'));
    line('a', 'Hàng hoá, dịch vụ bán ra chịu thuế suất 0%', '29', N(sold[29]));
    line('b', 'Hàng hoá, dịch vụ bán ra chịu thuế suất 5%', '30', N(sold[30]), '31', N(sold[31]));
    line('c', 'Hàng hoá, dịch vụ bán ra chịu thuế suất 10% (gồm hàng được giảm còn 8%)', '32', N(sold[32]), '33', N(sold[33]));
    line('d', 'Hàng hoá, dịch vụ bán ra không phải kê khai, tính nộp thuế GTGT', '32a', N(sold['32a']));
    line('3', 'Tổng doanh thu và thuế giá trị gia tăng của hàng hóa, dịch vụ bán ra ([34]=[26]+[27]; [35]=[28])', '34', F('__34__'), '35', F('__35__'));
    line('III', 'Thuế giá trị gia tăng phát sinh trong kỳ ([36]=[35]-[25])', null, null, '36', F('__36__'));
    line('IV', 'Điều chỉnh tăng, giảm thuế giá trị gia tăng còn được khấu trừ của các kỳ trước', null, null, null, null, true);
    line('1', 'Điều chỉnh giảm', null, null, '37', IN(0));
    line('2', 'Điều chỉnh tăng', null, null, '38', IN(0));
    line('V', 'Thuế giá trị gia tăng nhận bàn giao được khấu trừ trong kỳ', null, null, '39a', IN(0));
    line('VI', 'Xác định nghĩa vụ thuế giá trị gia tăng phải nộp trong kỳ', null, null, null, null, true);
    line('1', 'Thuế GTGT phải nộp của hoạt động sản xuất kinh doanh trong kỳ ([40a]=([36]-[22]+[37]-[38]-[39a]) ≥ 0)', null, null, '40a', F('__40a__'));
    line('2', 'Thuế GTGT mua vào của dự án đầu tư được bù trừ với thuế GTGT phải nộp của hoạt động SXKD cùng kỳ tính thuế', null, null, '40b', IN(0));
    line('3', 'Thuế giá trị gia tăng còn phải nộp trong kỳ ([40]=[40a]-[40b])', null, null, '40', F('__40__'));
    line('4', 'Thuế GTGT chưa khấu trừ hết kỳ này ([41]=([36]-[22]+[37]-[38]-[39a]) < 0)', null, null, '41', F('__41__'));
    line('4.1', 'Thuế giá trị gia tăng đề nghị hoàn ([42] ≤ [41])', null, null, '42', IN(0));
    line('4.2', 'Thuế giá trị gia tăng còn được khấu trừ chuyển kỳ sau ([43]=[41]-[42])', null, null, '43', F('__43__'));

    // Ghi chú đối chiếu
    push([]);
    push([T('Ghi chú đối chiếu', 'title')]);
    const exN = push([T('', 'cell'), T('Thuế của hóa đơn mua vào đề xuất KHÔNG khấu trừ (đã trừ khỏi [25]; sửa số nếu kế toán quyết khác)', 'cell'), T('', 'cell'), T('', 'cell'), T('', 'cell'), IN(round2(flagged.reduce((s, x) => s + x.thue, 0)))]);
    for (const x of flagged) push(['', `   ${x.r.khhdon}-${x.r.shdon} · ${x.r.nbten}: ${x.why}`, '', '', '', N(x.thue)]);
    push(['', `Trong [32], [33]: hàng bán ra được giảm thuế còn 8% – doanh thu ${fmtVND(v8)}, thuế ${fmtVND(t8)} (chi tiết ở sheet Phụ lục giảm thuế GTGT; cách kê cần kế toán xác nhận)`]);
    if (lateSigned.length) push(['', `Hóa đơn mua vào ký số khác tháng lập (đang tính vào kỳ này theo ngày lập – cân nhắc kỳ kê khai): ${lateSigned.join(', ')}`]);
    if (noVat) push(['', `${noVat} hóa đơn mua vào không có thuế GTGT (hóa đơn bán hàng) không tính vào [23], [24]`]);
    if (unknown.length) push(['', T(`Hóa đơn bán ra chưa xếp được chỉ tiêu (thuế suất khác / không xác định) – kế toán tự xếp: ${unknown.join(', ')}`, 'chg')]);
    push(['', 'Không tính: hóa đơn đã hủy, đã bị thay thế, chứng từ không có tiền (phiếu xuất kho…). Hóa đơn điều chỉnh tính theo số trên hóa đơn điều chỉnh.']);

    // Thay công thức giữ chỗ bằng tham chiếu ô thật
    const net = `(${ref[36]}-${ref[22]}+${ref[37]}-${ref[38]}-${ref['39a']})`;
    const FORM = {
      __25__: `${ref[24]}-F${exN}`,
      __27__: `${ref[29]}+${ref[30]}+${ref[32]}+${ref['32a']}`, __28__: `${ref[31]}+${ref[33]}`,
      __34__: `${ref[26]}+${ref[27]}`, __35__: `${ref[28]}`, __36__: `${ref[35]}-${ref[25]}`,
      __40a__: `MAX(0,${net})`, __40__: `${ref['40a']}-${ref['40b']}`, __41__: `MAX(0,-${net})`, __43__: `${ref[41]}-${ref[42]}`,
    };
    for (const r of out) for (const c of r || []) if (c && c.f && FORM[c.f]) c.f = FORM[c.f];
    return { name: 'Tờ khai 01GTGT (tham khảo)', layout: true, rows: out, rowProps, merges, widths: [6, 70, 7, 18, 7, 18] };
  }

  // rows: hóa đơn đã tra cứu; details: Map key → { source, head, lines?, fees? } (rỗng nếu không tải chi tiết)
  // opts.sheets: sheet thêm người dùng chọn; originals: Map refKey → hóa đơn gốc ngoài khoảng ngày (tải riêng)
  function buildSheets(rows, details, opts = {}) {
    const want = { reduction: true, risk: true, seller: true, adjust: true, hdkd: false, gtgt: false, ...opts.sheets };
    // Tách danh sách hóa đơn thành hai sheet độc lập; giữ nguyên bộ cột, dữ liệu và tổng cộng.
    const sheets = [
      invoiceSheet('Mua vào', rows.filter((r) => r.kind === 'purchase'), details, opts.withPdf, want.seller, opts.illegal),
      invoiceSheet('Bán ra', rows.filter((r) => r.kind === 'sold'), details, opts.withPdf, want.seller, opts.illegal),
    ];
    if (opts.withLines) sheets.push(linesSheet(rows, details));
    if (want.risk) sheets.push(riskSheet(rows, details, opts));
    if (want.adjust) { const s = adjustSheet(rows, details, opts); if (s) sheets.push(s); }
    if (want.reduction) sheets.push(reductionSheet(rows, details));
    if (want.hdkd) { const s = hdkdSheet(rows, details, opts); if (s) sheets.push(s); }
    // Sheet không lập được (vd tờ khai khi khoảng ngày không trọn tháng/quý) → lý do trong sheets.notes để báo ở nhật ký
    sheets.notes = [];
    if (want.gtgt) { const s = gtgtSheet(rows, details, opts); if (s.skip) sheets.notes.push(s.skip); else sheets.push(s); }
    return sheets;
  }
  const buildWorkbook = (rows, details, opts) => Xlsx.buildXlsx(buildSheets(rows, details, opts));

  window.Report = { buildWorkbook, buildSheets, dateVN, isAdjusting, refKey };
})();
