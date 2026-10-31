# HoaDon Nội Bộ – V3.1.0

Bản phát triển nội bộ kế thừa mã nguồn HoaDon Extension V3.0.0.

## Nguyên tắc hoạt động
- Không gọi máy chủ Vercel hoặc API cấp phép/thử nghiệm/thống kê của tác giả cũ.
- Không gửi mã máy, lựa chọn tra cứu, MST, thông tin doanh nghiệp hay dữ liệu hóa đơn tới máy chủ bên thứ ba.
- Xử lý báo cáo và tạo file trên máy tính; file tải về lưu trong Downloads.
- Chỉ kết nối `https://hoadondientu.gdt.gov.vn/` để người dùng đăng nhập và tra cứu bằng phiên đăng nhập chính thức.
- Không chứa backend hoặc thông tin bí mật của tác giả cũ; không tìm cách truy cập các hệ thống đó.

## Quy tắc tra cứu hiện có
- Hóa đơn điện tử thông thường: chia theo tháng dương lịch, không giới hạn tổng khoảng ngày.
- Hóa đơn máy tính tiền (MTT): chia các đợt liên tiếp, tối đa 10 ngày/đợt.
- Nếu chọn cả hai hình thức: từng hình thức được xử lý độc lập.
- Giữ CAPTCHA, tải chi tiết và các module xuất Excel/XML/HTML/PDF/ZIP của mã nguồn nền.

## Cài đặt
1. Giải nén ZIP.
2. Mở Chrome tại `chrome://extensions`.
3. Bật **Chế độ dành cho nhà phát triển**.
4. Chọn **Tải tiện ích đã giải nén** và chọn thư mục có `manifest.json`.
5. Mở `https://hoadondientu.gdt.gov.vn/`, tự đăng nhập, sau đó mở side panel.

## Giới hạn và lưu ý
- Bản 3.1.0 đã loại bỏ các kết nối máy chủ cũ và luồng bản quyền/dùng thử/thống kê từ mã nguồn nền.
- Bản này chưa bổ sung cơ chế phục hồi tiến trình sau khi Chrome hoặc tab Cổng Thuế bị đóng; hiện tại tác vụ có thể bị gián đoạn nếu trang tải lại.
- Không lưu mật khẩu. Phiên đăng nhập vẫn do Cổng Thuế quản lý.
- Nếu Cổng Thuế thay đổi API, cấu trúc phản hồi hoặc CAPTCHA, module `src/content/hddt-api.js` và các module CAPTCHA có thể cần cập nhật.
- Chưa xác nhận hoạt động trên tài khoản thật; cần chạy thử nội bộ trước khi dùng cho dữ liệu kế toán quan trọng.
