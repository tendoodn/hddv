# AutoTax V3.2 — trạng thái triển khai

**Chưa chạy trên Supabase production.** File `REBUILD_V32_DRAFT_DO_NOT_RUN.sql` chỉ để rà soát; không sao chép vào SQL Editor.

## Các tính năng đã có trong mã nguồn

- Gói hóa đơn cộng dồn; khấu trừ lượt duy nhất theo khóa hóa đơn bằng RPC nguyên tử (011, 015).
- Cho phép đọc lại hóa đơn đã trừ khi còn 0 lượt (014, 015 và `autotax/src/content/content.js`).
- Gói MST theo từng đợt mua và ngày hết hạn, kiểm soát số MST được quản lý (005–009).
- Mã mở khóa một lần theo từng gói (010).
- Danh sách liên kết MST và gỡ liên kết bởi admin, gỡ bởi người dùng khi gói còn hạn (012).
- Giữ vĩnh viễn dấu vết email và MST đã dùng thử, cấp dùng thử MST1 trong 7 ngày bằng giao dịch nguyên tử (012–013).
- Giao diện admin tại `docs/admin.html` / `docs/admin-mst.js`.
- Giao diện dùng thử và tự gỡ MST tại `autotax/src/license/license.js`.

## Chốt an toàn trước khi ra SQL production

1. Kiểm tra phụ thuộc bên ngoài các bảng `addon_*`, trigger của `auth.users` và các Edge Functions.
2. Thay script reset nháp có `CASCADE` bằng script có kiểm tra phụ thuộc và sao lưu; bảo toàn `auth.users` cùng `addon_admins`.
3. Rà soát toàn bộ luồng giao diện cổng khách hàng đang còn phần gói tháng/năm cũ.
4. Test thử/chuyển gói/trừ lượt đồng thời/đọc lại và MST hết hạn trên môi trường test.
5. Sau khi đủ điều kiện mới gửi SQL production **đầy đủ trong chat** để chủ tài khoản tự chạy.

Production hiện được người dùng xác nhận có 3 auth users, 1 admin, 11 bảng `addon_*`.
