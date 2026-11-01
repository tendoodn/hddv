# Kích hoạt AutoTax V3.2 sau khi SQL production đã chạy thành công

**SQL production đã chạy. Không chạy lại** `PRODUCTION_UPGRADE_V32_ONE_TIME.sql`. Người sở hữu xác nhận kết quả: `auth_accounts = 3`, `addon_admins = 1`, `package_products = 10`, `active_mst_lots = 0`.

## Bổ sung ngày 01/11/2026: MST cố định 1 năm và lịch sử gói thu gọn

Sau khi SQL V3.2 chính thức đã chạy, mở **SQL Editor → New query** và chỉ chạy file:
`migrations/020_mst_one_year_collapsible_admin_history.sql`.

Đây là SQL cập nhật an toàn, **không chạy lại file reset**, không xóa tài khoản, đơn hàng hay bản sao cũ. File này đặt thời hạn **365 ngày** cho toàn bộ gói MST hiện có, khóa quy tắc 365 ngày ở database cho các gói MST thêm sau này và bổ sung RPC quản trị chỉ dành cho admin.

Trang admin có nút **Xem toàn bộ lịch sử gói**. Nội dung được ẩn khi mở trang; bấm nút mới truy vấn, hiển thị tất cả bản ghi V3.2 và lịch sử đơn hàng/thuê bao cũ từ `autotax_backup_20261101`. Bấm **Thu gọn lịch sử** để đóng lại. Người dùng thường không truy cập được dữ liệu lịch sử quản trị.

Nếu trang admin đã cập nhật mà chưa chạy SQL 020, nút lịch sử sẽ báo thiếu hàm RPC. Chỉ chạy SQL 020 **một lần**, tuyệt đối không chạy SQL nâng cấp production 80KB lần thứ hai.

## Bước 1 — kiểm tra backend (chỉ đọc)
Trong SQL Editor của đúng dự án Supabase `ucqqjdsoyvvaxswzbhaw`, chạy toàn bộ `RELEASE_READINESS_V32_READ_ONLY.sql`. Đây là SELECT, không có lệnh sửa dữ liệu. Trước khi chạy SQL 020, dòng `mst_packages_terms_configured` là `CHUA_DAT`; sau SQL 020, cả 5 gói MST phải có `validity_days = 365` và dòng đó phải thành `DAT`.

## Bước 2 — cấu hình thời hạn sản phẩm
Mở trang admin https://tendoodn.github.io/hddv/admin.html, đăng nhập bằng tài khoản đang nằm trong `addon_admins`. Trong **Giá và cấu hình gói AutoTax**, xem 5 gói MST1/MST5/MST10/MST20/MST50, tất cả hiển thị **1 năm (365 ngày)**. Giá bán vẫn có thể được admin điều chỉnh, nhưng thời hạn MST không còn chỉnh sửa. Dùng `addon_admin_set_package_terms` thông qua giao diện để ghi audit log. Các gói T100...T5000 không có hạn sử dụng ngày. Giá bán có thể thay đổi từ giao diện admin.

Kiểm tra cổng khách hàng: https://tendoodn.github.io/hddv/. Chế độ hóa đơn và MST cùng truy cập Supabase, không phải hai bộ dữ liệu riêng.

## Bước 3 — Edge Functions (không cần cài phần mềm)
Supabase Dashboard hỗ trợ tạo, chỉnh sửa và deploy Edge Functions qua trình duyệt. Xem https://supabase.com/docs/guides/functions/quickstart-dashboard .

Trong dự án `ucqqjdsoyvvaxswzbhaw` → **Edge Functions**, triển khai/cập nhật đúng hai hàm từ các file GitHub:

1. `addon-create-order`: mã tại `addon-portal/supabase/functions/addon-create-order/index.ts`. Yêu cầu user JWT (verify_jwt = true) và kiểm tra bằng Supabase RPC; tạo đơn thanh toán và QR. Cần thiết lập `MB_BANK_ACCOUNT` và `MB_ACCOUNT_NAME` ở **Edge Function Secrets**. Không đưa tên/người nhận tiền giả vào production.
2. `addon-sepay-webhook`: mã tại `addon-portal/supabase/functions/addon-sepay-webhook/index.ts`. Chọn **tắt verify JWT ở Supabase Gateway** (SePay không có Supabase user JWT). Hàm **bắt buộc** kiểm tra chữ ký HMAC-SHA256, timestamp trong 5 phút, tài khoản ngân hàng, số tiền và mã đơn theo source. Cần `SEPAY_WEBHOOK_SECRET` và `SEPAY_BANK_ACCOUNT` ở **Edge Function Secrets**.

**Quan trọng:** Chỉ cấu hình chức năng webhook sau khi đối chiếu phương thức xác thực của webhook SePay đang dùng. Chọn HMAC-SHA256 tại https://my.sepay.vn/ rồi đồng bộ secret (không gửi secret vào chat hay GitHub). Xem https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc và https://supabase.com/docs/guides/functions/function-configuration.

Nếu mã được sửa trong Supabase Dashboard, GitHub **không** tự đồng bộ cho đến khi có pipeline triển khai chính thức.

## Bước 4 — kiểm thử không thu tiền
1. Đăng nhập Admin, xác minh thấy 3 tài khoản và đủ 10 sản phẩm.
2. Đặt thời hạn các gói MST, xem lại giá.
3. Tạo mã unlock gói thử nghiệm **do admin tự cấp** (không tạo chuyển khoản thật) và kích hoạt trên tài khoản khách hàng dùng thử. Xác minh số dư/chế độ xuất hiện đúng. Chỉ làm với tài khoản đã cho phép dùng thử.
4. Kiểm tra một email/MST chỉ dùng thử một lần, gỡ MST không xóa lịch sử dùng thử.
5. Kiểm tra đọc lại cùng hóa đơn qua ZIP/PDF/Excel không trừ thêm lượt; hết lượt vẫn được đọc lại. Thử nghiệm định dạng hóa đơn thật ở số lượng nhỏ, không dùng tài khoản người khác.

## Bước 5 — thanh toán thực (chỉ sau khi webhook đã sẵn sàng)
Để tránh tiền thật không được ghi nhận, **không mở thông báo nhận thanh toán thực cho khách hàng cho tới khi đã test Edge Functions, chữ ký SePay và trạng thái đơn hàng**. Thử một khoản chuyển khoản kiểm soát bằng đơn chính thức, kiểm tra đơn chuyển paid, đúng gói đúng tài khoản, gọi lại event không cấp lượt gấp đôi. SePay Dashboard có log gửi webhook và retry.

## Bước 6 — Extension
Build AutoTax Chrome MV3 từ `autotax/` đã được GitHub Actions tạo dưới artifact `autotax-v32-extension-candidate` khi kiểm thử thành công. **Bản đang cài trên máy không tự thay đổi chỉ vì GitHub Pages cập nhật.** Cần cập nhật cài đặt nội bộ hoặc phát hành phiên bản mới trên Chrome Web Store tùy kênh phân phối.

## Sự cố
- Không chạy lại file SQL one-time production; đã chuyển đổi.
- Còn 0 gói MST hoạt động là bình thường sau reset. Nếu thiếu khách hàng, kiểm tra Auth và addon_profiles.
- Nếu trang admin không hiển thị gói: kiểm tra đăng nhập, quyền admin, console và lỗi RPC trong Supabase logs.
- Đối chiếu các bảng lưu `autotax_backup_20261101` khi cần phục hồi lịch sử; **không** đụng hoặc xoá schema sao lưu.
- Không đăng bất kỳ database secret, webhook secret, mật khẩu, file sao lưu lên GitHub/ChatGPT.

## Ghi nhận
- 2026-11-01: SQL hoàn thành; bảo toàn số lượng 3 Auth, 1 admin; tạo đủ 10 sản phẩm; 0 MST lot mới.
- Trạng thái Edge Functions trên Supabase production, cấu hình SePay secret, trạng thái thanh toán thực và extension cài đặt **chưa thể xác nhận** chỉ bằng GitHub Actions.
