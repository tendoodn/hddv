# Sao lưu AutoTax trước khi nâng cấp V3.2 (Windows)

> **BẮT BUỘC TRƯỚC KHI CHẠY SQL RESET.** Script này chỉ đọc Supabase và ghi file về máy Windows; không xóa/sửa dữ liệu và không upload lên GitHub.

Supabase project của AutoTax: `ucqqjdsoyvvaxswzbhaw`. Bản nâng cấp dự kiến xóa **dữ liệu cấp phép cũ**, nhưng phải giữ nguyên 3 tài khoản đăng nhập và quyền admin. File sao lưu cần giữ cả hai schema **`auth` và `public`**.

## 1. Cài công cụ

1. Tải PostgreSQL client tools cho Windows từ https://www.postgresql.org/download/windows/. Cần **pg_dump** và **pg_restore** có trong PATH (mở PowerShell mới và thử `pg_dump --version`, `pg_restore --version`). Dùng phiên bản client **không cũ hơn PostgreSQL server**.
2. Mở Supabase Dashboard của đúng dự án `ucqqjdsoyvvaxswzbhaw`, nhấn **Connect**. Ghi lại riêng các trường `Host`, `Port`, `User`. Dùng kết nối **Direct** nếu máy có IPv6, hoặc **Session pooler** nếu không có IPv6.
3. Chuẩn bị **database password** từ Supabase Database Settings (khác với mật khẩu đăng nhập Supabase). **Không gửi mật khẩu hoặc connection string cho ChatGPT.**

## 2. Chạy script sao lưu

Tải mã nguồn tại https://github.com/tendoodn/hddv bằng **Code → Download ZIP**, giải nén. Trong thư mục `hddv-main`, mở PowerShell và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-supabase-v32.ps1
```

Script sẽ hỏi Host, Port, User, Database (mặc định `postgres`) và mật khẩu ẩn. Lệnh `pg_dump` **chỉ đọc** dữ liệu của `auth` và `public`. Script từ chối host/user không chứa project ref của AutoTax.

**File được lưu ngoài Git repository**:

```text
C:\Users\<ten-windows>\AutoTax-Private-Backups\AutoTax-before-V32-YYYYMMDD-HHMMSS.backup
```

Script kiểm tra dung lượng, đọc mục lục với `pg_restore --list`, xác nhận có `auth.users`, `addon_admins`, `addon_orders`, `addon_profiles` và tính SHA-256. Nếu lỗi, file được đánh dấu `.INCOMPLETE` và **không được sử dụng để triển khai**.

> Việc đọc được mục lục chỉ chứng minh **archive có cấu trúc hợp lệ**, không thay thế kiểm tra khôi phục vào database riêng. Để chắc chắn có thể phục hồi, nên thử `pg_restore` vào **database thử nghiệm hoàn toàn tách biệt** trước khi xóa dữ liệu cũ. Không chạy `pg_restore` vào production.

## 3. Sau khi sao lưu

- Giữ file `.backup` trên máy trong thư mục riêng tư, tốt nhất có thêm bản sao **được mã hóa** ở thiết bị khác.
- **Không đưa file vào GitHub, không gửi vào ChatGPT, không gửi connection string hoặc mật khẩu.**
- Nếu script báo thành công, chỉ gửi lại **dòng xác nhận sao lưu thành công và kích thước file**, không gửi nội dung dữ liệu.
- Tiếp theo rà soát/kiểm tra khôi phục, rồi mới chuẩn bị SQL V3.2 cuối cùng.
- **Không chạy** `UPGRADE_V32_CANDIDATE_DO_NOT_RUN.sql` hoặc `REBUILD_V32_DRAFT_DO_NOT_RUN.sql` khi chưa có bản sao lưu.

## Ghi chú

- PostgreSQL dump `--schema=auth --schema=public` lưu Auth và dữ liệu ứng dụng; không xuất file nhị phân trong Supabase Storage và không sao lưu Edge Function secrets. Các giá trị cấu hình SePay cần giữ lại **trong Supabase Secrets**, không copy ra GitHub.
- Supabase CLI `db dump` thường loại trừ schema do Supabase quản lý như `auth` theo mặc định; vì thế bản sao lưu này dùng trực tiếp `pg_dump` với **cả hai schema**.
- Tài liệu tham khảo: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore và https://supabase.com/docs/reference/cli/supabase-db-dump.
