// Bộ chọn khoảng ngày (không thư viện ngoài – MV3 không nạp script từ CDN).
// - Ô gõ tay dd/mm/yyyy, tự chèn "/" khi gõ.
// - Mỗi ô chọn riêng: bấm ô nào thì lịch popover chỉ chọn ngày cho ô đó rồi đóng lại,
//   bấm tiêu đề tháng để chọn nhanh tháng/năm, ngày ngoài giới hạn bị làm mờ.
// Giá trị thật (yyyy-mm-dd) nằm trong 2 input ẩn `from`/`to`; mỗi khi đổi sẽ phát sự kiện input + change
// trên input ẩn để phần còn lại của panel xử lý như trước.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(2000, 0, 1); dt.setFullYear(y, m - 1, d);
  return dt;
};
const toVN = (s) => (s ? s.split('-').reverse().join('/') : '');
// dd/mm/yyyy → yyyy-mm-dd, null nếu không phải ngày có thật (vd 31/02)
function fromVN(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (y < 2000 || mo < 1 || mo > 12) return null;
  const dt = new Date(2000, 0, 1); dt.setFullYear(y, mo - 1, d);
  return dt.getDate() === d && dt.getMonth() === mo - 1 ? iso(dt) : null;
}
// Gõ số → tự định dạng dd/mm/yyyy
function mask(v) {
  const digits = v.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTHS = Array.from({ length: 12 }, (_, i) => `Tháng ${i + 1}`);

/**
 * @param {object} o
 * @param {HTMLInputElement} o.from  input ẩn yyyy-mm-dd
 * @param {HTMLInputElement} o.to    input ẩn yyyy-mm-dd
 * @param {HTMLInputElement} o.fromText  ô gõ dd/mm/yyyy
 * @param {HTMLInputElement} o.toText
 * @param {HTMLElement} o.anchor  phần tử bọc 2 ô, popover hiện ngay dưới
 * @param {(fromIso:string)=>string} o.maxTo  ngày kết thúc lớn nhất cho phép theo ngày bắt đầu
 * @param {()=>{min:string,max:string}} [o.limits]  khoảng ngày được chọn (yyyy-mm-dd), vd. theo nguồn tra cứu
 */
export function createRangePicker({ from, to, fromText, toText, anchor, maxTo, limits = () => ({ min: '2000-01-01', max: '9999-12-31' }) }) {
  let mode = 'from';           // đang chọn ô nào
  let view = new Date();       // tháng đang xem (ngày 1)
  let level = 'days';          // days | months | years

  const pop = document.createElement('div');
  pop.className = 'dp';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  anchor.append(pop);

  const emit = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  function setValue(which, v) {
    const el = which === 'from' ? from : to;
    if (el.value === v) return;
    el.value = v;
    emit(el);
  }

  // Đồng bộ ô hiển thị từ giá trị ẩn (gọi sau khi code khác gán from/to.value)
  // force: ghi đè cả ô đang focus (sau khi chọn trên lịch)
  function refresh(force = false) {
    if (force || document.activeElement !== fromText) fromText.value = toVN(from.value);
    if (force || document.activeElement !== toText) toText.value = toVN(to.value);
    fromText.classList.remove('bad'); toText.classList.remove('bad');
    if (!pop.hidden) render();
  }

  function open(which) {
    mode = which;
    level = 'days';
    const base = parseIso((which === 'to' ? to.value : from.value) || from.value) || new Date();
    view = new Date(base.getFullYear(), base.getMonth(), 1);
    pop.hidden = false;
    fromText.classList.toggle('picking', which === 'from');
    toText.classList.toggle('picking', which === 'to');
    render();
  }
  function close() {
    pop.hidden = true;
    fromText.classList.remove('picking'); toText.classList.remove('picking');
  }

  function disabled(day) {
    const { min, max } = limits();
    if (day < min || day > max) return true;
    if (mode !== 'to' || !from.value) return false;
    return day < from.value || day > maxTo(from.value);
  }

  // Chọn xong thì đóng; đổi "Từ ngày" làm "Đến ngày" ra ngoài giới hạn thì panel tự kéo lại (sự kiện change)
  function pick(day) {
    setValue(mode, day);
    refresh(true); close();
    (mode === 'from' ? fromText : toText).blur();
  }

  function header(title, onPrev, onNext, onTitle) {
    const h = document.createElement('div'); h.className = 'dp-head';
    const prev = btn('‹', 'dp-nav', onPrev, 'Trước');
    const t = btn(title, 'dp-title', onTitle);
    const next = btn('›', 'dp-nav', onNext, 'Sau');
    h.append(prev, t, next);
    return h;
  }
  function btn(text, cls, onClick, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    if (label) b.setAttribute('aria-label', label);
    if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function render() {
    pop.replaceChildren();
    const { min, max } = limits();

    if (level === 'years') {
      const start = view.getFullYear() - (view.getFullYear() % 12);
      pop.append(header(`${start} – ${start + 11}`, () => { view.setFullYear(view.getFullYear() - 12); render(); }, () => { view.setFullYear(view.getFullYear() + 12); render(); }, null));
      const g = document.createElement('div'); g.className = 'dp-grid dp-grid-3';
      for (let y = start; y < start + 12; y++) {
        const b = btn(String(y), 'dp-cell' + (y === view.getFullYear() ? ' sel' : ''), () => { view.setFullYear(y); level = 'months'; render(); });
        if (y < 2000 || y < +min.slice(0, 4) || y > +max.slice(0, 4)) b.disabled = true;
        g.append(b);
      }
      pop.append(g);
    } else if (level === 'months') {
      pop.append(header(String(view.getFullYear()), () => { view.setFullYear(view.getFullYear() - 1); render(); }, () => { view.setFullYear(view.getFullYear() + 1); render(); }, () => { level = 'years'; render(); }));
      const g = document.createElement('div'); g.className = 'dp-grid dp-grid-3';
      MONTHS.forEach((m, i) => {
        const b = btn(m, 'dp-cell' + (i === view.getMonth() ? ' sel' : ''), () => { view.setMonth(i); level = 'days'; render(); });
        const ym = `${view.getFullYear()}-${pad(i + 1)}`;
        b.disabled = ym < min.slice(0, 7) || ym > max.slice(0, 7); // tháng nằm ngoài giới hạn của nguồn
        g.append(b);
      });
      pop.append(g);
    } else {
      pop.append(header(`Tháng ${view.getMonth() + 1}, ${view.getFullYear()}`,
        () => { view.setMonth(view.getMonth() - 1); render(); },
        () => { view.setMonth(view.getMonth() + 1); render(); },
        () => { level = 'months'; render(); }));
      const g = document.createElement('div'); g.className = 'dp-grid dp-grid-7';
      WEEKDAYS.forEach((w) => { const s = document.createElement('span'); s.className = 'dp-wd'; s.textContent = w; g.append(s); });
      const first = new Date(view.getFullYear(), view.getMonth(), 1);
      const offset = (first.getDay() + 6) % 7; // thứ Hai đầu tuần
      const today = iso(new Date());
      const sel = mode === 'from' ? from.value : to.value; // chỉ tô ngày của ô đang chọn
      for (let i = 0; i < 42; i++) {
        const d = new Date(first.getFullYear(), first.getMonth(), 1 - offset + i);
        const day = iso(d);
        const cls = ['dp-day'];
        if (d.getMonth() !== view.getMonth()) cls.push('out');
        if (day === today) cls.push('today');
        if (day === sel) cls.push('sel');
        const cell = btn(String(d.getDate()), cls.join(' '), () => pick(day));
        cell.disabled = disabled(day);
        g.append(cell);
      }
      pop.append(g);
    }

    const foot = document.createElement('div'); foot.className = 'dp-foot';
    foot.append(btn('Hôm nay', 'dp-link', () => { const t = new Date(); view = new Date(t.getFullYear(), t.getMonth(), 1); level = 'days'; render(); }),
      btn('Đóng', 'dp-link', close));
    pop.append(foot);
  }

  // Ô gõ tay
  for (const [which, input] of [['from', fromText], ['to', toText]]) {
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('placeholder', 'dd/mm/yyyy');
    input.title = 'Gõ ngày dạng dd/mm/yyyy hoặc chọn trên lịch';
    input.setAttribute('maxlength', '10');
    input.addEventListener('focus', () => open(which));
    input.addEventListener('click', () => { if (pop.hidden || mode !== which) open(which); });
    input.addEventListener('input', () => {
      const pos = input.selectionStart, before = input.value.length;
      input.value = mask(input.value);
      const after = input.value.length; input.setSelectionRange(pos + after - before, pos + after - before);
      const v = fromVN(input.value);
      input.classList.toggle('bad', input.value.length === 10 && !v);
      if (v) {
        setValue(which, v);
        const d = parseIso(v); view = new Date(d.getFullYear(), d.getMonth(), 1); level = 'days';
        render();
      }
    });
    input.addEventListener('blur', () => {
      // gõ dở/sai → trả về giá trị đang có
      if (!fromVN(input.value)) { input.value = toVN((which === 'from' ? from : to).value); input.classList.remove('bad'); }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); input.blur(); }
      if (e.key === 'Enter') { close(); input.blur(); }
    });
  }

  // Bấm ra ngoài thì đóng
  document.addEventListener('mousedown', (e) => { if (!pop.hidden && !anchor.contains(e.target)) close(); });
  pop.addEventListener('mousedown', (e) => e.preventDefault()); // giữ focus ở ô đang gõ

  refresh();
  return { refresh, close, open };
}
