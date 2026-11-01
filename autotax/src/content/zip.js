// Đọc/ghi file .zip tối giản, không thư viện ngoài (MV3 không nạp code từ CDN).
// - readZip: đọc zip "Xuất xml" của cổng (các file lưu không nén; có nén deflate thì giải bằng DecompressionStream).
// - writeZip: ghi zip không nén (STORE) – dùng cho gói XML/HTML từng tháng và làm vỏ file .xlsx.
(() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Trả { tên file: Uint8Array }
  async function readZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = buf.length - 22;
    while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('File zip không hợp lệ');
    const out = {};
    let p = dv.getUint32(eocd + 16, true);
    for (let i = dv.getUint16(eocd + 10, true); i > 0; i--) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = buf.subarray(start, start + size);
      out[name] = method === 0 ? data
        : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  // files: [{ name, data: string | Uint8Array }] → Uint8Array (zip không nén, tên file UTF-8)
  function writeZip(files) {
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const head = (sig, central) => {
        const h = new DataView(new ArrayBuffer(central ? 46 : 30));
        h.setUint32(0, sig, true);
        let o = 4;
        if (central) { h.setUint16(o, 20, true); o += 2; } // version made by
        h.setUint16(o, 20, true); h.setUint16(o + 2, 0x0800, true); // version needed, cờ UTF-8
        h.setUint16(o + 4, 0, true); h.setUint16(o + 6, time, true); h.setUint16(o + 8, date, true);
        h.setUint32(o + 10, crc, true); h.setUint32(o + 14, data.length, true); h.setUint32(o + 18, data.length, true);
        h.setUint16(o + 22, name.length, true);
        if (central) h.setUint32(42, offset, true);
        return new Uint8Array(h.buffer);
      };
      locals.push(head(0x04034b50, false), name, data);
      centrals.push(head(0x02014b50, true), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = centrals.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
    let o = 0;
    for (const b of parts) { out.set(b, o); o += b.length; }
    return out;
  }

  window.Zip = { readZip, writeZip, text: (u8) => dec.decode(u8) };
})();
