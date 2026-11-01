# AutoTax V3.2 — Production cutover runbook

**Status: awaiting read-only Supabase dependency preflight and verified backup. Do not execute production candidate yet.**

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

## After owner-approved production SQL
1. Confirm new `addon_my_entitlements`, `addon_admin_list_users_v32`, `addon_start_mst_trial` RPCs work for logged-in users.
2. Configure `validity_days` on each MST package via admin before accepting orders. Admin may adjust package prices.
3. Confirm SePay secrets and webhook setup from private Supabase environment (never paste secrets in chat/GitHub).
4. Register one trial test email and MST. Verify another email cannot trial the same MST, but can purchase and use a package legitimately.
5. Test quota T100+T200, reread free when credits are zero, Excel and ZIP once per invoice, and duplicate payment callback.
6. Reload or republish the Chrome extension. GitHub Pages source changes automatically do **not** update installed extensions.
7. Monitor logs and genuine purchases for any drift; user accounts/admin roles must stay unchanged.

**Incident policy:** Failed SQL transaction should auto-rollback. For a post-commit incident, stop new paid actions and restore from the verified backup; do not try to reverse the reset by running random legacy SQL.
