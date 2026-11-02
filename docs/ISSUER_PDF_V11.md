# AutoTax V1.1.1 — Lấy PDF gốc có xác thực

- Nếu nguồn cung cấp link tải PDF trực tiếp, AutoTax thử lấy tệp và kiểm tra chữ ký đầu `%PDF-`, kích thước và HTTPS. Kiểm tra định dạng PDF **không** xác minh chữ ký số hợp lệ hoặc nguồn phát hành của từng hóa đơn.
- Nếu nguồn có link tra cứu cùng mã bảo mật nhưng chưa có link tải trực tiếp, AutoTax **không** dựng PDF thay thế. Add-on ghi hàng đợi riêng theo MST đang đăng nhập, để người dùng mở đúng cổng của nhà phát hành.
- Trên trang nhà phát hành, người dùng điền mã tra cứu, thực hiện CAPTCHA/đăng nhập khi cần. Tiện ích chỉ hiện hỗ trợ đối với tab đã mở từ danh sách AutoTax, cho phép sao chép mã và chọn liên kết PDF thật xuất hiện trên trang để tải bằng phiên truy cập đã xác thực.
- Nếu cổng dùng nút JavaScript không tạo href trực tiếp, hoặc KiotViet trả ZIP chứa PDF+XML, người dùng sử dụng nút tải của chính cổng và có thể gắn PDF đã tải vào hóa đơn trên Web. Quy trình này **chưa** phải tích hợp tự động hoàn toàn.
- Nếu không có link tra cứu hoặc không có mã bảo mật, phần mềm có thể dựng bản PDF từ dữ liệu thuế và phân loại `KHONG_PHAI_GOC`.
- Các cổng yêu cầu CAPTCHA/phiên được tôn trọng. Không thử đoán, vượt CAPTCHA, đánh cắp cookie hay gọi API không được công bố.
- Mã tra cứu trong hàng đợi chỉ nằm ở Chrome session trên thiết bị và tự hết hiệu lực sau tối đa hai giờ; không đẩy lên Supabase hay qua trang không thuộc nhà phát hành.
- Web chạy ở GitHub Pages không có quyền tự bỏ qua CORS của các nhà phát hành; để lấy PDF trong phiên hợp lệ phải qua Add-on hoặc thao tác tại cổng chính thức.
- Catalog 21 nhà phát hành chỉ mô tả các trang tra cứu, không chứng thực khả năng tải thử cho mọi mã hóa đơn. KiotViet và VNPT có cơ chế tải/URL riêng.
