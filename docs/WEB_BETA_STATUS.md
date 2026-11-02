# AutoTax Web — beta kết nối cổng Thuế (02/11/2026)

Trang: `https://tendoodn.github.io/hddv/web.html`

## Kiến trúc

- UI tĩnh: `docs/web.html`, `docs/web/web.css`, `docs/web/web.js`.
- Sử dụng cùng tài khoản Supabase, danh sách MST, chế độ gói và kiểm tra quyền như AutoTax Extension.
- Server gateway: `addon-portal/supabase/functions/autotax-web-gateway/index.ts` (đã triển khai trên Supabase).
- Gateway chỉ chấp nhận origin `https://tendoodn.github.io`, yêu cầu phiên Supabase đăng nhập và sử dụng URL cố định của cổng Thuế.
- Mật khẩu cổng Thuế chỉ gửi qua HTTPS khi đăng nhập; không lưu vào cơ sở dữ liệu hoặc localStorage. Token cổng Thuế chỉ tồn tại trong bộ nhớ tab.
- Kết quả tra cứu theo gói T dùng cùng RPC `addon_claim_invoice_quota` của extension; tra lại hóa đơn đã trừ không trừ thêm.
- Tệp Excel dùng cùng `xlsx.js` và `report.js`; XML lấy từ dữ liệu zip gốc; danh sách liên kết PDF gốc xuất CSV để người dùng tự mở tại bên phát hành.
- `docs/web/hddt-api.js` là adapter từ mã nguồn extension với đúng hai thay đổi: đọc token từ bộ nhớ web và chuyển fetch qua gateway. Toàn bộ các thư viện còn lại được copy nguyên vẹn.
- CI `scripts/verify-web-bridge.mjs` kiểm tra hai đầu mã nguồn không lệch. Khi sửa engine extension cần đồng bộ các file tương ứng trước khi merge.

## Trạng thái và giới hạn

- Đã kiểm tra tĩnh, JavaScript syntax, CI và xuất bản GitHub Pages.
- Chưa xác nhận đăng nhập/truy vấn thật với tài khoản cổng Thuế: cần nghiệm thu theo quy trình của chủ tài khoản, không chia sẻ mật khẩu cho lập trình viên.
- Gateway có thể bị cổng Thuế từ chối IP máy chủ hoặc thay đổi CAPTCHA/API; không nên quảng cáo là đã hoạt động trơn tru khi chưa qua thử nghiệm.
- Hóa đơn máy tính tiền cần CAPTCHA từng đợt; phụ thuộc phản hồi cổng Thuế.
- `PDF gốc` không thể bảo đảm tải tự động từ mọi nhà cung cấp. Website chỉ xuất liên kết tra cứu, tuyệt đối không giả mạo bản PDF gốc.
- Mặc định trang web yêu cầu người dùng đã đăng nhập AutoTax, MST đã đăng ký và có gói còn hiệu lực.
- Đường dẫn tải JavaScript qua CDN cũng phải hoạt động để có Supabase Auth.
- Mã nguồn GitHub Pages phải được đồng bộ `main/docs` → `feature/addon-license-portal/docs`. Hai nhánh đã được đồng bộ ở lần cập nhật này.

## Quy trình nghiệm thu

1. Mở `/hddv/`, đăng nhập tài khoản AutoTax và bảo đảm MST được phép.
2. Mở `/hddv/web.html`, kiểm tra phiên tài khoản và danh sách MST.
3. Nhập MST, mật khẩu cổng Thuế, CAPTCHA (chỉ nhập trên website thật do chủ tài khoản kiểm soát); chọn ngày và loại hóa đơn.
4. Tra cứu kiểm tra dữ liệu mua vào/bán ra, điện tử/máy tính tiền; xác nhận tên, số và trạng thái từng hóa đơn.
5. Kiểm tra lượt trừ trên Supabase trước/sau và việc tra lại hóa đơn không bị trừ lần hai.
6. Kiểm tra tệp Excel/XML, sổ bảng kê, tờ khai tham khảo và liên kết nguồn PDF.
7. Kiểm tra lỗi đăng nhập, hết phiên, CAPTCHA sai, HTTP 429, 503, mất mạng và màn hình di động.
