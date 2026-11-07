AUTOTAX PDF - HTML OFFLINE
=========================
Bao gồm HTML và các thư viện PDF.js, pdf-lib, Tesseract.js,
WASM và dữ liệu OCR tiếng Việt/Anh. Khi chạy không cần Internet.

1. Giải nén toàn bộ ZIP.
2. Windows: chạy start-windows.bat (cần Python 3).
   Linux/macOS: chạy bash start-linux.sh (cần Python 3).
3. Mở http://127.0.0.1:8080 trong trình duyệt.

Double click index.html: ảnh và tạo PDF có thể chạy; việc tách PDF
và OCR có thể bị Chrome chặn do giới hạn bảo mật file://.
Hãy chạy localhost như hướng dẫn để dùng đủ tính năng.

A4 portrait 1240x1754px, landscape 1754x1240px; ảnh được
phóng/thu vừa trang, giữ nguyên tỷ lệ, bù phần thiếu bằng giấy trắng.

Tất cả thư viện và mô hình được tải về KHI ĐÓNG GÓI; khi sử dụng
không cần tải thư viện từ CDN. Xem licenses/ để biết giấy phép.
