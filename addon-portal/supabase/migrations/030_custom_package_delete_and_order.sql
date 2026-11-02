-- AutoTax 3.3.7: separate protected default packages from custom packages.
-- Custom packages can be deleted if unused or archived when referenced by financial history.
alter table public.addon_package_catalog
 add column if not exists archived_at timestamptz;

create or replace function public.addon_admin_list_packages()
returns jsonb language plpgsql stable security definer set search_path = public, auth
as $$
begin
 if auth.uid() is null or not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'code',p.code,'family',p.family,'name',p.name,'quantity',p.quantity,
   'price_vnd',p.price_vnd,'description',p.description,'active',p.active,
   'validity_days',p.validity_days,'is_custom',
     p.code <> all(array['T100','T200','T500','T1000','T5000',
                        'MST1','MST5','MST10','MST20','MST50'])
  ) order by
   case p.code
    when 'T100' then 1 when 'T200' then 2 when 'T500' then 3
    when 'T1000' then 4 when 'T5000' then 5
    when 'MST1' then 6 when 'MST5' then 7 when 'MST10' then 8
    when 'MST20' then 9 when 'MST50' then 10 else 100 end,
   p.created_at, p.code)
  from public.addon_package_catalog p where p.archived_at is null
 ),'[]'::jsonb);
end;
$$;

create or replace function public.addon_admin_delete_custom_package(p_code text)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_package public.addon_package_catalog%rowtype;
 v_used boolean;
 v_mode text;
begin
 if auth.uid() is null or not public.addon_is_admin() then
  raise exception 'admin_required';
 end if;
 if p_code = any(array['T100','T200','T500','T1000','T5000',
                       'MST1','MST5','MST10','MST20','MST50']) then
  raise exception 'default_package_cannot_be_deleted';
 end if;
 select * into v_package from public.addon_package_catalog
  where code=p_code for update;
 if not found then raise exception 'package_not_found'; end if;
 if v_package.archived_at is not null then return jsonb_build_object('mode','already_archived'); end if;
 select
  exists(select 1 from public.addon_orders where package_code=p_code)
  or exists(select 1 from public.addon_package_lots where package_code=p_code)
  or exists(select 1 from public.addon_package_unlock_codes where package_code=p_code)
  or exists(select 1 from public.addon_package_revocations where package_code=p_code)
  into v_used;
 if v_used then
  update public.addon_package_catalog
   set active=false,archived_at=now(),updated_at=now() where code=p_code;
  v_mode='archived';
 else
  delete from public.addon_package_catalog where code=p_code;
  v_mode='deleted';
 end if;
 insert into public.addon_audit_logs(actor_id,action,details)
  values(auth.uid(),'custom_package_removed',
   jsonb_build_object('code',p_code,'mode',v_mode,'had_history',v_used));
 return jsonb_build_object('code',p_code,'mode',v_mode,'history_preserved',v_used);
end;
$$;
revoke all on function public.addon_admin_delete_custom_package(text) from public, anon;
grant execute on function public.addon_admin_delete_custom_package(text) to authenticated;

create or replace function public.addon_admin_set_package_active(p_code text,p_active boolean)
returns void language plpgsql security definer set search_path=public, auth
as $$
begin
 if auth.uid() is null or not public.addon_is_admin() then raise exception 'admin_required'; end if;
 update public.addon_package_catalog set active=p_active,updated_at=now()
  where code=p_code and archived_at is null;
 if not found then raise exception 'package_not_found_or_archived'; end if;
 insert into public.addon_audit_logs(actor_id,action,details)
  values(auth.uid(),'package_active_changed',
   jsonb_build_object('code',p_code,'active',p_active));
end;
$$;

-- Existing public package listings already filter active. Archived packages are also inactive.
