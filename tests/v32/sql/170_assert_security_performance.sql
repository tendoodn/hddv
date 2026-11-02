-- Validate anonymous privilege reduction and index coverage on the test database.
do $$
declare missing text;
begin
 if exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE')
 ) then raise exception 'Anonymous role can still execute SECURITY DEFINER RPCs'; end if;
 if not has_function_privilege('authenticated',
    'public.addon_claim_invoice_quota(jsonb)'::regprocedure,'EXECUTE') then
  raise exception 'Invoice quota claim permission is missing for authenticated users'; end if;
 if not has_function_privilege('authenticated',
    'public.addon_redeem_package_unlock(text)'::regprocedure,'EXECUTE') then
  raise exception 'Package unlock permission is missing for authenticated users'; end if;
 select string_agg(expected_name,', ')
 into missing from (
  select unnest(array[
   'idx_addon_audit_logs_actor_id_fk',
   'idx_addon_audit_logs_target_user_id_fk',
   'idx_addon_device_sessions_user_id_fk',
   'idx_addon_gift_codes_created_by_fk',
   'idx_addon_gift_redemptions_gift_id_fk',
   'idx_addon_gift_redemptions_subscription_id_fk',
   'idx_addon_gift_redemptions_user_id_fk',
   'idx_addon_orders_package_code_fk',
   'idx_addon_orders_plan_code_fk',
   'idx_addon_package_lots_package_code_fk',
   'idx_addon_package_lots_user_id_fk',
   'idx_addon_package_unlock_codes_created_by_fk',
   'idx_addon_package_unlock_codes_package_code_fk',
   'idx_addon_package_unlock_codes_redeemed_by_fk',
   'idx_addon_payment_events_order_id_fk',
   'idx_addon_subscriptions_created_by_fk',
   'idx_addon_subscriptions_plan_code_fk'
  ]) as expected_name
 ) s
 where not exists (
  select 1 from pg_indexes i
  where i.schemaname='public' and i.indexname=s.expected_name
 );
 if missing is not null then
  raise exception 'Expected FK indexes are missing: %', missing;
 end if;
 if (select count(*) from pg_policies
   where schemaname='public'
   and (tablename, policyname) in (
    ('addon_trial_claims','trial claim self read'),
    ('addon_package_lots','addon_lots_read'),
    ('addon_invoice_deductions','addon_deductions_read'),
    ('addon_mst_assignments','addon_mst_assignments_read')
   )
   and qual like '%SELECT auth.uid()%') <> 4 then
  raise exception 'Four optimized read policies must keep initPlan auth identity';
 end if;
end $$;
select 'AutoTax security, FK index and RLS optimization checks passed' as result;
