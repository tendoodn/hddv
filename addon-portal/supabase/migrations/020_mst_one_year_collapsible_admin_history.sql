-- AutoTax V3.2 POST-UPGRADE. Run ONCE after production upgrade.
-- No reset, no DROP CASCADE, no changes to auth.users or addon_admins.
-- MST packages are valid for exactly 365 days after activation.
begin;

do $check$
begin
 if to_regclass('public.addon_package_catalog') is null
    or to_regclass('public.addon_package_lots') is null
    or to_regclass('autotax_backup_20261101._manifest') is null
 then raise exception 'v32_required_tables_missing_stop'; end if;
end $check$;

update public.addon_package_catalog
set validity_days=365,updated_at=now()
where family='mst' and validity_days is distinct from 365;

do $constraint$
begin
 if not exists (
  select 1 from pg_constraint
  where conrelid='public.addon_package_catalog'::regclass
    and conname='addon_package_catalog_mst_365_days_check'
 ) then
  alter table public.addon_package_catalog
   add constraint addon_package_catalog_mst_365_days_check
   check (family <> 'mst' or validity_days=365);
 end if;
end $constraint$;

-- Admin may edit price and active status but MST validity is fixed at 365 days.
create or replace function public.addon_admin_set_package_terms(
 p_code text,p_validity_days integer
) returns void language plpgsql security definer set search_path=public,auth as $$
declare v_family text;
begin
 if auth.uid() is null or not public.addon_is_admin() then raise exception 'admin_required'; end if;
 select family into v_family from public.addon_package_catalog where code=p_code for update;
 if not found then raise exception 'package_not_found'; end if;
 if v_family='mst' and p_validity_days is not null and p_validity_days<>365
 then raise exception 'mst_validity_fixed_365_days'; end if;
 if v_family='invoice' and p_validity_days is not null
 then raise exception 'invoice_package_has_no_expiry'; end if;
 update public.addon_package_catalog
 set validity_days=case when v_family='mst' then 365 else null end,
     updated_at=now()
 where code=p_code;
 insert into public.addon_audit_logs(actor_id,action,details)
 values(auth.uid(),'package_terms_changed',
  jsonb_build_object('code',p_code,'validity_days',
   case when v_family='mst' then 365 else null end));
end $$;

create or replace function public.addon_admin_create_package(
 p_code text,p_family text,p_name text,p_quantity integer,
 p_price_vnd bigint,p_description text,p_validity_days integer default null
) returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if auth.uid() is null or not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_code !~ '^[A-Z0-9_]{2,24}$' or p_family not in ('invoice','mst')
    or p_quantity is null or p_quantity<1
    or p_price_vnd is null or p_price_vnd<0
    or p_name is null or btrim(p_name)='' then
  raise exception 'invalid_package';
 end if;
 if p_family='mst' and p_validity_days is not null and p_validity_days<>365
 then raise exception 'mst_validity_fixed_365_days'; end if;
 if p_family='invoice' and p_validity_days is not null
 then raise exception 'invoice_package_has_no_expiry'; end if;
 insert into public.addon_package_catalog(
  code,family,name,quantity,price_vnd,description,validity_days)
 values(p_code,p_family,p_name,p_quantity,p_price_vnd,
  coalesce(p_description,''),
  case when p_family='mst' then 365 else null end);
 insert into public.addon_audit_logs(actor_id,action,details)
 values(auth.uid(),'package_created',
  jsonb_build_object('code',p_code,'family',p_family,
   'quantity',p_quantity,'price_vnd',p_price_vnd,
   'validity_days',case when p_family='mst' then 365 else null end));
end $$;

-- Preserve client access to admin features only after an admin identity check.
revoke all on function public.addon_admin_set_package_terms(text,integer)
 from public,anon;
grant execute on function public.addon_admin_set_package_terms(text,integer)
 to authenticated;
revoke all on function public.addon_admin_create_package(
 text,text,text,integer,bigint,text,integer)
 from public,anon;
grant execute on function public.addon_admin_create_package(
 text,text,text,integer,bigint,text,integer)
 to authenticated;

-- Read-only ADMIN-ONLY full history, including both new V3.2 records and
-- legacy orders/subscriptions preserved in the private pre-upgrade snapshot.
-- The function returns nothing to non-admin users; backup tables stay private.
create or replace function public.addon_admin_list_package_history_v32()
returns jsonb language plpgsql stable security definer
set search_path=public,auth as $$
declare v_history jsonb;
begin
 if auth.uid() is null or not public.addon_is_admin() then
  raise exception 'admin_required';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'kind',h.kind,'email',h.email,'code',h.code,'family',h.family,
  'quantity',h.quantity,'remaining',h.remaining,'amount_vnd',h.amount_vnd,
  'grant_kind',h.grant_kind,'status',h.status,'event_at',h.event_at,
  'expires_at',h.expires_at,'reference',h.reference,'legacy',h.legacy
 ) order by h.event_at desc,h.sort_id desc),'[]'::jsonb)
 into v_history
 from (
  -- New package lots: paid purchases, gifts, unlocks and seven-day trials.
  select 'lot'::text kind,u.email,l.package_code code,l.family,
   l.quantity,l.remaining,l.price_snapshot amount_vnd,l.grant_kind,
   case when l.expires_at is not null and l.expires_at<=now() then 'expired'
        when l.family='invoice' and l.remaining=0 then 'used_up'
        else 'active' end::text status,
   l.created_at event_at,l.expires_at,o.payment_reference reference,
   false legacy,l.id::text sort_id
  from public.addon_package_lots l
  left join auth.users u on u.id=l.user_id
  left join public.addon_orders o on o.id=l.order_id

  union all
  -- Pending/failed/current orders not represented by granted lots.
  select 'order'::text,u.email,o.package_code,p.family,
   o.package_quantity_snapshot,null::integer,o.amount_vnd,
   null::text,o.status,o.created_at,null::timestamptz,
   o.payment_reference,false,o.id::text
  from public.addon_orders o
  left join auth.users u on u.id=o.user_id
  left join public.addon_package_catalog p on p.code=o.package_code
  where not exists(
   select 1 from public.addon_package_lots l where l.order_id=o.id
  )

  union all
  -- Archived pre-V3.2 billing orders remain visible as history only.
  select 'legacy_order'::text,u.email,o.plan_code,'legacy'::text,
   null::integer,null::integer,o.amount_vnd,null::text,o.status,
   o.created_at,null::timestamptz,o.payment_reference,true,o.id::text
  from autotax_backup_20261101.addon_orders o
  left join auth.users u on u.id=o.user_id

  union all
  -- Archived monthly/yearly subscriptions (historical; never reactivated).
  select 'legacy_subscription'::text,u.email,s.plan_code,'legacy'::text,
   null::integer,null::integer,null::bigint,s.source,s.status,
   s.created_at,s.ends_at,null::text,true,s.id::text
  from autotax_backup_20261101.addon_subscriptions s
  left join auth.users u on u.id=s.user_id
 ) h;
 return v_history;
end $$;

revoke all on function public.addon_admin_list_package_history_v32()
 from public,anon,authenticated;
grant execute on function public.addon_admin_list_package_history_v32()
 to authenticated;

-- Ensure no active MST listing is offered without the one-year validity.
do $verify$
begin
 if exists (
  select 1 from public.addon_package_catalog
  where family='mst' and validity_days is distinct from 365
 ) then raise exception 'mst_365_configuration_failed'; end if;
end $verify$;

commit;

select code,family,validity_days,active
from public.addon_package_catalog
where family='mst' order by quantity,code;
