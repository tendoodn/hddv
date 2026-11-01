// Ghi file .xlsx tối giản (nhiều sheet, dòng tiêu đề in đậm + cố định, số có dấu phân cách nghìn).
// sheets: [{ name, columns: [{ header, width, type: 'text'|'number'|'int'|'pct' (tỷ lệ 0.08 = 8%), fills?: { 'giá trị': 'ok'|'warn'|'bad' } }], rows: [[...]], totalRow?: boolean, boldRows?: Set<chỉ số dòng> }]
// Sheet theo mẫu (vd bảng kê tải lên HTKK): { name, layout: true, widths: [...], rows: [[giá trị | { v, s } | { f, s }]],
//   rowProps?: Map<chỉ số dòng, { ht, hidden }>, merges?: ['B26:B28'], freeze?: 'A5' } – không có dòng tiêu đề tự động, không lọc.
//   { f: 'D9+F9-H9' } là công thức, Excel tự tính khi mở file (calcPr fullCalcOnLoad).
(() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''); // ký tự điều khiển làm hỏng XML
  const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  // Style: 0 thường · 1 tiêu đề · 2 số #,##0 · 3 số #,##0.#### · 4 chữ đậm · 5 số đậm
  // Sheet theo mẫu HTKK (chữ 8pt, viền mảnh): 6 tiêu đề bảng · 7 tên mục (đậm 11pt) · 8 chữ · 9 số #,##0 · 10 STT · 11 số #,##0.0
  // Sheet theo mẫu cỡ chữ thường (11pt, viền mảnh) từ 12: ô thường / tô màu (chg vàng = khác, new xanh = thêm mới,
  // out cam = ngoài khoảng ngày, gone đỏ = không còn) × chữ / số nguyên / số lẻ; hd tiêu đề; big tiêu đề sheet; sum dòng cộng.
  const FILLS = { chg: 'FFFFF2CC', new: 'FFE2EFDA', out: 'FFFCE4D6', gone: 'FFFFC7CE' };
  const xfs = ['<xf/>', '<xf fontId="1" fillId="2" applyFont="1" applyFill="1"/>', '<xf numFmtId="3" applyNumberFormat="1"/>', '<xf numFmtId="164" applyNumberFormat="1"/>',
    '<xf fontId="1" applyFont="1"/>', '<xf numFmtId="3" fontId="1" applyNumberFormat="1" applyFont="1"/>',
    '<xf fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    '<xf fontId="1" applyFont="1"/>', '<xf fontId="2" borderId="1" applyFont="1" applyBorder="1"/>',
    '<xf numFmtId="3" fontId="2" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>',
    '<xf fontId="2" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="165" fontId="2" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'];
  const LAYOUT_STYLE = { head: 6, title: 7, text: 8, int: 9, stt: 10, dec: 11 };
  const fillIds = Object.fromEntries(Object.keys(FILLS).map((k, i) => [k, 4 + i]));
  const addXf = (name, xml) => { LAYOUT_STYLE[name] = xfs.length; xfs.push(xml); };
  for (const [pre, fill] of [['', 0], ...Object.keys(FILLS).map((k) => [k, fillIds[k]])]) {
    const f = fill ? ` fillId="${fill}" applyFill="1"` : '';
    addXf(pre || 'cell',`<xf borderId="1"${f} applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>`);
    addXf(pre ? `${pre}Int` : 'cellInt', `<xf numFmtId="3" borderId="1"${f} applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>`);
    addXf(pre ? `${pre}Dec` : 'cellDec', `<xf numFmtId="164" borderId="1"${f} applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>`);
  }
  addXf('hd', '<xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>');
  addXf('big', '<xf fontId="4" applyFont="1"/>');
  addXf('sum', '<xf numFmtId="3" fontId="1" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>');
  addXf('sumText', '<xf fontId="1" borderId="1" applyFont="1" applyBorder="1"/>');
  addXf('note', '<xf fontId="5" applyFont="1"/>');
  // Cột có fills (vd Kết quả của sheet Kiểm tra rủi ro HĐ): ô chữ tô nền theo giá trị
  const CELL_FILL = { ok: 'new', warn: 'chg', bad: 'gone' };
  const FILL_STYLE = {};
  for (const [k, f] of Object.entries(CELL_FILL)) { FILL_STYLE[k] = xfs.length; xfs.push(`<xf fontId="1" fillId="${fillIds[f]}" applyFont="1" applyFill="1"/>`); }
  const LINK_STYLE = xfs.length;
  xfs.push('<xf fontId="6" applyFont="1"/>');
  // Cột 'pct' (thuế suất): số dạng phần trăm, 0% khi tròn (8%), 0.00% khi có lẻ (5,26%)
  const PCT_STYLE = xfs.length;
  xfs.push('<xf numFmtId="9" applyNumberFormat="1"/>', '<xf numFmtId="10" applyNumberFormat="1"/>');
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.####"/><numFmt numFmtId="165" formatCode="#,##0.0"/></numFmts>
<fonts count="7"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="8"/><name val="Calibri"/></font><font><b/><sz val="8"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts>
<fills count="${4 + Object.keys(FILLS).length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F0FA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCCFFCC"/></patternFill></fill>${Object.values(FILLS).map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/></patternFill></fill>`).join('')}</fills>
<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function cell(ref, v, type, bold, fill) {
    if (v === null || v === undefined || v === '') return '';
    // { link }: ô bấm mở được link (công thức HYPERLINK, giá trị đệm sẵn để hiện chữ khi chưa tính lại)
    if (typeof v === 'object' && v.link) return `<c r="${ref}" t="str" s="${LINK_STYLE}"><f>${esc(`HYPERLINK("${v.link.replace(/"/g, '""')}")`)}</f><v>${esc(v.link)}</v></c>`;
    if (fill) return `<c r="${ref}" t="inlineStr" s="${FILL_STYLE[fill]}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    if ((type === 'number' || type === 'int') && typeof v === 'number' && Number.isFinite(v)) {
      return `<c r="${ref}" s="${bold ? 5 : type === 'int' ? 2 : 3}"><v>${v}</v></c>`;
    }
    if (type === 'pct' && typeof v === 'number' && Number.isFinite(v)) {
      return `<c r="${ref}" s="${PCT_STYLE + (Number.isInteger(Math.round(v * 1e6) / 1e4) ? 0 : 1)}"><v>${v}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="4"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  function sheetXml({ columns, rows, totalRow, boldRows }) {
    const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('');
    const head = `<row r="1">${columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${esc(c.header)}</t></is></c>`).join('')}</row>`;
    const body = rows.map((r, ri) => {
      const n = ri + 2, bold = (totalRow && ri === rows.length - 1) || !!boldRows?.has(ri);
      return `<row r="${n}">${r.map((v, ci) => cell(`${colName(ci)}${n}`, v, columns[ci]?.type, bold, columns[ci]?.fills?.[v])).join('')}</row>`;
    }).join('');
    const last = `${colName(columns.length - 1)}${Math.max(rows.length + 1, 1)}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${head}${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
  }

  // Cố định các dòng phía trên ô freeze (vd 'A5' → dòng 1–4)
  const freezePane = (ref) => {
    const n = Number(/\d+$/.exec(ref || '')?.[0] || 1) - 1;
    return n > 0 ? `<pane ySplit="${n}" topLeftCell="A${n + 1}" activePane="bottomLeft" state="frozen"/>` : '';
  };
  function layoutCell(ref, x) {
    const { v, s, f } = x !== null && typeof x === 'object' ? x : { v: x };
    const st = s ? ` s="${LAYOUT_STYLE[s]}"` : '';
    if (f) return `<c r="${ref}"${st}><f>${esc(f)}</f></c>`;
    if (v === null || v === undefined || v === '') return st ? `<c r="${ref}"${st}/>` : ''; // ô trống vẫn giữ viền
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }
  function layoutXml({ widths, rows, rowProps, merges, freeze }) {
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const body = rows.map((r, ri) => {
      const p = rowProps?.get(ri) || {};
      const attr = `${p.ht ? ` ht="${p.ht}" customHeight="1"` : ''}${p.hidden ? ' hidden="1"' : ''}`;
      return `<row r="${ri + 1}"${attr}>${(r || []).map((x, ci) => layoutCell(`${colName(ci)}${ri + 1}`, x)).join('')}</row>`;
    }).join('');
    const merged = merges?.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${freezePane(freeze)}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData>${merged}</worksheet>`;
  }

  // Tên sheet Excel: tối đa 31 ký tự, loại ký tự cấm, không rỗng và không trùng.
  const cleanSheetName = (value) => {
    let name = String(value || 'Sheet').replace(/[\\[\\]:*?/\\\\]/g, ' ').trim();
    name = name.replace(/^'+|'+$/g, '').slice(0, 31).trim();
    return name || 'Sheet';
  };
  const sheetNames = (sheets) => {
    const used = new Set();
    return sheets.map((s, i) => {
      const base = cleanSheetName(s.name || ('Sheet' + (i + 1)));
      let name = base, n = 2;
      while (used.has(name.toLowerCase())) {
        const suffix = ' (' + (n++) + ')';
        name = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
      }
      used.add(name.toLowerCase());
      return name;
    });
  };

  const filterNames = (sheets, names) => {
    const defs = sheets.map((s, i) => {
      if (s.layout) return '';
      const quoted = names[i].replace(/'/g, "''");
      const lastCol = colName(Math.max(0, (s.columns && s.columns.length || 1) - 1));
      const lastRow = Math.max((s.rows && s.rows.length || 0) + 1, 1);
      return '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">' +
        "'" + esc(quoted) + "'!$A$1:$" + lastCol + '$' + lastRow + '</definedName>';
    }).join('');
    return defs ? '<definedNames>' + defs + '</definedNames>' : '';
  };
  function buildXlsx(sheets) {
    if (!Array.isArray(sheets) || !sheets.length) throw new Error('Workbook phải có ít nhất một sheet.');
    const names = sheetNames(sheets);
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(names[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${filterNames(sheets, names)}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.layout ? layoutXml(s) : sheetXml(s) })),
    ];
    return Zip.writeZip(files);
  }

  window.Xlsx = { buildXlsx };
})();
