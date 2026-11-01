-- AutoTax V3.2: hide cancelled/revoked entries from the ADMIN package
-- history UI. Never DELETE the financial orders, SePay events, entitlement
-- adjustment archive, audit trail or pre-upgrade snapshot.
create table if not exists public.addon_hidden_package_history (
 event_type text not null check (event_type in ('purchase','admin_grant')),
 event_id text not null,
 is_legacy boolean not null default false,
 hidden_at timestamptz not null default clock_timestamp(),
 hidden_by uuid not null,
 hide_reason text not null,
 primary key (event_type,event_id,is_legacy)
);
alter table public.addon_hidden_package_history enable row level security;
revoke all on public.addon_hidden_package_history from public,anon,authenticated;

-- The caller must be admin, the record must exist, and its package must
-- no longer be active. Archived ledger rows cannot be altered through RPC.
create or replace function public.addon_admin_hide_package_history_v32(
 p_event_type text,p_event_id text,p_legacy boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_reason text:=left(btrim(coalesce(p_reason,'')),500);
 v_owner uuid;
 v_code text;
 v_status text;
 v_order_id uuid;
 v_lot_id uuid;
 v_revoked boolean:=false;
 v_active boolean:=false;
 v_legacy boolean:=coalesce(p_legacy,false);
begin
 if v_actor is null or not public.addon_is_admin()
 then raise exception 'admin_required'; end if;
 if p_event_type is null or p_event_type not in ('purchase','admin_grant')
    or p_event_id is null
 then raise exception 'invalid_history_record'; end if;
 if length(v_reason)<6 then raise exception 'history_hide_reason_required'; end if;

 if p_event_type='purchase' then
  if p_event_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then raise exception 'invalid_history_record'; end if;
  v_order_id:=p_event_id::uuid;
  if v_legacy then
   select o.user_id,o.plan_code,o.status
   into v_owner,v_code,v_status
   from autotax_backup_20261101.addon_orders o
   where o.id=v_order_id;
   if not found then raise exception 'history_record_not_found'; end if;
   if v_status not in ('cancelled','canceled','refunded')
   then raise exception 'active_package_must_be_revoked_first'; end if;
  else
   select o.user_id,o.package_code,o.status
   into v_owner,v_code,v_status
   from public.addon_orders o where o.id=v_order_id for update;
   if not found or v_code is null then
    raise exception 'history_record_not_found'; end if;

   -- Serialize against restoration of a revoked lot.
   select r.lot_id into v_lot_id
   from public.addon_package_revocations r
   where r.order_id=v_order_id and r.restored_at is null
   limit 1 for update;
   v_revoked:=found;

   -- Paid or compensated packages may not be hidden while usable.
   select exists(
    select 1 from public.addon_package_lots l where l.order_id=v_order_id
   ) or exists(
    select 1 from public.addon_audit_logs a
    join public.addon_package_lots l on l.id::text=a.details->>'lot_id'
    where a.action='admin_package_compensated_v32'
      and a.details->>'order_id'=v_order_id::text
   ) into v_active;
   if v_active then raise exception 'active_package_must_be_revoked_first'; end if;
   if not v_revoked and v_status not in ('cancelled','canceled','refunded')
   then raise exception 'history_not_cancelled_or_revoked'; end if;
  end if;
 else
  if v_legacy or p_event_id !~ '^[0-9]{1,19}$'
  then raise exception 'invalid_history_record'; end if;
  select a.target_user_id,
         a.details->>'package_code',
         (a.details->>'lot_id')::uuid
  into v_owner,v_code,v_lot_id
  from public.addon_audit_logs a
  where a.id=p_event_id::bigint
    and a.action in ('admin_package_granted_v32',
                     'admin_package_compensated_v32')
  for update;
  if not found or v_lot_id is null then
   raise exception 'history_record_not_found'; end if;

  select exists(
   select 1 from public.addon_package_lots l where l.id=v_lot_id
  ) into v_active;
  if v_active then raise exception 'active_package_must_be_revoked_first'; end if;
  perform 1 from public.addon_package_revocations r
    where r.lot_id=v_lot_id and r.restored_at is null
    for update;
  if not found then raise exception 'history_not_cancelled_or_revoked'; end if;
 end if;

 insert into public.addon_hidden_package_history(
  event_type,event_id,is_legacy,hidden_by,hide_reason
 ) values(p_event_type,p_event_id,v_legacy,v_actor,v_reason)
 on conflict(event_type,event_id,is_legacy) do nothing;
 if not found then raise exception 'history_already_hidden'; end if;

 insert into public.addon_audit_logs(
  actor_id,target_user_id,action,details
 ) values(
  v_actor,v_owner,'admin_package_history_hidden_v32',
  jsonb_build_object('event_type',p_event_type,
   'event_id',p_event_id,'legacy',v_legacy,'package_code',v_code,
   'order_id',v_order_id,'lot_id',v_lot_id,
   'reason',v_reason,'original_status',v_status)
 );
 return jsonb_build_object('success',true,
  'event_type',p_event_type,'event_id',p_event_id,
  'hidden',true,'financial_records_preserved',true);
end $$;

revoke all on function public.addon_admin_hide_package_history_v32(
 text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.addon_admin_hide_package_history_v32(
 text,text,boolean,text) to authenticated;

-- UI list retains its API signature and ten-row pagination.
create or replace function public.addon_admin_package_transactions_v32(
 p_page integer default 1,p_kind text default 'all',p_user_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_page integer:=greatest(1,least(coalesce(p_page,1),1000000));
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

revoke all on function public.addon_admin_package_transactions_v32(
 integer,text,uuid) from public,anon,authenticated;
grant execute on function public.addon_admin_package_transactions_v32(
 integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
