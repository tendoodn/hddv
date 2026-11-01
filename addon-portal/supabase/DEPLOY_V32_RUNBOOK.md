# AutoTax V3.2 — Production cutover runbook

**Status: awaiting read-only Supabase dependency preflight and verified backup. Do not execute production candidate yet.**

## Production preflight đã xác nhận (01/11/2026)

Người sở hữu dự án đã chạy `PREDEPLOY_V32_READ_ONLY.sql` trong Supabase SQL Editor và cung cấp kết quả:

- `auth_accounts = 3`, `admin_accounts = 1`.
- Đúng 11 bảng `public.addon_*` cũ; `addon_package_lots` chưa tồn tại.
- `external_fk_dependencies = []`, `external_view_dependencies = []`.
- Trigger `auth.users.addon_auth_user_profile` vẫn enabled.

**Preflight đã đạt; chưa cấp phép chạy migration.** Bước bắt buộc còn thiếu: xác nhận bản sao lưu có thể phục hồi. Bản sao lưu cần lấy **trước** khi chạy SQL thay dữ liệu cấp phép cũ.

Để sao lưu: vào Supabase Dashboard → Database → Backups nếu dự án hỗ trợ daily backups. Với Free plan hoặc cần bản sao riêng, dùng `supabase db dump` / `pg_dump` theo tài liệu chính thức: https://supabase.com/docs/guides/platform/backups và https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore. Không đưa mật khẩu kết nối, database dump hoặc secret lên GitHub hoặc vào chat.

GitHub Actions đã kiểm tra V3.2 dưới cả role `authenticated` và `anon`: các API người dùng hoạt động, người dùng không có quyền xem admin, anon không có quyền dùng thử hay xử lý thanh toán. Điều này là kiểm thử trên PostgreSQL giả lập, không thay thế rà soát môi trường Supabase thật.

## Architecture
- Single GitHub repo: https://github.com/tendoodn/hddv
- Customer portal: docs/index.html, docs/customer.js
- Admin: docs/admin.html, docs/admin-mst.js
- Chrome extension: autotax/src/sidepanel/index.html and autotax/src/license/license.js
- Source of truth: existing dedicated Supabase project (keep all auth.users and addon_admins)
- Payment: addon-create-order and addon-sepay-webhook Edge Functions.

## Preflight, no writes
1. Open the exact Supabase project already used by the extension and web admin.
2. Run the complete **read-only** file `PREDEPLOY_V32_READ_ONLY.sql`.
3. Review the returned `addon_tables`, `v32_already_created`, `external_fk_dependencies`, `external_view_dependencies`, `auth_triggers`.
4. Do not proceed if the expected legacy schema differs, V3.2 partial tables exist, or external dependencies are not understood.
5. Take and independently verify a Supabase database backup including all existing Auth and public tables. This is mandatory because the upgrade deliberately removes prior licensing, orders, gifts, trial records, and audit history. Current customers will receive new unlock codes at the owner's discretion.

## SQL upgrade
- Candidate source: `UPGRADE_V32_CANDIDATE_DO_NOT_RUN.sql`.
- This script uses one transaction, preserves auth.users and addon_admins, installs migrations 005–018, wipes legacy business records, replaces the legacy monthly/yearly checkout dependency, re-seeds addon_profiles, and revokes legacy RPCs.
- The candidate is **not authorized for production** until preflight and backup complete.
- Do not run `REBUILD_V32_DRAFT_DO_NOT_RUN.sql` or `docs/sql/*.sql`. The first one uses destructive DDL; the latter are deprecated old billing scripts.
- Do not query `supabase_migrations.schema_migrations` in SQL Editor; that table may not exist and is unrelated to this one-time upgrade.
- Use Supabase SQL Editor to run the reviewed production script once. Never run it again. If an error occurs during the transaction, inspect the error and do not run partial fragments.

## Verified isolated tests
`.github/workflows/verify-v32.yml` now runs:
- Static JavaScript syntax, UI ID alignment and RPC definition checks.
- PostgreSQL 16: historical schema, three mock users and one admin; upgrade and assert preservation.
- Email/MST trial dedup, expired MST unlink access, previously charged invoice reread at zero quota, paid MST without cross-account trial restriction.
- T100+T200 summation, one-time package unlock, MST capacity shrinking when one lot expires.
- SePay idempotent order activation.
- Negative test: unrelated external foreign key causes upgrade to roll back, leaving previous records intact.
- ZIP packaging from `autotax/` after both check suites pass. No public Chrome Store publication.

All tests run on isolated mock databases. They **do not** prove compatibility with unknown external dependencies or live providers.

## Supabase Edge Functions và SePay (bắt buộc sau SQL)

Mã nguồn đã có `addon-portal/supabase/config.toml`:

- `addon-create-order`: `verify_jwt = true`, người mua phải đăng nhập Supabase.
- `addon-sepay-webhook`: `verify_jwt = false`, vì SePay không gửi Supabase JWT; thay vào đó code kiểm tra HMAC-SHA256 qua `X-SePay-Timestamp` và `X-SePay-Signature` trước khi cộng gói. **Tuyệt đối không tắt kiểm tra HMAC trong code.**

Phải triển khai lại **cả hai Edge Functions** từ `addon-portal/` bằng Supabase CLI hoặc cập nhật tương ứng trong dashboard; commit GitHub **không tự triển khai** Edge Functions. Với CLI từ thư mục `addon-portal/` sau khi đã đăng nhập và liên kết đúng dự án:

```sh
supabase functions deploy addon-create-order --project-ref ucqqjdsoyvvaxswzbhaw
supabase functions deploy addon-sepay-webhook --project-ref ucqqjdsoyvvaxswzbhaw --no-verify-jwt
```

Lệnh `--no-verify-jwt` trên webhook chỉ bỏ kiểm tra JWT của Supabase gateway, **không bỏ kiểm tra chữ ký HMAC** trong handler. SePay dashboard phải được cấu hình chế độ **HMAC-SHA256**, với secret trùng `SEPAY_WEBHOOK_SECRET` lưu tại Supabase Secrets. Cấu hình tài khoản nhận `SEPAY_BANK_ACCOUNT`, `MB_BANK_ACCOUNT` và `MB_ACCOUNT_NAME` phải khớp tài khoản thực tế. Không đưa bất kỳ secret nào vào GitHub hoặc chat.

Tài liệu:
- https://supabase.com/docs/guides/functions/function-configuration
- https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc

## After owner-approved production SQL
1. Confirm new `addon_my_entitlements`, `addon_admin_list_users_v32`, `addon_start_mst_trial` RPCs work for logged-in users.
2. Configure `validity_days` on each MST package via admin before accepting orders. Admin may adjust package prices.
3. Confirm SePay secrets and webhook setup from private Supabase environment (never paste secrets in chat/GitHub).
4. Register one trial test email and MST. Verify another email cannot trial the same MST, but can purchase and use a package legitimately.
5. Test quota T100+T200, reread free when credits are zero, Excel and ZIP once per invoice, and duplicate payment callback.
6. Reload or republish the Chrome extension. GitHub Pages source changes automatically do **not** update installed extensions.
7. Monitor logs and genuine purchases for any drift; user accounts/admin roles must stay unchanged.

**Incident policy:** Failed SQL transaction should auto-rollback. For a post-commit incident, stop new paid actions and restore from the verified backup; do not try to reverse the reset by running random legacy SQL.
