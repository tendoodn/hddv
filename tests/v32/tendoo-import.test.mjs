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
assert.throws(()=>td.makePackage(invoice,details,products,template,{}),/Chưa ghép SKU/);
const mapped={[td.normalize('Rau chợ')]:'SKU-02'};
const result=td.makePackage(invoice,details,products,template,mapped);
assert.equal(result.count,2);
assert.equal(result.skipped,0);
assert.equal(books.length,2);
assert.equal(books[0][0].rows[1][0],'SKU-01');
assert.equal(books[0][0].rows[1][6],0.03);
assert.equal(books[0][0].rows[1][8],0.08);
assert.equal(books[0][0].rows[1][10],20400);
assert.equal(books[1][0].rows[1][0],'SKU-02');
assert.equal(books[1][0].rows[1][8],'Không chịu thuế');
assert.equal(books[1][0].rows[1][10],'');
assert.equal(captured[captured.length-1].filter(x=>x.name.endsWith('.xlsx')).length,2);
assert.equal(books[0][0].rows[0].length,11);
assert.equal(td.missing(invoice,details,products,mapped).length,0);
assert.equal(td.missing([{kind:'purchase',key:'d'}],new Map([
 ['d',{lines:[{ten:'Bất kỳ',ma:'SKU-01',sl:1,dgia:100,tsuat:'0%'}]}]
]),products,{}).length,0);
console.log('Tendoo 11-column template, numeric VAT, MTT-KCT, mapped SKU and ZIP: PASS');
