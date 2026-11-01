-- Test-only: explicit profile registration, strict session match, 12-digit ID,
-- no auto-enrollment on mismatch, paid MST capacity. Roll back all fixtures.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000009','invoice-profile-test@example.invalid'),
 ('00000000-0000-4000-8000-000000000010','mst-profile-test@example.invalid'),
 ('00000000-0000-4000-8000-000000000011','trial-12-id@example.invalid')
on conflict(id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.addon_admin_grant_package_v32(
 '00000000-0000-4000-8000-000000000009','T200');
select public.addon_admin_grant_package_v32(
 '00000000-0000-4000-8000-000000000010','MST1');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000009',true);
select public.addon_set_usage_mode('invoice');
do $invoice$
declare j jsonb;
begin
 j:=public.addon_verify_session_mst_v33('012345678901');
 if j->>'reason'<>'mst_profile_not_configured' or (j->>'allowed')::bool
 then raise exception 'unknown_mst_is_not_blocked'; end if;
 j:=public.addon_add_mst_profile_v33('012345678901');
 if j->>'success'<>'true' then raise exception 'add_personal_id_failed'; end if;
 j:=public.addon_verify_session_mst_v33('012345678901');
 if j->>'allowed'<>'true' or j->>'mode'<>'invoice' then
  raise exception 'invoice_profile_not_authorized'; end if;
 j:=public.addon_add_mst_profile_v33('012345678901');
 if j->>'already_linked'<>'true' then raise exception 'duplicate_profile_inserted'; end if;
 j:=public.addon_add_mst_profile_v33('0123456789');
 if j->>'success'<>'true' then raise exception 'ten_digit_not_allowed'; end if;
 j:=public.addon_add_mst_profile_v33('0123456789012');
 if j->>'success'<>'true' then raise exception 'legacy_thirteen_digit_not_allowed'; end if;
 j:=public.addon_verify_session_mst_v33('999999999999');
 if j->>'reason'<>'mst_profile_not_configured' then
  raise exception 'mismatched_portal_mst_not_blocked'; end if;
end $invoice$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
select public.addon_set_usage_mode('mst');
do $mst$
declare j jsonb;
begin
 j:=public.addon_add_mst_profile_v33('0199998888');
 if j->>'success'<>'true' then raise exception 'paid_profile_add_failed'; end if;
 begin
  perform public.addon_add_mst_profile_v33('0188889999');
  raise exception 'over_capacity_allowed';
 exception when others then
  if sqlerrm<>'mst_capacity_reached' then raise; end if;
 end;
 if (public.addon_verify_session_mst_v33('0188889999')->>'allowed')::boolean
 then raise exception 'unconfigured_mst_allowed'; end if;
end $mst$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
do $trial$
declare j jsonb;
begin
 j:=public.addon_start_mst_trial('013579246802');
 if j->>'success'<>'true' then raise exception 'twelve_digit_trial_failed'; end if;
 j:=public.addon_verify_session_mst_v33('013579246802');
 if j->>'allowed'<>'true' then raise exception 'trial_profile_unusable'; end if;
end $trial$;
rollback;

do $acl$
begin
 if has_function_privilege('anon','public.addon_verify_session_mst_v33(text)','EXECUTE')
  or has_function_privilege('anon','public.addon_add_mst_profile_v33(text)','EXECUTE')
 then raise exception 'profile_rpcs_public'; end if;
end $acl$;
select 'explicit_mst_profile_lock_and_12_digit_ids_passed' status;
