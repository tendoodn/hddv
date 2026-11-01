# AutoTax V3.2 — tiến độ dữ liệu dùng chung

**Code: đã đồng bộ source GitHub. Database production: người sở hữu xác nhận đã chuyển đổi thành công ngày 01/11/2026 (3 tài khoản, 1 admin, 10 sản phẩm, 0 MST lots). Edge Functions/SePay/Chrome production: chưa xác minh hoặc triển khai thông qua công cụ.**

Các thư mục đều thuộc https://github.com/tendoodn/hddv:

- `docs/index.html` + `docs/customer.js`: web khách hàng (gói, lượt, hạn MST, dùng thử, unlock, thanh toán, tự gỡ MST).
- `docs/admin.html` + `docs/admin-mst.js`: web admin (tài khoản V3.2, giá gói, hạn MST, mã unlock, MST liên kết, nhật ký).
- `autotax/src/sidepanel/index.html` + `autotax/src/license/license.js`: Chrome Extension (cùng tính năng theo vai trò khách hàng).
- `autotax/src/content/content.js`: gọi kiểm tra MST, RPC trừ hóa đơn nguyên tử. Bản XML/PDF/Excel giữ trên máy.
- `addon-portal/supabase/migrations/001`–`019`: logic backend, trừ lượt, gói, dùng thử và bảng admin.

**Single source of truth:** Supabase project `ucqqjdsoyvvaxswzbhaw`. Không ghi bản sao dữ liệu khách hàng lên GitHub. Mỗi UI lấy dữ liệu mới nhất qua RPC, sau khi đổi gói hoặc ấn Làm mới.

## Đã thêm vào code

- Email trùng: thông báo khi Supabase cho phép nhận biết email đã tồn tại, ở web và extension.
- Một email và một MST chỉ dùng thử một lần; khách mua gói không bị chặn vì MST dùng thử khác.
- Mỗi gói MST có hạn riêng; admin xem/gỡ MST; người dùng chỉ tự gỡ khi gói MST còn hiệu lực.
- Hóa đơn đã trừ được đọc lại với số dư 0; cùng hóa đơn xuất Excel/ZIP không trừ thêm.
- Giá gói và hạn MST, mã unlock hiển thị/quản lý qua API chung.
- Web khách hàng không còn phụ thuộc gói thuê bao tháng/năm cũ; admin chuyển sang RPC khách hàng V3.2.
- `docs/sql/*.sql` được gắn cảnh báo legacy để tránh triển khai nhầm.

## Các việc tiếp theo sau SQL production

1. **Không chạy lại** SQL one-time. Sao lưu gốc còn trong `autotax_backup_20261101`.
2. Chạy `RELEASE_READINESS_V32_READ_ONLY.sql` để xác minh tình trạng gói, backup và số tài khoản.
3. Admin xác định thời hạn cho 5 gói MST và giá bán trước khi mở checkout.
4. Triển khai hai Edge Functions và cấu hình Secrets/HMAC SePay; SQL không tự làm việc này.
5. Kiểm tra mua gói, mã unlock, trừ lượt, đọc lại, log và Chrome extension thật.

Hướng dẫn browser-only: [AFTER_UPGRADE_V32_BROWSER_DEPLOY.md](./AFTER_UPGRADE_V32_BROWSER_DEPLOY.md).

**Không chạy** `REBUILD_V32_DRAFT_DO_NOT_RUN.sql` hoặc `PRODUCTION_UPGRADE_V32_ONE_TIME.sql` lần nữa.
