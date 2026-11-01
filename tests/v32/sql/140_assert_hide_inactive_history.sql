-- CI-only: history may be hidden only after a package is revoked or cancelled.
-- All temporary users/orders/adjustments are rolled back; does not touch production.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000000001',true);
select set_config('autotax.history_test_lot',
 (public.addon_admin_grant_package_v32(
  '00000000-0000-4000-8000-000000000003','T200')->>'lot_id'),true);

do $grant_check$
declare
 lot text:=current_setting('autotax.history_test_lot');
 event_id text;
 page jsonb;
begin
 page:=public.addon_admin_package_transactions_v32(
  1,'admin_grant','00000000-0000-4000-8000-000000000003');
 select e->>'event_id' into event_id
 from jsonb_array_elements(page->'items') e where e->>'lot_id'=lot limit 1;
 if event_id is null then raise exception 'grant_not_in_admin_history'; end if;
 if (select (e->>'can_hide')::boolean from jsonb_array_elements(page->'items') e
   where e->>'event_id'=event_id) is not false
 then raise exception 'active_grant_can_be_hidden_in_ui'; end if;
 begin
  perform public.addon_admin_hide_package_history_v32(
   'admin_grant',event_id,false,'Test must reject active package');
  raise exception 'active_grant_hidden';
 exception when others then
  if sqlerrm<>'active_package_must_be_revoked_first' then raise; end if;
 end;
 perform public.addon_admin_adjust_package_lot_v32(
  lot::uuid,'revoke','Test package was cancelled');
 page:=public.addon_admin_package_transactions_v32(
  1,'admin_grant','00000000-0000-4000-8000-000000000003');
 if not exists(select 1 from jsonb_array_elements(page->'items') e
  where e->>'event_id'=event_id and e->>'status'='revoked'
    and (e->>'can_hide')::boolean)
 then raise exception 'revoked_grant_not_eligible_for_hide'; end if;
 perform public.addon_admin_hide_package_history_v32(
  'admin_grant',event_id,false,'Test approved history cleanup');
 page:=public.addon_admin_package_transactions_v32(
  1,'admin_grant','00000000-0000-4000-8000-000000000003');
 if exists(select 1 from jsonb_array_elements(page->'items') e
  where e->>'event_id'=event_id)
 then raise exception 'hidden_grant_still_visible'; end if;
 perform public.addon_admin_adjust_package_lot_v32(
  lot::uuid,'restore','Test restoration of original entitlement');
 page:=public.addon_admin_package_transactions_v32(
  1,'admin_grant','00000000-0000-4000-8000-000000000003');
 if not exists(select 1 from jsonb_array_elements(page->'items') e
  where e->>'event_id'=event_id
    and e->>'status'='granted' and (e->>'can_hide')::boolean=false)
 then raise exception 'restored_grant_remains_hidden'; end if;
end $grant_check$;

-- Test an unfulfilled order, first pending (not eligible), then cancelled.
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000000003',true);
select set_config('autotax.history_test_order',
 (public.addon_create_package_order('T100')->>'order_id'),true);
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000000001',true);
do $pending_check$
begin
 begin
  perform public.addon_admin_hide_package_history_v32(
   'purchase',current_setting('autotax.history_test_order'),false,
   'Reject pending purchase without revocation');
  raise exception 'pending_order_hidden';
 exception when others then
  if sqlerrm<>'history_not_cancelled_or_revoked' then raise; end if;
 end;
end $pending_check$;
reset role;
update public.addon_orders set status='cancelled'
 where id=current_setting('autotax.history_test_order')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '00000000-0000-4000-8000-000000000001',true);
do $cancel_check$
declare
 page jsonb;
 oid text:=current_setting('autotax.history_test_order');
begin
 page:=public.addon_admin_package_transactions_v32(
  1,'purchase','00000000-0000-4000-8000-000000000003');
 if not exists(select 1 from jsonb_array_elements(page->'items') e
  where e->>'event_id'=oid and (e->>'can_hide')::boolean)
 then raise exception 'cancelled_order_not_eligible'; end if;
 perform public.addon_admin_hide_package_history_v32(
  'purchase',oid,false,'Cancelled purchase history cleanup');
 page:=public.addon_admin_package_transactions_v32(
  1,'purchase','00000000-0000-4000-8000-000000000003');
 if exists(select 1 from jsonb_array_elements(page->'items') e
  where e->>'event_id'=oid)
 then raise exception 'cancelled_purchase_still_visible'; end if;
end $cancel_check$;
reset role;
do $originals$
begin
 if not exists(select 1 from public.addon_orders
  where id=current_setting('autotax.history_test_order')::uuid
   and status='cancelled')
 then raise exception 'financial_order_physically_deleted'; end if;
 if (select count(*) from public.addon_hidden_package_history)<2
 then raise exception 'hidden_list_records_missing'; end if;
 if (select count(*) from public.addon_audit_logs
  where action='admin_package_history_hidden_v32')<2
 then raise exception 'hide_action_not_audited'; end if;
end $originals$;
rollback;

do $permissions$
begin
 if has_function_privilege('anon',
  'public.addon_admin_hide_package_history_v32(text,text,boolean,text)','EXECUTE')
 then raise exception 'anonymous_can_hide_history'; end if;
 if has_table_privilege('authenticated','public.addon_hidden_package_history','SELECT')
 then raise exception 'hidden_audit_table_exposed_to_client'; end if;
end $permissions$;
select 'only_cancelled_or_revoked_history_can_be_hidden' as status;
