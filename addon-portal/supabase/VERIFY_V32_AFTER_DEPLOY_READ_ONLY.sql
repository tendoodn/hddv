-- READ ONLY: verify AutoTax V3.2 after one-time production upgrade.
-- Must be run only AFTER PRODUCTION_UPGRADE_V32_ONE_TIME.sql succeeds.
with checks as (
 select 'auth_accounts' metric,count(*)::bigint value from auth.users
 union all select 'admin_accounts',count(*) from public.addon_admins
 union all select 'customer_profiles',count(*) from public.addon_profiles
 union all select 'package_catalog',count(*) from public.addon_package_catalog
 union all select 'old_orders_remaining',count(*) from public.addon_orders
 union all select 'old_subscriptions_remaining',count(*) from public.addon_subscriptions
 union all select 'old_trials_remaining',count(*) from public.addon_trial_claims
 union all select 'legacy_snapshot_tables',count(*) from autotax_backup_20261101._manifest
 union all select 'package_lots',count(*) from public.addon_package_lots
)
select metric,value from checks order by metric;
