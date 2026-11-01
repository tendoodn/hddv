-- AutoTax V3.2: admin-only paginated package transaction timeline.
-- Exactly 10 purchases/admin-direct-grants per page; supports customer filters.
-- Includes archived pre-V3.2 orders as read-only historical purchases.
-- Does not change any orders, lots, payment or historical data.
create or replace function public.addon_admin_package_transactions_v32(
 p_page integer default 1,
 p_kind text default 'all',
 p_user_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
 v_page integer := greatest(1,least(coalesce(p_page,1),1000000));
 v_result jsonb;
begin
 if auth.uid() is null or not public.addon_is_admin() then
  raise exception 'admin_required';
 end if;
 if p_kind is null or p_kind not in ('all','purchase','admin_grant') then
  raise exception 'invalid_transaction_filter';
 end if;
 with events as (
  -- New purchases (including pending payments), one record per order.
  select o.id::text as event_id,'purchase'::text as event_type,
   o.user_id,u.email as customer_email,o.package_code,
   coalesce(o.package_quantity_snapshot,c.quantity) as quantity,
   c.family as family,o.amount_vnd,o.status,o.created_at as occurred_at,
   l.expires_at,null::text as admin_email,o.payment_reference,
   false as legacy
  from public.addon_orders o
  left join auth.users u on u.id=o.user_id
  left join public.addon_package_catalog c on c.code=o.package_code
  left join public.addon_package_lots l on l.order_id=o.id
  where o.package_code is not null

  union all
  -- Direct admin grants only (not trial gifts or unlock-code redemptions).
  select a.id::text,'admin_grant'::text,a.target_user_id,
   target_user.email,l.package_code,l.quantity,l.family,0::bigint,
   'granted'::text,a.created_at,l.expires_at,actor.email,
   null::text,false
  from public.addon_audit_logs a
  join public.addon_package_lots l on l.id::text=a.details->>'lot_id'
  left join auth.users target_user on target_user.id=a.target_user_id
  left join auth.users actor on actor.id=a.actor_id
  where a.action='admin_package_granted_v32'

  union all
  -- Purchases from the archived pre-V3.2 monthly/yearly system.
  select o.id::text,'purchase'::text,o.user_id,u.email,o.plan_code,
   null::integer,'legacy'::text,o.amount_vnd,o.status,
   o.created_at,null::timestamptz,null::text,o.payment_reference,true
  from autotax_backup_20261101.addon_orders o
  left join auth.users u on u.id=o.user_id
 ), filtered as (
  select * from events
  where (p_user_id is null or user_id=p_user_id)
   and (p_kind='all' or event_type=p_kind)
 ), page_rows as (
  select * from filtered order by occurred_at desc,event_id desc
  limit 10 offset ((v_page - 1) * 10)
 ), totals as (
  select count(*)::bigint as total from filtered
 )
 select jsonb_build_object(
  'page',v_page,'page_size',10,'total',t.total,
  'pages',greatest(1,ceil(t.total::numeric/10)::integer),
  'items',coalesce((
   select jsonb_agg(to_jsonb(r) order by r.occurred_at desc,r.event_id desc)
   from page_rows r
  ),'[]'::jsonb)
 ) into v_result from totals t;
 return v_result;
end $$;

revoke all on function public.addon_admin_package_transactions_v32(integer,text,uuid)
 from public,anon,authenticated;
grant execute on function public.addon_admin_package_transactions_v32(integer,text,uuid)
 to authenticated;
