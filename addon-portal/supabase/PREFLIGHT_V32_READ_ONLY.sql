-- AutoTax V3.2 preflight: READ ONLY. Run in the intended Supabase project.
-- No passwords, keys, emails or customer details are returned.
select 'auth_accounts' as metric, count(*)::bigint as value from auth.users
union all select 'addon_admins', count(*) from public.addon_admins
union all select 'addon_tables', count(*) from pg_tables where schemaname='public' and tablename like 'addon_%';

-- Objects outside addon_* that depend on addon_* objects; review before any reset.
select distinct
  d.classid::regclass::text as dependent_catalog,
  d.objid::text as dependent_object_id,
  d.deptype
from pg_depend d
join pg_class c on d.refobjid=c.oid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'addon_%'
  and d.deptype not in ('i','a')
order by 1,2,3;

-- Check whether old Auth trigger exists.
select tgname, tgenabled from pg_trigger
where tgrelid='auth.users'::regclass and not tgisinternal
order by tgname;
