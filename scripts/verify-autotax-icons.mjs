import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const file=p=>fs.readFileSync(p);
const master=file('autotax/icons/icon.svg');
const web=file('docs/favicon.svg');
assert.deepEqual(web,master,'Website favicon must match Chrome extension master SVG');
assert(master.toString().includes('AutoTax by Tendoo'));
assert(master.toString().includes('#070D15')&&master.toString().includes('#21CEFF')&&
 master.toString().includes('smart invoice automation'),
 'Independent dark automation mark with electric-blue circuit accent required.');
assert(!master.toString().includes('#FF2449'),'The new AutoTax logo must not reuse the old red identity.');
const manifest=JSON.parse(file('autotax/manifest.json').toString('utf8'));
for(const s of [16,24,32,48,64,128,256]){
 const pathname='autotax/icons/icon-'+s+'.png';
 const bytes=file(pathname);
 assert(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),
  pathname+' is not a PNG');
 assert.equal(bytes.readUInt32BE(16),s,'PNG width differs from filename: '+pathname);
 assert.equal(bytes.readUInt32BE(20),s,'PNG height differs from filename: '+pathname);
 if([16,32,48,128].includes(s)){
  assert.equal(manifest.icons[String(s)],'icons/icon-'+s+'.png');
  assert.equal(manifest.action.default_icon[String(s)],'icons/icon-'+s+'.png');
 }
}
const ico=file('docs/favicon.ico');
assert.equal(ico.readUInt16LE(0),0);
assert.equal(ico.readUInt16LE(2),1);
assert(ico.readUInt16LE(4)>=4,'Multi-resolution ICO must include small icons');
assert.deepEqual(ico,file('autotax/icons/favicon.ico'));
const apple=file('docs/apple-touch-icon.png');
assert.equal(apple.readUInt32BE(16),180);
assert.equal(apple.readUInt32BE(20),180);
for(const page of ['docs/index.html','docs/web.html','docs/mst.html','docs/admin.html']){
 const html=file(page).toString('utf8');
 for(const name of ['favicon.ico','favicon.svg','apple-touch-icon.png'])
  assert(html.includes('./'+name),page+' missing '+name);
}
console.log('AutoTax favicon master, PNG resolutions, ICO, Apple icon, manifest and website links passed.');
