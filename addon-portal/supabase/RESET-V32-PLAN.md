# AutoTax V3.2 — kế hoạch thay mới hệ thống cấp phép (CHƯA TRIỂN KHAI)

## Phạm vi đã được chủ dự án chấp thuận

- Giữ **auth.users** và khả năng đăng nhập của toàn bộ khách hàng.
- Giữ quyền quản trị hiện tại từ **public.addon_admins** (lưu danh sách user_id trước khi tái tạo).
- Xóa toàn bộ gói, giao dịch, lịch sử cấp phép, mã quà và dữ liệu sử dụng **addon_*** cũ; chủ dự án sẽ cấp bù bằng mã gói mới.
- Không đụng đến bảng ngoài phạm vi addon_*, Supabase Auth, storage hay secrets.

## Tình trạng production đã xác nhận qua SQL Editor

Bảng tồn tại: addon_admins, addon_audit_logs, addon_device_sessions, addon_gift_codes, addon_gift_redemptions, addon_orders, addon_payment_events, addon_plans, addon_profiles, addon_subscriptions, addon_trial_claims.
Các hàm public addon_* thuộc thế hệ gói tháng/năm; chưa có bảng V3.2. Không có bằng chứng migration 005–011 đã chạy.

## Trước khi tạo một script triển khai có thể chạy

1. Chụp backup database; lưu **user_id** admin (không cần xuất email, mật khẩu, token).
2. Kiểm tra toàn bộ trigger trên auth.users và các view/policy/function phụ thuộc addon_*; tránh DROP ... CASCADE không kiểm soát.
3. Refactor bootstrap: migration 001–004 vẫn tạo gói tháng/năm, trong khi 005 phụ thuộc addon_orders.plan_code và addon_plans. Không thể xóa các bảng cũ rồi chỉ chạy 005–011.
4. Tạo script **một transaction**: xác nhận đúng project và điều kiện trước khi xóa; lưu quyền admin; tái tạo schema; restore quyền admin; kiểm thử ràng buộc, RLS, RPC; COMMIT chỉ sau khi thành công. Không tự động xóa auth.users.
5. Xử lý tên migration 004 trùng nếu chuyển sang Supabase CLI; SQL Editor không tự ghi vào supabase_migrations.schema_migrations.
6. Kiểm thử claim hóa đơn, quota=0 vẫn đọc lại hóa đơn đã trừ, mã unlock một lần, hết hạn MST, giá admin, webhook SePay và polling thanh toán trước khi bật production.

**CẢNH BÁO:** Chưa có script reset production đã được kiểm thử. Không chạy DROP/TRUNCATE trên Supabase chỉ dựa vào tài liệu này.
