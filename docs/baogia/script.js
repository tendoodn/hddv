const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + ' đ';
    const THRESHOLD = 500000000; 
    document.addEventListener('input', function(e) {
        if(e.target.classList.contains('currency-input')) {
            let val = e.target.value.replace(/\D/g, "");
            e.target.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        }
    });
    function getVal(id) {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value.replace(/\./g, "")) || 0 : 0;
    }
    function switchTab(id, b) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        document.getElementById(id).classList.add('active'); 
        b.classList.add('active');
    }
// tab
    function switchSubTab(id, b) {
        document.querySelectorAll('.sub-tab-content').forEach(c => c.style.display = 'none');
        document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
    const target = document.getElementById(id);
        if (target) target.style.display = 'block';
        b.classList.add('active');
    const moreMenu = document.getElementById("moreMenu");
        if (moreMenu) moreMenu.classList.remove('show');
    }
    function toggleMoreMenu(event) {
        event.stopPropagation(); 
    const menu = document.getElementById("moreMenu");
    menu.classList.toggle("show");
    }
    window.onclick = function(event) {
    const menu = document.getElementById("moreMenu");
    if (menu && menu.classList.contains('show')) {
        if (!event.target.closest('.tabs-more')) {
            menu.classList.remove('show');
        }
    }}
    //banggia
    function switchInnerTab(tabId, btn) {
        document.querySelectorAll('.inner-tab-content').forEach(content => {content.style.display = 'none';});
        const parent = btn.parentElement;
        parent.querySelectorAll('.sub-tab-btn').forEach(b => {b.classList.remove('active');});
        document.getElementById(tabId).style.display = 'block';
        btn.classList.add('active');
}

    const taxRates = [
        { name: "Phân phối hàng hóa", g: 0.01, t: 0.005 },
        { name: "Dịch vụ, xây dựng", g: 0.05, t: 0.02 },
        { name: "Sản xuất, vận tải", g: 0.03, t: 0.015 },
        { name: "Hoạt động khác", g: 0.02, t: 0.01 },
        { name: "Tự nhập tỷ lệ %", g: 0, t: 0, custom: true }
    ];
    function renderIndustryFields() {
        const count = parseInt(document.getElementById('industry_count').value);
        const container = document.getElementById('multi_industry_container');
        container.innerHTML = '';
        for(let i=1; i<=count; i++) {
            container.innerHTML += `
                <div style="border: 1px solid #eee; border-radius:12px; padding:15px; margin-bottom:15px; background:#fff;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom:10px;">
                        <div>
                            <label>Ngành thứ ${i}</label>
                            <select id="type_${i}" class="form-control" style="margin-bottom:5px;" onchange="toggleIndustryCustom(${i})">
                                ${taxRates.map((r, idx) => `<option value="${idx}">${r.name} ${r.custom ? '' : `(GTGT:${r.g*100}%|TNCN:${r.t*100}%)`}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label>Doanh thu năm</label>
                            <input type="text" id="rev_${i}" class="form-control currency-input" placeholder="0" oninput="calcTax()">
                        </div>
                    </div>
                    <div id="custom_rate_area_${i}" style="display:none; background: #f8fafc; padding: 10px; border-radius: 8px; margin-top: 5px;">
                        <label style="font-size:0.7rem;">Tên ngành/Dịch vụ tự định nghĩa</label>
                        <input type="text" id="custom_name_${i}" class="form-control" placeholder="Ví dụ: Cho thuê mặt bằng" style="padding:8px; margin-bottom:10px;" oninput="calcTax()">
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap:10px;">
                             <div>
                                <label style="font-size:0.7rem;">% Thuế GTGT</label>
                                <input type="number" id="custom_g_${i}" class="form-control" placeholder="%" oninput="calcTax()">
                             </div>
                             <div>
                                <label style="font-size:0.7rem;">% Thuế TNCN</label>
                                <input type="number" id="custom_t_${i}" class="form-control" placeholder="%" oninput="calcTax()">
                             </div>
                        </div>
                    </div>
                </div>
            `;
        }
        calcTax();
    }
    function toggleIndustryCustom(i) {
        const sel = document.getElementById(`type_${i}`).value;
        const area = document.getElementById(`custom_rate_area_${i}`);
        area.style.display = taxRates[sel].custom ? 'grid' : 'none';
        calcTax();
    }
    function calcTax() {
        const count = parseInt(document.getElementById('industry_count').value);
        let totalRev = 0;
        let industries = [];
        for(let i=1; i<=count; i++) {
            let rev = getVal(`rev_${i}`);
            let rateIdx = document.getElementById(`type_${i}`).value;
            let rateObj = taxRates[rateIdx];
            let g_rate = rateObj.custom ? (parseFloat(document.getElementById(`custom_g_${i}`).value)/100 || 0) : rateObj.g;
            let t_rate = rateObj.custom ? (parseFloat(document.getElementById(`custom_t_${i}`).value)/100 || 0) : rateObj.t;
            let name = rateObj.custom ? (document.getElementById(`custom_name_${i}`).value || "Ngành tự nhập") : rateObj.name;

            if(rev > 0) {
                industries.push({ rev, g_rate, t_rate, name: name });
                totalRev += rev;
            }
        }
        let totalGTGT = 0;
        let totalTNCN = 0;
        let detailHTML = '';
        let taxableRevTNCN = Math.max(0, totalRev - THRESHOLD);
        industries.forEach((item, index) => {
            let g = item.rev * item.g_rate;
            totalGTGT += g;
            let ratio = item.rev / totalRev;
            let allocatedRev = taxableRevTNCN * ratio;
            let t = allocatedRev * item.t_rate;
            totalTNCN += t;
            detailHTML += `
                <div style="margin-bottom: 15px; padding: 12px; background: #fff; border: 1px solid #eee; border-radius: 10px;">
                    <div style="font-weight:bold; font-size:0.85rem; color:var(--primary); margin-bottom:8px;">${index+1}. ${item.name}</div>
                    
                    <div class="math-row">
                        <span>• Thuế GTGT:</span>
                        <span style="font-weight:bold;">${fmt(g)}</span>
                    </div>
                    <div style="font-size:0.7rem; color:#888; margin-bottom:10px; padding-left:10px;">
                        Cơ sở: ${fmt(item.rev)} × ${(item.g_rate*100).toFixed(1)}%
                    </div>

                    <div class="math-row">
                        <span>• Thuế TNCN:</span>
                        <span style="font-weight:bold;">${fmt(t)}</span>
                    </div>
                    <div style="font-size:0.7rem; color:#888; padding-left:10px; line-height:1.4;">
                        Tỷ trọng ngành: ${(ratio * 100).toFixed(1)}% doanh thu tổng <br>
                        DT phân bổ: ${fmt(taxableRevTNCN)} × ${(ratio * 100).toFixed(1)}% = <b style="color:#555;">${fmt(allocatedRev)}</b> <br>
                        Thuế: ${fmt(allocatedRev)} × ${(item.t_rate*100).toFixed(1)}%
                    </div>

                    <div class="math-row" style="border-top:1px dashed #ddd; margin-top:8px; padding-top:8px; color:#000;">
                        <span style="font-weight:bold;">Tổng thuế ngành ${index+1}:</span>
                        <span style="font-weight:bold; color:var(--primary);">${fmt(g + t)}</span>
                    </div>
                </div>`;
        });
        let total1 = totalGTGT + totalTNCN;
        document.getElementById('res_tax_1').innerText = fmt(total1);
        let subDetail = `
            <div style="margin-top:10px; border: 2px solid #333; padding: 12px; border-radius: 10px; background: #f8fafc;">
                <div class="math-row"><span>Tổng doanh thu (a):</span> <span>${fmt(totalRev)}</span></div>
                <div class="math-row"><span>Doanh thu miễn thuế:</span> <span>${fmt(THRESHOLD)}</span></div>
                <div class="math-row" style="color:var(--green); font-weight:bold;"><span>DT chịu thuế TNCN (b):</span> <span>${fmt(taxableRevTNCN)}</span></div>
                <hr style="border:0; border-top:1px solid #ccc; margin:8px 0;">
                <div class="math-row"><span>1. Tổng GTGT (tính trên a):</span> <span>${fmt(totalGTGT)}</span></div>
                <div class="math-row"><span>2. Tổng TNCN (tính trên b):</span> <span>${fmt(totalTNCN)}</span></div>
                <div class="math-row" style="margin-top:5px; padding-top:5px; border-top: 2px solid #333;">
                    <span style="font-weight:900;">TỔNG CỘNG:</span> 
                    <span style="font-size:1.2rem; font-weight:900; color:var(--primary);">${fmt(total1)}</span>
                </div>
            </div>
        `;
        
        document.getElementById('detail_tax_1').innerHTML = detailHTML + subDetail;
        document.getElementById('avg_1').innerText = fmt(total1 / 12);
        let cost = getVal('tax_c');
        let ln = Math.max(0, totalRev - cost);
        let total2 = ln * 0.15;
        document.getElementById('val_ln').innerText = fmt(ln);
        document.getElementById('val_tax_ln').innerText = fmt(total2);
        document.getElementById('val_total_2').innerText = fmt(total2);
        document.getElementById('res_tax_2').innerText = fmt(total2);
        document.getElementById('avg_2').innerText = fmt(total2 / 12);
        updateUIResult(totalRev, total1, total2);
    }

    function updateUIResult(totalRev, t1, t2) {
        const card1 = document.getElementById('card_1');
        const card2 = document.getElementById('card_2');
        const b1 = document.getElementById('badge_1');
        const b2 = document.getElementById('badge_2');
        if(t1 <= t2 || t2 <= 0) {
            card1.className = 'tax-card best'; card2.className = 'tax-card warning';
            b1.className = 'badge-status badge-best'; b1.innerText = 'Tối ưu';
            b2.className = 'badge-status badge-warn'; b2.innerText = 'Cảnh báo';
        } else {
            card2.className = 'tax-card best'; card1.className = 'tax-card warning';
            b2.className = 'badge-status badge-best'; b2.innerText = 'Tối ưu';
            b1.className = 'badge-status badge-warn'; b1.innerText = 'Cảnh báo';
        }
        const advice = document.getElementById('advice_text');
        const tag = document.getElementById('tag_nhom');
        if (totalRev < 500000000) {
            tag.innerText = "NHÓM: DƯỚI 500 TRIỆU";
            advice.innerHTML = `<b>Hộ, cá nhân kinh doanh được MIỄN THUẾ.</b>
                                Theo quy định, hộ kinh doanh miễn thuế vẫn cần kê khai doanh thu 1 – 2 lần trong năm.
                                <br><b>Hóa đơn điện tử</b>
                                Không bắt buộc
                                <br><b>Sổ sách kế toán</b>
                                <a href="https://docs.google.com/spreadsheets/d/1wqz2V-3uQlUAq9FtV1ZAOVszp49zlFsA/export?format=xlsx" 
                                style="color: #22c55e; font-weight: bold; text-decoration: none; margin-left: 5px;">
                                <i class="fas fa-file-download"></i>Mẫu số S1a-HKD
                                </a>
                                <br><b>Tài khoản ngân hàng</b>
                                Không bắt buộc
                                <br><b>Kỳ kê khai:</b> 1 lần/năm
                                <br><b>Hạn kê khai:</b>
                                Khai doanh thu 1 lần trước 31/1 năm sau
                                <br>Nếu vượt ngưỡng 6 tháng đầu, kê khai chậm nhất vào ngày 30/06 năm sau`;
        } else if (totalRev <= 3000000000) {
            tag.innerText = "NHÓM: 500TR - 3 TỈ";
            advice.innerHTML = `<b>Hóa đơn điện tử</b>
                                < 1 tỷ: Không bắt buộc, nhưng khuyến khích dùng
                                <br>≥ 1 tỷ: Bắt buộc sử dụng hóa đơn điện tử
                                <br>≥ 1 tỷ và có hoạt động bán hàng/dịch vụ trực tiếp (bán lẻ,..): 
                                <br>Bắt buộc dùng hóa đơn điện tử máy tính tiền (Theo Nghị định 70/2025/NĐ-CP)
                                <br><b>Sổ sách kế toán</b>
                                <a href="https://docs.google.com/spreadsheets/d/1wqz2V-3uQlUAq9FtV1ZAOVszp49zlFsA/export?format=xlsx" 
                                style="color: #22c55e; font-weight: bold; text-decoration: none; margin-left: 5px;">
                                <i class="fas fa-file-download"></i>Mẫu số S2a-HKD
                                </a>
                                <br><b>Tài khoản ngân hàng</b>
                                Bắt buộc mở tài khoản riêng phục vụ kinh doanh
                                <br><b>Kỳ kê khai:</b>Theo quý
                                <br><b>Hạn kê khai:</b>
                                Thuế GTGT & Thuế TNCN: Theo Quý
                                <br>Nếu chọn phương pháp tính thuế theo thu nhập (Doanh thu - Chi phí): Phải nộp thuế TNCN trước 31/1 năm sau
                                <br>Hạn nộp hồ sơ khai thuế theo Quý muộn nhất: Quý 1 là ngày 30/04/năm; Quý 2 là 31/7/năm; Quý 3 là ngày 31/10/năm; Quý 4 là ngày 31/1/(năm+1)`;
        } else {
            tag.innerText = "NHÓM: TRÊN 3 TỈ";
            advice.innerHTML = `<b>Hóa đơn điện tử</b>
                                Bắt buộc
                                <br><b>Sổ sách kế toán</b>
                                <a href="https://docs.google.com/spreadsheets/d/1wqz2V-3uQlUAq9FtV1ZAOVszp49zlFsA/export?format=xlsx" 
                                style="color: #22c55e; font-weight: bold; text-decoration: none; margin-left: 5px;">
                                <i class="fas fa-file-download"></i>Mẫu số S2b-HKD
                                </a><br>
                                <a href="https://docs.google.com/spreadsheets/d/1wqz2V-3uQlUAq9FtV1ZAOVszp49zlFsA/export?format=xlsx" 
                                style="color: #22c55e; font-weight: bold; text-decoration: none; margin-left: 5px;">
                                <i class="fas fa-file-download"></i>Mẫu số S2c-HKD
                                </a><br>
                                <a href="https://docs.google.com/spreadsheets/d/1wqz2V-3uQlUAq9FtV1ZAOVszp49zlFsA/export?format=xlsx" 
                                style="color: #22c55e; font-weight: bold; text-decoration: none; margin-left: 5px;">
                                <i class="fas fa-file-download"></i>Mẫu số S2d-HKD
                                </a><br>
                                <a href="https://docs.google.com/spreadsheets/d/1wqz2V-3uQlUAq9FtV1ZAOVszp49zlFsA/export?format=xlsx" 
                                style="color: #22c55e; font-weight: bold; text-decoration: none; margin-left: 5px;">
                                <i class="fas fa-file-download"></i>Mẫu số S2e-HKD
                                </a>
                                <br><b>Tài khoản ngân hàng</b>
                                Bắt buộc mở tài khoản riêng phục vụ kinh doanh
                                <br><b>Kỳ kê khai:</b>Theo quý
                                <br><b>Hạn kê khai:</b>
                                Thuế GTGT & Thuế TNCN: Theo Quý
                                <br>Nếu chọn phương pháp tính thuế theo thu nhập (Doanh thu - Chi phí): Phải nộp thuế TNCN trước 31/1 năm sau
                                <br>Hạn nộp hồ sơ khai thuế theo Quý muộn nhất: Quý 1 là ngày 30/04/năm; Quý 2 là 31/7/năm; Quý 3 là ngày 31/10/năm; Quý 4 là ngày 31/1/(năm+1)`;
        }
    }
    //tính giá niêm yết
function calcPrice() {
    let x = getVal('x_val'); 
    let v_val = document.getElementById('vat_select').value;
    let v = v_val === 'custom' 
        ? (parseFloat(document.getElementById('vat_custom').value) / 100 || 0) 
        : parseFloat(v_val);
    let y = getVal('y_val');
    let t_val = document.getElementById('t_select').value;
    let t = t_val === 'custom' 
        ? (parseFloat(document.getElementById('t_custom').value) / 100 || 0) 
        : parseFloat(t_val);
    let finalPrice = 0;
    if (t < 1) {
        finalPrice = (x * (1 + v) + y) / (1 - t);
    }
    document.getElementById('p_res').innerText = fmt(finalPrice);
}
function toggleVAT() {
    document.getElementById('vat_custom').style.display = (document.getElementById('vat_select').value === 'custom') ? 'block' : 'none';
    calcPrice();
}
function toggleT() {
    document.getElementById('t_custom').style.display = (document.getElementById('t_select').value === 'custom') ? 'block' : 'none';
    calcPrice();
}
// tính Doanh thu ngược 
function calcRevenue() {
    let tax = getVal('tax_paid');
    let t_val = document.getElementById('t_rev_select').value;
    let t = t_val === 'custom' ? (parseFloat(document.getElementById('t_rev_custom').value)/100 || 0) : parseFloat(t_val);
    let revenue = (t > 0) ? (tax / t) : 0;
    document.getElementById('rev_res').innerText = fmt(revenue);
}
function toggleTRev() {
    document.getElementById('t_rev_custom').style.display = (document.getElementById('t_rev_select').value === 'custom') ? 'block' : 'none';
    calcRevenue();
}

//gio hang
let cart = [];
let swiper = null;
let currentProduct = null;
let currentImages = [];
let currentIndex = 0;
function openPos(product) {
    currentProduct = product;
    currentImages = (product.images && product.images.length > 0) ? product.images : [product.image];
    currentIndex = 0;
    document.getElementById('modal_product_name').innerText = product.name;
    document.getElementById('modal_product_price').innerText = product.price.toLocaleString() + 'đ';
    document.getElementById('modal_product_specs').innerText = product.specs;
    updateSlider();
    document.getElementById('productModal').style.display = 'flex';
}
function updateSlider() {
    const imgElement = document.getElementById('modal_product_img');
    const counterElement = document.getElementById('image_counter');
    if (imgElement && currentImages.length > 0) {
        imgElement.src = currentImages[currentIndex];
    }
    if (counterElement) {
        counterElement.innerText = (currentIndex + 1) + '/' + currentImages.length;
    }
    const btnPrev = document.getElementById('btn_prev');
    const btnNext = document.getElementById('btn_next');
    if (btnPrev && btnNext) {
        const display = currentImages.length > 1 ? 'flex' : 'none';
        btnPrev.style.display = display;
        btnNext.style.display = display;
    }
}
function changeImage(step) {
    if (currentImages.length <= 1) return;
    currentIndex += step;
    if (currentIndex >= currentImages.length) currentIndex = 0;
    if (currentIndex < 0) currentIndex = currentImages.length - 1;
    updateSlider();
}
function closeModal() {
    document.getElementById('productModal').style.display = 'none';
}
function addToCart() {
    cart.push(currentProduct);
    updateCartUI();
    closePos();
    alert('Đã thêm ' + currentProduct.name + ' vào giỏ hàng!');
}

function updateCartUI() {
    const bubble = document.getElementById('cart_bubble');
    const list = document.getElementById('cart_items_list');
    const totalDiv = document.getElementById('cart_total');
    bubble.style.display = cart.length > 0 ? 'flex' : 'none';
    document.getElementById('cart_count').innerText = cart.length;
    if (cart.length === 0) {
        list.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:20px;">Giỏ hàng trống</div>`;
        totalDiv.innerText = 'Tổng cộng: 0 đ';
        return;
    }
    let total = 0;
    list.innerHTML = cart.map((item, idx) => {
        total += item.price;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px; background:#f8fafc; border-radius:8px;">
                <div style="flex:1;">
                    <div style="font-size:0.85rem; font-weight:600; color:#334155;">${item.name}</div>
                    <div style="font-size:0.8rem; color:var(--primary); font-weight:700;">${fmt(item.price)}</div>
                </div>
                <button onclick="removeFromCart(${idx})" style="background:none; border:none; color:#cbd5e1; cursor:pointer; padding:5px;">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>`;
    }).join('');
    totalDiv.innerText = 'Tổng cộng: ' + fmt(total);
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
}

function toggleCartModal() {
    const m = document.getElementById('cartModal');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}

function sendOrderZalo() {
    const phone = document.getElementById('cust_phone').value;
    if (!phone) { 
        alert('Vui lòng nhập Số điện thoại để Tendoo liên hệ hỗ trợ!'); 
        return; 
    }
    let message = `🚀 *YÊU CẦU ĐƠN HÀNG*\nChào shop, tôi muốn đặt hàng\n`;
    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `📞 SĐT: ${phone}\n`;
    message += `📦 Đơn hàng gồm:\n`;
    cart.forEach((item, i) => {
        message += `  ${i+1}. ${item.name} (${fmt(item.price)})\n`;
    });
    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `💰 ${document.getElementById('cart_total').innerText}`;
    const textArea = document.createElement("textarea");
    textArea.value = message;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 99999); 
    let success = false;
    try {
        success = document.execCommand('copy');
    } catch (err) {
        success = false;
    }
    document.body.removeChild(textArea);
    if (success) {
        window.location.href = "https://zalo.me/0868838242";
    } else {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(message).then(() => {
                window.location.href = "https://zalo.me/0868838242";
            });
        } else {
            window.location.href = "https://zalo.me/0868838242";
        }
    }
    setTimeout(function() {
        if(document.hasFocus()) {
            window.open("https://zalo.me/0868838242", '_blank');
        }
    }, 2000);
}

    function closePos() { document.getElementById('posModal').style.display = 'none'; }
    function createPetals() {
        const container = document.getElementById('blossoms');
        for (let i = 0; i < 20; i++) {
            let petal = document.createElement('div');
            petal.className = 'petal';
            petal.style.left = Math.random() * 100 + 'vw';
            petal.style.width = petal.style.height = Math.random() * 8 + 5 + 'px';
            petal.style.animationDuration = Math.random() * 5 + 5 + 's';
            petal.style.animationDelay = Math.random() * 5 + 's';
            container.appendChild(petal);
        }
    }
    window.onload = () => { renderIndustryFields(); createPetals(); calcPrice(); };

    function addInvoiceToCart(name, price) {
    const invoiceItem = {
        name: name,
        price: price,
        images: [],
        specs: "Hóa đơn điện tử có mã của Cơ quan Thuế theo Thông tư 78/2021/TT-BTC."
    };

    cart.push(invoiceItem);
    updateCartUI();
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "Đã thêm!";
    btn.style.background = "#28a745";
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.background = "";
    }, 1500);
}
function clearCart() {
    if (confirm("Bạn có chắc chắn muốn xóa tất cả sản phẩm trong giỏ hàng?")) {
        cart = [];
        updateCartUI();
        toggleCartModal();
    }
}
const fakeData = {
    names: ["Anh Hùng", "Chị Lan", "Anh Minh", "Chú Bảy", "Chị Thảo", "Chị Trân", "Anh Quốc", "Anh Trung", "Anh Long", "CTY FLG", "Tiệm Cafe Mộc", "Tiệm Cafe Hoa Bên Hồ", "Shop Bella"],
    cities: ["Đồng Nai", "TP.HCM", "Bình Dương", "Vũng Tàu", "Long An", "Vĩnh Long", "Lâm Đồng", "Cần Thơ"],
    products: [
        { name: "Máy POS V302", img: "https://marketplace.canva.com/hXHoU/MAFEx5hXHoU/1/tl/canva-salary-sell-money-business-buy-hand-icon-MAFEx5hXHoU.png" },
        { name: "Combo Máy Bán Hàng & Phần mềm Tendoo", img: "https://marketplace.canva.com/hXHoU/MAFEx5hXHoU/1/tl/canva-salary-sell-money-business-buy-hand-icon-MAFEx5hXHoU.png" },
        { name: "Gói 1.000 tờ hóa đơn", img: "https://marketplace.canva.com/hXHoU/MAFEx5hXHoU/1/tl/canva-salary-sell-money-business-buy-hand-icon-MAFEx5hXHoU.png" },
        { name: "Phần mềm kế toán Easybook", img: "https://marketplace.canva.com/hXHoU/MAFEx5hXHoU/1/tl/canva-salary-sell-money-business-buy-hand-icon-MAFEx5hXHoU.png" },
        { name: "Combo Tendoo + 10.000 hoá đơn", img: "https://marketplace.canva.com/hXHoU/MAFEx5hXHoU/1/tl/canva-salary-sell-money-business-buy-hand-icon-MAFEx5hXHoU.png" },
        { name: "Gói 5.000 hoá đơn đầu vào", img: "https://marketplace.canva.com/hXHoU/MAFEx5hXHoU/1/tl/canva-salary-sell-money-business-buy-hand-icon-MAFEx5hXHoU.png" },
        { name: "Gói 5.000 vContract", img: "https://marketplace.canva.com/hXHoU/MAFEx5hXHoU/1/tl/canva-salary-sell-money-business-buy-hand-icon-MAFEx5hXHoU.png" },
    ]
};

function showRandomNotif() {
    const name = fakeData.names[Math.floor(Math.random() * fakeData.names.length)];
    const city = fakeData.cities[Math.floor(Math.random() * fakeData.cities.length)];
    const product = fakeData.products[Math.floor(Math.random() * fakeData.products.length)];
    document.getElementById('notif_title').innerText = `${name} (${city})`;
    document.getElementById('notif_desc').innerText = `Vừa đặt mua ${product.name}`;
    document.getElementById('notif_thumb').src = product.img;
    const notif = document.getElementById('order_notif');
    notif.classList.add('show');
    setTimeout(() => {
        hideNotif();
    }, 6000);
}

function hideNotif() {
    document.getElementById('order_notif').classList.remove('show');
}

setTimeout(() => {
    showRandomNotif();
    setInterval(showRandomNotif, 20000);
}, 5000);

// Tự động cuộn lên đầu khi nhấn vào bất kỳ tab nào
document.addEventListener('click', function (e) {
    if (e.target.classList.contains('tab-item') || e.target.closest('.tabs')) {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }
}, true);

// Đóng khi bấm ra ngoài vùng trắng
window.onclick = function(event) {
    const modal = document.getElementById('productModal');
    if (event.target == modal) {
        closeModal();
    }
}
   

//tinhgia
function switchpTab(tabId, btn) {
    document.querySelectorAll('.p-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    const parent = btn.parentElement;
    parent.querySelectorAll('.sub-tab-btn').forEach(b => {
        b.classList.remove('active');
    });
    document.getElementById(tabId).style.display = 'block';
    btn.classList.add('active');
}
//tính hoá đơn
function toggleCustomTax() {
    const select = document.getElementById('taxRate');
    const customInput = document.getElementById('customTax');
    customInput.style.display = (select.value === 'custom') ? 'block' : 'none';
    calculate();
}

function calculate() {
    const inputA = document.getElementById('valA');
    const inputB = document.getElementById('valB');
    inputA.value = inputA.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    inputB.value = inputB.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const A = parseFloat(inputA.value.replace(/\./g, "")) || 0;
    const B = parseFloat(inputB.value.replace(/\./g, "")) || 0;
    let rate = 0;
    const select = document.getElementById('taxRate');
    if (select.value === 'custom') {
        rate = (parseFloat(document.getElementById('customTax').value) || 0) / 100;
    } else {
        rate = parseFloat(select.value);
    }
    const D = 1 - rate;
    const E = (B - A) * rate;
    const F = A + E;
    const G = B;
    const H = B - A - E;
    document.getElementById('resE').innerText = E.toLocaleString('vi-VN') + " đ";
    document.getElementById('resF').innerText = F.toLocaleString('vi-VN') + " đ";
    document.getElementById('resG').innerText = G.toLocaleString('vi-VN') + " đ";
    document.getElementById('resH').innerText = H.toLocaleString('vi-VN') + " đ";
}

function toggleDropdown() {
    document.getElementById("moreMenu").classList.toggle("show");
}
