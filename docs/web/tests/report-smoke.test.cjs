// Offline regression checks for Excel sheet data; run: node docs/web/tests/report-smoke.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {
  window: {},
  HDDT: {
    KINDS: {purchase:{label:'Mua vào'},sold:{label:'Bán ra'}},
    FORMS: {normal:{label:'Điện tử'}},
    TTXLY: {}, TTHAI: {2:'Thay thế',3:'Điều chỉnh',4:'Đã thay thế',6:'Đã hủy'},
    originalLookup:()=>({name:'',code:'',link:''})
  },
  console, Intl, Date, Map, Set
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','report.js'),'utf8'),context);
const base = {
  form:'normal',khmshdon:'1',khhdon:'C26TAA',nbmst:'1111111111',nbten:'Bên bán',
  nmmst:'2222222222',nmten:'Bên mua',tdlap:'2026-11-01',ttxly:1,tthai:1,
  tgtcthue:100,tgtthue:10,tgtphi:0,tgtttbso:110,dvtte:'VND',tgia:null,
  rates:[],goc:'',gocRef:null
};
const rows = [
  {...base,key:'p1',kind:'purchase',shdon:'001',dvtte:'usd',tgia:26000,tgtcthue:10,tgtthue:1,tgtttbso:11},
  {...base,key:'p2',kind:'purchase',shdon:'002',dvtte:' USD ',tgia:26000,tgtcthue:20,tgtthue:2,tgtttbso:22,tthai:3,goc:'C25TAA-99'},
  {...base,key:'p3',kind:'purchase',shdon:'003',tthai:6},
  {...base,key:'s1',kind:'sold',shdon:'004',tthai:4},
  {...base,key:'s2',kind:'sold',shdon:'005',tthai:2,goc:'C25TAA-99'}
];
const book=context.window.Report.buildSheets(rows,new Map(),{
  sheets:{reduction:false,risk:false,seller:false,adjust:false,hdkd:false,gtgt:false}
});
assert.equal(book.length,2);
assert.equal(book[0].name,'Mua vào');
assert.equal(book[1].name,'Bán ra');
for (const [sheet,expected] of [[book[0],3],[book[1],2]]) {
  assert.equal(sheet.rows.filter(r=>typeof r[0]==='number').length,expected);
  assert.equal(sheet.columns[0].header,'STT');
  assert.equal(sheet.columns[6].header,'Số hóa đơn');
  assert.equal(sheet.columns[16].header,'Tổng thanh toán');
  assert.equal(sheet.columns[17].header,'Tiền tệ');
  assert.ok(sheet.rows.some(r=>String(r[1]).startsWith('Tổng')));
}
assert.ok(book[0].rows.filter(r=>typeof r[0]==='number').every(r=>r[1]==='Mua vào'));
assert.ok(book[1].rows.filter(r=>typeof r[0]==='number').every(r=>r[1]==='Bán ra'));
const usd=book[0].rows.find(r=>r[1]==='Tổng (USD)');
assert.ok(usd,'Currency variants must be combined in one USD subtotal');
assert.equal(usd[13],30);assert.equal(usd[14],3);assert.equal(usd[16],33);
// Lowercase/whitespace currency must preserve the exchange rate in the invoice sheet.
assert.equal(book[0].rows.find(r=>r[6]==='001')[17],'USD');
assert.equal(book[0].rows.find(r=>r[6]==='001')[18],26000);
assert.equal(book[0].rows.find(r=>r[6]==='002')[18],26000);
// A VND invoice with whitespace/case variants must not show an exchange rate.
const vndVariant=context.window.Report.buildSheets([
  {...base,key:'v1',kind:'purchase',shdon:'006',dvtte:' vnd ',tgia:26000}
],new Map(),{sheets:{reduction:false,risk:false,seller:false,adjust:false,hdkd:false,gtgt:false}})[0];
assert.equal(vndVariant.rows[0][17],'VND');
assert.equal(vndVariant.rows[0][18],null);
assert.equal(book[0].rows.find(r=>r[6]==='002')[19],'Điều chỉnh');
assert.equal(book[0].rows.find(r=>r[6]==='003')[19],'Đã hủy');
assert.equal(book[1].rows.find(r=>r[6]==='004')[19],'Đã thay thế');
assert.equal(book[1].rows.find(r=>r[6]==='005')[19],'Thay thế');
console.log('PASS: separated sheets, columns, currency subtotals, adjustment/replacement/cancellation');
