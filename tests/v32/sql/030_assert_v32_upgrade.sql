-- TEST ONLY: execute after the one-time candidate upgrade in an isolated DB.
do $verify$
declare
 a uuid := '00000000-0000-4000-8000-000000000001';
 u uuid := '00000000-0000-4000-8000-000000000002';
 v uuid := '00000000-0000-4000-8000-000000000003';
 j jsonb;
 k jsonb;
 ref text;
 n integer;
begin
 if (select count(*) from auth.users)<>3 then raise exception 'auth_users_not_preserved'; end if;
 if (select count(*) from public.addon_admins)<>1 then raise exception 'admin_not_preserved'; end if;
 if (select count(*) from public.addon_profiles)<>3 then raise exception 'auth_profiles_not_rebuilt'; end if;
 if (select count(*) from public.addon_package_catalog)<>10 then raise exception 'package_catalog_wrong'; end if;
 if exists(select 1 from public.addon_orders) or exists(select 1 from public.addon_subscriptions)
 then raise exception 'legacy_data_remains'; end if;
 if exists(select 1 from public.addon_trial_claims) or exists(select 1 from public.addon_gift_codes)
 then raise exception 'legacy_trial_or_gift_remains'; end if;
 if has_function_privilege('authenticated','public.addon_claim_trial()','EXECUTE')
 then raise exception 'legacy_trial_still_callable'; end if;
 if has_function_privilege('authenticated','public.addon_process_sepay_payment(text,text,bigint,jsonb)','EXECUTE')
 then raise exception 'payment_webhook_unprotected'; end if;
 perform set_config('request.jwt.claim.sub',u::text,false);
 if public.addon_is_admin() then raise exception 'customer_has_admin_role'; end if;
 j:=public.addon_start_mst_trial('0123456789');
 if j->>'mst'<>'0123456789' then raise exception 'trial_not_granted'; end if;
 if (select count(*) from public.addon_trial_email_registry)<>1 then raise exception 'trial_email_not_reserved'; end if;
 perform set_config('request.jwt.claim.sub',v::text,false);
 begin
  perform public.addon_start_mst_trial('0123456789');
  raise exception 'expected_duplicate_mst_denial';
 exception when others then
  if sqlerrm<>'trial_mst_already_used' then raise; end if;
 end;
 j:=public.addon_start_mst_trial('9876543210');
 if j->>'mst'<>'9876543210' then raise exception 'second_trial_not_granted'; end if;
 begin
  perform public.addon_start_mst_trial('5555555555');
  raise exception 'expected_duplicate_email_denial';
 exception when others then
  if sqlerrm<>'trial_email_already_used' then raise; end if;
 end;
 update public.addon_package_lots set expires_at=now()-interval '1 day'
 where user_id=v and grant_kind='trial';
 begin
  perform public.addon_unlink_mst('9876543210');
  raise exception 'expected_expired_unlink_denial';
 exception when others then
  if sqlerrm<>'mst_unlink_requires_active_package' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',a::text,false);
 if not public.addon_is_admin() then raise exception 'admin_lost_role'; end if;
 if jsonb_array_length(public.addon_admin_list_users_v32())<>3 then raise exception 'admin_customer_listing_wrong'; end if;
 perform public.addon_unlink_mst('9876543210',v);
 insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot,expires_at)
 values(v,'MST1','mst',1,1,35000,now()+interval '365 days');
 perform set_config('request.jwt.claim.sub',v::text,false);
 j:=public.addon_authorize_mst('0123456789');
 if j->>'allowed'<>'true' then raise exception 'paid_account_rejected_for_old_trial_mst'; end if;
 -- The invoice deduction RPC is atomic and idempotent.
 insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot)
 values(u,'T100','invoice',100,100,50000);
 perform set_config('request.jwt.claim.sub',u::text,false);
 perform public.addon_set_usage_mode('invoice');
 k:=jsonb_build_array(jsonb_build_object(
 'mst','0123456789','direction','purchase','form_code','01GTKT','series','C26TAA','invoice_number','000123'));
 j:=public.addon_claim_invoice_quota(k);
 if (j->>'deducted')::integer<>1 then raise exception 'first_invoice_not_charged'; end if;
 j:=public.addon_claim_invoice_quota(k);
 if (j->>'previously_deducted')::integer<>1 or (j->>'deducted')::integer<>0
 then raise exception 'duplicate_invoice_charged'; end if;
 -- A change in purchase/sale classification is not a new invoice.
 j:=public.addon_claim_invoice_quota(jsonb_build_array((k->0)||jsonb_build_object('direction','sold')));
 if (j->>'previously_deducted')::integer<>1 or (j->>'deducted')::integer<>0
 then raise exception 'invoice_double_charged_after_direction_change'; end if;
 update public.addon_package_lots set remaining=0 where user_id=u and family='invoice';
 j:=public.addon_my_entitlements();
 if j->>'allowed'<>'true' or j->>'can_reread_charged_invoices'<>'true'
 then raise exception 'zero_quota_blocks_rereads'; end if;
 j:=public.addon_claim_invoice_quota(k);
 if (j->>'previously_deducted')::integer<>1 then raise exception 'reread_zero_quota_denied'; end if;
 j:=public.addon_claim_invoice_quota(jsonb_build_array(jsonb_build_object(
 'mst','0123456789','direction','purchase','form_code','01GTKT','series','C26TAA','invoice_number','000124')));
 if (j->>'denied')::integer<>1 then raise exception 'zero_quota_allowed_new_invoice'; end if;
 -- Paid order is snapshot-based, and duplicate provider events cannot grant twice.
 perform set_config('request.jwt.claim.sub',a::text,false);
 perform public.addon_admin_set_package_terms('MST1',365);
 perform set_config('request.jwt.claim.sub',u::text,false);
 j:=public.addon_create_package_order('T100');
 ref:=j->>'payment_reference';
 if ref is null then raise exception 'paid_order_not_created'; end if;
 j:=public.addon_process_sepay_payment(ref,'test-sepay-1',50000,'{}'::jsonb);
 if j->>'duplicate'<>'false' then raise exception 'payment_not_applied'; end if;
 j:=public.addon_process_sepay_payment(ref,'test-sepay-1',50000,'{}'::jsonb);
 if j->>'duplicate'<>'true' then raise exception 'duplicate_payment_not_detected'; end if;
 select count(*) into n from public.addon_package_lots l
 join public.addon_orders o on o.id=l.order_id where o.payment_reference=ref;
 if n<>1 then raise exception 'payment_granted_lot_multiple_times'; end if;
 -- Switching away and back to invoice mode must not block rereads at zero credit.
 perform set_config('request.jwt.claim.sub',u::text,false);
 update public.addon_package_lots set remaining=0 where user_id=u and family='invoice';
 perform public.addon_set_usage_mode('mst');
 perform public.addon_set_usage_mode('invoice');
 j:=public.addon_claim_invoice_quota(k);
 if (j->>'previously_deducted')::integer<>1
 then raise exception 'reread_blocked_after_mode_switch'; end if;
 -- Prevent oversized user payloads from holding row locks for too long.
 begin
  perform public.addon_claim_invoice_quota(
   (select jsonb_agg(k->0) from generate_series(1,251))
  );
  raise exception 'expected_batch_limit_rejection';
 exception when others then
  if sqlerrm<>'too_many_invoice_items' then raise; end if;
 end;
end $verify$;
select 'smoke_test_passed' as status;
