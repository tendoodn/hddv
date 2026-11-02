-- Safe removal of elevated execution for a public catalog-only reader.
-- Uses existing authenticated SELECT permission and RLS active-or-admin policy.
-- No rows, pricing, orders, entitlements or function arguments are changed.
begin;
do $autotax_invoker$
begin
 if not (select relrowsecurity from pg_class where oid='public.addon_package_catalog'::regclass) then
  raise exception 'Package catalog RLS must be enabled';
 end if;
 if not exists (
  select 1 from pg_policies where schemaname='public'
   and tablename='addon_package_catalog'
   and policyname='addon_catalog_read'
   and qual like '%active%'
 ) then
  raise exception 'Catalog RLS read guard missing - refusing to lower function privileges';
 end if;
end
$autotax_invoker$;
-- Older installations used only a SECURITY DEFINER RPC and lacked table SELECT.
-- RLS already limits this grant to active catalog rows and administrators.
grant select on public.addon_package_catalog to authenticated;
alter function public.addon_list_packages() security invoker;
do $autotax_verify$
begin
 if (select prosecdef from pg_proc
      where oid='public.addon_list_packages()'::regprocedure) then
  raise exception 'Catalog list function still has SECURITY DEFINER';
 end if;
 if not has_function_privilege('authenticated',
     'public.addon_list_packages()'::regprocedure,'EXECUTE') then
  raise exception 'Catalog list function no longer usable by signed-in users';
 end if;
end
$autotax_verify$;
commit;
