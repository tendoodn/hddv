# AutoTax V1.1.2 — phát hành PDF và đường chuyển nguồn riêng tư

## PDF

**Add-on:** chọn `PDF (gốc → dựng lại)`. Add-on luôn thử tệp PDF thực từ nhà phát hành nếu có URL tải trực tiếp hợp lệ. Nếu không thấy, bị chặn bởi CORS/CAPTCHA, cần đăng nhập, hoặc nguồn thất bại, hệ thống tự dựng PDF từ dữ liệu hóa đơn Thuế, xuất vào thư mục `PDF_Dung_Lai_Tu_CQT_Khong_Phai_Goc/` và kèm `_NGUON.txt` nêu rõ lý do/link/mã tra cứu. Hồ sơ có link và mã vẫn vào hàng đợi tải PDF gốc bằng phiên xác thực tại trang nhà phát hành.

**Web:** hai nút độc lập `Tải PDF Thuế` (luôn tạo PDF dựng; không thử PDF nhà phát hành) và `Tải PDF gốc (có dự phòng)` (ưu tiên tệp gốc, nếu không được thì dựng thay và ghi rõ KHÔNG PHẢI GỐC). Khi có nhiều tệp, ZIP luôn chứa `NGUON_PDF_MA_TRA_CUU.txt` và từng PDF được phân loại trong thư mục riêng. PDF do người dùng gắn từ trang phát hành chỉ được ghi là chưa xác minh chữ ký số.

Đừng nhầm `%PDF-` với xác minh chữ ký số. Kiểm tra định dạng tệp không đủ để chứng minh đó là hóa đơn gốc hợp lệ. AutoTax không tự giải CAPTCHA của các nhà phát hành khi không có API hợp lệ.

## Mã nguồn và phát hành

- Mã nguồn của phiên bản hiện tại còn tại `tendoodn/hddv` (công khai) vì website hiện đang triển khai từ đó.
- Kho dự kiến phát triển kín: `tendoodn/tax`. **Chưa chuyển mã nguồn sang tax khi repo này còn PUBLIC**.
- Khi chủ repo chuyển `tax` thành PRIVATE: chạy workflow `Import AutoTax source only after tax is PRIVATE` trong Actions của `tax` để nhập mã nguồn, rồi phát triển tại `tax`.
- Trang GitHub Pages luôn phải tải HTML/JS/CSS xuống trình duyệt và vì vậy các phần frontend đã phát hành không thể bí mật tuyệt đối. Cốt lõi độc quyền nên chạy qua Supabase/Edge Functions có quyền truy cập, không nằm ở file JavaScript client.
- Bộ cài ZIP/CRX phát hành chỉ lưu trên Google Drive AutoTax; repository không lưu binary. `AUTOTAX_CRX_PRIVATE_KEY_B64` là secret riêng để phát hành CRX với ID ổn định.
- Giữ nguyên `AutoTax_v3.3.6_Chrome.zip` và chỉ bộ cài mới nhất trên Drive; thay bộ cài sau khi kiểm tra file mới không lỗi.

## Kiểm thử hồi quy

- `node scripts/verify-web-vault-pdf-audit.mjs`
- `node scripts/verify-original-pdf-v34.mjs`
- `node scripts/verify-v32-sync.mjs`
- GitHub Actions `AutoTax V1.1 validation`

