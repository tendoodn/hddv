-- TEST ONLY: page server-side purchase and direct-admin-grant transactions 10 at a time.
-- Applied after fixtures, migration 022 and 090 tests.
do $check$
begin
 if has_function_privilege('anon',
   'public.addon_admin_package_transactions_v32(integer,text,uuid)','EXECUTE')
 then raise exception 'anon_has_admin_history_access'; end if;
end $check$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $customer$
begin
 begin
  perform public.addon_admin_package_transactions_v32();
  raise exception 'nonadmin_has_transaction_history';
 exception when others then
  if sqlerrm<>'admin_required' then raise; end if;
 end;
end $customer$;
rollback;

-- Populate only the isolated CI database. No live payments.
do $seed$
declare i integer;
begin
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 for i in 1..15 loop
  perform public.addon_create_package_order('T100');
 end loop;
end $seed$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $admin$
declare
 a jsonb;b jsonb;c jsonb;d jsonb;
begin
 a:=public.addon_admin_package_transactions_v32(
  1,'purchase','00000000-0000-4000-8000-000000000002');
 b:=public.addon_admin_package_transactions_v32(
  2,'purchase','00000000-0000-4000-8000-000000000002');
 if a->>'page_size'<>'10' or jsonb_array_length(a->'items')<>10
    or (a->>'total')::integer<15 then
  raise exception 'first_purchase_page_not_exactly_10'; end if;
 if jsonb_array_length(b->'items')<5 then
  raise exception 'second_purchase_page_missing_rows'; end if;
 if exists(
  select 1 from jsonb_array_elements(a->'items') r
  where r->>'event_type'<>'purchase'
 ) then raise exception 'purchase_page_mixed_types'; end if;
 c:=public.addon_admin_package_transactions_v32(
  1,'admin_grant','00000000-0000-4000-8000-000000000003');
 if (c->>'total')::integer<2 then raise exception 'admin_grants_not_in_history'; end if;
 if exists(
  select 1 from jsonb_array_elements(c->'items') r
  where r->>'event_type'<>'admin_grant'
 ) then raise exception 'admin_grant_filter_wrong'; end if;
 d:=public.addon_admin_package_transactions_v32(1,'all',null);
 if (d->>'total')::integer < (a->>'total')::integer+2
 then raise exception 'global_history_missing_records'; end if;
 begin
  perform public.addon_admin_package_transactions_v32(1,'not_valid',null);
  raise exception 'unvalidated_history_filter';
 exception when others then
  if sqlerrm<>'invalid_transaction_filter' then raise; end if;
 end;
end $admin$;
rollback;
select 'paged_package_transactions_passed' status;
