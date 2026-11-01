// Tự dựng PDF bản thể hiện hóa đơn ngay trên máy từ dữ liệu của cổng (XML gốc, hoặc JSON chi tiết với HĐ không mã).
// Không phải PDF gốc của nhà cung cấp HĐĐT (cần captcha ở cổng tra cứu của họ) và không gửi dữ liệu đi đâu.
// Không thư viện ngoài: tự ghi PDF 1.7, nhúng font Roboto rút gọn (src/content/fonts, tạo bằng scripts/build-pdf-font.py)
// dạng CIDFontType2 + Identity-H, chỉ giữ glyph đã dùng; ToUnicode để chọn / tìm được chữ tiếng Việt.
(() => {
  const enc = new TextEncoder();

  // ---------- Font TrueType ----------
  function parseFont(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const tables = {};
    for (let i = 0, n = dv.getUint16(4); i < n; i++) {
      const p = 12 + i * 16, tag = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
      tables[tag] = { off: dv.getUint32(p + 8), len: dv.getUint32(p + 12) };
    }
    const T = (t) => tables[t].off;
    const upem = dv.getUint16(T('head') + 18), longLoca = dv.getInt16(T('head') + 50) === 1;
    const bbox = [0, 2, 4, 6].map((k) => Math.round((dv.getInt16(T('head') + 36 + k) * 1000) / upem));
    const numGlyphs = dv.getUint16(T('maxp') + 4), numH = dv.getUint16(T('hhea') + 34);
    const adv = new Uint16Array(numGlyphs);
    for (let g = 0; g < numGlyphs; g++) adv[g] = dv.getUint16(T('hmtx') + 4 * Math.min(g, numH - 1));
    const loca = [];
    for (let g = 0; g <= numGlyphs; g++) loca.push(longLoca ? dv.getUint32(T('loca') + 4 * g) : dv.getUint16(T('loca') + 2 * g) * 2);
    // cmap định dạng 4 (Unicode BMP – đủ cho Latin + tiếng Việt)
    const cmap = new Map(), c = T('cmap');
    for (let i = 0, n = dv.getUint16(c + 2); i < n; i++) {
      const pid = dv.getUint16(c + 4 + i * 8), eid = dv.getUint16(c + 6 + i * 8), st = c + dv.getUint32(c + 8 + i * 8);
      if (pid !== 3 || eid !== 1 || dv.getUint16(st) !== 4) continue;
      const seg = dv.getUint16(st + 6) / 2, ends = st + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
      for (let s = 0; s < seg; s++) {
        const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2), delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ranges + s * 2);
        for (let u = start; u <= end && u !== 0xffff; u++) {
          const g = ro ? dv.getUint16(ranges + s * 2 + ro + (u - start) * 2) : u;
          if (g) cmap.set(u, (g + (ro ? 0 : delta)) & 0xffff);
        }
      }
    }
    const os2 = tables['OS/2'] ? T('OS/2') : null;
    return {
      buf, tables, upem, bbox, adv, loca, cmap,
      ascent: Math.round((dv.getInt16(T('hhea') + 4) * 1000) / upem), descent: Math.round((dv.getInt16(T('hhea') + 6) * 1000) / upem),
      capHeight: os2 && dv.getUint16(os2) >= 2 ? Math.round((dv.getInt16(os2 + 88) * 1000) / upem) : 700,
    };
  }

  // Font rút gọn: giữ nguyên số hiệu glyph, glyph không dùng để rỗng (font đã tách glyph ghép nên không cần dò thành phần)
  function subsetFont(f, used) {
    const glyphs = [], loca = new DataView(new ArrayBuffer((f.adv.length + 1) * 4));
    let size = 0;
    for (let g = 0; g < f.adv.length; g++) {
      loca.setUint32(g * 4, size);
      if (!used.has(g) && g !== 0) continue;
      const d = f.buf.subarray(f.tables.glyf.off + f.loca[g], f.tables.glyf.off + f.loca[g + 1]);
      glyphs.push(d); size += d.length;
      if (size % 4) { glyphs.push(new Uint8Array(4 - (size % 4))); size += 4 - (size % 4); }
    }
    loca.setUint32(f.adv.length * 4, size);
    const glyf = new Uint8Array(size);
    let p = 0;
    for (const d of glyphs) { glyf.set(d, p); p += d.length; }
    const head = f.buf.slice(f.tables.head.off, f.tables.head.off + f.tables.head.len);
    new DataView(head.buffer).setInt16(50, 1); // loca dạng 32 bit
    new DataView(head.buffer).setUint32(8, 0);
    const out = { glyf, loca: new Uint8Array(loca.buffer), head };
    for (const t of ['hhea', 'maxp', 'hmtx', 'cmap', 'post', 'name', 'OS/2']) if (f.tables[t]) out[t] = f.buf.subarray(f.tables[t].off, f.tables[t].off + f.tables[t].len);
    const tags = Object.keys(out).sort(), n = tags.length;
    let total = 12 + n * 16;
    for (const t of tags) total += (out[t].length + 3) & ~3;
    const res = new Uint8Array(total), dv = new DataView(res.buffer);
    const es = Math.floor(Math.log2(n));
    dv.setUint32(0, 0x00010000); dv.setUint16(4, n); dv.setUint16(6, 16 << es); dv.setUint16(8, es); dv.setUint16(10, n * 16 - (16 << es));
    let off = 12 + n * 16;
    tags.forEach((t, i) => {
      const d = out[t], padded = (d.length + 3) & ~3;
      res.set(d, off);
      let sum = 0;
      for (let k = 0; k < padded; k += 4) sum = (sum + dv.getUint32(off + k)) >>> 0;
      for (let k = 0; k < 4; k++) res[12 + i * 16 + k] = t.charCodeAt(k);
      dv.setUint32(12 + i * 16 + 4, sum); dv.setUint32(12 + i * 16 + 8, off); dv.setUint32(12 + i * 16 + 12, d.length);
      off += padded;
    });
    return res;
  }

  let fontsPromise = null;
  const loadFonts = () => (fontsPromise ||= Promise.all(['regular', 'bold', 'italic'].map(async (n) =>
    parseFont(new Uint8Array(await (await fetch(chrome.runtime.getURL(`src/content/fonts/pdf-${n}.ttf`))).arrayBuffer())))));

  const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

  // ---------- Trang + chữ ----------
  const W = 595.28, H = 841.89, M = 28; // A4, khung viền cách mép 10 mm
  const FRAME = 24, TOP = FRAME + 10, BOTTOM = H - M - 30; // khung viền: dòng ghi chú phía trên, chân trang phía dưới
  const hex4 = (n) => n.toString(16).padStart(4, '0');
  const num = (v) => (Math.round(v * 100) / 100).toString();

  class Doc {
    constructor(fonts) {
      this.fonts = fonts.map((f) => ({ f, used: new Map() })); // used: glyph → ký tự (cho ToUnicode)
      this.pages = []; this.newPage();
    }
    newPage() { this.ops = []; this.pages.push(this.ops); this.y = TOP; }
    // Kiểu chữ: 0 thường · 1 đậm · 2 nghiêng
    glyphs(s, st) {
      const F = this.fonts[st];
      return [...String(s ?? '').normalize('NFC').replace(/[\t\r\n]+/g, ' ')].map((ch) => {
        const g = F.f.cmap.get(ch.codePointAt(0)) ?? F.f.cmap.get(63); // ký tự ngoài font → "?"
        return { g, ch };
      });
    }
    width(s, size, st = 0) { const f = this.fonts[st].f; return this.glyphs(s, st).reduce((w, x) => w + f.adv[x.g], 0) * size / f.upem; }
    text(x, y, s, { size = 9, bold = false, italic = false, align = 'left', w = 0, color } = {}) {
      if (s === null || s === undefined || s === '') return 0;
      const st = bold ? 1 : italic ? 2 : 0, F = this.fonts[st], gs = this.glyphs(s, st);
      for (const { g, ch } of gs) if (!F.used.has(g)) F.used.set(g, ch);
      const tw = this.width(s, size, st);
      const tx = align === 'right' ? x + w - tw : align === 'center' ? x + (w - tw) / 2 : x;
      this.ops.push(`BT${color ? ` ${color} rg` : ''} /F${st + 1} ${size} Tf 1 0 0 1 ${num(tx)} ${num(H - y - size * 0.8)} Tm <${gs.map((x) => hex4(x.g)).join('')}> Tj ET${color ? ' 0 g' : ''}`);
      return tw;
    }
    // Nhiều đoạn chữ khác kiểu trên 1 dòng: [{ t, bold, italic, color }]
    runs(x, y, parts, { size = 9, align = 'left', w = 0 } = {}) {
      const st = (p) => (p.bold ? 1 : p.italic ? 2 : 0);
      const tw = parts.reduce((s, p) => s + this.width(p.t, size, st(p)), 0);
      let cx = align === 'right' ? x + w - tw : align === 'center' ? x + (w - tw) / 2 : x;
      for (const p of parts) cx += this.text(cx, y, p.t, { size, ...p });
      return tw;
    }
    // Ngắt dòng theo độ rộng (từ quá dài thì cắt theo ký tự)
    wrap(s, width, size, st = 0) {
      const out = [];
      for (const para of String(s ?? '').normalize('NFC').split(/\r?\n/)) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
          const t = line ? `${line} ${word}` : word;
          if (this.width(t, size, st) <= width) { line = t; continue; }
          if (line) out.push(line);
          line = word;
          while (this.width(line, size, st) > width && line.length > 1) {
            let k = line.length - 1;
            while (k > 1 && this.width(line.slice(0, k), size, st) > width) k--;
            out.push(line.slice(0, k)); line = line.slice(k);
          }
        }
        out.push(line);
      }
      return out;
    }
    para(x, y, s, width, opt = {}) {
      const size = opt.size || 9, lh = size * 1.3, lines = this.wrap(s, width, size, opt.bold ? 1 : opt.italic ? 2 : 0);
      lines.forEach((l, i) => this.text(x, y + i * lh, l, { ...opt, w: width }));
      return lines.length * lh;
    }
    rect(x, y, w, h, { fill, stroke = true, color, lw = 0.6 } = {}) {
      this.ops.push(`${fill ? `${fill} rg ` : ''}${color ? `${color} RG ` : ''}${lw} w ${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}${fill ? ' 0 g' : ''}${color ? ' 0 G' : ''}`);
    }
    line(x1, y1, x2, y2, color, lw = 0.6) { this.ops.push(`${color ? `${color} RG ` : ''}${lw} w ${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S${color ? ' 0 G' : ''}`); }

    async build(title) {
      const objs = [];
      const add = (body) => { objs.push(body); return objs.length; };
      const stream = (dict, data) => ({ dict, data });
      const fontRefs = [];
      for (const [i, F] of this.fonts.entries()) {
        const f = F.f, gids = [...F.used.keys()].sort((a, b) => a - b);
        const name = `HDDTP${'ABC'[i]}+Tinos-${['Regular', 'Bold', 'Italic'][i]}`;
        const file = await deflate(subsetFont(f, new Set(gids)));
        const fileRef = add(stream(`/Length ${file.length} /Filter /FlateDecode`, file));
        const desc = add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${i === 2 ? 96 : 32} /FontBBox [${f.bbox.join(' ')}] /ItalicAngle ${i === 2 ? -12 : 0} /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV ${i === 1 ? 120 : 80} /FontFile2 ${fileRef} 0 R >>`);
        const widths = gids.map((g) => `${g} [${Math.round((f.adv[g] * 1000) / f.upem)}]`).join(' ');
        const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 0 /W [${widths}] /CIDToGIDMap /Identity >>`);
        const chunks = [];
        for (let k = 0; k < gids.length; k += 100) {
          const part = gids.slice(k, k + 100);
          chunks.push(`${part.length} beginbfchar\n${part.map((g) => `<${hex4(g)}> <${[...F.used.get(g)].map((c) => hex4(c.charCodeAt(0))).join('')}>`).join('\n')}\nendbfchar`);
        }
        const cmap = enc.encode(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${chunks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`);
        const cm = await deflate(cmap);
        const uni = add(stream(`/Length ${cm.length} /Filter /FlateDecode`, cm));
        fontRefs.push(add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${uni} 0 R >>`));
      }
      const pagesId = add(null), kids = []; // điền sau khi biết các trang
      for (const ops of this.pages) {
        const data = await deflate(enc.encode(ops.join('\n')));
        const content = add(stream(`/Length ${data.length} /Filter /FlateDecode`, data));
        kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontRefs[0]} 0 R /F2 ${fontRefs[1]} 0 R /F3 ${fontRefs[2]} 0 R >> >> /Contents ${content} 0 R >>`));
      }
      objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
      const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
      const utf16 = (s) => `<FEFF${[...s].map((c) => hex4(c.charCodeAt(0))).join('')}>`;
      const info = add(`<< /Title ${utf16(title)} /Producer ${utf16('Tiện ích hỗ trợ tải hóa đơn')} >>`);

      const parts = [enc.encode('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')], offsets = [];
      let len = parts[0].length;
      const push = (b) => { parts.push(b); len += b.length; };
      objs.forEach((o, i) => {
        offsets.push(len);
        if (typeof o === 'string') { push(enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)); return; }
        push(enc.encode(`${i + 1} 0 obj\n<< ${o.dict} >>\nstream\n`)); push(o.data); push(enc.encode('\nendstream\nendobj\n'));
      });
      const xref = len;
      push(enc.encode(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
      const out = new Uint8Array(len);
      let p = 0;
      for (const b of parts) { out.set(b, p); p += b.length; }
      return out;
    }
  }

  // ---------- Dữ liệu hóa đơn ----------
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (v, dec = 4) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? ''
    : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: dec }));
  const nz = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  // Ngày có múi giờ (tdlap của cổng là giờ UTC) → đổi sang giờ máy; ngày trong XML (NLap, SigningTime) giữ nguyên
  const dmy = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    if (m && !/(Z|[+-]\d\d:?\d\d)$/.test(s)) return [m[3], m[2], m[1]];
    const d = new Date(s);
    return !s || Number.isNaN(+d) ? null : [pad(d.getDate()), pad(d.getMonth() + 1), d.getFullYear()];
  };
  const FEE_NAMES = { OtherTaxes: 'Thuế, phí khác', OtherFees: 'Phí khác' };
  const TITLES = { 1: 'HÓA ĐƠN GIÁ TRỊ GIA TĂNG', 2: 'HÓA ĐƠN BÁN HÀNG', 3: 'HÓA ĐƠN BÁN TÀI SẢN CÔNG', 4: 'HÓA ĐƠN BÁN HÀNG DỰ TRỮ QUỐC GIA', 5: 'HÓA ĐƠN', 6: 'PHIẾU XUẤT KHO' };
  const TITLES_EN = { 1: 'VAT Invoice', 2: 'Sales Invoice' };

  // Đọc số tiền bằng chữ (dùng khi hóa đơn không ghi sẵn)
  const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  function words3(n, full) {
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10, out = [];
    if (full || h) out.push(DIGITS[h], 'trăm');
    if (t > 1) out.push(DIGITS[t], 'mươi'); else if (t === 1) out.push('mười'); else if (u && (full || h)) out.push('lẻ');
    if (u) out.push(u === 1 && t > 1 ? 'mốt' : u === 5 && t ? 'lăm' : u === 4 && t > 1 ? 'tư' : DIGITS[u]);
    return out.join(' ');
  }
  function moneyWords(v, unit) {
    let n = Math.round(Math.abs(v));
    if (!n) return '';
    const groups = [];
    while (n) { groups.unshift(n % 1000); n = Math.floor(n / 1000); }
    const UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'], out = [];
    groups.forEach((g, i) => { if (g) out.push(words3(g, i > 0), UNITS[groups.length - 1 - i]); });
    const s = out.filter(Boolean).join(' ');
    return `${s[0].toUpperCase()}${s.slice(1)} ${unit === 'VND' ? 'đồng' : unit}.`;
  }

  // Phần thông tin cần cho bản thể hiện, từ XML gốc (TT78) hoặc JSON chi tiết
  function fromXml(xmlBytes) {
    const doc = new DOMParser().parseFromString(Zip.text(xmlBytes), 'application/xml');
    const one = (tag, el = doc) => el?.getElementsByTagNameNS('*', tag)[0];
    const kid = (el, tag) => (el ? [...el.children].find((c) => c.localName === tag) : undefined);
    const v = (el, tag) => kid(el, tag)?.textContent?.trim() ?? '';
    const tc = one('TTChung'), nb = one('NBan'), nm = one('NMua'), tt = one('TToan');
    return {
      title: v(tc, 'THDon'), stk: [v(nb, 'STKNHang'), v(nb, 'TNHang')].filter(Boolean).join(' – '), nbsdt: v(nb, 'SDThoai'), nbemail: v(nb, 'DCTDTu'),
      nmhvt: v(nm, 'HVTNMHang'), nmstk: [v(nm, 'STKNHang'), v(nm, 'TNHang')].filter(Boolean).join(' – '),
      chu: v(tt, 'TgTTTBChu'), ttcktmai: nz(v(tt, 'TTCKTMai')),
      rates: [...(one('THTTLTSuat', tt)?.children || [])].map((x) => ({ tsuat: v(x, 'TSuat'), thtien: nz(v(x, 'ThTien')), tthue: nz(v(x, 'TThue')) })),
      msttcgp: v(tc, 'MSTTCGP'),
    };
  }
  function fromDetail(d) {
    return {
      title: d.thdon || '', stk: [d.nbstkhoan, d.nbtnhang].filter(Boolean).join(' – '), nbsdt: d.nbsdthoai || '', nbemail: d.nbdctdtu || '',
      nmhvt: d.nmtnmua || '', nmstk: [d.nmstkhoan, d.nmtnhang].filter(Boolean).join(' – '),
      chu: d.tgtttbchu || '', ttcktmai: nz(d.ttcktmai),
      rates: (d.thttltsuat || []).map((x) => ({ tsuat: x.tsuat, thtien: nz(x.thtien), tthue: nz(x.tthue) })), msttcgp: d.msttcgp || '',
    };
  }


  // ---------- Bố cục: theo mẫu thể hiện thường gặp của HĐĐT (khung viền, nhãn song ngữ, dòng số cột) ----------
  const MUTED = '0.35 0.35 0.35', RED = '0.75 0.1 0.1', BLUE = '0.1 0.2 0.55', HEAD_FILL = '0.94 0.94 0.94', LIGHT = '0.75 0.75 0.75';
  const X0 = M + 8, CW = W - 2 * M - 16; // vùng nội dung trong khung
  const rateKey = (t) => String(t || '').trim();

  // row: dòng danh sách của cổng; inv: kết quả HDDT.fetchInvoice; lookup: { name, link, code } nhà cung cấp + tra cứu
  async function buildInvoicePdf(row, inv, lookup = {}) {
    const doc = new Doc(await loadFonts());
    const h = inv.head || {}, x = inv.source === 'xml' ? fromXml(inv.xml) : fromDetail(inv.json || {});
    const unit = h.dvtte || row.dvtte || 'VND', mau = String(h.khmshdon || row.khmshdon || '');
    const khhdon = h.khhdon || row.khhdon, shdon = String(h.shdon || row.shdon || '');

    // "Nhãn (Label): giá trị" – giá trị ngắt dòng trong phần còn lại; nhãn quá dài thì giá trị xuống dòng
    const field = (x0, y, w, vn, en, value, opt = {}) => {
      if (value === null || value === undefined || value === '') return 0;
      const size = opt.size || 9.5;
      const lw = doc.runs(x0, y, [{ t: `${vn} ` }, ...(en ? [{ t: `(${en})`, italic: true }] : []), { t: ': ' }], { size });
      const vx = lw > w * 0.6 ? x0 + 12 : x0 + lw, vy = lw > w * 0.6 ? y + size * 1.3 : y;
      return vy - y + doc.para(vx, vy, String(value), x0 + w - vx, { size, bold: opt.bold, color: opt.color });
    };
    const rule = (y) => doc.line(M, y, W - M, y);

    // --- Phần đầu: tiêu đề giữa, ký hiệu / số bên phải ---
    const head = () => {
      const rw = 150, tw = CW - 2 * rw, tx = X0 + rw;
      let y = doc.y + 4;
      const title = (x.title || TITLES[mau] || 'HÓA ĐƠN').toUpperCase();
      y += doc.para(tx, y, title, tw, { size: 15, bold: true, align: 'center', color: BLUE });
      const en = TITLES_EN[mau];
      if (en) { doc.text(tx, y, `(${en})`, { size: 10, italic: true, w: tw, align: 'center' }); y += 14; }
      const d = dmy(h.nlap || row.tdlap);
      if (d) {
        doc.runs(tx, y + 2, [{ t: 'Ngày ' }, { t: '(Date) ', italic: true }, { t: d[0], bold: true }, { t: ' tháng ' }, { t: '(month) ', italic: true },
          { t: d[1], bold: true }, { t: ' năm ' }, { t: '(year) ', italic: true }, { t: String(d[2]), bold: true }], { size: 9.5, w: tw, align: 'center' });
        y += 15;
      }
      if (h.mccqt) {
        doc.runs(X0, y, [{ t: 'Mã của CQT ' }, { t: '(Code): ', italic: true }, { t: h.mccqt, bold: true }], { size: 9, w: CW, align: 'center' });
        y += 13;
      }
      // Bên phải: mẫu số, ký hiệu, số
      let ry = doc.y + 6;
      const rx = X0 + CW - rw + 20;
      for (const [vn, en, v, opt] of [['Mẫu số', 'Form', mau], ['Ký hiệu', 'Serial', khhdon, { bold: true }], ['Số', 'No.', shdon, { bold: true, color: RED, size: 11 }]]) {
        ry += field(rx, ry, rw - 20, vn, en, v, opt) + 1;
      }
      doc.y = Math.max(y, ry) + 2;
      const rel = h.related;
      if (rel?.shdon) {
        const kind = rel.tchdon === '1' ? 'Thay thế cho' : rel.tchdon === '2' ? 'Điều chỉnh cho' : 'Liên quan đến';
        const rd = dmy(rel.nlap);
        doc.y += doc.para(X0, doc.y, `${kind} hóa đơn mẫu số ${rel.khmshdon} ký hiệu ${rel.khhdon} số ${rel.shdon}${rd ? ` ngày ${rd.join('/')}` : ''}${rel.gchu ? ` – ${rel.gchu}` : ''}`, CW, { size: 9, italic: true, align: 'center', color: RED });
      }
      doc.y += 4; rule(doc.y); doc.y += 6;
    };
    head();

    // --- Người bán ---
    doc.y += field(X0, doc.y, CW, 'Đơn vị bán hàng', 'Seller', h.nbten || row.nbten, { bold: true, size: 10.5 }) + 1;
    doc.y += field(X0, doc.y, CW, 'Mã số thuế', 'Tax code', h.nbmst || row.nbmst, { bold: true }) + 1;
    doc.y += field(X0, doc.y, CW, 'Địa chỉ', 'Address', h.nbdchi) + 1;
    const half = (CW - 12) / 2;
    const pair = (a, b) => {
      const ha = a ? field(X0, doc.y, b?.[2] ? half : CW, ...a) : 0;
      const hb = b?.[2] ? field(a?.[2] ? X0 + half + 12 : X0, doc.y, a?.[2] ? half : CW, ...b) : 0;
      doc.y += Math.max(ha, hb) + (ha || hb ? 1 : 0);
    };
    pair(['Điện thoại', 'Tel', x.nbsdt], ['Email', '', x.nbemail]);
    doc.y += field(X0, doc.y, CW, 'Số tài khoản', 'Account No.', x.stk) + 1;
    doc.y += 4; rule(doc.y); doc.y += 6;

    // --- Người mua ---
    doc.y += field(X0, doc.y, CW, 'Họ tên người mua hàng', 'Buyer', x.nmhvt) + 1;
    doc.y += field(X0, doc.y, CW, 'Tên đơn vị', 'Company name', h.nmten || row.nmten, { bold: true }) + 1;
    doc.y += field(X0, doc.y, CW, 'Mã số thuế', 'Tax code', h.nmmst || row.nmmst, { bold: true }) + 1;
    doc.y += field(X0, doc.y, CW, 'Địa chỉ', 'Address', h.nmdchi) + 1;
    pair(['Hình thức thanh toán', 'Payment method', h.httt || row.httt], ['Số tài khoản', 'Account No.', x.nmstk]);
    if (unit !== 'VND') pair(['Đồng tiền thanh toán', 'Currency', unit], ['Tỷ giá', 'Exchange rate', fmt(h.tgia || row.tgia)]);
    doc.y += 6;

    // --- Bảng hàng hóa: 1 thuế suất → 6 cột (thuế ghi ở phần tổng), nhiều thuế suất → 8 cột ---
    const lines = [...(inv.lines || []), ...(inv.fees || []).map((p) => ({ ten: FEE_NAMES[p.ten] || p.ten || 'Phí, lệ phí', thtien: p.tien, phi: true }))];
    const rateSet = new Set(lines.filter((l) => !l.phi && l.tsuat).map((l) => rateKey(l.tsuat)));
    const multi = rateSet.size > 1;
    const cols = multi
      ? [['STT', 'No.', 26, 'center', '1'], ['Tên hàng hóa, dịch vụ', 'Name of goods and services', 0, 'left', '2'], ['Đơn vị tính', 'Unit', 44, 'center', '3'],
        ['Số lượng', 'Quantity', 46, 'right', '4'], ['Đơn giá', 'Unit price', 62, 'right', '5'], ['Thành tiền chưa thuế', 'Amount', 72, 'right', '6=4x5'],
        ['Thuế suất', 'VAT rate', 40, 'center', '7'], ['Tiền thuế', 'VAT amount', 62, 'right', '8=6x7']]
      : [['STT', 'No.', 30, 'center', '1'], ['Tên hàng hóa, dịch vụ', 'Name of goods and services', 0, 'left', '2'], ['Đơn vị tính', 'Unit', 54, 'center', '3'],
        ['Số lượng', 'Quantity', 56, 'right', '4'], ['Đơn giá', 'Unit price', 76, 'right', '5'], ['Thành tiền', 'Amount', 90, 'right', '6=4x5']];
    cols[1][2] = CW - cols.reduce((s, c) => s + c[2], 0);
    const colX = []; cols.reduce((cx, c) => { colX.push(cx); return cx + c[2]; }, X0);
    const lastX = colX[cols.length - 1], lastW = cols[cols.length - 1][2];
    const amtCol = multi ? 5 : 5;

    const tableHead = () => {
      cols.forEach(([vn, en, w], i) => {
        doc.rect(colX[i], doc.y, w, 28, { fill: HEAD_FILL });
        const l1 = doc.wrap(vn, w - 4, 8.5, 1), l2 = doc.wrap(`(${en})`, w - 4, 7.5, 2), lines2 = [...l1.map((t) => [t, 1]), ...l2.map((t) => [t, 2])];
        const top = doc.y + (28 - lines2.length * 9) / 2;
        lines2.forEach(([t, st], k) => doc.text(colX[i] + 2, top + k * 9, t, { size: st === 1 ? 8.5 : 7.5, bold: st === 1, italic: st === 2, w: w - 4, align: 'center' }));
      });
      doc.y += 28;
      cols.forEach(([, , w, , n], i) => { doc.rect(colX[i], doc.y, w, 12); doc.text(colX[i], doc.y + 2, n, { size: 7.5, italic: true, w, align: 'center' }); });
      doc.y += 12;
    };
    const newPage = () => {
      doc.newPage();
      doc.text(X0, doc.y, `Hóa đơn ký hiệu ${khhdon} số ${shdon} (tiếp theo)`, { size: 8.5, italic: true, color: MUTED });
      doc.y += 14;
    };
    // Dòng hàng: viền dọc từng cột, kẻ ngang mảnh giữa các dòng
    const bodyRow = (cells, rh, opt = {}) => {
      cols.forEach(([, , w, a], i) => {
        doc.line(colX[i], doc.y, colX[i], doc.y + rh);
        (cells[i] || []).forEach((t, k) => doc.text(colX[i] + 3, doc.y + 3 + k * 11, t, { size: 9, w: w - 6, align: a, italic: opt.italic, color: opt.color }));
      });
      doc.line(X0 + CW, doc.y, X0 + CW, doc.y + rh);
      doc.y += rh;
      doc.line(X0, doc.y, X0 + CW, doc.y, LIGHT, 0.4);
    };
    tableHead();
    let stt = 0;
    for (const l of lines) {
      const note = l.tchat === 'Ghi chú, diễn giải';
      const ten = l.ten + (l.tchat === 'Khuyến mại' && !/khuyến mại/i.test(l.ten) ? ' (khuyến mại)' : l.tchat === 'Chiết khấu thương mại' && !/chiết khấu/i.test(l.ten) ? ' (chiết khấu)' : '');
      const base = [note || l.phi ? '' : String(++stt), ten, l.dvt || '', fmt(l.sl), fmt(l.dgia), fmt(l.thtien, 2)];
      const cells = (multi ? [...base, l.tsuat || '', fmt(l.tthue, 2)] : base).map((t, i) => (i === 1 ? doc.wrap(t, cols[1][2] - 6, 9) : [t]));
      const rh = Math.max(...cells.map((c) => c.length)) * 11 + 5;
      if (doc.y + rh > BOTTOM) { doc.line(X0, doc.y, X0 + CW, doc.y); newPage(); tableHead(); }
      bodyRow(cells, rh, { italic: note, color: note ? MUTED : undefined });
    }

    // --- Phần tổng ---
    const rates = (x.rates.length ? x.rates : row.rates || []).filter((r) => r.thtien || r.tthue);
    const cthue = h.tgtcthue ?? row.tgtcthue, thue = h.tgtthue ?? row.tgtthue, tong = h.tgtttbso ?? row.tgtttbso;
    const has = (v) => v !== null && v !== undefined && v !== '';
    const sums = []; // [nhãn (runs), giá trị cột thành tiền, giá trị cột tiền thuế (nhiều thuế suất)]
    const L = (vn, en, bold) => [{ t: `${vn} `, bold }, { t: `(${en})`, italic: true }, { t: ':', bold }];
    if (multi) {
      for (const r of rates) sums.push([L(`Tổng tiền chịu thuế suất ${r.tsuat}`, `Amount at VAT rate ${r.tsuat}`), fmt(r.thtien, 2), fmt(r.tthue, 2)]);
      if (has(cthue) || has(thue)) sums.push([L('Cộng tiền hàng, tiền thuế', 'Total amount, VAT amount', true), fmt(cthue, 2), fmt(thue, 2), true]);
    } else {
      if (has(cthue)) sums.push([L('Cộng tiền hàng', 'Total amount'), fmt(cthue, 2)]);
      const ts = rates[0]?.tsuat || [...rateSet][0];
      if (has(thue) || ts) sums.push([[...L('Thuế suất GTGT', 'VAT rate'), { t: ` ${ts || ''}`, bold: true }, { t: '          Tiền thuế GTGT ' }, { t: '(VAT amount)', italic: true }, { t: ':' }], fmt(thue, 2)]);
    }
    if (row.tgtphi) sums.push([L('Tiền phí, lệ phí', 'Fees'), fmt(row.tgtphi, 2)]);
    if (x.ttcktmai) sums.push([L('Chiết khấu thương mại', 'Trade discount'), fmt(x.ttcktmai, 2)]);
    if (has(tong)) sums.push([L('Tổng cộng tiền thanh toán', 'Total payment', true), fmt(tong, 2), null, true]);
    const chu = x.chu || (has(tong) ? moneyWords(tong, unit) : '');
    const wordsLines = chu ? doc.wrap(chu, CW - 200, 9.5, 1) : [];
    const sumH = sums.length * 16 + (chu ? wordsLines.length * 12.5 + 6 : 0);
    const signH = 120;

    // Dòng trống cho kín khung như bản giấy (chỉ khi còn chỗ cho phần tổng + chữ ký trên cùng trang)
    for (let k = 0; k < 10 && doc.y + 15 + sumH + signH <= BOTTOM; k++) bodyRow([], 15);
    if (doc.y + sumH + signH > BOTTOM) { doc.line(X0, doc.y, X0 + CW, doc.y); newPage(); }
    doc.line(X0, doc.y, X0 + CW, doc.y);
    const taxX = multi ? colX[7] : null, amtX = colX[amtCol], amtW = cols[amtCol][2];
    for (const [label, a, t, bold] of sums) {
      doc.rect(X0, doc.y, CW, 16);
      doc.runs(X0 + 4, doc.y + 4, label, { size: 9.5 });
      const right = multi ? amtX : lastX;
      doc.line(right, doc.y, right, doc.y + 16);
      doc.text(right + 3, doc.y + 4, a, { size: 9.5, bold, w: (multi ? amtW : lastW) - 6, align: 'right' });
      if (multi) { doc.line(colX[6], doc.y, colX[6], doc.y + 16); doc.line(taxX, doc.y, taxX, doc.y + 16); doc.text(taxX + 3, doc.y + 4, t || '', { size: 9.5, bold, w: cols[7][2] - 6, align: 'right' }); }
      doc.y += 16;
    }
    if (chu) {
      const rh = wordsLines.length * 12.5 + 6;
      doc.rect(X0, doc.y, CW, rh);
      const lw = doc.runs(X0 + 4, doc.y + 4, [{ t: 'Số tiền viết bằng chữ ' }, { t: '(Amount in words)', italic: true }, { t: ': ' }], { size: 9.5 });
      wordsLines.forEach((t, k) => doc.text(X0 + 4 + lw, doc.y + 4 + k * 12.5, t, { size: 9.5, bold: true, italic: false }));
      doc.y += rh;
    }
    doc.y += 12;

    // --- Chữ ký ---
    const sw = CW / 2;
    for (const [i, vn, en] of [[0, 'Người mua hàng', 'Buyer'], [1, 'Người bán hàng', 'Seller']]) {
      const sx = X0 + i * sw;
      doc.runs(sx, doc.y, [{ t: `${vn} `, bold: true }, { t: `(${en})`, italic: true }], { size: 10, w: sw, align: 'center' });
      doc.text(sx, doc.y + 13, '(Ký, ghi rõ họ tên)', { size: 8.5, italic: true, w: sw, align: 'center' });
      doc.text(sx, doc.y + 24, '(Signature & full name)', { size: 8, italic: true, w: sw, align: 'center', color: MUTED });
    }
    let sy = doc.y + 42;
    const sg = h.seller;
    if (sg) {
      // Không ghi "Signature Valid": chỉ đọc chữ ký trong XML, chưa xác thực mật mã
      const bw = 200, bx = X0 + sw + (sw - bw) / 2, GREEN = '0.1 0.5 0.25';
      const sd = sg.time ? dmy(sg.time) : null;
      const txt = [`Ký bởi: ${sg.name || sg.subject}`, ...(sd ? [`Ký ngày: ${sd.join('/')}`] : [])];
      const wrapped = txt.flatMap((t) => doc.wrap(t, bw - 12, 8.5));
      const bh = 20 + wrapped.length * 11;
      doc.rect(bx, sy, bw, bh, { color: GREEN, lw: 1 });
      doc.text(bx + 6, sy + 5, 'Chữ ký số trong XML gốc', { size: 8.5, bold: true, color: GREEN });
      wrapped.forEach((t, k) => doc.text(bx + 6, sy + 17 + k * 11, t, { size: 8.5, color: GREEN }));
      sy += bh + 8;
    } else {
      if (inv.source !== 'xml') doc.text(X0 + sw, sy, 'Cổng không có XML gốc – không có thông tin chữ ký số', { size: 8, italic: true, w: sw, align: 'center', color: MUTED });
      sy += 22;
    }
    doc.text(X0, sy, '(Cần kiểm tra, đối chiếu khi lập, giao, nhận hóa đơn)', { size: 8.5, italic: true, w: CW, align: 'center' });

    // --- Khung viền, ghi chú, chân trang mọi trang ---
    const look = [lookup.code && `Mã tra cứu (Lookup code): ${lookup.code}`, lookup.link && `Tra cứu bản gốc tại: ${lookup.link}`, lookup.name && `Nhà cung cấp HĐĐT: ${lookup.name}`].filter(Boolean).join('   ·   ');
    doc.pages.forEach((ops, i) => {
      doc.ops = ops;
      doc.text(M, 10, 'Bản thể hiện dựng từ dữ liệu trên hoadondientu.gdt.gov.vn – không phải bản PDF gốc của nhà cung cấp hóa đơn điện tử', { size: 7, italic: true, color: MUTED, w: W - 2 * M, align: 'center' });
      doc.rect(M, FRAME, W - 2 * M, H - M - FRAME, { lw: 1 });
      doc.line(M, BOTTOM + 4, W - M, BOTTOM + 4, LIGHT, 0.4);
      if (look) doc.para(X0, BOTTOM + 8, look, CW - 60, { size: 7.5, color: MUTED });
      doc.text(X0, BOTTOM + 8, `Trang ${i + 1}/${doc.pages.length}`, { size: 7.5, italic: true, color: MUTED, w: CW, align: 'right' });
    });
    return doc.build(`Hóa đơn ${khhdon} số ${shdon}`);
  }

  window.Pdf = { buildInvoicePdf, moneyWords };
})();
