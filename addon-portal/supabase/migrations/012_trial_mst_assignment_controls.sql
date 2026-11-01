-- AutoTax V3.2: MST assignment management and one-time trial safeguards.
-- Apply AFTER 011. This migration does NOT grant trial packages.
alter table public.addon_package_lots
 add column if not exists grant_kind text not null default 'paid'
 check (grant_kind in ('paid','gift','trial'));

create table if not exists public.addon_trial_email_registry(
 email_normalized text primary key,
 first_user_id uuid,
 claimed_at timestamptz not null default now()
);
create table if not exists public.addon_trial_mst_registry(
 mst text primary key,
 first_user_id uuid,
 claimed_at timestamptz not null default now()
);
alter table public.addon_trial_email_registry enable row level security;
alter table public.addon_trial_mst_registry enable row level security;
-- No direct table policies. Only SECURITY DEFINER RPCs may access registries.

-- Reserved for a future trusted trial issuer. A service-role caller needs an explicit
-- target-user implementation; do NOT expose this auth.uid()-based function as a public RPC.
-- A trial issuer MUST reserve identity atomically with issuing a trial lot.
-- Records survive removal of an assignment; neither registry is cascaded on user deletion.
create or replace function public.addon_reserve_trial_identity(p_mst text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); e text; m text;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select lower(btrim(email)) into e from auth.users where id=u;
 m:=upper(regexp_replace(coalesce(p_mst,''),'\\s','','g'));
 if e is null or e='' or m='' then raise exception 'trial_identity_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('trial:'||e,0));
 perform pg_advisory_xact_lock(hashtextextended('trial:'||m,1));
 if exists(select 1 from public.addon_trial_email_registry where email_normalized=e) then
  raise exception 'trial_email_already_used';
 end if;
 if exists(select 1 from public.addon_trial_mst_registry where mst=m) then
  raise exception 'trial_mst_already_used';
 end if;
 insert into public.addon_trial_email_registry(email_normalized,first_user_id) values(e,u);
 insert into public.addon_trial_mst_registry(mst,first_user_id) values(m,u);
end $$;

create or replace function public.addon_authorize_mst(p_mst text) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); cap integer; assigned_rank bigint; existing_id bigint;
 m text; trial_only boolean;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'mst' then
  return jsonb_build_object('allowed',false,'reason','mst_mode_not_selected');
 end if;
 m:=upper(regexp_replace(coalesce(p_mst,''),'\\s','','g'));
 if m='' then raise exception 'mst_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select coalesce(sum(quantity),0)::int into cap from public.addon_package_lots
 where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 if cap=0 then return jsonb_build_object('allowed',false,'reason','mst_package_expired','capacity',0); end if;
 select not exists(select 1 from public.addon_package_lots where user_id=u and family='mst'
   and grant_kind<>'trial' and (expires_at is null or expires_at>now())) into trial_only;
 select id into existing_id from public.addon_mst_assignments where user_id=u and mst=m;
 if existing_id is null then
  if (select count(*) from public.addon_mst_assignments where user_id=u)>=cap then
   return jsonb_build_object('allowed',false,'reason','mst_capacity_reached','capacity',cap);
  end if;
  if trial_only then
   -- Trial issuance must have reserved the identity; no cross-account reuse.
   if not exists(select 1 from public.addon_trial_mst_registry where mst=m and first_user_id=u) then
    return jsonb_build_object('allowed',false,'reason','trial_mst_not_reserved');
   end if;
  end if;
  insert into public.addon_mst_assignments(user_id,mst) values(u,m) returning id into existing_id;
 end if;
 select count(*) into assigned_rank from public.addon_mst_assignments where user_id=u and id<=existing_id;
 return jsonb_build_object('allowed',assigned_rank<=cap,
  'reason',case when assigned_rank<=cap then 'ok' else 'mst_capacity_reduced' end,
  'capacity',cap,'assigned_rank',assigned_rank);
end $$;

create or replace function public.addon_list_my_mst_assignments() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'mst',mst,'assigned_at',assigned_at)
  order by assigned_at,id) from public.addon_mst_assignments where user_id=auth.uid()),'[]'::jsonb);
end $$;

create or replace function public.addon_admin_list_mst_assignments(p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,
 'email',u.email,'mst',a.mst,'assigned_at',a.assigned_at) order by a.assigned_at,a.id)
 from public.addon_mst_assignments a join auth.users u on u.id=a.user_id
 where p_user_id is null or a.user_id=p_user_id),'[]'::jsonb);
end $$;

create or replace function public.addon_unlink_mst(p_mst text,p_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare actor uuid:=auth.uid(); target uuid; m text; deleted_count int; admin_mode boolean;
begin
 if actor is null then raise exception 'authentication_required'; end if;
 admin_mode:=public.addon_is_admin();
 target:=coalesce(p_user_id,actor);
 if target<>actor and not admin_mode then raise exception 'admin_required'; end if;
 if not admin_mode then
  if not exists(select 1 from public.addon_package_lots where user_id=target and family='mst'
   and (expires_at is null or expires_at>now())) then
   raise exception 'mst_unlink_requires_active_package';
  end if;
 end if;
 m:=upper(regexp_replace(coalesce(p_mst,''),'\\s','','g'));
 if m='' then raise exception 'mst_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 delete from public.addon_mst_assignments where user_id=target and mst=m;
 get diagnostics deleted_count=row_count;
 if deleted_count=0 then raise exception 'mst_assignment_not_found'; end if;
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(actor,target,'mst_assignment_removed',jsonb_build_object('mst',m,'by_admin',admin_mode));
 -- Historical trial identity remains reserved, preventing trial farming.
 return jsonb_build_object('success',true,'mst',m);
end $$;

revoke all on function public.addon_reserve_trial_identity(text) from public,anon;
revoke all on function public.addon_authorize_mst(text) from public,anon;
revoke all on function public.addon_list_my_mst_assignments() from public,anon;
revoke all on function public.addon_admin_list_mst_assignments(uuid) from public,anon;
revoke all on function public.addon_unlink_mst(text,uuid) from public,anon;
-- Trial issuance must be a trusted server-side operation; never expose reservation to end users.
grant execute on function public.addon_reserve_trial_identity(text) to service_role;
grant execute on function public.addon_authorize_mst(text) to authenticated;
grant execute on function public.addon_list_my_mst_assignments() to authenticated;
grant execute on function public.addon_admin_list_mst_assignments(uuid) to authenticated;
grant execute on function public.addon_unlink_mst(text,uuid) to authenticated;
