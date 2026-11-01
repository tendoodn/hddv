# AutoTax V3.2 — tiến độ dữ liệu dùng chung

**Code: đã đồng bộ source GitHub. Database production: CHƯA chuyển đổi.**

Các thư mục đều thuộc https://github.com/tendoodn/hddv:

- `docs/index.html` + `docs/customer.js`: web khách hàng (gói, lượt, hạn MST, dùng thử, unlock, thanh toán, tự gỡ MST).
- `docs/admin.html` + `docs/admin-mst.js`: web admin (tài khoản V3.2, giá gói, hạn MST, mã unlock, MST liên kết, nhật ký).
- `autotax/src/sidepanel/index.html` + `autotax/src/license/license.js`: Chrome Extension (cùng tính năng theo vai trò khách hàng).
- `autotax/src/content/content.js`: gọi kiểm tra MST, RPC trừ hóa đơn nguyên tử. Bản XML/PDF/Excel giữ trên máy.
- `addon-portal/supabase/migrations/001`–`018`: logic backend, trừ lượt, gói, dùng thử và bảng admin.

**Single source of truth:** Supabase project `ucqqjdsoyvvaxswzbhaw`. Không ghi bản sao dữ liệu khách hàng lên GitHub. Mỗi UI lấy dữ liệu mới nhất qua RPC, sau khi đổi gói hoặc ấn Làm mới.

## Đã thêm vào code

- Email trùng: thông báo khi Supabase cho phép nhận biết email đã tồn tại, ở web và extension.
- Một email và một MST chỉ dùng thử một lần; khách mua gói không bị chặn vì MST dùng thử khác.
- Mỗi gói MST có hạn riêng; admin xem/gỡ MST; người dùng chỉ tự gỡ khi gói MST còn hiệu lực.
- Hóa đơn đã trừ được đọc lại với số dư 0; cùng hóa đơn xuất Excel/ZIP không trừ thêm.
- Giá gói và hạn MST, mã unlock hiển thị/quản lý qua API chung.
- Web khách hàng không còn phụ thuộc gói thuê bao tháng/năm cũ; admin chuyển sang RPC khách hàng V3.2.
- `docs/sql/*.sql` được gắn cảnh báo legacy để tránh triển khai nhầm.

## Chưa hoàn tất trước khi yêu cầu SQL production

1. Kiểm tra phụ thuộc DB ngoài các bảng `addon_*`; tránh `DROP ... CASCADE` tác động ngoài phạm vi.
2. Xây dựng và kiểm thử kịch bản reset an toàn **bảo toàn cả 3 tài khoản auth và quyền 1 admin**.
3. Kiểm thử thực tế Supabase/RPC/SePay/Chrome cho trả phí, dùng thử, trừ lượt và quá hạn.
4. Chỉ sau các bước này mới gửi **bản SQL production nguyên văn trong chat** để người sở hữu dự án tự chạy.

**KHÔNG CHẠY** `REBUILD_V32_DRAFT_DO_NOT_RUN.sql`. Các file frontend có thể đã được publish bởi GitHub Pages, nhưng các RPC V3.2 chưa có trên production sẽ chưa hoạt động; cần chạy SQL production trước khi hệ thống mới dùng được hoàn toàn.
