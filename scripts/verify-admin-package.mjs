import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('docs/admin.html','utf8');
const form=html.match(/<form id="createPackageForm"([\s\S]*?)<\/form>/)?.[0]||'';
assert(form,'Admin package creation form missing');
for(const id of ['newCode','newFamily','newName','newQty','newPrice','newDesc','createPackage'])
 assert(form.includes('id="'+id+'"'),'Missing form input '+id);
assert(form.includes('id="createPackage" type="submit"'),'Create action must be a submit');
assert(html.includes('id="createPackageMessage"')&&html.includes('packageNotice('),
 'Errors should be visible next to the package form');
assert(html.includes('normalizePackageCode')&&html.includes('Number.isSafeInteger(quantity)')&&html.includes('Number.isSafeInteger(price)'),
 'Validate normalized package codes and positive integer quantities/prices');
assert(html.includes('Mã "+code+" đã tồn tại')&&html.includes('Đang tạo gói'),
 'Prevent duplicate codes and repeated submissions');
assert(html.includes('addon_admin_create_package')&&html.includes('await loadPlans()'),
 'Create package through protected RPC and refresh catalog');
assert(!html.includes('một trong 10 gói'),'Catalog must allow more than ten packages');
assert(!html.includes('@media(max-width:520px){</style>'),'Close responsive styles');
assert(!html.includes('</div></div></div>\n<section id="adminPackageGrant"'),
 'Do not close the admin protected section before grant tools');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))
 if(match[1].trim())new vm.Script(match[1],{filename:'admin.html:inline'});
console.log('Admin package creation checks passed.');
