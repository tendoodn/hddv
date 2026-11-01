-- TEST ONLY: independent package lots, expiry and one-time unlock.
do $lots$
declare
 admin_id uuid:='00000000-0000-4000-8000-000000000001';
 trial_user uuid:='00000000-0000-4000-8000-000000000002';
 paid_user uuid:='00000000-0000-4000-8000-000000000003';
 unlock jsonb;
 result jsonb;
 ent jsonb;
begin
 -- Buying 100 + 200 invoices must show purchased=300, remaining=300.
 insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot)
 values
  (paid_user,'T100','invoice',100,100,50000),
  (paid_user,'T200','invoice',200,200,90000);
 perform set_config('request.jwt.claim.sub',paid_user::text,false);
 ent:=public.addon_my_entitlements();
 if (ent#>>'{packages,invoice,purchased}')::bigint<>300
 or (ent#>>'{packages,invoice,remaining}')::bigint<>300
 then raise exception 'invoice_lots_did_not_accumulate'; end if;

 perform set_config('request.jwt.claim.sub',admin_id::text,false);
 perform public.addon_admin_set_package_terms('MST5',10);
 unlock:=public.addon_admin_create_package_unlock('MST5');
 if unlock->>'code' is null then raise exception 'unlock_creation_failed'; end if;
 perform set_config('request.jwt.claim.sub',trial_user::text,false);
 result:=public.addon_redeem_package_unlock(unlock->>'code');
 if result->>'package_code'<>'MST5' then raise exception 'unlock_did_not_grant_specific_package'; end if;
 begin
  perform public.addon_redeem_package_unlock(unlock->>'code');
  raise exception 'unlock_reused_illegally';
 exception when others then
  if sqlerrm<>'unlock_code_invalid_or_disabled' then raise; end if;
 end;
 ent:=public.addon_my_entitlements();
 if (ent#>>'{packages,mst,active_quantity}')::bigint<>6
 then raise exception 'mst_capacity_not_accumulated'; end if;
 if (ent#>>'{packages,mst,nearest_expiry}') is null then raise exception 'mst_expiry_missing'; end if;

 -- Expiration of the earlier trial lot must reduce active capacity by one.
 update public.addon_package_lots set expires_at=now()-interval '1 day'
 where user_id=trial_user and grant_kind='trial';
 ent:=public.addon_my_entitlements();
 if (ent#>>'{packages,mst,active_quantity}')::bigint<>5
 then raise exception 'mst_capacity_failed_to_shrink_after_one_lot_expires'; end if;
end $lots$;
select 'package_lots_test_passed' as status;
