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
    unit:['don vi tinh','dvt'],
    quantity:['so luong','sl nhap'],
    price:['don gia','gia nhap'],
    discount:['giam gia','chiet khau'],
    tax:['thue gtgt','thue suat','vat','thue gia tri gia tang']
  };
  const roleOf=value=>{
    const str=norm(value);
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
    for(const role of ['sku','quantity','price','tax']){
      if(h.columns[role]==null)throw Error('File mẫu nhập kho thiếu cột '+role+'.');
    }
    return {columns:h.columns,headers:h.headers,preRows:rows.slice(0,h.index),fileName:file.name};
  }
  const cleanFile=v=>String(v||'').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').trim().slice(0,90)||'HoaDon';
  const goods=lines=>(lines||[]).filter(l=>l?.ten&&l.tchat!=='Ghi chú, diễn giải'&&
    l.tchat!=='Phí, lệ phí'&&l.sl!=null&&Number(l.sl)>0);
  function findProduct(line,items,links={}){
    const key=norm(line.ten),linked=links[key];
    if(linked)return items.find(p=>p.sku===linked)||null;
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
    if(mtt)return 'KCT';const str=String(v??'').trim().toUpperCase();
    if(/KCT|KHONG CHIU|KHÔNG CHỊU/i.test(str))return 'KCT';
    const num=str.match(/\d+(?:[.,]\d+)?/);return num?num[0].replace(',','.')+'%':'KCT';
  }
  const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0};
  function makePackage(rows,details,items,sample,links={}){
    const misses=missing(rows,details,items,links);
    if(misses.length)throw Error('Chưa ghép SKU cho '+misses.length+' tên hàng.');
    const files=[];let count=0,skipped=0;
    for(const invoice of rows.filter(r=>r.kind==='purchase')){
      const lines=goods(details.get(invoice.key)?.lines);
      if(!lines.length){skipped++;continue}
      const data=lines.map(line=>{
        const product=findProduct(line,items,links);
        if(!product)throw Error('Không xác định SKU cho '+String(line.ten));
        const cells=Array(sample.headers.length).fill('');
        const set=(role,value)=>{if(sample.columns[role]!=null)cells[sample.columns[role]]=value};
        set('sku',product.sku);set('name',product.name);set('unit',line.dvt||product.unit);
        set('type',product.type||'Sản phẩm');set('quantity',num(line.sl));
        set('price',num(line.dgia));set('discount',num(line.ck));
        set('tax',taxRate(line.tsuat,invoice.form==='mtt'));return cells;
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
      'Mau: '+(sample.fileName||'mau Tendoo da tai')+'\n'+
      'Moi hoa don la mot file Excel. Can kiem tra truoc khi nhap kho.\n'+
      'Hoa don MTT duoc gan thue suat KCT.\n'+
      (skipped?'Bo qua '+skipped+' hoa don thieu dong san pham.\n':'')});
    return {zip:Zip.writeZip(files),count,skipped};
  }
  window.TendooImport={normalize:norm,workbook,catalog,template,missing,makePackage};
})();
