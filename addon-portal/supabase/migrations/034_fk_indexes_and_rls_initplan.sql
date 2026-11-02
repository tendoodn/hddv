-- AutoTax performance: index uncovered foreign keys and cache auth functions in RLS.
-- Additive indexes: no data rows or business rules changed. Reversible by DROP INDEX.
-- This migration intentionally preserves the original RLS read semantics.
begin;
create index if not exists idx_addon_audit_logs_actor_id_fk on public.addon_audit_logs (actor_id);
create index if not exists idx_addon_audit_logs_target_user_id_fk on public.addon_audit_logs (target_user_id);
create index if not exists idx_addon_device_sessions_user_id_fk on public.addon_device_sessions (user_id);
create index if not exists idx_addon_gift_codes_created_by_fk on public.addon_gift_codes (created_by);
create index if not exists idx_addon_gift_redemptions_gift_id_fk on public.addon_gift_redemptions (gift_id);
create index if not exists idx_addon_gift_redemptions_subscription_id_fk on public.addon_gift_redemptions (subscription_id);
create index if not exists idx_addon_gift_redemptions_user_id_fk on public.addon_gift_redemptions (user_id);
create index if not exists idx_addon_orders_package_code_fk on public.addon_orders (package_code);
create index if not exists idx_addon_orders_plan_code_fk on public.addon_orders (plan_code);
create index if not exists idx_addon_package_lots_package_code_fk on public.addon_package_lots (package_code);
create index if not exists idx_addon_package_lots_user_id_fk on public.addon_package_lots (user_id);
create index if not exists idx_addon_package_unlock_codes_created_by_fk on public.addon_package_unlock_codes (created_by);
create index if not exists idx_addon_package_unlock_codes_package_code_fk on public.addon_package_unlock_codes (package_code);
create index if not exists idx_addon_package_unlock_codes_redeemed_by_fk on public.addon_package_unlock_codes (redeemed_by);
create index if not exists idx_addon_payment_events_order_id_fk on public.addon_payment_events (order_id);
create index if not exists idx_addon_subscriptions_created_by_fk on public.addon_subscriptions (created_by);
create index if not exists idx_addon_subscriptions_plan_code_fk on public.addon_subscriptions (plan_code);

-- Auth identity and admin membership do not depend on individual result rows.
-- InitPlan evaluates each helper once per statement, instead of once per row.
-- Some legacy installs do not have the trial read policy yet.
-- Preserve their existing permissions rather than unexpectedly creating access.
do $autotax_rls$
begin
 if exists (select 1 from pg_policies where schemaname='public'
   and tablename='addon_trial_claims' and policyname='trial claim self read') then
  execute 'alter policy "trial claim self read" on public.addon_trial_claims using (user_id = (select auth.uid()))';
 end if;
end $autotax_rls$;
alter policy "addon_lots_read" on public.addon_package_lots
  using (user_id = (select auth.uid()) or (select public.addon_is_admin()));
alter policy "addon_deductions_read" on public.addon_invoice_deductions
  using (user_id = (select auth.uid()) or (select public.addon_is_admin()));
alter policy "addon_mst_assignments_read" on public.addon_mst_assignments
  using (user_id = (select auth.uid()) or (select public.addon_is_admin()));
commit;
