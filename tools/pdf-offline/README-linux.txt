AUTOTAX PDF - LINUX LAN OFFLINE
===============================
Thư viện đầy đủ đã kèm trong ZIP; không cần Internet hay npm.

Yêu cầu: Linux với Python3, trình duyệt trên máy khách.
Chạy:
  unzip AutoTax-PDF-Linux-LAN.zip
  cd AutoTax-PDF-Linux-LAN
  chmod +x start.sh
  ./start.sh

Truy cập http://IP-MAY-LINUX:8080 trên các thiết bị cùng LAN.
Dùng hostname -I để lấy IP Linux.
Đổi cổng: PORT=9090 ./start.sh

Muốn chạy cùng hệ thống: tham khảo autotax-pdf.service.example.
Nếu máy khách không kết nối được, kiểm tra firewall và quyền LAN.
Không mở cổng 8080 công khai ra Internet.
