-- Add optional account-owned MST display names without changing license/assignment logic.
-- Existing assignments, packages, invoices and audit history are preserved.
begin;
alter table public.addon_mst_assignments
 add column if not exists display_name text not null default '';
alter table public.addon_mst_assignments
 drop constraint if exists addon_mst_assignments_display_name_length;
alter table public.addon_mst_assignments
 add constraint addon_mst_assignments_display_name_length
 check (char_length(display_name)<=120);

create or replace function public.addon_set_mst_profile_name(p_mst text,p_display_name text)
returns jsonb language plpgsql security definer
set search_path = ''
as $body$
declare v_user uuid := auth.uid();
declare v_mst text := regexp_replace(coalesce(p_mst,''),'[^0-9]','','g');
declare v_name text := btrim(coalesce(p_display_name,''));
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 if v_mst !~ '^([0-9]{10}|[0-9]{12}|[0-9]{13})$' then raise exception 'invalid_mst'; end if;
 if char_length(v_name)>120 then raise exception 'invalid_display_name'; end if;
 update public.addon_mst_assignments set display_name=v_name
 where user_id=v_user and regexp_replace(mst,'[^0-9]','','g')=v_mst;
 if not found then raise exception 'mst_not_linked'; end if;
 return jsonb_build_object('mst',v_mst,'display_name',v_name);
end;
$body$;
revoke all on function public.addon_set_mst_profile_name(text,text) from public,anon;
grant execute on function public.addon_set_mst_profile_name(text,text) to authenticated, service_role;

create or replace function public.addon_list_my_mst_assignments()
returns jsonb language plpgsql stable security definer
set search_path to 'public','auth'
as $body$
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 return coalesce(
  (select jsonb_agg(jsonb_build_object(
     'id',id,'mst',mst,'display_name',display_name,'assigned_at',assigned_at
  ) order by assigned_at,id)
  from public.addon_mst_assignments where user_id=auth.uid()),'[]'::jsonb);
end;
$body$;

create or replace function public.addon_admin_list_mst_assignments(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path to 'public','auth'
as $body$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'id',a.id,'user_id',a.user_id,'email',u.email,'mst',a.mst,
 'display_name',a.display_name,'assigned_at',a.assigned_at)
 order by a.assigned_at,a.id)
 from public.addon_mst_assignments a join auth.users u on u.id=a.user_id
 where p_user_id is null or a.user_id=p_user_id),'[]'::jsonb);
end;
$body$;
commit;
