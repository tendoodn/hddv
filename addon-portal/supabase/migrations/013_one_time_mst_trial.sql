-- AutoTax V3.2 trial: one seven-day MST trial per normalized email and MST.
-- Requires 012_trial_mst_assignment_controls.sql; customer accounts remain untouched.
-- Trial issuance and identity reservation happen in one transaction.
drop function if exists public.addon_reserve_trial_identity(text);

create or replace function public.addon_start_mst_trial(p_mst text)
returns jsonb language plpgsql security definer
set search_path = public, auth as $$
declare
 u uuid := auth.uid();
 e text;
 m text := upper(regexp_replace(coalesce(p_mst,''),'[[:space:]-]','','g'));
 v_package text;
 v_lot uuid;
 v_expires timestamptz := now() + interval '7 days';
begin
 if u is null then raise exception 'authentication_required'; end if;
 if m !~ '^[0-9]{10}([0-9]{3})?$' then raise exception 'invalid_mst'; end if;
 select lower(btrim(email)) into e from auth.users where id=u;
 if e is null or e='' then raise exception 'email_required'; end if;
 -- Consistent lock ordering: email -> MST -> account.
 perform pg_advisory_xact_lock(hashtextextended('trial-email:'||e,20));
 perform pg_advisory_xact_lock(hashtextextended('trial-mst:'||m,20));
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if exists (select 1 from public.addon_trial_email_registry where email_normalized=e) then
  raise exception 'trial_email_already_used';
 end if;
 if exists (select 1 from public.addon_trial_mst_registry where mst=m) then
  raise exception 'trial_mst_already_used';
 end if;
 if exists (select 1 from public.addon_package_lots where user_id=u) then
  raise exception 'existing_package_account_not_eligible_for_trial';
 end if;
 if exists (select 1 from public.addon_mst_assignments where user_id=u) then
  raise exception 'existing_mst_account_not_eligible_for_trial';
 end if;
 -- The built-in MST1 catalog entry is the trial capacity reference, not an order.
 select code into v_package from public.addon_package_catalog
 where code='MST1' and family='mst';
 if v_package is null then raise exception 'trial_catalog_package_missing'; end if;
 insert into public.addon_trial_email_registry(email_normalized,first_user_id)
 values(e,u);
 insert into public.addon_trial_mst_registry(mst,first_user_id) values(m,u);
 insert into public.addon_package_lots
  (user_id,package_code,family,quantity,remaining,price_snapshot,starts_at,expires_at,grant_kind)
 values(u,v_package,'mst',1,1,0,now(),v_expires,'trial') returning id into v_lot;
 insert into public.addon_mst_assignments(user_id,mst) values(u,m);
 insert into public.addon_usage_modes(user_id,mode) values(u,'mst')
 on conflict(user_id) do update set mode='mst',updated_at=now();
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(u,u,'mst_trial_started',jsonb_build_object('mst',m,'lot_id',v_lot,'expires_at',v_expires));
 return jsonb_build_object('success',true,'mst',m,'expires_at',v_expires,'days',7);
end $$;
revoke all on function public.addon_start_mst_trial(text) from public, anon;
grant execute on function public.addon_start_mst_trial(text) to authenticated;

-- Old subscription trial can never be used to bypass the new registry.
revoke all on function public.addon_claim_trial() from public,anon,authenticated;
