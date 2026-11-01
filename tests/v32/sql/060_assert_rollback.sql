-- TEST ONLY: SQL candidate must roll back completely when unrelated FK exists.
do $verify$
begin
 if to_regclass('public.addon_package_catalog') is not null then
  raise exception 'upgrade_did_not_roll_back_catalog_creation';
 end if;
 if (select count(*) from auth.users)<>3 then
  raise exception 'auth_accounts_changed_on_failed_upgrade';
 end if;
 if (select count(*) from public.addon_admins)<>1 then
  raise exception 'admin_roles_changed_on_failed_upgrade';
 end if;
 if (select count(*) from public.addon_orders)<>1 then
  raise exception 'old_orders_lost_on_failed_upgrade';
 end if;
 if (select count(*) from public.addon_subscriptions)<>1 then
  raise exception 'old_subscriptions_lost_on_failed_upgrade';
 end if;
 if (select count(*) from public.addon_trial_claims)<>1 then
  raise exception 'old_trial_lost_on_failed_upgrade';
 end if;
 if (select count(*) from public.external_order_review)<>1 then
  raise exception 'external_data_modified_on_failed_upgrade';
 end if;
end $verify$;
select 'rollback_safety_passed' as status;
