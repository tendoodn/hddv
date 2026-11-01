-- AutoTax V3.2: READ ONLY safety report for the existing Supabase project.
-- COPY THIS QUERY INTO SQL EDITOR; it does not change any data or permissions.
-- Send the single JSON result to the developer before production cutover.
with addon_tables as (
 select c.oid,c.relname from pg_class c
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p')
 and c.relname like 'addon_%'
),
 foreign_references as (
 select distinct con.conrelid::regclass::text as outside_table,
        con.confrelid::regclass::text as addon_table,
        con.conname as constraint_name
 from pg_constraint con
 join addon_tables t on t.oid=con.confrelid
 where con.contype='f'
 and con.conrelid not in (select oid from addon_tables)
),
 external_views as (
 select distinct n.nspname||'.'||v.relname as dependent_view, t.relname as addon_table
 from pg_depend d
 join pg_rewrite r on d.classid='pg_rewrite'::regclass and d.objid=r.oid
 join pg_class v on v.oid=r.ev_class
 join pg_namespace n on n.oid=v.relnamespace
 join addon_tables t on t.oid=d.refobjid
 where v.relkind in ('v','m') and not (n.nspname='public' and v.relname like 'addon_%')
),
 triggers_on_auth as (
 select tgname,tgenabled from pg_trigger
 where tgrelid='auth.users'::regclass and not tgisinternal
)
select jsonb_pretty(jsonb_build_object(
 'auth_accounts',(select count(*) from auth.users),
 'admin_accounts',(select count(*) from public.addon_admins),
 'addon_tables',(select coalesce(jsonb_agg(relname order by relname),'[]'::jsonb) from addon_tables),
 'v32_already_created',to_regclass('public.addon_package_lots') is not null,
 'external_fk_dependencies',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from foreign_references x),
 'external_view_dependencies',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from external_views x),
 'auth_triggers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from triggers_on_auth x)
)) as v32_read_only_report;
