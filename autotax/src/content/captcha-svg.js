// Giải captcha SVG kiểu svg-captcha: mỗi ký tự là một <path fill> riêng, đường nhiễu là <path fill="none">.
// Ký tự là outline của font (chỉ bị lệch ngẫu nhiên ±0.1) nên so khớp với bảng mẫu là đủ, không cần OCR.
// Chỉ xử lý chuỗi nên chạy được cả trong service worker.
// Chép từ captcha/local/svg.js của repo anhtd-png/captcha-solver-extension (bỏ renderSvgGlyphs – cần canvas, chỉ dùng cho OCR),
// bọc thành script thường vì content script không dùng được import. Bảng mẫu: captcha-svg-templates.js (nạp trước).
(() => {
  /** Tách các ký tự trong SVG, sắp xếp từ trái sang phải. */
  function parseSvgCaptcha(svg) {
    const glyphs = [];
    for (const [tag] of svg.matchAll(/<path\b[^>]*>/g)) {
      if (/\bfill\s*=\s*"none"/.test(tag)) continue; // đường nhiễu
      const d = tag.match(/\bd\s*=\s*"([^"]+)"/)?.[1];
      if (d) glyphs.push(normalizePath(d));
    }
    return glyphs.sort((a, b) => a.cx - b.cx);
  }

  /** Chuẩn hóa path: chuỗi lệnh + tọa độ đưa về khung cao = 1 (không phụ thuộc vị trí, cỡ chữ). */
  function normalizePath(d) {
    const cmds = d.match(/[A-Za-z]/g).join('');
    const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]);
      y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]);
    }
    const size = y1 - y0 || 1;
    const pts = nums.map((v, i) => (i % 2 ? (v - y0) : (v - x0)) / size);
    return { cmds, pts, cx: (x0 + x1) / 2, aspect: (x1 - x0) / size };
  }

  /**
   * Nhận diện từng ký tự bằng bảng mẫu.
   * @param {Array<{ch, cmds, pts, aspect}>} templates  tạo bởi scripts/build-svg-templates.js
   * @returns {{text: string, confidence: number, chars: Array<{ch, distance}>}}
   */
  function matchSvgGlyphs(glyphs, templates, { charset } = {}) {
    const pool = charset ? templates.filter((t) => charset.includes(t.ch)) : templates;
    const chars = glyphs.map((g) => {
      let best = { ch: '', distance: Infinity };
      for (const t of pool) {
        const distance = glyphDistance(g, t);
        if (distance < best.distance) best = { ch: t.ch, distance };
      }
      return best;
    });
    const worst = Math.max(0, ...chars.map((c) => c.distance));
    return {
      text: chars.map((c) => c.ch).join(''),
      // khớp cùng cấu trúc lệnh: distance ~0.003 (chỉ do nhiễu ±0.1) -> ~100
      confidence: Math.max(0, Math.round(100 - worst * 2000)),
      chars,
    };
  }

  function glyphDistance(g, t) {
    if (g.cmds === t.cmds && g.pts.length === t.pts.length) {
      let sum = 0;
      for (let i = 0; i < g.pts.length; i++) sum += Math.abs(g.pts[i] - t.pts[i]);
      return sum / g.pts.length;
    }
    // Khác cấu trúc (font khác / path bị biến đổi): so sánh thô theo tỉ lệ khung + độ dài lệnh
    return 1 + Math.abs(g.aspect - t.aspect) + Math.abs(g.cmds.length - t.cmds.length) / Math.max(g.cmds.length, t.cmds.length);
  }

  // Giải chuỗi SVG (trường content của GET /api/captcha) → { text, confidence, chars }
  const solve = (svg) => matchSvgGlyphs(parseSvgCaptcha(svg), self.SVG_CAPTCHA_TEMPLATES);

  self.SvgCaptcha = { parseSvgCaptcha, matchSvgGlyphs, solve };
})();
