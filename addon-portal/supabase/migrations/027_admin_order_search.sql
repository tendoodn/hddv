-- V3.2 additive admin search: order UUID, ADDON payment reference and
-- SePay transaction ID. Keeps the existing 3-argument RPC for cached clients.
-- Search is applied before pagination and hidden-history rules still apply.
create or replace function public.addon_admin_search_package_transactions_v32(
 p_page integer default 1,p_kind text default 'all',p_user_id uuid default null,
 p_order_query text default ''
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_page integer:=greatest(1,least(coalesce(p_page,1),1000000));
 v_search text:=lower(left(btrim(coalesce(p_order_query,'')),128));
 v_result jsonb;
begin
 if auth.uid() is null or not public.addon_is_admin() then
  raise exception 'admin_required'; end if;
 if p_kind is null or p_kind not in ('all','purchase','admin_grant')
 then raise exception 'invalid_transaction_filter'; end if;
 with events as (
  select o.id::text event_id,'purchase'::text event_type,
   o.user_id,u.email customer_email,o.package_code,
   coalesce(o.package_quantity_snapshot,c.quantity) quantity,
   c.family,o.amount_vnd,
   case when rev.lot_id is not null then 'revoked' else o.status end::text status,
   o.created_at occurred_at,
   coalesce(l.expires_at,(rev.lot_snapshot->>'expires_at')::timestamptz) expires_at,
   null::text admin_email,o.payment_reference,false legacy,
   o.id::text order_id,
   coalesce(e.provider_event_id,o.payment_reference) transaction_code,
   e.provider_event_id as bank_event_code,
   coalesce(l.id,rev.lot_id)::text lot_id,
   (rev.lot_id is not null) revoked,rev.revoked_at,rev.revoke_reason,
   null::text admin_action
  from public.addon_orders o
  left join auth.users u on u.id=o.user_id
  left join public.addon_package_catalog c on c.code=o.package_code
  left join public.addon_package_lots l on l.order_id=o.id
  left join public.addon_package_revocations rev on rev.order_id=o.id and rev.restored_at is null
  left join lateral (
   select pe.provider_event_id from public.addon_payment_events pe
   where pe.order_id=o.id order by pe.created_at desc,pe.id desc limit 1
  ) e on true
  where o.package_code is not null

  union all
  select a.id::text,'admin_grant'::text,a.target_user_id,
   target.email,coalesce(l.package_code,rev.package_code),
   coalesce(l.quantity,(rev.lot_snapshot->>'quantity')::integer),
   coalesce(l.family,rev.lot_snapshot->>'family'),0::bigint,
   case when rev.lot_id is not null then 'revoked' else 'granted' end::text,
   a.created_at,
   coalesce(l.expires_at,(rev.lot_snapshot->>'expires_at')::timestamptz),
   actor.email,null::text,false,
   a.details->>'order_id',
   'ADMIN-'||a.id::text,null::text,
   coalesce(l.id,rev.lot_id)::text,
   rev.lot_id is not null,rev.revoked_at,rev.revoke_reason,
   a.action
  from public.addon_audit_logs a
  left join public.addon_package_lots l on l.id::text=a.details->>'lot_id'
  left join public.addon_package_revocations rev on
    rev.lot_id::text=a.details->>'lot_id' and rev.restored_at is null
  left join auth.users target on target.id=a.target_user_id
  left join auth.users actor on actor.id=a.actor_id
  where a.action in ('admin_package_granted_v32','admin_package_compensated_v32')
    and (l.id is not null or rev.lot_id is not null)

  union all
  select o.id::text,'purchase'::text,o.user_id,u.email,o.plan_code,
   null::integer,'legacy'::text,o.amount_vnd,o.status,o.created_at,
   null::timestamptz,null::text,o.payment_reference,true,
   o.id::text,
   coalesce(pe.provider_event_id,o.payment_reference),pe.provider_event_id,
   null::text,false,null::timestamptz,null::text,null::text
  from autotax_backup_20261101.addon_orders o
  left join auth.users u on u.id=o.user_id
  left join lateral (
   select e.provider_event_id from autotax_backup_20261101.addon_payment_events e
   where e.order_id=o.id order by e.created_at desc,e.id desc limit 1
  ) pe on true
 ), eligible as (
  select e.*,
   (
    (e.event_type='admin_grant' and e.revoked and e.lot_id is not null)
    or
    (e.event_type='purchase' and (
      (e.revoked and e.lot_id is not null)
      or
      (e.status in ('cancelled','canceled','refunded')
       and e.lot_id is null
       and (e.legacy or not exists (
        select 1 from public.addon_audit_logs a
        join public.addon_package_lots l on l.id::text=a.details->>'lot_id'
        where a.action='admin_package_compensated_v32'
          and a.details->>'order_id'=e.order_id
       )))
    ))
   ) as can_hide
  from events e
 ), filtered as (
  select * from eligible e
  where (p_user_id is null or e.user_id=p_user_id)
    and (p_kind='all' or e.event_type=p_kind)
    -- Filter BEFORE pagination, allow partial UUID, transfer reference and SePay code.
    and (
      v_search='' or
      strpos(lower(coalesce(e.order_id,'')),v_search)>0 or
      strpos(lower(coalesce(e.payment_reference,'')),v_search)>0 or
      strpos(lower(coalesce(e.transaction_code,'')),v_search)>0 or
      strpos(lower(coalesce(e.event_id,'')),v_search)>0
    )
    and not exists (
     select 1 from public.addon_hidden_package_history h
     where h.event_type=e.event_type
       and h.event_id=e.event_id
       and h.is_legacy=e.legacy
       and e.can_hide
    )
 ), page_rows as (
  select * from filtered order by occurred_at desc,event_id desc
  limit 10 offset ((v_page-1)*10)
 ), totals as (
  select count(*)::bigint total from filtered
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


revoke all on function public.addon_admin_search_package_transactions_v32(integer,text,uuid,text)
 from public,anon,authenticated;
grant execute on function public.addon_admin_search_package_transactions_v32(integer,text,uuid,text)
 to authenticated;
notify pgrst,'reload schema';
