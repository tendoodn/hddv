-- Isolated SQL smoke: 12-digit MST works for trial and authorization.
-- Preserve legacy 13-digit MST support; no permanent test user is created.
begin;
insert into auth.users(id,email)
values('00000000-0000-4000-8000-000000000010','v32-trial-twelve@example.invalid')
on conflict(id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000010',true);
do $twelve$
declare j jsonb;
begin
 j:=public.addon_start_mst_trial('123456789012');
 if j->>'mst'<>'123456789012' or j->>'days'<>'7'
 then raise exception 'twelve_digit_trial_not_granted'; end if;
 j:=public.addon_authorize_mst('123456789012');
 if j->>'allowed'<>'true'
 then raise exception 'twelve_digit_authorization_not_allowed'; end if;
 begin
  perform public.addon_start_mst_trial('123456789012');
  raise exception 'repeat_trial_unexpectedly_allowed';
 exception when others then
  if sqlerrm<>'trial_email_already_used' then raise; end if;
 end;
 -- Existing 13-digit branches must still be recognized by the backend.
 j:=public.addon_authorize_mst('1234567890123');
 if j is null or j->>'reason'='invalid_mst' then
  raise exception 'legacy_thirteen_digit_mst_rejected';
 end if;
end $twelve$;
rollback;
select 'twelve_digit_mst_trial_and_auth_passed' as status;
