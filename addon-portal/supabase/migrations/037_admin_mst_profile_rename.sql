-- Admin rename is separate from end-user rename, guarded by the existing
-- privileged addon_is_admin() check. No changes to MST entitlements or history.
begin;
create or replace function public.addon_admin_set_mst_profile_name(
 p_user_id uuid,p_mst text,p_display_name text
) returns jsonb language plpgsql security definer set search_path=''
as $body$
declare v_digits text := regexp_replace(coalesce(p_mst,''),'[^0-9]','','g');
declare v_name text := btrim(coalesce(p_display_name,''));
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_user_id is null then raise exception 'user_required'; end if;
 if v_digits !~ '^([0-9]{10}|[0-9]{12}|[0-9]{13})$' then raise exception 'invalid_mst'; end if;
 if char_length(v_name)>120 then raise exception 'invalid_display_name'; end if;
 update public.addon_mst_assignments set display_name=v_name
 where user_id=p_user_id and regexp_replace(mst,'[^0-9]','','g')=v_digits;
 if not found then raise exception 'mst_not_linked'; end if;
 return jsonb_build_object('user_id',p_user_id,'mst',v_digits,'display_name',v_name);
end;
$body$;
revoke all on function public.addon_admin_set_mst_profile_name(uuid,text,text)
 from public,anon;
grant execute on function public.addon_admin_set_mst_profile_name(uuid,text,text)
 to authenticated,service_role;
commit;
