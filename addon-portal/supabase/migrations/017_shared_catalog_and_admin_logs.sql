-- AutoTax V3.2: public package catalog and admin audit use shared backend data.
-- Deploy after 016_admin_customer_v32_snapshot.sql.
create or replace function public.addon_list_packages()
returns jsonb
language sql stable security definer
set search_path=public,auth as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'code',code,'family',family,'name',name,'quantity',quantity,
  'price_vnd',price_vnd,'description',description,
  'validity_days',validity_days
 ) order by family,quantity,code),'[]'::jsonb)
 from public.addon_package_catalog where active;
$$;
revoke all on function public.addon_list_packages() from public,anon;
grant execute on function public.addon_list_packages() to authenticated;

create or replace function public.addon_admin_list_logs(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,auth
as $$
begin
 if auth.uid() is null or not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',x.id,'action',x.action,'details',x.details,
   'created_at',x.created_at,'actor_email',x.actor_email,
   'target_email',x.target_email
  ) order by x.created_at desc,x.id desc)
  from (
   select l.id,l.action,l.details,l.created_at,
    a.email as actor_email,t.email as target_email
   from public.addon_audit_logs l
   left join auth.users a on a.id=l.actor_id
   left join auth.users t on t.id=l.target_user_id
   order by l.created_at desc,l.id desc
   limit least(greatest(coalesce(p_limit,100),1),500)
  ) x
 ),'[]'::jsonb);
end $$;
revoke all on function public.addon_admin_list_logs(integer) from public,anon;
grant execute on function public.addon_admin_list_logs(integer) to authenticated;
