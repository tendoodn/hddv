# AutoTax Web – Giai đoạn 1

Thư mục nền tảng web độc lập, phát triển trên nhánh `autotax-web-v1`, không sửa nhánh `main`.

## Cấu hình đã chốt
- Triển khai dưới đường dẫn Tendoo hiện có (subpath).
- Lưu trữ cục bộ trên trình duyệt; chưa gửi dữ liệu hóa đơn lên máy chủ.
- Có định hướng tương thích dữ liệu với AutoTax Chrome.

## Chức năng hiện có
- Tạo và chuyển đổi hồ sơ MST.
- Nhập nhiều tệp XML.
- Nhận diện XML theo local-name, không phụ thuộc prefix/namespace.
- Đọc sơ bộ thông tin người bán, người mua, MST, ký hiệu, số hóa đơn, ngày lập và tổng thanh toán.
- Phân loại mua vào/bán ra khi MST hồ sơ trùng với MST người mua/người bán; để trạng thái chưa xác định nếu không đủ căn cứ.
- Chống nhập trùng theo MST hồ sơ + MST người bán + ký hiệu + số hóa đơn + ngày lập.
- Tìm kiếm, lọc, xuất CSV.
- Sao lưu/khôi phục dữ liệu JSON và gộp hóa đơn trùng.
- Lưu bằng localStorage trên trình duyệt hiện tại; thông báo nếu lưu thất bại.

## Kiểm thử cần làm trước khi sử dụng thực tế
Bộ phân tích hiện là parser nền tảng, chưa được xác nhận với các mẫu XML thực tế từ tài khoản của người dùng. Cần thử tối thiểu:
1. XML hóa đơn mua vào.
2. XML hóa đơn bán ra.
3. Hóa đơn điều chỉnh/thay thế.
4. Hóa đơn có ngoại tệ hoặc số tiền có phần thập phân.
5. XML nhiều namespace hoặc cấu trúc từ các nhà cung cấp khác nhau.

Không được dùng kết quả parser làm căn cứ kê khai/đối soát chính thức cho tới khi kiểm thử và đối chiếu với hóa đơn gốc.

## Giới hạn hiện tại
- Chưa có kết nối trực tiếp tới cổng hóa đơn điện tử.
- Chưa đọc ZIP, PDF hoặc bảng kê Excel.
- Một số XML có thể đặt thông tin MST, ngày, số hóa đơn hoặc tổng tiền ở cấu trúc khác; khi đó cần bổ sung mapping.
- localStorage có dung lượng giới hạn. Lưu XML gốc dài hạn có thể làm đầy bộ nhớ; cần chuyển kho hóa đơn sang IndexedDB trước khi mở rộng quy mô.
- Dữ liệu chỉ nằm trên trình duyệt và thiết bị đang sử dụng. Xóa dữ liệu trang web/trình duyệt có thể làm mất dữ liệu nếu chưa sao lưu.

## Tương thích AutoTax Chrome
AutoTax Chrome hiện dùng các trường dữ liệu nội bộ như `nbmst`, `nbten`, `nmmst`, `nmten`, `khmshdon`, `khhdon`, `shdon`, `tdlap`, `tgtcthue`, `tgtthue`, `tgtphi`, `tgtttbso`, `kind`, `form`, `tthai`, `ttxly`. AutoTax Web đã có schema riêng để lưu các thông tin phổ biến, nhưng chưa có bộ chuyển đổi hai chiều đã kiểm thử. Bước tương thích tiếp theo cần có mẫu tệp xuất thực tế từ extension hoặc một định dạng JSON xuất chính thức được bổ sung vào extension trong một thay đổi riêng.

## Triển khai GitHub Pages
Tài nguyên dùng đường dẫn tương đối (`./styles.css`, `./app.js`) để hỗ trợ subpath. URL thực tế phụ thuộc cấu hình GitHub Pages và custom domain của Tendoo.
