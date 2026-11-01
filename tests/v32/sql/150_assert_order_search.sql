-- Isolated CI verification for admin order/payment reference search.
-- Search is server-side before 10-row pagination; ordinary users forbidden.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('autotax.test_order_search',
 (public.addon_create_package_order('T100')->>'order_id'),true);
select set_config('autotax.test_payment_search',
 (select payment_reference from public.addon_orders
  where id=current_setting('autotax.test_order_search')::uuid),true);
do $denied$
begin
 begin
  perform public.addon_admin_search_package_transactions_v32(
   1,'all',null,current_setting('autotax.test_payment_search'));
  raise exception 'customer_allowed_to_search_admin_history';
 exception when others then
  if sqlerrm<>'admin_required' then raise; end if;
 end;
end $denied$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $admin$
declare
 j jsonb;
 v_id text:=current_setting('autotax.test_order_search');
 v_ref text:=current_setting('autotax.test_payment_search');
begin
 j:=public.addon_admin_search_package_transactions_v32(1,'purchase',null,v_id);
 if (j->>'total')::integer<>1 or jsonb_array_length(j->'items')<>1
    or j->'items'->0->>'order_id'<>v_id
 then raise exception 'full_order_uuid_search_failed'; end if;
 j:=public.addon_admin_search_package_transactions_v32(1,'purchase',null,
   substring(v_id from 1 for 15));
 if not exists(select 1 from jsonb_array_elements(j->'items') x
   where x->>'order_id'=v_id)
 then raise exception 'partial_order_uuid_search_failed'; end if;
 j:=public.addon_admin_search_package_transactions_v32(1,'all',null,lower(v_ref));
 if not exists(select 1 from jsonb_array_elements(j->'items') x
   where x->>'payment_reference'=v_ref)
 then raise exception 'case_insensitive_bank_reference_search_failed'; end if;
 j:=public.addon_admin_search_package_transactions_v32(1,'all',null,
  'THIS-ORDER-DOES-NOT-EXIST');
 if (j->>'total')::integer<>0 or jsonb_array_length(j->'items')<>0
 then raise exception 'unmatched_order_search_should_be_empty'; end if;
 if j->>'page_size'<>'10' then raise exception 'page_size_changed'; end if;
 j:=public.addon_admin_search_package_transactions_v32(1,'all',null,'');
 if (j->>'total')::integer<1 then raise exception 'empty_query_excludes_history'; end if;
end $admin$;
rollback;
do $access$
begin
 if has_function_privilege('anon',
  'public.addon_admin_search_package_transactions_v32(integer,text,uuid,text)','EXECUTE')
 then raise exception 'anon_can_search_private_history'; end if;
end $access$;
select 'admin_order_search_passed' as status;
