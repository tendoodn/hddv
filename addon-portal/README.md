# AutoTax V3.2 — Quy tắc đồng bộ dữ liệu

Repository: https://github.com/tendoodn/hddv

## Một nguồn dữ liệu duy nhất

Tất cả tài khoản, quyền admin, gói, số dư hóa đơn, MST đã liên kết, dấu vết dùng thử và đơn hàng đều lưu ở **Supabase project ucqqjdsoyvvaxswzbhaw**. GitHub lưu mã nguồn, không chứa bản sao dữ liệu hay mật khẩu khách hàng.

- docs/index.html và docs/customer.js: cổng khách hàng GitHub Pages.
- docs/admin.html và docs/admin-mst.js: cổng quản trị.
- autotax/src/sidepanel/index.html và autotax/src/license/license.js: tiện ích Chrome dùng cùng tài khoản và bộ RPC.
- autotax/src/content/content.js: tra cứu/tải hóa đơn và kiểm tra quyền qua Supabase.
- supabase/functions: tạo đơn và xử lý thanh toán có xác thực.
- supabase/migrations: quy tắc cấp phép chạy phía máy chủ.

## API đồng bộ quan trọng

| Dữ liệu | RPC |
|---|---|
| Gói, quyền, dùng thử | addon_my_entitlements |
| Danh sách giá, thời hạn | addon_list_packages |
| Dùng thử một MST | addon_start_mst_trial |
| Chế độ MST / số tờ | addon_set_usage_mode |
| Liên kết/xóa MST | addon_authorize_mst; addon_list_my_mst_assignments; addon_unlink_mst |
| Đếm lượt hóa đơn chống trùng | addon_claim_invoice_quota |
| Mã unlock theo gói | addon_redeem_package_unlock |
| Admin khách hàng và MST | addon_admin_list_users_v32; addon_admin_list_mst_assignments |
| Admin giá/gói/nhật ký | addon_admin_list_packages; addon_admin_set_package_price; addon_admin_set_package_terms; addon_admin_list_logs |

Không đồng bộ trạng thái bằng localStorage hoặc bằng bản sao JSON trong GitHub. Giao diện luôn đọc số dư và hạn hiệu lực từ RPC; lịch sử tải hóa đơn lưu cục bộ trong Chrome Storage.

## Trạng thái triển khai và bảo mật

- **Chưa triển khai SQL V3.2 trên Supabase production.** REBUILD_V32_DRAFT_DO_NOT_RUN.sql là bản nháp không được chạy.
- Dữ liệu đăng nhập auth.users và quyền addon_admins phải được bảo toàn.
- Các file docs/sql/*.sql là mã legacy của gói tháng/năm. **Không chạy cho V3.2.**
- Migration 001–004 còn phụ thuộc lược đồ cũ. Migration 005–017 là các cập nhật V3.2. Chưa có một lệnh reset an toàn đã được kiểm thử.
- Không được lưu Supabase service-role key, secret SePay hay mật khẩu trong GitHub.
- Việc cập nhật mã nguồn GitHub Pages không tự cập nhật extension đã cài; người dùng phải cài/cập nhật phiên bản extension mới.

## Kiểm thử trước phát hành

Đăng ký trùng email; một MST thử trên nhiều email; email thử nhiều lần; khách đã mua gói không bị chặn MST cũ; người dùng/admin gỡ MST; gói MST hết hạn từng đợt; T100+T200; hóa đơn đọc lại miễn phí khi số dư 0; Excel và ZIP chung một lượt; thanh toán không cộng trùng; mọi giao diện sau khi refresh phải khớp số dư.
