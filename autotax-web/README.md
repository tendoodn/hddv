# AutoTax Web – Giai đoạn 1

Thư mục nền tảng web độc lập, phát triển trên nhánh `autotax-web-v1`, không sửa nhánh `main`.

## Cấu hình đã chốt
- Triển khai dưới đường dẫn Tendoo hiện có (subpath).
- Lưu trữ cục bộ trên trình duyệt; chưa gửi dữ liệu hóa đơn lên máy chủ.
- Có định hướng tương thích dữ liệu với AutoTax Chrome.

## Chạy thử
Mở `index.html` bằng trình duyệt hoặc phục vụ thư mục này qua static web server. Không cần build step.

## Chức năng giai đoạn 1
- Tạo và chuyển đổi hồ sơ MST.
- Nhập nhiều tệp XML hóa đơn.
- Phân loại sơ bộ mua vào/bán ra.
- Chống nhập trùng theo định danh hóa đơn.
- Tìm kiếm, lọc và xuất CSV.
- Sao lưu/khôi phục dữ liệu JSON.
- Lưu dữ liệu bằng localStorage trên thiết bị hiện tại.

## Giới hạn hiện tại
- Chưa có kết nối trực tiếp tới cổng hóa đơn điện tử.
- Chưa đọc tệp ZIP, PDF hoặc bảng kê Excel.
- XML có nhiều biến thể cấu trúc; bộ phân tích hiện tại là nền tảng ban đầu, cần kiểm thử bằng các mẫu XML thực tế trước khi dùng cho nghiệp vụ.
- Dữ liệu localStorage chỉ nằm trên trình duyệt và thiết bị đang sử dụng. Xóa dữ liệu trình duyệt có thể làm mất dữ liệu nếu chưa sao lưu.
- Chưa có đồng bộ dữ liệu tự động với extension. Cần xây dựng bộ chuyển đổi schema và xác định định dạng xuất/nhập ổn định ở giai đoạn tiếp theo.

## Tương thích AutoTax Chrome
Schema chuẩn hóa ban đầu giữ các trường nghiệp vụ phổ biến: `sellerTax`, `buyerTax`, `invoiceNo`, `series`, `date`, `total`, `kind`, `identity`, `rawXml`. Trước khi chốt adapter hai chiều, cần kiểm tra mẫu Excel/JSON thực tế mà extension đang tạo; không nên suy đoán schema từ giao diện.

## Triển khai GitHub Pages
Thư mục được thiết kế để phục vụ từ subpath: mọi tài nguyên dùng đường dẫn tương đối (`./styles.css`, `./app.js`). URL thực tế phụ thuộc repository đang được cấu hình làm nguồn GitHub Pages và cấu hình custom domain của Tendoo.