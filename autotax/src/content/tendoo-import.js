// Offline Tendoo Excel helper for catalog/SKU mapping and per-invoice stock import.
// Uploaded files are read locally; no catalog/template is sent to any backend.
(() => {
  const decoder=new TextDecoder();
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[đĐ]/g,'d').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  const colIndex=ref=>{const m=/^([A-Z]+)/i.exec(ref||'');return m?
    [...m[1].toUpperCase()].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1:-1};
  const csv=text=>{
    const rows=[];let row=[],v='',quoted=false;const t=text.replace(/^\uFEFF/,'');
    for(let i=0;i<t.length;i++){
      const c=t[i];
      if(c==='"'){if(quoted&&t[i+1]==='"'){v+='"';i++}else quoted=!quoted}
      else if(c===','&&!quoted){row.push(v);v=''}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&t[i+1]==='\n')i++;
        row.push(v);rows.push(row);row=[];v=''}
      else v+=c;
    }
    if(v||row.length){row.push(v);rows.push(row)}return rows;
  };
  async function workbook(file){
    if(!file||file.size>15*1024*1024)throw Error('File cần nhỏ hơn 15 MB.');
    if(/\.csv$/i.test(file.name))return csv(await file.text());
    if(!/\.xlsx$/i.test(file.name))throw Error('Chỉ hỗ trợ .xlsx hoặc .csv. File .xls cần chuyển sang .xlsx.');
    const files=await Zip.readZip(new Uint8Array(await file.arrayBuffer()));
    const name=Object.keys(files).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort()[0];
    if(!name)throw Error('File Excel không có bảng dữ liệu.');
    const parse=src=>{const x=new DOMParser().parseFromString(src,'application/xml');
      if(x.querySelector('parsererror'))throw Error('Cấu trúc XML Excel lỗi.');return x};
    const shared=files['xl/sharedStrings.xml']?
      [...parse(decoder.decode(files['xl/sharedStrings.xml'])).getElementsByTagName('si')]
       .map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent||'').join('')):[];
    const rows=[];
    for(const row of parse(decoder.decode(files[name])).getElementsByTagName('row')){
      const arr=[];for(const c of row.getElementsByTagName('c')){
        const col=colIndex(c.getAttribute('r'));if(col<0||col>160)continue;
        const type=c.getAttribute('t')||'',raw=c.getElementsByTagName('v')[0]?.textContent||'';
        arr[col]=type==='s'?shared[Number(raw)]||'':
          type==='inlineStr'?[...c.getElementsByTagName('t')].map(t=>t.textContent||'').join(''):
          raw!==''&&!isNaN(Number(raw))?Number(raw):raw;
      }
      rows.push(arr);if(rows.length>50000)throw Error('Bảng vượt 50.000 dòng.');
    }
    if(!rows.length)throw Error('Không có dữ liệu Excel.');return rows;
  }
  const aliases={
    sku:['sku','ma sku','ma san pham','ma san pham nguyen lieu','ma hang'],
    name:['ten san pham','ten san pham nguyen lieu','ten hang','ten nguyen lieu'],
    type:['loai hang','loai san pham'],
    unit:['don vi tinh','dvt','ten don vi'],
    quantity:['so luong','sl nhap'],
    price:['don gia','gia nhap'],
    discount:['giam gia','chiet khau'],
    discountAmount:['giam gia san pham vnd'],
    discountTotal:['tong giam gia san pham vnd'],
    taxAmount:['tien thue'],
    tax:['thue gtgt','thue suat','vat','thue gia tri gia tang']
  };
  const roleOf=value=>{
    const str=norm(value);
    // Distinguish discount percentage and VND columns in the 11-column Tendoo template.
    if(str.startsWith('tong giam gia san pham vnd'))return 'discountTotal';
    if(str.startsWith('giam gia san pham vnd'))return 'discountAmount';
    if(str.startsWith('tien thue'))return 'taxAmount';
    for(const [role,names] of Object.entries(aliases)){
      if(names.some(n=>str===n||str.startsWith(n+' ')))return role;
    }return null;
  };
  function header(rows,min=2){
    let best={score:0};
    rows.slice(0,30).forEach((r,i)=>{
      const cols={};r.forEach((v,index)=>{const role=roleOf(v);if(role&&cols[role]==null)cols[role]=index});
      const score=Object.keys(cols).length;if(score>best.score)best={score,index:i,headers:r.map(x=>String(x??'')),columns:cols};
    });
    if(best.score<min)throw Error('Không nhận dạng được hàng tiêu đề trong file Excel Tendoo.');
    return best;
  }
  async function catalog(file){
    const rows=await workbook(file),h=header(rows,2);
    if(h.columns.sku==null||h.columns.name==null)throw Error('BC_San_Pham cần cột SKU và Tên sản phẩm.');
    const out=[],seen=new Set();
    for(const row of rows.slice(h.index+1)){
      const sku=String(row[h.columns.sku]??'').trim(),name=String(row[h.columns.name]??'').trim();
      if(!sku||!name||seen.has(sku))continue;
      seen.add(sku);
      out.push({sku,name,unit:String(row[h.columns.unit]??'').trim(),
        type:String(row[h.columns.type]??'Sản phẩm').trim()||'Sản phẩm'});
      if(out.length>8000)throw Error('File sản phẩm vượt 8.000 SKU.');
    }
    if(!out.length)throw Error('Không có sản phẩm chứa SKU trong báo cáo.');
    return out;
  }
  async function template(file){
    const rows=await workbook(file),h=header(rows,4);
    for(const role of ['sku','name','quantity','price','tax']){
      if(h.columns[role]==null)throw Error('File mẫu nhập kho thiếu cột '+role+'.');
    }
    return {columns:h.columns,headers:h.headers,preRows:rows.slice(0,h.index),fileName:file.name};
  }
  // Built-in headers transcribed from the two supplied import templates (no second upload).
  function builtinTemplate(platform='tendoo'){
    if(platform==='misa'){
      const headers=['Loại nhập kho','Ngày chứng từ (*)','Số chứng từ (*)',
        'Mã đối tượng','Tên đối tượng','Diễn giải','Hình thức thanh toán',
        'Mã hàng (*)','Tên hàng','Số lô','Hạn sử dụng','Mã kho (*)',
        'Mã vị trí lưu kho','ĐVT','Số lượng (*)','Đơn giá','Thành tiền',
        '% chiết khấu','Tiền chiết khấu','Thuế suất','Tiền thuế','Tiền thanh toán'];
      const preRows=[
        ['FILE MẪU PHIẾU NHẬP KHO ĐỂ NHẬP VÀO PHẦN MỀM MISA eShop'],
        ['Hướng dẫn:'],
        ['- Điền dữ liệu vào các cột tương ứng trên file này. Thông tin chiết khấu và thuế áp dụng cho nhập kho mua hàng'],
        ['- Các cột có dấu (*) là những cột bắt buộc'],
        ['- Các dòng cùng Số chứng từ phải có cùng thông tin đầu phiếu'],
        ['- Kiểm tra mã kho và số chứng từ trước khi nhập MISA'],
        Array.from({length:7},()=> '').concat('Chi tiết hàng tiền')];
      return {platform:'misa',fileName:'nhap_khau_hang_hoa (mẫu MISA eShop tích hợp)',
        headers,preRows,columns:{sku:7,name:8,unit:13,quantity:14,price:15,tax:19}};
    }
    const headers=['Mã sản phẩm/nvl (*)','Loại hàng','Tên sản phẩm/nvl',
      'Đơn vị tính','Số lượng (*)','Đơn giá (*)','Giảm giá sản phẩm %',
      'Giảm giá sản phẩm VNĐ','Thuế GTGT','Tổng giảm giá sản phẩm VNĐ','Tiền thuế'];
    return {platform:'tendoo',fileName:'File mẫu nhập kho hoá đơn GTGT (tích hợp)',
      headers,preRows:[],columns:{sku:0,type:1,name:2,unit:3,quantity:4,price:5,
        discount:6,discountAmount:7,tax:8,discountTotal:9,taxAmount:10}};
  }
  function nextDocumentNumber(last,index=1){
    const original=String(last??'').trim();
    const match=/^(.*?)(\d+)(\D*)$/.exec(original);
    if(!match||match[2].length>20)throw Error('Mã chứng từ gần nhất phải có phần số, ví dụ NK0001.');
    return match[1]+String(BigInt(match[2])+BigInt(index)).padStart(match[2].length,'0')+match[3];
  }
  function misaTax(rate,mtt){
    if(mtt)return 'KCT';
    const n=norm(rate);
    if(/kct|khong chiu thue/.test(n))return 'KCT';
    if(/kkknt|khong tinh thue|khong ke khai/.test(n))return 'KKKNT';
    const fraction=taxRate(rate,false);
    return typeof fraction==='number'?(Number((fraction*100).toFixed(2))+'%'):'KKKNT';
  }
  function dateVN(value){
    const date=new Date(value);
    if(Number.isNaN(date.valueOf()))return '';
    return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',
      day:'2-digit',month:'2-digit',year:'numeric'}).format(date);
  }
  const cleanFile=v=>String(v||'').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').trim().slice(0,90)||'HoaDon';
  const goods=lines=>(lines||[]).filter(l=>l?.ten&&
    !['Ghi chú, diễn giải','Phí, lệ phí','Chiết khấu thương mại'].includes(l.tchat)&&
    l.sl!=null&&Number(l.sl)>0&&Number(l.dgia??0)>=0);
  // Fast lookup for the interactive link dialog: search both BC name and SKU,
  // ignoring accents/case and ranking exact or prefix matches first.
  function searchCatalog(products,query,limit=12){
    const term=norm(query);
    const max=Math.min(30,Math.max(1,Math.floor(Number(limit)||12)));
    if(!term)return (products||[]).slice(0,Math.min(8,max));
    const matches=[];
    for(const product of products||[]){
      const sku=norm(product.sku),name=norm(product.name);
      if(!sku.includes(term)&&!name.includes(term))continue;
      const rank=sku===term?0:name===term?1:sku.startsWith(term)?2:
        name.startsWith(term)?3:sku.includes(term)?4:5;
      matches.push({rank,product});
    }
    matches.sort((a,b)=>a.rank-b.rank||
      a.product.name.localeCompare(b.product.name,'vi')||
      a.product.sku.localeCompare(b.product.sku,'vi'));
    return matches.slice(0,max).map(x=>x.product);
  }
  function findProduct(line,items,links={}){
    const key=norm(line.ten),linked=links[key];
    if(linked){const product=items.find(p=>p.sku===linked);if(product)return product}
    const exactSku=String(line.ma||'').trim();
    if(exactSku){const found=items.find(p=>p.sku===exactSku);if(found)return found}
    const same=items.filter(p=>norm(p.name)===key);return same.length===1?same[0]:null;
  }
  function missing(rows,details,items,links={}){
    const miss=new Map();
    for(const r of rows.filter(x=>x.kind==='purchase')){
      for(const line of goods(details.get(r.key)?.lines)){
        if(!findProduct(line,items,links))miss.set(norm(line.ten),String(line.ten));
      }
    }
    return [...miss].map(([key,name])=>({key,name}));
  }
  function taxRate(v,mtt){
    // The actual Tendoo template stores VAT as an Excel fraction (0.08), not '8%'.
    // MTT purchases are non-VAT for this import flow, as requested.
    if(mtt)return 'Không chịu thuế';
    const str=String(v??'').trim();
    const normalized=norm(str);
    if(/kct|khong chiu thue/.test(normalized))return 'Không chịu thuế';
    if(/kktnt|khong tinh thue|khong ke khai/.test(normalized))return 'Không tính thuế';
    if(/^\d+(?:[.,]\d+)?%$/.test(str)){
      const n=Number(str.slice(0,-1).replace(',','.'))/100;
      return Number.isFinite(n)?n:'Không tính thuế';
    }
    if(/^\d+(?:[.,]\d+)?$/.test(str)){
      const n=Number(str.replace(',','.'));
      return n<=1?n:n<=100?n/100:'Không tính thuế';
    }
    // Unknown rates must not be silently presented as 0% or VAT deductible.
    return 'Không tính thuế';
  }
  const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0};
  function makePackage(rows,details,items,sample,links={}){
    if(sample?.platform==='misa')return makeMisaPackage(rows,details,items,sample,links,arguments[5]||{});
    const misses=missing(rows,details,items,links);
    const files=[];let count=0,skipped=0;
    for(const invoice of rows.filter(r=>r.kind==='purchase')){
      const lines=goods(details.get(invoice.key)?.lines);
      if(!lines.length){skipped++;continue}
      const data=lines.map(line=>{
        const product=findProduct(line,items,links);
        const cells=Array(sample.headers.length).fill('');
        const set=(role,value)=>{if(sample.columns[role]!=null)cells[sample.columns[role]]=value};
        set('sku',product?.sku||'THIẾU MÃ');set('name',product?.name||String(line.ten));set('unit',line.dvt||product?.unit||'');
        set('type',product?.type||'Sản phẩm');set('quantity',num(line.sl));
        set('price',num(line.dgia));
        // STCKhau is a percentage. The Tendoo sample expects the fraction 0.03, not 3.
        const rawDiscount=num(line.ck),discount=rawDiscount>1?rawDiscount/100:rawDiscount;
        if(rawDiscount>0&&discount<=1)set('discount',discount);
        const mtt=invoice.form==='mtt';
        set('tax',taxRate(line.tsuat,mtt));
        // Monetary discount/tax columns are optional, never populate with guessed values.
        if(!mtt&&line.tthue!=null&&Number.isFinite(Number(line.tthue)))
          set('taxAmount',Number(line.tthue));
        return cells;
      });
      const book=[{name:'Nhap kho',layout:true,
        rows:[...sample.preRows,sample.headers,...data],widths:sample.headers.map(()=>22)}];
      const bytes=Xlsx.buildXlsx(book);
      count++;
      files.push({name:'NhapKho_'+cleanFile(invoice.nbmst||'NCC')+'_'+
        cleanFile(invoice.khhdon||'')+'_'+cleanFile(invoice.shdon||count)+'_'+count+'.xlsx',data:bytes});
    }
    if(!files.length)throw Error('Không có hóa đơn mua vào đủ dữ liệu chi tiết.');
    files.push({name:'HUONG_DAN.txt',data:'AutoTax / Tendoo - '+count+' hoa don mua vao\n'+
      'San pham chua khop duoc giu nguyen ten va ghi THIẾU MÃ trong cot SKU. Vui long doi chieu truoc khi nhap.\n'+
      'Mau: '+(sample.fileName||'mau Tendoo da tai')+'\n'+
      'Moi hoa don la mot file Excel. Can kiem tra truoc khi nhap kho.\n'+
      'Hoa don MTT duoc gan muc Khong chiu thue (KCT).\n'+
      (skipped?'Bo qua '+skipped+' hoa don thieu dong san pham.\n':'')});
    return {zip:Zip.writeZip(files),count,skipped,missing:misses.length};
  }

  function makeMisaPackage(rows,details,items,sample,links={},settings={}){
    const warehouse=String(settings.warehouse||'').trim();
    const lastDoc=String(settings.lastDocNumber||'').trim();
    if(!warehouse)throw Error('Bạn cần nhập Mã kho MISA trước khi xuất.');
    nextDocumentNumber(lastDoc,1);
    const misses=missing(rows,details,items,links);
    const files=[];let count=0,skipped=0,lastIssued=lastDoc;
    for(const invoice of rows.filter(r=>r.kind==='purchase')){
      const lines=goods(details.get(invoice.key)?.lines);
      if(!lines.length){skipped++;continue}
      const doc=nextDocumentNumber(lastDoc,count+1);
      const date=dateVN(invoice.tdlap);
      if(!date)throw Error('Hóa đơn '+String(invoice.shdon||'')+' không có ngày chứng từ hợp lệ.');
      const invoiceRef=[invoice.khhdon,invoice.shdon].filter(Boolean).join('-');
      const data=lines.map(line=>{
        const product=findProduct(line,items,links);
        const cells=Array(sample.headers.length).fill('');
        const n=num(line.sl),price=num(line.dgia);
        const tax=misaTax(line.tsuat,invoice.form==='mtt');
        const pretax=line.thtien!=null&&Number.isFinite(Number(line.thtien))?
          Number(line.thtien):n*price;
        const amountTax=invoice.form==='mtt'?0:(line.tthue!=null&&Number.isFinite(Number(line.tthue))?Number(line.tthue):0);
        cells[0]='Nhập kho mua hàng';cells[1]=date;cells[2]=doc;
        cells[4]=String(invoice.nbten||'');
        cells[5]='Nhập theo HĐ '+invoiceRef;
        cells[7]=product?.sku||'THIẾU MÃ';
        cells[8]=product?.name||String(line.ten);
        cells[11]=warehouse;cells[13]=line.dvt||product?.unit||'';
        cells[14]=n;cells[15]=price;cells[16]=pretax;
        if(line.ck!=null&&num(line.ck)>0){
          const ck=num(line.ck);cells[17]=ck>1?ck/100:ck;
        }
        cells[19]=tax;
        if(tax!=='KCT'&&tax!=='KKKNT'&&line.tthue!=null&&Number.isFinite(Number(line.tthue)))cells[20]=amountTax;
        cells[21]=pretax+amountTax;
        return cells;
      });
      const bytes=Xlsx.buildXlsx([{name:'Nhap kho',layout:true,
        rows:[...sample.preRows,sample.headers,...data],widths:sample.headers.map((h,i)=>
          [4,5,8].includes(i)?32:19)}]);
      count++;lastIssued=doc;
      files.push({name:'nhap_khau_hang_hoa_'+cleanFile(doc)+'_'+
        cleanFile(invoiceRef||String(count))+'.xlsx',data:bytes});
    }
    if(!files.length)throw Error('Không có hóa đơn mua vào đủ chi tiết để nhập kho MISA.');
    files.push({name:'HUONG_DAN.txt',data:'AutoTax / MISA eShop - '+count+' hoa don\n'+
      'Ma kho: '+warehouse+'\n'+'Ma chung tu cuoi duoc tao: '+lastIssued+'\n'+
      'THIẾU MÃ: san pham chua co ma trong danh muc, can sua truoc khi nhap MISA.\n'+
      'Ngay chung tu lay tu ngay hoa don, kiem tra trong MISA truoc khi nhap.\n'+
      (skipped?'Bo qua '+skipped+' hoa don thieu chi tiet.\n':'')});
    return {zip:Zip.writeZip(files),count,skipped,missing:misses.length,lastIssued};
  }
  window.TendooImport={normalize:norm,workbook,catalog,template,builtinTemplate,nextDocumentNumber,searchCatalog,missing,makePackage};
})();
