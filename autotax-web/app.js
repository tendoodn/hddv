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
      if (parsed && parsed.version === 1 && Array.isArray(parsed.profiles)) return parsed;
    } catch (error) { console.warn('Không đọc được kho AutoTax:', error); }
    return emptyDb();
  }
  function saveDb() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
    catch (error) { setStatus('Không thể lưu: bộ nhớ trình duyệt có thể đã đầy. Hãy xuất bản sao lưu.', true); return false; }
  }
  const activeProfile = () => db.profiles.find(p => p.id === db.activeProfileId) || null;
  const fmtMoney = value => Number(value || 0).toLocaleString('vi-VN');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function setStatus(message, error = false) { $('importStatus').textContent = message; $('importStatus').style.color = error ? '#b44d4d' : ''; }

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
    const query = $('searchInput').value.trim().toLocaleLowerCase('vi');
    const kind = $('kindFilter').value;
    const invoices = profile ? profile.invoices.filter(x => (kind === 'all' || x.kind === kind) &&
      [x.invoiceNo,x.series,x.sellerName,x.buyerName,x.sellerTax,x.buyerTax].join(' ').toLocaleLowerCase('vi').includes(query)) : [];
    $('visibleCount').textContent = invoices.length+' hóa đơn';
    $('invoiceRows').innerHTML = invoices.length ? invoices.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(x =>
      '<tr><td>'+esc(x.date)+'</td><td>'+esc(x.invoiceNo)+'</td><td>'+esc(x.series)+'</td><td title="'+esc(x.sellerName)+'">'+esc(x.sellerName)+'</td><td title="'+esc(x.buyerName)+'">'+esc(x.buyerName)+'</td><td class="right">'+fmtMoney(x.total)+'</td><td><span class="type-pill '+(x.kind==='sales'?'sales':'')+'">'+(x.kind==='sales'?'Bán ra':'Mua vào')+'</span></td></tr>'
    ).join('') : '<tr><td colspan="7" class="empty">'+(profile ? 'Không có hóa đơn phù hợp.' : 'Hãy tạo hoặc chọn hồ sơ MST.')+'</td></tr>';
  }
  function addProfile(name, taxCode) {
    const normalized = taxCode.replace(/\D/g,'');
    if (!normalized || normalized.length < 10 || normalized.length > 14) throw new Error('Mã số thuế cần có từ 10 đến 14 chữ số.');
    if (db.profiles.some(p => p.taxCode === normalized)) throw new Error('Mã số thuế này đã có trong danh sách hồ sơ.');
    const p = { id: uid(), name: name.trim(), taxCode: normalized, invoices: [], createdAt: new Date().toISOString() };
    db.profiles.push(p); db.activeProfileId = p.id; saveDb(); render();
  }
  function textOf(parent, selectors) {
    for (const selector of selectors) { const node = parent.querySelector(selector); if (node?.textContent?.trim()) return node.textContent.trim(); }
    return '';
  }
  function attrOrText(parent, selector, attr) {
    const node = parent.querySelector(selector); return node ? (node.getAttribute(attr) || node.textContent || '').trim() : '';
  }
  function parseInvoice(xmlText, filename, profile) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(filename+': XML không hợp lệ.');
    const root = doc.documentElement;
    const pick = (localNames) => {
      for (const name of localNames) {
        const node = doc.getElementsByTagNameNS('*', name)[0];
        if (node?.textContent?.trim()) return node.textContent.trim();
      }
      return '';
    };
    const sellerTax = pick(['sellerTaxCode','SellerTaxCode','MST','MSTNBan','TaxCode']);
    const buyerTax = pick(['buyerTaxCode','BuyerTaxCode','MSTNMua','TaxCodeBuyer']);
    const sellerName = pick(['sellerLegalName','SellerLegalName','TenNBan','SellerName']);
    const buyerName = pick(['buyerLegalName','BuyerLegalName','TenNMua','BuyerName']);
    const invoiceNo = pick(['invoiceNo','InvoiceNo','SHDon','InvoiceNumber','ID']);
    const series = pick(['invoiceSeries','InvoiceSeries','KHMSHDon','KHHDon','Series']);
    const dateRaw = pick(['issueDate','IssueDate','NLap','InvoiceDate']);
    const date = dateRaw ? dateRaw.slice(0,10) : '';
    const totalRaw = pick(['totalAmountWithVAT','TotalAmountWithVAT','TgTTTBSo','TToan','PayableAmount','TaxInclusiveAmount']);
    const total = Number(String(totalRaw).replace(/[^\d,.-]/g,'').replace(/,(?=\d{3}(?:\D|$))/g,'').replace(',','.')) || 0;
    const identity = [sellerTax || profile.taxCode, series, invoiceNo, date].join('|').toLowerCase();
    if (!invoiceNo && !series) throw new Error(filename+': không nhận diện được số hóa đơn/ký hiệu.');
    const kind = buyerTax === profile.taxCode || (!sellerTax && sellerTax !== profile.taxCode && buyerName.toLowerCase().includes(profile.name.toLowerCase())) ? 'purchase' : 'sales';
    return { id: uid(), identity, date, invoiceNo, series, sellerTax, buyerTax, sellerName, buyerName, total, kind, sourceFile: filename, importedAt: new Date().toISOString(), rawXml: xmlText };
  }
  async function importXmlFiles(files) {
    const profile = activeProfile();
    if (!profile) { setStatus('Hãy tạo hoặc chọn hồ sơ MST trước khi nhập hóa đơn.', true); return; }
    let added = 0, duplicates = 0, failed = 0;
    for (const file of files) {
      try {
        const xml = await file.text();
        const invoice = parseInvoice(xml, file.name, profile);
        if (profile.invoices.some(x => x.identity === invoice.identity)) { duplicates++; continue; }
        profile.invoices.push(invoice); added++;
      } catch (error) { failed++; console.warn(error); }
    }
    saveDb(); render();
    setStatus('Đã nhập '+added+' hóa đơn · Bỏ qua '+duplicates+' hóa đơn trùng · Lỗi '+failed+' tệp.');
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
      const currentByTax = new Map(db.profiles.map(p => [p.taxCode,p]));
      for (const incoming of data.profiles) {
        if (!incoming.taxCode || !Array.isArray(incoming.invoices)) continue;
        const current = currentByTax.get(incoming.taxCode);
        if (!current) { db.profiles.push(incoming); currentByTax.set(incoming.taxCode,incoming); }
        else {
          const ids = new Set(current.invoices.map(x=>x.identity));
          for (const invoice of incoming.invoices) if (!ids.has(invoice.identity)) current.invoices.push(invoice);
        }
      }
      if (!db.activeProfileId && db.profiles.length) db.activeProfileId = db.profiles[0].id;
      saveDb(); render(); setStatus('Đã khôi phục và gộp dữ liệu sao lưu.');
    } catch (error) { setStatus(error.message, true); }
    $('backupFile').value = '';
  }

  $('addProfile').addEventListener('click', () => { $('profileError').textContent=''; $('profileName').value=''; $('profileTax').value=''; $('profileDialog').showModal(); });
  $('profileForm').addEventListener('submit', event => {
    if (event.submitter?.id !== 'saveProfile') return;
    event.preventDefault();
    try { addProfile($('profileName').value,$('profileTax').value); $('profileDialog').close(); }
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
    if(confirm('Xóa toàn bộ hóa đơn của hồ sơ '+profile.name+'? Thao tác này không thể hoàn tác nếu chưa sao lưu.')) { profile.invoices=[];saveDb();render(); }
  });
  render();
})();