-- AUTOTAX V3.2: BROWSER-ONLY SNAPSHOT / KHONG XOA DU LIEU CU.
-- Execute ONCE in Supabase SQL Editor on the expected production project.
-- Creates 11 table copies under autotax_backup_20261101; does NOT modify
-- auth.users, addon_admins or original addon_* tables.
-- IMPORTANT: In-database snapshot is NOT an independent/off-site backup.
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
create table autotax_backup_20261101._manifest (
 table_name text primary key,
 rows_original bigint not null,
 rows_copied bigint not null,
 captured_at timestamptz not null default now()
);

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
commit;

-- Confirm 11 copied tables and matching row counts.
select table_name,rows_original,rows_copied,captured_at
from autotax_backup_20261101._manifest
order by table_name;
