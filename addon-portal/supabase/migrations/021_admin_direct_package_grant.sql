-- AutoTax V3.2: admin may directly grant a catalog package to a customer.
-- Safe additive migration: keeps old customer accounts, orders and private backups.
-- Every manual grant is recorded in addon_audit_logs.
create or replace function public.addon_admin_grant_package_v32(
  p_user_id uuid,
  p_package_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_package public.addon_package_catalog%rowtype;
  v_granted public.addon_package_lots%rowtype;
  v_expires timestamptz;
begin
  if v_actor is null or not public.addon_is_admin() then
    raise exception 'admin_required';
  end if;

  if p_user_id is null or not exists(
    select 1 from auth.users where id=p_user_id
  ) then
    raise exception 'customer_not_found';
  end if;

  if p_package_code is null or p_package_code !~ '^[A-Z0-9_]{2,24}$' then
    raise exception 'invalid_package_code';
  end if;

  select * into v_package
  from public.addon_package_catalog
  where code=p_package_code and active=true
  for share;
  if not found then raise exception 'package_unavailable'; end if;

  if v_package.family='mst' then
    if v_package.validity_days is distinct from 365 then
      raise exception 'mst_validity_fixed_365_days';
    end if;
    v_expires := pg_catalog.now() + interval '365 days';
  elsif v_package.family<>'invoice' then
    raise exception 'unsupported_package_family';
  end if;

  -- Admin direct grants have no charge or payment transaction.
  insert into public.addon_package_lots(
    user_id,package_code,family,quantity,remaining,
    price_snapshot,starts_at,expires_at,grant_kind
  ) values (
    p_user_id,v_package.code,v_package.family,
    v_package.quantity,v_package.quantity,0,
    pg_catalog.now(),v_expires,'gift'
  ) returning * into v_granted;

  insert into public.addon_audit_logs(
    actor_id,target_user_id,action,details
  ) values (
    v_actor,p_user_id,'admin_package_granted_v32',
    pg_catalog.jsonb_build_object(
      'lot_id',v_granted.id,
      'code',v_package.code,
      'family',v_package.family,
      'quantity',v_package.quantity,
      'starts_at',v_granted.starts_at,
      'expires_at',v_granted.expires_at
    )
  );

  return pg_catalog.jsonb_build_object(
    'success',true,
    'lot_id',v_granted.id,
    'package_code',v_package.code,
    'family',v_package.family,
    'quantity',v_package.quantity,
    'expires_at',v_granted.expires_at
  );
end $$;

revoke all on function public.addon_admin_grant_package_v32(uuid,text)
from public,anon,authenticated;
grant execute on function public.addon_admin_grant_package_v32(uuid,text)
to authenticated;
