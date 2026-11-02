# AutoTax V1.1.2 — Quy tắc xuất PDF

## Add-on Chrome

- Người dùng chọn **PDF (gốc → dựng lại)**. AutoTax thử tải tệp PDF thực từ đường dẫn nhà phát hành nếu URL phù hợp và server trả dữ liệu PDF hợp lệ.
- Nếu tệp gốc không có, nhà phát hành yêu cầu CAPTCHA, phiên đăng nhập không có sẵn, URL chỉ là trang tra cứu hoặc kết nối lỗi, AutoTax sẽ **dựng PDF từ dữ liệu cổng Thuế** và đặt trong thư mục `PDF_Dung_Lai_Tu_CQT_Khong_Phai_Goc/`.
- Với mỗi PDF dựng, bản tải kèm `_NGUON.txt` chứa link/mã tra cứu và lý do phải dùng bản dự phòng. **Bản dựng không được gọi là hóa đơn PDF gốc**.
- Nếu có link + mã, AutoTax vẫn ghi vào hàng đợi lấy PDF thật riêng theo MST. Người dùng chủ động mở trang nhà phát hành, nhập mã/CAPTCHA/đăng nhập hợp lệ rồi dùng chức năng hỗ trợ tìm và tải tệp PDF thật.
- Tệp PDF thật được nhận bằng nguồn và phiên truy cập phù hợp nhưng việc kiểm tra `%PDF-` **không** xác minh chữ ký số của nhà phát hành.

## AutoTax Web — hai nút độc lập

1. **Tải PDF Thuế:** luôn dựng **tất cả** PDF từ XML/JSON hóa đơn do cổng Thuế cung cấp, bất kể nhà phát hành có tệp PDF gốc hay không. Tệp nằm trong `PDF_THUE_DUNG_TU_DU_LIEU_CQT_KHONG_PHAI_GOC/`.
2. **Tải PDF gốc (có dự phòng):** ưu tiên tệp thực từ URL nhà phát hành; sau đó chấp nhận tệp người dùng tải và gắn thủ công (nhãn **chưa xác minh**); nếu không lấy được bất kỳ tệp phù hợp thì dựng PDF dự phòng và ghi nhãn **không phải gốc**. Báo cáo nguồn trong ZIP nêu lý do, link và mã bảo mật.

Tại Web trên GitHub Pages, CORS và phiên riêng của nhà phát hành có thể chặn thao tác `fetch`. Cấp quyền website không có nghĩa có thể bỏ CAPTCHA hoặc truy cập API kín. Để lấy PDF từ cổng yêu cầu xác thực, dùng Add-on hoặc tải thủ công trên chính trang nhà phát hành.

Danh mục 21 nhà phát hành chỉ định hướng mở các trang tra cứu; không phải cam kết tải PDF gốc được 100% từ mọi cổng, đặc biệt với KiotViet (có thể tải ZIP gồm PDF+XML) hoặc các đơn vị VNPT dùng cổng theo doanh nghiệp.

## Nguồn mã và phân phối

Mã nguồn tiếp tục được chuyển hướng sang `tendoodn/tax` **sau khi repository đó được chủ tài khoản chuyển thành Private**. Chỉ phần tài sản Web cần công khai mới được xuất bản qua GitHub Pages; mã server cần giữ kín nằm ở private repo và Supabase. Không lưu khóa ký CRX, service-role key hoặc mật khẩu khách hàng trong bất kỳ gói công khai nào.
