import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const captured=[],books=[];
const context={
  TextDecoder,TextEncoder,
  window:{},
  Zip:{
    readZip:async()=>{throw Error('XLSX parser requires a browser test')},
    writeZip:files=>{captured.push(files);return new Uint8Array([80,75,3,4])}
  },
  Xlsx:{buildXlsx:book=>{books.push(book);return new Uint8Array([80,75,3,4])}}
};
const source=fs.readFileSync('autotax/src/content/tendoo-import.js','utf8');
vm.runInNewContext(source,context,{filename:'tendoo-import.js'});
const td=context.window.TendooImport;
const file={name:'BC_San_Pham_202611012345.xlsx.csv',size:140,
 text:async()=>'\uFEFFSKU,Tên sản phẩm,Đơn vị tính,Loại hàng\nSKU-01,Thịt heo,kg,Sản phẩm\nSKU-02,Rau xanh,kg,Sản phẩm\n'};
const products=await td.catalog(file);
assert.equal(products.length,2);
assert.equal(products[0].sku,'SKU-01');
assert.equal(products[0].name,'Thịt heo');
// Search by exact or partial SKU and accented/unaccented BC product name.
assert.equal(td.searchCatalog(products,'rau')[0].sku,'SKU-02');
assert.equal(td.searchCatalog(products,'RAU XANH')[0].sku,'SKU-02');
assert.equal(td.searchCatalog(products,'sku-01')[0].name,'Thịt heo');
assert.equal(td.searchCatalog(products,'HEO')[0].sku,'SKU-01');
assert.equal(td.searchCatalog(products,'No such product').length,0);
assert.equal(td.searchCatalog(products,'',1).length,1);
const template={
 fileName:'File mẫu nhập kho hoá đơn GTGT.xlsx',headers:[
  'Mã sản phẩm/nvl (*)','Loại hàng','Tên sản phẩm/nvl',
  'Đơn vị tính','Số lượng (*)','Đơn giá (*)','Giảm giá sản phẩm %',
   'Giảm giá sản phẩm VNĐ','Thuế GTGT','Tổng giảm giá sản phẩm VNĐ','Tiền thuế'
 ],
 columns:{sku:0,type:1,name:2,unit:3,quantity:4,price:5,discount:6,discountAmount:7,tax:8,discountTotal:9,taxAmount:10},
 preRows:[]
};
const invoice=[
 {kind:'purchase',form:'hddt',key:'a',nbmst:'0123456789',khhdon:'C26TAA',shdon:'001'},
 {kind:'purchase',form:'mtt',key:'b',nbmst:'0123456789',khhdon:'C26TBB',shdon:'002'},
 {kind:'sold',form:'hddt',key:'c'}
];
const details=new Map([
 ['a',{lines:[{ten:'Thịt heo',dvt:'kg',sl:3,dgia:85000,ck:0.03,tsuat:'8%',tthue:20400}]}],
 ['b',{lines:[{ten:'Rau chợ',dvt:'kg',sl:4,dgia:12000,ck:0,tsuat:'10%'}]}],
 ['c',{lines:[{ten:'Không xuất',sl:1,dgia:9}]}]
]);
const misses=td.missing(invoice,details,products,{});
assert.equal(misses.length,1);
assert.equal(misses[0].name,'Rau chợ');
// An unmapped stock item must not block ZIP export.
const fallback=td.makePackage(invoice,details,products,template,{});
assert.equal(fallback.count,2);
assert.equal(fallback.missing,1);
assert.equal(books[1][0].rows[1][0],'THIẾU MÃ');
assert.equal(books[1][0].rows[1][2],'Rau chợ');

const mapped={[td.normalize('Rau chợ')]:'SKU-02'};
const result=td.makePackage(invoice,details,products,template,mapped);
assert.equal(result.count,2);
assert.equal(result.skipped,0);
assert.equal(books.length,4);
assert.equal(books[2][0].rows[1][0],'SKU-01');
assert.equal(books[2][0].rows[1][6],0.03);
assert.equal(books[2][0].rows[1][8],0.08);
assert.equal(books[2][0].rows[1][10],20400);
assert.equal(books[3][0].rows[1][0],'SKU-02');
assert.equal(books[3][0].rows[1][8],'Không chịu thuế');
assert.equal(books[3][0].rows[1][10],'');
assert.equal(captured[captured.length-1].filter(x=>x.name.endsWith('.xlsx')).length,2);
assert.equal(books[2][0].rows[0].length,11);
assert.equal(td.missing(invoice,details,products,mapped).length,0);
assert.equal(td.missing([{kind:'purchase',key:'d'}],new Map([
 ['d',{lines:[{ten:'Bất kỳ',ma:'SKU-01',sl:1,dgia:100,tsuat:'0%'}]}]
]),products,{}).length,0);
// Bundled Tendoo template matches the 11-column reference without an upload.
const builtT=td.builtinTemplate('tendoo');
assert.equal(builtT.headers.length,11);
assert.equal(builtT.headers[0],'Mã sản phẩm/nvl (*)');
assert.equal(builtT.headers[8],'Thuế GTGT');

// MISA: validate the user's actual 22-column eShop nhập kho layout.
const builtM=td.builtinTemplate('misa');
assert.equal(builtM.headers.length,22);
assert.equal(builtM.headers[2],'Số chứng từ (*)');
assert.equal(builtM.headers[7],'Mã hàng (*)');
assert.equal(builtM.headers[11],'Mã kho (*)');
assert.equal(builtM.preRows.length,7);
assert.equal(td.nextDocumentNumber('NK0009',1),'NK0010');
assert.equal(td.nextDocumentNumber('NK-2026-0099',2),'NK-2026-0101');
assert.throws(()=>td.nextDocumentNumber('SAI',1),/Mã chứng từ/);

// MISA catalog has header row 3: Mã hàng hóa, Tên hàng hóa, Đơn vị tính.
const misaFile={name:'Danh sách hàng hóa MISA.csv',size:180,
  text:async()=>'STT,Mã hàng hóa,Tên hàng hóa,Giá bán,Đơn vị tính,Loại hàng hóa,Trạng thái\n1,Tsptess,test,12000,Chiếc,Hàng hóa thường,Đang theo dõi\n'};
const misaCatalog=await td.catalog(misaFile);
assert.equal(misaCatalog[0].sku,'Tsptess');
assert.equal(misaCatalog[0].name,'test');
const misaInvoice=[{kind:'purchase',form:'hddt',key:'a',nbten:'Nhà cung cấp',
    nbmst:'0123456789',shdon:'001',khhdon:'C26AAA',tdlap:'2026-11-01T02:00:00Z'},
  {kind:'purchase',form:'mtt',key:'b',shdon:'002',khhdon:'C26BBB',
    tdlap:'2026-11-01T05:00:00Z'}];
const misaResult=td.makePackage(misaInvoice,details,misaCatalog,builtM,{},{
  warehouse:'KHO01',lastDocNumber:'NK0008'});
assert.equal(misaResult.count,2);
assert.equal(misaResult.missing,2);
assert.equal(misaResult.lastIssued,'NK0010');
const misaBooks=books.slice(-2);
assert.equal(misaBooks[0][0].rows[8][0],'Nhập kho mua hàng');
assert.equal(misaBooks[0][0].rows[8][1],'01/11/2026');
assert.equal(misaBooks[0][0].rows[8][2],'NK0009');
assert.equal(misaBooks[1][0].rows[8][2],'NK0010');
assert.equal(misaBooks[0][0].rows[8][7],'THIẾU MÃ');
assert.equal(misaBooks[0][0].rows[8][8],'Thịt heo');
assert.equal(misaBooks[0][0].rows[8][11],'KHO01');
assert.equal(misaBooks[1][0].rows[8][19],'KCT');
assert.throws(()=>td.makePackage(misaInvoice,details,misaCatalog,builtM,{},{
  warehouse:'',lastDocNumber:'NK0008'}),/Mã kho/);
console.log('Stock import Tendoo/MISA: embedded templates, mapping fallback, document sequence and ZIP PASS');
