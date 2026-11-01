-- AutoTax 3.3: explicit MST profiles and read-only session MST authorization.
-- Keep current entitlements, quota and trial identities; do not auto-enroll a GDT session.
-- 10-digit organization tax IDs; 12-digit personal identity; legacy 13-digit branch tax IDs.

create or replace function public.addon_add_mst_profile_v33(p_mst text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid := auth.uid();
 v_mst text := regexp_replace(coalesce(p_mst,''),'[^0-9]','','g');
 v_mode text;
 v_capacity int;
 v_count int;
 v_trial_only boolean;
 v_invoice_allowed boolean;
 v_assignment_id bigint;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if v_mst !~ '^([0-9]{10}|[0-9]{12}|[0-9]{13})$' then
  raise exception 'invalid_mst'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 select coalesce((select mode from public.addon_usage_modes where user_id=v_user),
   (case when exists(select 1 from public.addon_package_lots
      where user_id=v_user and family='invoice')
       and not exists(select 1 from public.addon_package_lots
      where user_id=v_user and family='mst' and (expires_at is null or expires_at>now()))
      then 'invoice' else 'mst' end)
 ) into v_mode;
 if exists(select 1 from public.addon_mst_assignments
  where user_id=v_user and mst=v_mst) then
   return jsonb_build_object('success',true,'mst',v_mst,'already_linked',true);
 end if;
 if v_mode='invoice' then
  select exists(select 1 from public.addon_package_lots
   where user_id=v_user and family='invoice' and remaining>0)
   or exists(select 1 from public.addon_invoice_deductions where user_id=v_user)
    into v_invoice_allowed;
  if not v_invoice_allowed then raise exception 'invoice_package_required'; end if;
  -- Bound records while not equating invoice quota with MST package capacity.
  select count(*) into v_count from public.addon_mst_assignments where user_id=v_user;
  if v_count>=100 then raise exception 'mst_profile_limit_reached'; end if;
 else
  select coalesce(sum(quantity),0)::int into v_capacity
  from public.addon_package_lots where user_id=v_user and family='mst'
   and (expires_at is null or expires_at>now());
  if v_capacity=0 then raise exception 'mst_package_expired'; end if;
  select count(*) into v_count from public.addon_mst_assignments where user_id=v_user;
  if v_count>=v_capacity then raise exception 'mst_capacity_reached'; end if;
  select not exists(select 1 from public.addon_package_lots
   where user_id=v_user and family='mst' and grant_kind<>'trial'
    and (expires_at is null or expires_at>now())) into v_trial_only;
  if v_trial_only and not exists(select 1 from public.addon_trial_mst_registry
   where mst=v_mst and first_user_id=v_user)
  then raise exception 'trial_mst_not_reserved'; end if;
 end if;
 insert into public.addon_mst_assignments(user_id,mst)
 values(v_user,v_mst) returning id into v_assignment_id;
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(v_user,v_user,'mst_profile_added_v33',
  jsonb_build_object('mst',v_mst,'id',v_assignment_id,'mode',v_mode));
 return jsonb_build_object('success',true,'mst',v_mst,'already_linked',false);
end $$;
revoke all on function public.addon_add_mst_profile_v33(text)
 from public,anon,authenticated;
grant execute on function public.addon_add_mst_profile_v33(text) to authenticated;

create or replace function public.addon_verify_session_mst_v33(p_mst text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid();
 v_mst text:=regexp_replace(coalesce(p_mst,''),'[^0-9]','','g');
 v_mode text;
 v_capacity int;
 v_rank bigint;
 v_invoice_allowed boolean;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if v_mst !~ '^([0-9]{10}|[0-9]{12}|[0-9]{13})$' then
  return jsonb_build_object('allowed',false,'reason','invalid_mst','mst',v_mst);
 end if;
 if not exists(select 1 from public.addon_mst_assignments
    where user_id=v_user and mst=v_mst) then
  return jsonb_build_object('allowed',false,'reason','mst_profile_not_configured','mst',v_mst);
 end if;
 select coalesce((select mode from public.addon_usage_modes where user_id=v_user),
   (case when exists(select 1 from public.addon_package_lots
       where user_id=v_user and family='invoice')
    and not exists(select 1 from public.addon_package_lots
       where user_id=v_user and family='mst' and (expires_at is null or expires_at>now()))
    then 'invoice' else 'mst' end)) into v_mode;
 if v_mode='invoice' then
  select exists(select 1 from public.addon_package_lots
   where user_id=v_user and family='invoice' and remaining>0)
   or exists(select 1 from public.addon_invoice_deductions where user_id=v_user)
   into v_invoice_allowed;
  return jsonb_build_object('allowed',v_invoice_allowed,'mode',v_mode,'mst',v_mst,
    'reason',case when v_invoice_allowed then 'ok' else 'invoice_package_required' end);
 end if;
 select coalesce(sum(quantity),0)::int into v_capacity
 from public.addon_package_lots where user_id=v_user and family='mst'
  and (expires_at is null or expires_at>now());
 if v_capacity=0 then
  return jsonb_build_object('allowed',false,'mode','mst','mst',v_mst,
   'reason','mst_package_expired','capacity',0);
 end if;
 select count(*) into v_rank from public.addon_mst_assignments
 where user_id=v_user and id<=(
  select id from public.addon_mst_assignments where user_id=v_user and mst=v_mst);
 return jsonb_build_object('allowed',v_rank<=v_capacity,'mode','mst','mst',v_mst,
   'capacity',v_capacity,'assigned_rank',v_rank,
   'reason',case when v_rank<=v_capacity then 'ok' else 'mst_capacity_reduced' end);
end $$;
revoke all on function public.addon_verify_session_mst_v33(text)
 from public,anon,authenticated;
grant execute on function public.addon_verify_session_mst_v33(text) to authenticated;

-- Self-service removal works even when the paid package expires.
-- Audit and old invoice/trial history remain intact.
create or replace function public.addon_remove_mst_profile_v33(p_mst text)
returns jsonb language plpgsql security definer set search_path='' as $
declare
 v_user uuid:=auth.uid();
 v_mst text:=regexp_replace(coalesce(p_mst,''),'[^0-9]','','g');
 v_count int;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if v_mst !~ '^([0-9]{10}|[0-9]{12}|[0-9]{13})
-- The V3.2 12-digit migration may already have expanded either function.
do $extend_mst$
declare
 v_fn text;
 v_def text;
 v_old text := '^[0-9]{10}([0-9]{3})?$';
 v_new text := '^([0-9]{10}|[0-9]{12}|[0-9]{13})$';
 v_already_expanded text := '^[0-9]{10}([0-9]{2}|[0-9]{3})?$';
begin
 foreach v_fn in array array['addon_start_mst_trial(text)','addon_authorize_mst(text)'] loop
  select pg_get_functiondef(('public.'||v_fn)::regprocedure) into v_def;
  if position(v_old in v_def)>0 then
    execute replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)>0 or position(v_already_expanded in v_def)>0 then
    null; -- Previous additive migration already added 12-digit support.
  else
    raise exception 'mst_validation_pattern_not_found_in_%',v_fn;
  end if;
 end loop;
end $extend_mst$;
notify pgrst,'reload schema';
 then
  raise exception 'invalid_mst'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 delete from public.addon_mst_assignments where user_id=v_user and mst=v_mst;
 get diagnostics v_count=row_count;
 if v_count=0 then raise exception 'mst_assignment_not_found'; end if;
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(v_user,v_user,'mst_profile_removed_v33',jsonb_build_object('mst',v_mst));
 return jsonb_build_object('success',true,'mst',v_mst);
end $;
revoke all on function public.addon_remove_mst_profile_v33(text)
 from public,anon,authenticated;
grant execute on function public.addon_remove_mst_profile_v33(text) to authenticated;

-- Personal 12-digit IDs and legacy 13-digit branch MSTs stay supported.
-- The V3.2 12-digit migration may already have expanded either function.
do $extend_mst$
declare
 v_fn text;
 v_def text;
 v_old text := '^[0-9]{10}([0-9]{3})?$';
 v_new text := '^([0-9]{10}|[0-9]{12}|[0-9]{13})$';
 v_already_expanded text := '^[0-9]{10}([0-9]{2}|[0-9]{3})?$';
begin
 foreach v_fn in array array['addon_start_mst_trial(text)','addon_authorize_mst(text)'] loop
  select pg_get_functiondef(('public.'||v_fn)::regprocedure) into v_def;
  if position(v_old in v_def)>0 then
    execute replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)>0 or position(v_already_expanded in v_def)>0 then
    null; -- Previous additive migration already added 12-digit support.
  else
    raise exception 'mst_validation_pattern_not_found_in_%',v_fn;
  end if;
 end loop;
end $extend_mst$;
notify pgrst,'reload schema';
