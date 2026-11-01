-- AUTOTAX V3.2: BROWSER-ONLY SNAPSHOT / KHONG XOA DU LIEU CU.
-- Execute ONCE in Supabase SQL Editor on the expected production project.
-- Creates 11 table copies under autotax_backup_20261101; does NOT modify
-- auth.users, addon_admins or original addon_* tables.
-- IMPORTANT: In-database snapshot is NOT an independent/off-site backup.
-- ALL 12 tables use RLS and client roles have no schema/table permissions.
begin transaction isolation level repeatable read;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
declare
 actual text[];
 expected text[] := array[
  'addon_admins','addon_audit_logs','addon_device_sessions',
  'addon_gift_codes','addon_gift_redemptions','addon_orders',
  'addon_payment_events','addon_plans','addon_profiles',
  'addon_subscriptions','addon_trial_claims'
 ];
begin
 select array_agg(tablename::text order by tablename)
 into actual
 from pg_tables
 where schemaname='public' and tablename like 'addon_%';
 if actual is distinct from expected then
  raise exception 'unexpected_addon_table_structure_refusing_to_snapshot: %', actual;
 end if;
 if to_regclass('public.addon_package_lots') is not null then
  raise exception 'v32_schema_detected_refusing_to_snapshot_old_system';
 end if;
 if (select count(*) from auth.users)<3 then
  raise exception 'expected_auth_users_missing';
 end if;
 if (select count(*) from public.addon_admins)<1 then
  raise exception 'expected_admin_missing';
 end if;
end $guard$;

-- A second run will fail safely rather than overwrite any existing copy.
create schema autotax_backup_20261101;
-- The backup schema is private: neither public nor client roles may use it.
revoke all on schema autotax_backup_20261101 from public, anon, authenticated;
create table autotax_backup_20261101._manifest (
 table_name text primary key,
 rows_original bigint not null,
 rows_copied bigint not null,
 captured_at timestamptz not null default now()
);
-- Fail closed: no policies permit direct access to backup metadata.
alter table autotax_backup_20261101._manifest enable row level security;
revoke all on table autotax_backup_20261101._manifest from public, anon, authenticated;

do $copy$
declare
 t text;
 source_count bigint;
 copied_count bigint;
begin
 for t in
  select tablename::text from pg_tables
  where schemaname='public' and tablename like 'addon_%'
  order by tablename
 loop
  execute format(
   'create table autotax_backup_20261101.%I as select * from public.%I',
   t,t
  );
  -- CTAS does not copy source RLS policies. Secure EVERY table explicitly.
  execute format(
   'alter table autotax_backup_20261101.%I enable row level security',
   t
  );
  execute format(
   'revoke all on table autotax_backup_20261101.%I from public, anon, authenticated',
   t
  );
  execute format('select count(*) from public.%I',t) into source_count;
  execute format(
   'select count(*) from autotax_backup_20261101.%I',t
  ) into copied_count;
  if source_count<>copied_count then
   raise exception 'backup_count_mismatch_for_%: original %, copy %',
    t,source_count,copied_count;
  end if;
  insert into autotax_backup_20261101._manifest(
   table_name,rows_original,rows_copied
  ) values(t,source_count,copied_count);
 end loop;
 if (select count(*) from autotax_backup_20261101._manifest)<>11 then
  raise exception 'backup_incomplete_expected_11_tables';
 end if;
end $copy$;
-- Verify that all 12 tables (11 copies + manifest) are protected BEFORE commit.
do $security_check$
declare exposed_count integer;
begin
 select count(*) into exposed_count
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='autotax_backup_20261101' and c.relkind='r'
   and (not c.relrowsecurity
        or has_table_privilege('anon',c.oid,'SELECT')
        or has_table_privilege('authenticated',c.oid,'SELECT'));
 if exposed_count<>0 then
  raise exception 'backup_table_security_check_failed: %', exposed_count;
 end if;
 if has_schema_privilege('anon','autotax_backup_20261101','USAGE')
 or has_schema_privilege('authenticated','autotax_backup_20261101','USAGE')
 then raise exception 'backup_schema_is_exposed_to_clients'; end if;
 if (select count(*) from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='autotax_backup_20261101' and c.relkind='r')<>12
 then raise exception 'backup_table_count_mismatch_expected_12'; end if;
end $security_check$;
commit;

-- Confirm 11 copied tables and matching row counts.
select table_name,rows_original,rows_copied,captured_at
from autotax_backup_20261101._manifest
order by table_name;
