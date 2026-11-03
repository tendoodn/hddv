/* Read only a PDF from a bounded issuer-provided ZIP archive.
 * No filename extraction to disk, no external libraries, and no ZIP bomb expansion.
 */
(() => {
 'use strict';
 const MAX_PDF=12*1024*1024,MAX_TOTAL=48*1024*1024,MAX_ENTRIES=150;
 const isPdf=x=>x?.length>=5&&x[0]===37&&x[1]===80&&x[2]===68&&x[3]===70&&x[4]===45;
 const crcTable=Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
 });
 function crc32(bytes){
  let crc=0xffffffff;
  for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
 }
 async function deflateRaw(src,expected){
  const stream=new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader=stream.getReader(),parts=[];let size=0;
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>MAX_PDF){await reader.cancel();throw Error('Tệp PDF giải nén vượt 12 MB.')}
   parts.push(value);
  }
  if(size!==expected)throw Error('Kích thước tệp PDF bên trong ZIP không khớp.');
  const output=new Uint8Array(size);let p=0;
  for(const part of parts){output.set(part,p);p+=part.byteLength}
  return output;
 }
 async function extractPdf(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length>24*1024*1024)
   throw Error('Tệp ZIP gốc vượt 24 MB hoặc không hợp lệ.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true);
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-22-65535)&&u32(end)!==0x06054b50)end--;
  if(end<0||end+22>bytes.length)throw Error('Không tìm thấy danh mục ZIP gốc.');
  const count=u16(end+10),cdSize=u32(end+12),cdOffset=u32(end+16);
  if(!count||count>MAX_ENTRIES||cdOffset+cdSize>bytes.length)
   throw Error('ZIP có danh mục không hợp lệ hoặc quá nhiều tệp.');
  let cursor=cdOffset,declared=0;
  const found=[],decoder=new TextDecoder();
  for(let i=0;i<count;i++){
   if(cursor+46>bytes.length||u32(cursor)!==0x02014b50)
    throw Error('ZIP có mục bị lỗi.');
   const flags=u16(cursor+8),method=u16(cursor+10),crc=u32(cursor+16),
     compressed=u32(cursor+20),size=u32(cursor+24),
     nameLength=u16(cursor+28),extraLength=u16(cursor+30),
     commentLength=u16(cursor+32),localOffset=u32(cursor+42);
   const next=cursor+46+nameLength+extraLength+commentLength;
   if(next>bytes.length||flags&1||compressed===0xffffffff||size===0xffffffff)
    throw Error('ZIP mã hóa, ZIP64 hoặc danh mục bị lỗi chưa được hỗ trợ.');
   declared+=size;
   if(declared>MAX_TOTAL)throw Error('ZIP có tổng dung lượng giải nén vượt giới hạn an toàn.');
   const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
   cursor=next;
   if(!/\.pdf$/i.test(name)||name.startsWith('__MACOSX/')||name.includes('/._'))continue;
   if(size>MAX_PDF)throw Error('PDF trong ZIP vượt 12 MB.');
   if(localOffset+30>bytes.length||u32(localOffset)!==0x04034b50)
    throw Error('ZIP thiếu header tệp PDF.');
   const at=localOffset+30+u16(localOffset+26)+u16(localOffset+28);
   if(at+compressed>bytes.length)throw Error('Dữ liệu PDF trong ZIP không đầy đủ.');
   if(method!==0&&method!==8)throw Error('Định dạng nén PDF không được hỗ trợ.');
   const raw=bytes.subarray(at,at+compressed);
   const pdf=method===0?raw:await deflateRaw(raw,size);
   if(pdf.length!==size||crc32(pdf)!==crc||!isPdf(pdf))
    throw Error('PDF trong ZIP không hợp lệ hoặc checksum bị sai.');
   found.push({name,pdf});
   if(found.length>1)throw Error('ZIP chứa nhiều tệp PDF. Hãy tải ZIP trực tiếp và chọn đúng hóa đơn.');
  }
  if(!found.length)throw Error('ZIP nhà phát hành không chứa PDF hợp lệ.');
  return found[0];
 }
 globalThis.AutoTaxIssuerArchive=Object.freeze({extractPdf});
})();