-- Test-only transaction: admin can revoke and restore one package lot;
-- a normal customer cannot; refund/error compensation is one-time and audited.
begin;
insert into auth.users(id,email)
values('00000000-0000-4000-8000-000000000009','v32-revoke-test@example.invalid')
on conflict(id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select set_config('autotax.revoke_test_lot_id',
 (public.addon_admin_grant_package_v32(
  '00000000-0000-4000-8000-000000000009','T200')->>'lot_id'),true);

do $revoke$
declare
 id uuid:=current_setting('autotax.revoke_test_lot_id')::uuid;
 j jsonb;
 n integer;
begin
 select count(*) into n from public.addon_package_lots where id=id;
 -- Use qualified column explicitly to avoid ID shadowing.
 j:=public.addon_admin_adjust_package_lot_v32(id,'revoke','Paid package refund test');
 if j->>'action'<>'revoke' then raise exception 'revoke_failed'; end if;
 if exists(select 1 from public.addon_package_lots l where l.id=id)
 then raise exception 'revoked_lot_still_active'; end if;
 if not exists(select 1 from public.addon_package_revocations r
  where r.lot_id=id and r.restored_at is null)
 then raise exception 'revoked_lot_not_archived'; end if;
 j:=public.addon_admin_package_transactions_v32(
   1,'admin_grant','00000000-0000-4000-8000-000000000009');
 if not exists(select 1 from jsonb_array_elements(j->'items') x
  where x->>'lot_id'=id::text and x->>'status'='revoked'
   and x->>'transaction_code' like 'ADMIN-%')
 then raise exception 'revoked_grant_missing_transaction_details'; end if;
end $revoke$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000009',true);
do $forbidden$
begin
 begin
  perform public.addon_admin_adjust_package_lot_v32(
   current_setting('autotax.revoke_test_lot_id')::uuid,
   'restore','Unauthorized client restore');
  raise exception 'non_admin_was_able_to_restore';
 exception when others then
  if sqlerrm<>'admin_required' then raise; end if;
 end;
 if (public.addon_my_entitlements()->>'ever_had_package')::boolean is not true
 then raise exception 'revoked_user_eligible_for_trial'; end if;
 begin
  perform public.addon_start_mst_trial('0312345678');
  raise exception 'revoked_account_got_new_trial';
 exception when others then
  if sqlerrm<>'existing_package_account_not_eligible_for_trial'
  then raise; end if;
 end;
end $forbidden$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $restore$
declare
 id uuid:=current_setting('autotax.revoke_test_lot_id')::uuid;
 j jsonb;
begin
 j:=public.addon_admin_adjust_package_lot_v32(id,'restore','Reinstated after verification');
 if j->>'action'<>'restore' then raise exception 'restore_failed'; end if;
 if not exists(select 1 from public.addon_package_lots l
  where l.id=id and l.remaining=200)
 then raise exception 'restored_balance_not_preserved'; end if;
 if not exists(select 1 from public.addon_package_revocations r
  where r.lot_id=id and r.restored_at is not null)
 then raise exception 'restore_not_audited'; end if;
end $restore$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000009',true);
select set_config('autotax.comp_test_order_id',
 (public.addon_create_package_order('MST5')->>'order_id'),true);
reset role;
update public.addon_orders
 set status='failed'
 where id=current_setting('autotax.comp_test_order_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $comp$
declare
 j jsonb;
 p uuid:=current_setting('autotax.comp_test_order_id')::uuid;
begin
 j:=public.addon_admin_compensate_failed_order_v32(
   p,'Bank transfer reconciled manually');
 if j->>'success'<>'true' or (j->>'quantity')::integer<>5
 then raise exception 'failed_order_compensation_invalid'; end if;
 if not exists(select 1 from public.addon_package_lots l
  where l.id=(j->>'lot_id')::uuid and l.grant_kind='gift'
    and l.expires_at>now()+interval '364 days')
 then raise exception 'compensation_not_granted_for_one_year'; end if;
 if (select status from public.addon_orders where id=p)<>'failed'
 then raise exception 'financial_status_modified_by_compensation'; end if;
 begin
  perform public.addon_admin_compensate_failed_order_v32(
   p,'Repeat compensation should be rejected');
  raise exception 'duplicate_compensation_allowed';
 exception when others then
  if sqlerrm<>'order_already_compensated' then raise; end if;
 end;
 j:=public.addon_admin_package_transactions_v32(
  1,'admin_grant','00000000-0000-4000-8000-000000000009');
 if not exists(select 1 from jsonb_array_elements(j->'items') x
  where x->>'order_id'=p::text
    and x->>'transaction_code' like 'ADMIN-%'
    and x->>'admin_action'='admin_package_compensated_v32')
 then raise exception 'compensation_missing_from_history'; end if;
end $comp$;
rollback;

do $acl$
begin
 if has_function_privilege('anon',
  'public.addon_admin_adjust_package_lot_v32(uuid,text,text)','EXECUTE')
 then raise exception 'anonymous_package_adjustment_enabled'; end if;
 if has_function_privilege('anon',
  'public.addon_admin_compensate_failed_order_v32(uuid,text)','EXECUTE')
 then raise exception 'anonymous_compensation_enabled'; end if;
end $acl$;
select 'admin_revoke_restore_compensation_and_codes_passed' status;
