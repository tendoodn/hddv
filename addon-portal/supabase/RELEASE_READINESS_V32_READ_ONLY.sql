-- AutoTax V3.2 — READ ONLY release checklist after successful production migration.
-- Does not create, update, delete, or alter any objects.
with metrics as (
 select 'auth_accounts'::text name,count(*)::bigint actual,3::bigint expected,'equal'::text check_type from auth.users
 union all select 'admin_accounts',count(*),1,'equal' from public.addon_admins
 union all select 'profiles',count(*),3,'equal' from public.addon_profiles
 union all select 'total_packages',count(*),10,'minimum' from public.addon_package_catalog
 union all select 'invoice_packages_active',count(*),5,'minimum' from public.addon_package_catalog where family='invoice' and active
 union all select 'mst_packages_active',count(*),5,'minimum' from public.addon_package_catalog where family='mst' and active
 union all select 'mst_packages_terms_configured',count(*),5,'minimum' from public.addon_package_catalog where family='mst' and active and validity_days between 1 and 3650
 union all select 'backup_manifest_rows',count(*),11,'equal' from autotax_backup_20261101._manifest
 union all select 'backup_rls_enabled',count(*),12,'equal' from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='autotax_backup_20261101' and c.relkind='r' and c.relrowsecurity
 union all select 'historical_subscriptions_active',count(*),0,'equal' from public.addon_subscriptions
 union all select 'historical_orders_active',count(*),0,'equal' from public.addon_orders
 union all select 'package_lots_current',count(*),0,'info' from public.addon_package_lots
)
select name,actual,expected,
 case when check_type='info' then 'THONG_TIN'
      when check_type='equal' and actual=expected then 'DAT'
      when check_type='minimum' and actual>=expected then 'DAT'
      else 'CHUA_DAT' end as status
from metrics order by name;
