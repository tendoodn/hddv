/* AutoTax 1.1.6: stage output files and save one ZIP with an MST folder tree. */
(() => {
 'use strict';
 let pending = null;
 const safe = value => String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 130);
 async function bytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new TextEncoder().encode(String(data ?? ''));
 }
 async function capture(name, data, mime) {
  if (!pending) throw Error('Chưa bắt đầu xuất ZIP.');
  const path = String(name || '').replace(/\\/g, '/');
  if (!path || path.split('/').some(part => !part || part === '..' || part === '.')) throw Error('Đường dẫn không an toàn.');
  const buffer = await bytes(data);
  if (buffer.byteLength > 100 * 1024 * 1024) throw Error('Tệp lớn hơn 100 MB. Hãy xuất theo tháng.');
  pending.push({name:path, data:buffer, mime:mime || 'application/octet-stream'});
  return path;
 }
 function archive(files) {
  const current = String(window.WebInvoiceApp?.getMst?.() || '').replace(/\D/g, '');
  const prefix = 'HoaDon/' + safe(current || 'MST') + '/';
  const buckets = {html:[], original:[], rendered:[], xml:[], stock:[]};
  const outer = [];
  for (const file of files) {
   const name = file.name;
   const leaf = name.split('/').pop();
   if (/^nhap_hang\//i.test(name)) {
    buckets.stock.push({name:safe(leaf), data:file.data});
    outer.push({name:prefix+'nhaphang/'+safe(leaf), data:file.data});
   } else if (/^xml\//i.test(name) || /\.xml$/i.test(leaf)) {
    buckets.xml.push({name:name.replace(/^xml\//i,''), data:file.data});
   } else if (/^html\//i.test(name) || /\.html?$/i.test(leaf)) {
    buckets.html.push({name:name.replace(/^html\//i,''), data:file.data});
   } else if (/\.pdf$/i.test(leaf)) {
    const key = /PDF_goc_nha_phat_hanh|PDF_nguoi_dung_cung_cap/i.test(name) ? 'original' : 'rendered';
    buckets[key].push({name, data:file.data});
   } else if (/\.(?:xlsx|xls|csv)$/i.test(leaf)) {
    outer.push({name:prefix+safe(leaf), data:file.data});
   } else {
    outer.push({name:prefix+'thong_tin/'+safe(leaf), data:file.data});
   }
  }
  const categories = [
   ['html','file nen HTML.zip'],
   ['original','file nen PDF goc.zip'],
   ['rendered','file nen PDF dung.zip'],
   ['xml','file nen XML.zip'],
   ['stock','file nen nhap hang/NhapHang.zip']
  ];
  for (const [key, filename] of categories) {
   if (buckets[key].length) outer.push({name:prefix+filename,data:window.Zip.writeZip(buckets[key])});
  }
  if (!outer.length) throw Error('Không có tệp nào để đóng gói.');
  return window.Zip.writeZip(outer);
 }
 async function batch(job, label) {
  if (pending) throw Error('Đang xuất một gói ZIP khác.');
  if (!window.Zip?.writeZip || !window.AutoTaxDownloadFolder?.saveRootArchive) throw Error('Thiếu bộ ZIP hoặc thư mục tải.');
  pending = [];
  try {
   const result = await job();
   const files = pending;
   const total = files.reduce((sum, item) => sum + item.data.byteLength, 0);
   if (total > 350 * 1024 * 1024) throw Error('Dữ liệu vượt 350 MB. Hãy xuất theo tháng.');
   const zip = archive(files);
   pending = null;
   const mst = safe(window.WebInvoiceApp?.getMst?.() || 'MST');
   const stamp = new Date().toISOString().replace(/\D/g, '').slice(0,14);
   const name = 'AutoTax_V1.1.6_' + mst + '_' + safe(label || 'TatCa') + '_' + stamp + '.zip';
   await window.AutoTaxDownloadFolder.saveRootArchive(name,zip);
   window.WebInvoiceApp?.show?.('Đã lưu 1 tệp ZIP chứa '+files.length+' tệp: '+name,true);
   return result;
  } finally { pending = null; }
 }
 window.AutoTaxZipExport = Object.freeze({isCapturing:()=>pending !== null,capture,batch});
})();