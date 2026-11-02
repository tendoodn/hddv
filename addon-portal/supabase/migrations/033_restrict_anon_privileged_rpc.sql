-- Security hardening, 2026-11-02: functions reachable through the public REST RPC.
-- Anonymous visitors must not call privileged or authenticated-only routines.
-- Preserve explicit grants for authenticated users and service_role.
-- No rows, entitlements, order state, or payments are modified.
begin;
revoke execute on function public.addon_admin_create_package_unlock(text,timestamptz) from public, anon;
revoke execute on function public.addon_admin_list_package_unlocks() from public, anon;
revoke execute on function public.addon_admin_list_packages() from public, anon;
revoke execute on function public.addon_admin_set_package_active(text,boolean) from public, anon;
revoke execute on function public.addon_admin_set_package_price(text,bigint) from public, anon;
revoke execute on function public.addon_admin_set_package_unlock_active(uuid,boolean) from public, anon;
revoke execute on function public.addon_claim_invoice_quota(jsonb) from public, anon;
revoke execute on function public.addon_is_admin() from public, anon;
revoke execute on function public.addon_redeem_package_unlock(text) from public, anon;
revoke execute on function public.addon_sync_profile() from public, anon;
do $$
declare n integer;
begin
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public'
    and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE');
  if n <> 0 then
    raise exception 'Anonymous SECURITY DEFINER RPCs still executable: %', n;
  end if;
  if not has_function_privilege('authenticated',
         'public.addon_claim_invoice_quota(jsonb)'::regprocedure, 'EXECUTE') then
    raise exception 'Authenticated invoice quota permission unexpectedly removed';
  end if;
  if not has_function_privilege('authenticated',
         'public.addon_redeem_package_unlock(text)'::regprocedure, 'EXECUTE') then
    raise exception 'Authenticated unlock redemption permission unexpectedly removed';
  end if;
end $$;
commit;
