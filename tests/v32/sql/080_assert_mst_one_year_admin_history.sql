-- V3.2 Post-upgrade: MST validity 365 days + private on-demand admin package history.
do $verify$
begin
 if (select count(*) from public.addon_package_catalog where family='mst')<5
 then raise exception 'mst_catalog_missing'; end if;
 if exists(select 1 from public.addon_package_catalog
  where family='mst' and validity_days is distinct from 365)
 then raise exception 'mst_not_fixed_to_one_year'; end if;
 if has_function_privilege('anon',
  'public.addon_admin_list_package_history_v32()','EXECUTE')
 then raise exception 'anonymous_can_read_private_package_history'; end if;
 if exists(select 1 from public.addon_package_catalog
  where family='invoice' and validity_days is not null)
 then raise exception 'invoice_packages_have_expiration'; end if;
end $verify$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $customer$
begin
 begin
  perform public.addon_admin_list_package_history_v32();
  raise exception 'customer_accessed_admin_package_history';
 exception when others then
  if sqlerrm<>'admin_required' then raise; end if;
 end;
end $customer$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $admin$
declare j jsonb;
begin
 j:=public.addon_admin_list_package_history_v32();
 if jsonb_typeof(j)<>'array' then raise exception 'admin_package_history_not_array'; end if;
 if not exists(select 1 from jsonb_array_elements(j) v where v->>'kind'='legacy_order')
 then raise exception 'legacy_order_missing_from_full_history'; end if;
 if not exists(select 1 from jsonb_array_elements(j) v where v->>'kind'='legacy_subscription')
 then raise exception 'legacy_subscription_missing_from_full_history'; end if;
 if not exists(select 1 from jsonb_array_elements(j) v where v->>'kind'='lot')
 then raise exception 'new_lots_missing_from_full_history'; end if;
 begin
  perform public.addon_admin_set_package_terms('MST5',180);
  raise exception 'mst_term_changed_without_one_year';
 exception when others then
  if sqlerrm<>'mst_validity_fixed_365_days' then raise; end if;
 end;
 perform public.addon_admin_create_package(
  'MST99','mst','Test 99 MST',99,100000,'test 365-day default',null);
 if not exists(select 1 from jsonb_array_elements(public.addon_admin_list_packages()) x where x->>'code'='MST99' and (x->>'validity_days')::int=365)
 then raise exception 'new_mst_package_missing_one_year_default'; end if;
end $admin$;
rollback;

select 'mst_one_year_and_admin_history_passed' as status;
