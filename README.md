# AutoTax — Quản lý và tra cứu hóa đơn điện tử

![Logo AutoTax](docs/favicon.svg)

**AutoTax V1.2.2 · Public Web Runtime**

Phần mềm hỗ trợ quản lý tài khoản và hồ sơ MST, tra cứu hóa đơn mua vào/bán ra, xuất Excel/XML/HTML/PDF, kiểm tra rủi ro và đối chiếu sản phẩm.

## Tính năng

- Quản lý nhiều MST 10 số, chi nhánh 13 số và CCCD 12 số, phân quyền theo gói.
- Tra cứu hóa đơn điện tử và hóa đơn máy tính tiền theo khoảng ngày; tải chi tiết hàng hóa.
- Xuất Excel, XML và HTML; hỗ trợ báo cáo, kiểm tra rủi ro, so sánh hóa đơn điều chỉnh/thay thế.
- Hai chế độ PDF trên Web: **PDF Thuế** dựng từ dữ liệu Thuế; **PDF gốc ưu tiên** thử tải tệp nhà phát hành và dựng lại có nhãn riêng khi thất bại.
- Add-on Chrome ưu tiên PDF gốc và hỗ trợ bản dựng lại khi chưa lấy được bản gốc.
- Đồng bộ SKU, xuất dữ liệu nhập kho MISA/Tendoo và theo dõi lịch sử hóa đơn.
- Quản lý gói sử dụng, gia hạn, tài khoản và hồ sơ MST.
- Ghi nhận hóa đơn đã đọc dùng chung giữa chế độ MST và số tờ, tránh trừ lượt khi đọc lại.
- Admin cấp lại mật khẩu qua email hoặc mật khẩu tạm có yêu cầu đổi lại khi đăng nhập.

## Sử dụng

- [AutoTax – Tài khoản](https://tracuuhoadon.top/user/)
- [Tra cứu hóa đơn Web](https://tracuuhoadon.top/)
- [Tra cứu MST](https://tracuuhoadon.top/tracuumst/)
- [Trang tạo PDF đối chiếu](https://tracuuhoadon.top/pdf/)
- [Báo giá thiết bị & HDĐT Viettel](https://tracuuhoadon.top/baogia/)
- [Theo dõi hệ số K](https://tracuuhoadon.top/k/)
- [Bộ cài Chrome](https://drive.google.com/drive/folders/1q8l5pDqb0UzxFF2ma7Nm6KQyGX9UB0WF)

**Lưu ý:** PDF dựng lại không phải PDF gốc; một số cổng nhà phát hành cần phiên đăng nhập hoặc CAPTCHA hợp lệ.

## Đồng bộ mật khẩu MST và liên hệ (1.2.2)

- Mật khẩu MST tự mã hóa AES-GCM trên máy và đồng bộ ciphertext lên Supabase theo tài khoản AutoTax. Đăng nhập cùng email/mật khẩu AutoTax trên Web và Add-on để tự mở khóa, không cần bấm nút chuyển mật khẩu.
- Admin chỉnh sửa danh sách liên kết chân trang tại trang quản trị: 1 ô nội dung hiển thị, 1 ô đường link, bật/tắt và sắp xếp.
- Liên hệ: Zalo/điện thoại **0868838242**; email **lienhe@tracuuhoadon.top** / **ptflorist68@gmail.com**.
- Copyright © 2026 AutoTax - Phương Thảo Florist. All rights reserved.


## Cấu trúc phát hành

Repository này chỉ giữ các tài nguyên Web tĩnh cần thiết cho GitHub Pages. Mã nguồn build Android, bộ triển khai Auth và backend/server-side được bảo trì trong repository riêng tư `tendoodn/tax` và không còn lưu ở cây public này.
