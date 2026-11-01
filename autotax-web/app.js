(() => {
  'use strict';
  const DB_KEY = 'autotax.web.v1';
  const $ = (id) => document.getElementById(id);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const emptyDb = () => ({ version: 1, activeProfileId: null, profiles: [] });
  let db = loadDb();

  function loadDb() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
      if (parsed && parsed.version === 1 && Array.isArray(parsed.profiles)) {
        parsed.profiles = parsed.profiles.map(p => ({ ...p, invoices: Array.isArray(p.invoices) ? p.invoices : [] }));
        if (!parsed.profiles.some(p => p.id === parsed.activeProfileId)) parsed.activeProfileId = parsed.profiles[0]?.id || null;
        return parsed;
      }
    } catch (error) { console.warn('Không đọc được kho AutoTax:', error); }
    return emptyDb();
  }
  function setStatus(message, error = false) {
    $('importStatus').textContent = message;
    $('importStatus').style.color = error ? '#b44d4d' : '';
  }
  function saveDb() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return true;
    } catch (error) {
      setStatus('Không thể lưu dữ liệu: bộ nhớ trình duyệt có thể đã đầy. Hãy xuất bản sao lưu và giải phóng dung lượng.', true);
      return false;
    }
  }
  const activeProfile = () => db.profiles.find(p => p.id === db.activeProfileId) || null;
  const fmtMoney = value => Number(value || 0).toLocaleString('vi-VN');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value ?? '').trim().toLocaleLowerCase('vi');

  function render() {
    const profile = activeProfile();
    $('profileList').innerHTML = db.profiles.length ? db.profiles.map(p =>
      '<button class="profile-item '+(p.id === db.activeProfileId ? 'active' : '')+'" data-profile="'+esc(p.id)+'"><b>'+esc(p.name)+'</b><small>MST: '+esc(p.taxCode)+' · '+p.invoices.length+' hóa đơn</small></button>'
    ).join('') : '<p class="muted">Chưa có hồ sơ. Hãy thêm mã số thuế để bắt đầu.</p>';
    $('profileCount').textContent = db.profiles.length;
    const invoices = profile ? profile.invoices : [];
    $('totalCount').textContent = invoices.length;
    $('purchaseCount').textContent = invoices.filter(x => x.kind === 'purchase').length;
    $('salesCount').textContent = invoices.filter(x => x.kind === 'sales').length;
    renderInvoices();
  }
  function renderInvoices() {
    const profile = activeProfile();
    const query = norm($('searchInput').value);
    const kind = $('kindFilter').value;
    const invoices = profile ? profile.invoices.filter(x => (kind === 'all' || x.kind === kind) &&
      [x.invoiceNo,x.series,x.sellerName,x.buyerName,x.sellerTax,x.buyerTax].join(' ').toLocaleLowerCase('vi').includes(query)) : [];
    $('visibleCount').textContent = invoices.length+' hóa đơn';
    $('invoiceRows').innerHTML = invoices.length ? invoices.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(x =>
      '<tr><td>'+esc(x.date)+'</td><td>'+esc(x.invoiceNo)+'</td><td>'+esc(x.series)+'</td><td title="'+esc(x.sellerName)+'">'+esc(x.sellerName)+'</td><td title="'+esc(x.buyerName)+'">'+esc(x.buyerName)+'</td><td class="right">'+fmtMoney(x.total)+'</td><td><span class="type-pill '+(x.kind==='sales'?'sales':'')+'">'+(x.kind==='sales'?'Bán ra':x.kind==='purchase'?'Mua vào':'Chưa xác định')+'</span></td></tr>'
    ).join('') : '<tr><td colspan="7" class="empty">'+(profile ? 'Không có hóa đơn phù hợp.' : 'Hãy tạo hoặc chọn hồ sơ MST.')+'</td></tr>';
  }
  function addProfile(name, taxCode) {
    const normalized = String(taxCode).replace(/\D/g,'');
    if (!name.trim()) throw new Error('Vui lòng nhập tên hồ sơ.');
    if (!normalized || normalized.length < 10 || normalized.length > 14) throw new Error('Mã số thuế cần có từ 10 đến 14 chữ số.');
    if (db.profiles.some(p => p.taxCode === normalized)) throw new Error('Mã số thuế này đã có trong danh sách hồ sơ.');
    const p = { id: uid(), name: name.trim(), taxCode: normalized, invoices: [], createdAt: new Date().toISOString() };
    db.profiles.push(p); db.activeProfileId = p.id;
    if (saveDb()) render();
    else { db.profiles.pop(); db.activeProfileId = db.profiles[0]?.id || null; }
  }

  // XML hóa đơn có nhiều phiên bản/namespace. Luôn so khớp local-name, không phụ thuộc prefix.
  function localName(node) { return (node.localName || node.nodeName || '').split(':').pop().toLowerCase(); }
  function descendants(node, names) {
    const wanted = new Set(names.map(x => x.toLowerCase()));
    return [...node.getElementsByTagName('*')].filter(el => wanted.has(localName(el)));
  }
  function firstText(node, names) {
    const found = descendants(node, names).find(el => (el.textContent || '').trim());
    return found ? found.textContent.trim() : '';
  }
  function childText(node, parentNames, fieldNames) {
    const parents = descendants(node, parentNames);
    for (const parent of parents) {
      const value = firstText(parent, fieldNames);
      if (value) return value;
    }
    return '';
  }
  function parseVietnameseNumber(raw) {
    if (raw === null || raw === undefined || raw === '') return 0;
    let s = String(raw).trim().replace(/\s/g,'').replace(/[^\d,.-]/g,'');
    if (!s) return 0;
    // Hóa đơn XML Việt Nam thường dùng dấu chấm phân cách nghìn, dấu phẩy thập phân.
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g,'').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g,'');
    else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function normalizeDate(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
    if (m) return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return iso ? iso[1] : s;
  }
  function parseInvoice(xmlText, filename, profile) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror') || !doc.documentElement) throw new Error(filename+': XML không hợp lệ.');
    const root = doc.documentElement;
    const sellerNode = descendants(root, ['NBan','Seller','SellerInfo','ThongTinNguoiBan'])[0];
    const buyerNode = descendants(root, ['NMua','Buyer','BuyerInfo','ThongTinNguoiMua'])[0];
    const sellerTax = sellerNode ? firstText(sellerNode, ['MST','TaxCode','MaSoThue']) : '';
    const buyerTax = buyerNode ? firstText(buyerNode, ['MST','TaxCode','MaSoThue']) : '';
    const sellerName = sellerNode ? firstText(sellerNode, ['Ten','TenDVi','TenDonVi','SellerName','LegalName']) : '';
    const buyerName = buyerNode ? firstText(buyerNode, ['Ten','TenDVi','TenDonVi','BuyerName','LegalName']) : '';
    const common = descendants(root, ['TTChung','InvoiceData','InvoiceInfo','ThongTinChung'])[0] || root;
    const headerValue = names => firstText(common, names) || firstText(root, names);
    const invoiceNo = headerValue(['SHDon','InvoiceNo','InvoiceNumber','SoHoaDon']);
    const series = headerValue(['KHHDon','KHMSHDon','InvoiceSeries','Series','KyHieuHoaDon']);
    const date = normalizeDate(headerValue(['NLap','IssueDate','InvoiceDate','NgayLap']));
    const totalRaw = childText(root, ['TToan','Payment','TongThanhToan'], ['TgTTTBSo','TToan','PayableAmount','TotalAmountWithVAT','TaxInclusiveAmount'])
      || firstText(root, ['TgTTTBSo','PayableAmount','TotalAmountWithVAT','TaxInclusiveAmount']);
    const total = parseVietnameseNumber(totalRaw);
    if (!invoiceNo && !series) throw new Error(filename+': không nhận diện được số hóa đơn và ký hiệu. XML có thể thuộc định dạng chưa hỗ trợ.');
    const sellerMatches = sellerTax && sellerTax.replace(/\D/g,'') === profile.taxCode;
    const buyerMatches = buyerTax && buyerTax.replace(/\D/g,'') === profile.taxCode;
    const kind = buyerMatches ? 'purchase' : sellerMatches ? 'sales' : 'unknown';
    const issuerTax = sellerTax || '';
    // Gồm MST hồ sơ, MST người bán, ký hiệu, số và ngày để tránh đụng số hóa đơn giữa các đơn vị.
    const identity = [profile.taxCode, issuerTax, series, invoiceNo, date].map(x => String(x).trim().toLowerCase()).join('|');
    return {
      id: uid(), schemaVersion: 1, identity, profileTax: profile.taxCode,
      date, invoiceNo, series, sellerTax, buyerTax, sellerName, buyerName,
      total, kind, sourceFile: filename, importedAt: new Date().toISOString(), rawXml: xmlText
    };
  }
  async function importXmlFiles(files) {
    const profile = activeProfile();
    if (!profile) { setStatus('Hãy tạo hoặc chọn hồ sơ MST trước khi nhập hóa đơn.', true); return; }
    let added = 0, duplicates = 0, failed = 0, unknown = 0;
    for (const file of files) {
      try {
        const xml = await file.text();
        const invoice = parseInvoice(xml, file.name, profile);
        if (profile.invoices.some(x => x.identity === invoice.identity)) { duplicates++; continue; }
        profile.invoices.push(invoice); added++;
        if (invoice.kind === 'unknown') unknown++;
      } catch (error) { failed++; console.warn(error); }
    }
    if (saveDb()) {
      render();
      setStatus('Đã nhập '+added+' hóa đơn · Trùng '+duplicates+' · Chưa xác định chiều '+unknown+' · Lỗi '+failed+' tệp.');
    }
    $('xmlFiles').value = '';
  }
  function download(name, content, type) {
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup() {
    download('autotax-backup-'+new Date().toISOString().slice(0,10)+'.json', JSON.stringify(db,null,2), 'application/json;charset=utf-8');
  }
  function exportCsv() {
    const profile = activeProfile(); if (!profile) { setStatus('Chưa chọn hồ sơ MST.', true); return; }
    const columns = ['date','invoiceNo','series','sellerTax','sellerName','buyerTax','buyerName','total','kind','identity'];
    const rows = [columns.join(','), ...profile.invoices.map(x => columns.map(k => '"'+String(x[k] ?? '').replace(/"/g,'""')+'"').join(','))];
    download('autotax-invoices-'+profile.taxCode+'.csv', '\uFEFF'+rows.join('\r\n'), 'text/csv;charset=utf-8');
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.profiles)) throw new Error('Tệp sao lưu không đúng định dạng AutoTax Web.');
      const candidate = structuredClone(db);
      const currentByTax = new Map(candidate.profiles.map(p => [p.taxCode,p]));
      for (const incoming of data.profiles) {
        if (!incoming.taxCode || !Array.isArray(incoming.invoices)) continue;
        const current = currentByTax.get(incoming.taxCode);
        if (!current) { candidate.profiles.push(incoming); currentByTax.set(incoming.taxCode,incoming); }
        else {
          const ids = new Set(current.invoices.map(x=>x.identity));
          for (const invoice of incoming.invoices) if (!ids.has(invoice.identity)) current.invoices.push(invoice);
        }
      }
      if (!candidate.activeProfileId && candidate.profiles.length) candidate.activeProfileId = candidate.profiles[0].id;
      const previous = db; db = candidate;
      if (saveDb()) { render(); setStatus('Đã khôi phục và gộp dữ liệu sao lưu.'); }
      else db = previous;
    } catch (error) { setStatus(error.message, true); }
    $('backupFile').value = '';
  }

  $('addProfile').addEventListener('click', () => { $('profileError').textContent=''; $('profileName').value=''; $('profileTax').value=''; $('profileDialog').showModal(); });
  $('profileForm').addEventListener('submit', event => {
    if (event.submitter?.id !== 'saveProfile') return;
    event.preventDefault();
    try { addProfile($('profileName').value,$('profileTax').value); if (activeProfile()?.taxCode === $('profileTax').value.replace(/\D/g,'')) $('profileDialog').close(); }
    catch(error) { $('profileError').textContent=error.message; }
  });
  $('profileList').addEventListener('click', event => { const button=event.target.closest('[data-profile]'); if(button){db.activeProfileId=button.dataset.profile;saveDb();render();} });
  $('xmlFiles').addEventListener('change', event => { if(event.target.files?.length) importXmlFiles([...event.target.files]); });
  $('backupFile').addEventListener('change', event => { if(event.target.files?.[0]) importBackup(event.target.files[0]); });
  $('exportBackup').addEventListener('click', exportBackup);
  $('exportCsv').addEventListener('click', exportCsv);
  $('searchInput').addEventListener('input', renderInvoices);
  $('kindFilter').addEventListener('change', renderInvoices);
  $('clearProfile').addEventListener('click', () => {
    const profile=activeProfile(); if(!profile) return;
    if(confirm('Xóa toàn bộ hóa đơn của hồ sơ '+profile.name+'? Hãy sao lưu trước nếu cần giữ dữ liệu.')) {
      const previous = profile.invoices; profile.invoices=[];
      if (saveDb()) render(); else profile.invoices=previous;
    }
  });
  render();
})();