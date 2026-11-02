import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(path,'utf8');
const source=read('docs/web/mst-official.js');
const page=read('docs/mst.html');
const frontend=read('docs/web/mst-lookup.js');
const ctx={window:{}};
vm.createContext(ctx);
new vm.Script(source,{filename:'mst-official.js'}).runInContext(ctx);
const a=ctx.window.MstOfficial;
assert.equal(a.normalize('3600675874').kind,'business');
assert.equal(a.normalize('3600675874-001').display,'3600675874-001');
assert.equal(a.normalize('3600675874001').display,'3600675874-001');
assert.equal(a.normalize('012345678901').kind,'personal');
assert.equal(a.normalize('12345'),null);
assert.equal(a.officialUrl('3600675874'),'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp');
assert.equal(a.officialUrl('3600675874-001'),'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp');
assert.equal(a.officialUrl('012345678901'),'https://tracuunnt.gdt.gov.vn/tcnnt/mstcn.jsp');
for(const code of ['3600675874','3600675874-001','012345678901']){
 assert.equal(a.officialUrl(code,'business'),'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp');
 assert.equal(a.officialUrl(code,'personal'),'https://tracuunnt.gdt.gov.vn/tcnnt/mstcn.jsp');
}
const company='1\t3600675874\tCông ty kiểm thử\tĐường A\tCục Thuế Đồng Nai\tNNT đang hoạt động';
const parsed=a.parseCopiedRow(company,'3600675874');
assert.equal(parsed.ok,true);
assert.equal(parsed.name,'Công ty kiểm thử');
assert.equal(parsed.office,'Cục Thuế Đồng Nai');
assert.equal(parsed.address,'Đường A');
assert.equal(parsed.matchedClipboard,true);
assert.equal(a.parseCopiedRow(company,'3600675874','business').portal,'business');
assert.equal(a.parseCopiedRow(company,'3600675874','business').source,
 'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp');
assert.equal(a.parseCopiedRow(company,'3600675875').ok,false,
 'Must not assign someone else’s tax record to a requested code.');
const branch=a.parseCopiedRow(
 '1\t3600675874-001\tChi nhánh kiểm thử\tĐường B\tCục Thuế A\tĐang hoạt động',
 '3600675874001');
assert.equal(branch.ok,true);
assert.equal(branch.name,'Chi nhánh kiểm thử');
const personal=a.parseCopiedRow(
 '1\t1234567890\tNguyễn Văn Kiểm Thử\tCục Thuế A\t012345678901\t01/07/2025\tNNT đang hoạt động',
 '012345678901');
assert.equal(personal.ok,true);
assert.equal(personal.name,'Nguyễn Văn Kiểm Thử');
assert.equal(personal.previousTaxCode,'1234567890');
assert.equal(personal.address,'');
const cccdTwice=a.parseCopiedRow(
 '1\t012345678901\tNguyễn Thị Ví Dụ\tĐội thuế số 2\t012345678901\t01/07/2025\tNNT đang hoạt động',
 '012345678901','personal');
assert.equal(cccdTwice.ok,true,'12-digit CCCD repeated in two TNCN columns is one person.');
assert.equal(cccdTwice.name,'Nguyễn Thị Ví Dụ');
assert.equal(cccdTwice.office,'Đội thuế số 2');
assert.equal(a.parseCopiedRow(
 '1\t1234567890\tNguyễn Văn Kiểm Thử\tCục Thuế A\t012345678901\t01/07/2025\tNNT đang hoạt động',
 '1234567890','personal').ok,true,
 'Searching by old 10-digit individual MST must accept the linked 12-digit CCCD.');
assert.equal(a.parseCopiedRow(
 '1\t1234567890\tNguyễn Văn A\tCục Thuế A\t987654321000\t2025\tNNT hoạt động',
 '012345678901','personal').ok,false,'Must reject a different citizen ID.');
assert.equal(a.parseCopiedRow(
 '1\t012345678901\tNguyễn Văn A\tCục Thuế A\t012345678901\t2025\tNNT hoạt động',
 '012345678901','personal').code,'012345678901','Leading zero must remain intact.');
assert.equal(a.parseCopiedRow('1\t012345678901\tHộ kinh doanh thử\tĐịa chỉ A\tCQT A\tĐang hoạt động',
 '012345678901','business').source,
 'https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp');
assert.equal(a.parseCopiedRow('1\t3600675874\tNguyễn Văn Thử\tCQT A\tĐang hoạt động',
 '3600675874','personal').portal,'personal');
assert.equal(a.comparePortalNames({
 business:{name:'Đỗ Thị Hồng'},personal:{name:'Do Thi Hong'}
}),'Tên khớp giữa 2 nguồn nhập thủ công');
assert.equal(a.comparePortalNames({
 business:{name:'Nguyễn Văn A'},personal:{name:'Nguyễn Văn B'}
}),'Tên khác nhau giữa 2 cổng — cần kiểm tra');
assert.equal(a.parseCopiedRow(company+'\n'+company.replace('3600675874','3600675875'),
 '3600675874').ok,false,'Cannot use a multi-row selection');
assert.equal(a.parseCopiedRow('<script>alert(1)</script>','3600675874').ok,false);
assert(page.includes('id="mstOfficialDialog"')&&page.includes('id="mstOfficialConfirm"'));
assert(page.includes('mst-official.js?v=3')&&page.includes('mst-lookup.js?v=10'));
assert(page.includes('id="mstOfficialNoResult"'));
assert(frontend.includes('found:false')&&frontend.includes('matchedClipboard:false'));
assert(page.includes('id="mstOfficialSource"')&&
 page.includes('id="mstOfficialPortalBusiness"')&&page.includes('id="mstOfficialPortalPersonal"'));
assert(frontend.includes("window.MstOfficial.officialUrl(v.mst,portal)"));
assert(frontend.includes('officialChecks:{...(row.officialChecks||{}),[s.portal]:record}'));
assert(frontend.includes('...fields(checks.business),...fields(checks.personal)'));
assert(frontend.includes('window.MstOfficial.comparePortalNames(checks)'));
assert(frontend.includes('new Date().toISOString()'));
assert(frontend.includes('AutoTax không xác minh máy chủ.'));
assert(!source.includes('fetch('),'Official tax site must not be auto-scraped or bypass CAPTCHA');
assert(!source.includes('localStorage')||source.includes('No localStorage'),
 'Data must not be persisted automatically');
new vm.Script(frontend,{filename:'mst-lookup.js'});
console.log('Official tax row matching, 10/12/13-digit routing, privacy and export provenance passed.');
