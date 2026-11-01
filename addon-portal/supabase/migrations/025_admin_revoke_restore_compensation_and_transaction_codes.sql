-- AutoTax V3.2: private revocation ledger, reversible entitlement grants,
-- failed/refunded order compensation and auditable 10-row transaction history.
-- Never delete or rewrite the original sale, bank payment, or legacy backup.
-- A revoked lot is removed from active entitlements and preserved verbatim here.

create table if not exists public.addon_package_revocations (
 lot_id uuid primary key,
 user_id uuid not null,
 order_id uuid,
 package_code text not null,
 lot_snapshot jsonb not null,
 revoked_at timestamptz not null,
 revoked_by uuid not null,
 revoke_reason text not null,
 restored_at timestamptz,
 restored_by uuid,
 restore_reason text
);
create index if not exists addon_package_revocations_order_id_idx
 on public.addon_package_revocations(order_id);
create index if not exists addon_package_revocations_user_id_idx
 on public.addon_package_revocations(user_id);
alter table public.addon_package_revocations enable row level security;
revoke all on public.addon_package_revocations from public,anon,authenticated;

-- Revoke or restore precisely one live package lot. Row-level snapshots preserve
-- remaining invoice credits and the original MST expiry; restore NEVER resets time.
create or replace function public.addon_admin_adjust_package_lot_v32(
 p_lot_id uuid,p_action text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_reason text:=left(btrim(coalesce(p_reason,'')),500);
 v_lot public.addon_package_lots%rowtype;
 v_saved public.addon_package_revocations%rowtype;
 v_snapshot jsonb;
 v_user uuid;
 v_now timestamptz:=clock_timestamp();
begin
 if v_actor is null or not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_lot_id is null or p_action not in ('revoke','restore') then
  raise exception 'invalid_package_action';
 end if;
 if length(v_reason)<6 then raise exception 'adjustment_reason_required'; end if;

 if p_action='revoke' then
  select user_id into v_user from public.addon_package_lots where id=p_lot_id;
  if v_user is null then raise exception 'active_package_lot_not_found'; end if;
  -- Serialize with concurrent invoice quota claims and MST usage checks.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,774219));
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
  select * into v_lot from public.addon_package_lots where id=p_lot_id for update;
  if not found then raise exception 'active_package_lot_not_found'; end if;
  if exists(select 1 from public.addon_package_revocations
    where lot_id=p_lot_id and restored_at is null)
  then raise exception 'already_revoked'; end if;
  insert into public.addon_package_revocations(
   lot_id,user_id,order_id,package_code,lot_snapshot,revoked_at,revoked_by,
   revoke_reason,restored_at,restored_by,restore_reason
  ) values (
   v_lot.id,v_lot.user_id,v_lot.order_id,v_lot.package_code,
   to_jsonb(v_lot),v_now,v_actor,v_reason,null,null,null
  ) on conflict(lot_id) do update set
   user_id=excluded.user_id,order_id=excluded.order_id,
   package_code=excluded.package_code,lot_snapshot=excluded.lot_snapshot,
   revoked_at=excluded.revoked_at,revoked_by=excluded.revoked_by,
   revoke_reason=excluded.revoke_reason,restored_at=null,
   restored_by=null,restore_reason=null;
  delete from public.addon_package_lots where id=v_lot.id;
  insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
  values(v_actor,v_lot.user_id,'admin_package_revoked_v32',
   jsonb_build_object('lot_id',v_lot.id,'package_code',v_lot.package_code,
    'order_id',v_lot.order_id,'remaining',v_lot.remaining,
    'expires_at',v_lot.expires_at,'reason',v_reason));
  return jsonb_build_object('success',true,'action','revoke',
   'lot_id',v_lot.id,'package_code',v_lot.package_code);
 end if;

 select * into v_saved from public.addon_package_revocations
 where lot_id=p_lot_id for update;
 if not found then raise exception 'revoked_package_not_found'; end if;
 if v_saved.restored_at is not null then raise exception 'package_already_restored'; end if;
 v_snapshot:=v_saved.lot_snapshot;
 v_user:=v_saved.user_id;
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,774219));
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 if exists(select 1 from public.addon_package_lots where id=p_lot_id)
 then raise exception 'package_already_active'; end if;
 if v_snapshot->>'family'='mst'
  and (v_snapshot->>'expires_at')::timestamptz<=v_now
 then raise exception 'expired_mst_restore_requires_new_grant'; end if;
 insert into public.addon_package_lots(
  id,user_id,package_code,family,quantity,remaining,price_snapshot,
  starts_at,expires_at,order_id,created_at,grant_kind
 ) values (
  (v_snapshot->>'id')::uuid,(v_snapshot->>'user_id')::uuid,
  v_snapshot->>'package_code',v_snapshot->>'family',
  (v_snapshot->>'quantity')::integer,
  (v_snapshot->>'remaining')::integer,
  (v_snapshot->>'price_snapshot')::bigint,
  (v_snapshot->>'starts_at')::timestamptz,
  (v_snapshot->>'expires_at')::timestamptz,
  (v_snapshot->>'order_id')::uuid,
  (v_snapshot->>'created_at')::timestamptz,
  v_snapshot->>'grant_kind'
 );
 update public.addon_package_revocations
 set restored_at=v_now,restored_by=v_actor,restore_reason=v_reason
 where lot_id=p_lot_id;
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(v_actor,v_user,'admin_package_restored_v32',
  jsonb_build_object('lot_id',p_lot_id,'package_code',v_saved.package_code,
    'order_id',v_saved.order_id,'remaining',(v_snapshot->>'remaining')::integer,
    'expires_at',v_snapshot->>'expires_at','reason',v_reason));
 return jsonb_build_object('success',true,'action','restore',
  'lot_id',p_lot_id,'package_code',v_saved.package_code);
end $$;
revoke all on function public.addon_admin_adjust_package_lot_v32(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.addon_admin_adjust_package_lot_v32(uuid,text,text)
 to authenticated;

-- Issue one explicitly audited compensation for a FAILED / REFUNDED / CANCELLED
-- purchase. Financial status and bank events are NOT changed. Reject duplicates.
create or replace function public.addon_admin_compensate_failed_order_v32(
 p_order_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_reason text:=left(btrim(coalesce(p_reason,'')),500);
 v_order public.addon_orders%rowtype;
 v_product public.addon_package_catalog%rowtype;
 v_lot public.addon_package_lots%rowtype;
 v_expiry timestamptz;
 v_qty integer;
begin
 if v_actor is null or not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_order_id is null or length(v_reason)<6 then raise exception 'adjustment_reason_required'; end if;
 select * into v_order from public.addon_orders where id=p_order_id for update;
 if not found then raise exception 'order_not_found'; end if;
 if v_order.status not in ('failed','refunded','cancelled')
 then raise exception 'only_failed_refunded_cancelled_orders_eligible'; end if;
 if v_order.package_code is null then raise exception 'legacy_order_not_eligible'; end if;
 if exists(select 1 from public.addon_audit_logs
  where action='admin_package_compensated_v32'
   and details->>'order_id'=p_order_id::text)
 then raise exception 'order_already_compensated'; end if;
 if exists(select 1 from public.addon_package_lots where order_id=p_order_id)
 then raise exception 'order_already_has_package'; end if;
 select * into v_product from public.addon_package_catalog
 where code=v_order.package_code;
 if not found then raise exception 'package_missing'; end if;
 v_qty:=coalesce(v_order.package_quantity_snapshot,v_product.quantity);
 if v_qty<1 then raise exception 'invalid_package_quantity'; end if;
 if v_product.family='mst' then
  v_expiry:=clock_timestamp()+make_interval(days=>365);
 end if;
 insert into public.addon_package_lots(
  user_id,package_code,family,quantity,remaining,price_snapshot,
  starts_at,expires_at,grant_kind
 ) values (
  v_order.user_id,v_product.code,v_product.family,v_qty,v_qty,0,
  clock_timestamp(),v_expiry,'gift'
 ) returning * into v_lot;
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(v_actor,v_order.user_id,'admin_package_compensated_v32',
  jsonb_build_object('order_id',p_order_id,'lot_id',v_lot.id,
   'package_code',v_lot.package_code,'reason',v_reason,
   'source_status',v_order.status,'quantity',v_qty,
   'expires_at',v_lot.expires_at));
 return jsonb_build_object('success',true,'package_code',v_lot.package_code,
  'lot_id',v_lot.id,'order_id',p_order_id,'quantity',v_qty,
  'expires_at',v_lot.expires_at);
end $$;
revoke all on function public.addon_admin_compensate_failed_order_v32(uuid,text)
 from public,anon,authenticated;
grant execute on function public.addon_admin_compensate_failed_order_v32(uuid,text)
 to authenticated;

-- Keep historical trial eligibility even if every active package was revoked.
-- Reuse current behavior for all other entitlement fields.
create or replace function public.addon_my_entitlements()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare
 u uuid:=auth.uid();
 inv jsonb;ms jsonb;v_mode text;
 v_invoice_remaining bigint;v_invoice_purchased bigint;v_mst_capacity bigint;
 v_nearest timestamptz;v_expiring bigint;
 v_has_history boolean;v_trial_used boolean;v_ever_had_package boolean;v_trial_expires timestamptz;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select jsonb_build_object('remaining',coalesce(sum(remaining),0),
   'purchased',coalesce(sum(quantity),0)),coalesce(sum(remaining),0),coalesce(sum(quantity),0)
 into inv,v_invoice_remaining,v_invoice_purchased
 from public.addon_package_lots where user_id=u and family='invoice';
 select exists(select 1 from public.addon_invoice_deductions where user_id=u)
 into v_has_history;
 select (
  exists(select 1 from public.addon_package_lots where user_id=u)
  or exists(select 1 from public.addon_package_revocations where user_id=u)
 ) into v_ever_had_package;
 select exists(select 1 from public.addon_trial_email_registry
  where first_user_id=u or email_normalized=
   (select lower(btrim(email)) from auth.users where id=u)) into v_trial_used;
 select max(expires_at) into v_trial_expires from public.addon_package_lots
 where user_id=u and grant_kind='trial';
 select min(expires_at) into v_nearest from public.addon_package_lots
 where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select coalesce(sum(quantity),0) into v_expiring from public.addon_package_lots
 where user_id=u and family='mst' and expires_at::date=v_nearest::date and expires_at>now();
 select jsonb_build_object('active_quantity',coalesce(sum(quantity),0),
  'nearest_expiry',v_nearest,'farthest_expiry',max(expires_at),
  'expiring_quantity',v_expiring),coalesce(sum(quantity),0)
 into ms,v_mst_capacity from public.addon_package_lots
 where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select mode into v_mode from public.addon_usage_modes where user_id=u;
 if v_mode is null then
  v_mode:=case when (v_invoice_purchased>0 or v_has_history)
   and v_mst_capacity=0 then 'invoice' else 'mst' end;
 end if;
 return jsonb_build_object(
  'allowed',case when v_mode='invoice'
    then v_invoice_remaining>0 or v_has_history else v_mst_capacity>0 end,
  'can_download_new_invoices',v_invoice_remaining>0,
  'can_reread_charged_invoices',v_has_history,
  'trial_used',v_trial_used,'trial_expires_at',v_trial_expires,
  'ever_had_package',v_ever_had_package,
  'packages',jsonb_build_object('invoice',inv,'mst',ms),
  'mode',v_mode,'updated_at',now());
end $$;

-- Keep original trial once-only rules, including packages now archived.
create or replace function public.addon_start_mst_trial(p_mst text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
 u uuid:=auth.uid();
 e text;m text:=upper(regexp_replace(coalesce(p_mst,''),'[[:space:]-]','','g'));
 v_package text;v_lot uuid;v_expires timestamptz:=now()+interval '7 days';
begin
 if u is null then raise exception 'authentication_required'; end if;
 if m !~ '^[0-9]{10}([0-9]{3})?$' then raise exception 'invalid_mst'; end if;
 select lower(btrim(email)) into e from auth.users where id=u;
 if e is null or e='' then raise exception 'email_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('trial-email:'||e,20));
 perform pg_advisory_xact_lock(hashtextextended('trial-mst:'||m,20));
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if exists(select 1 from public.addon_trial_email_registry where email_normalized=e)
 then raise exception 'trial_email_already_used'; end if;
 if exists(select 1 from public.addon_trial_mst_registry where mst=m)
 then raise exception 'trial_mst_already_used'; end if;
 if exists(select 1 from public.addon_package_lots where user_id=u)
    or exists(select 1 from public.addon_package_revocations where user_id=u)
 then raise exception 'existing_package_account_not_eligible_for_trial'; end if;
 if exists(select 1 from public.addon_mst_assignments where user_id=u)
 then raise exception 'existing_mst_account_not_eligible_for_trial'; end if;
 select code into v_package from public.addon_package_catalog
 where code='MST1' and family='mst';
 if v_package is null then raise exception 'trial_catalog_package_missing'; end if;
 insert into public.addon_trial_email_registry(email_normalized,first_user_id)
 values(e,u);
 insert into public.addon_trial_mst_registry(mst,first_user_id) values(m,u);
 insert into public.addon_package_lots
 (user_id,package_code,family,quantity,remaining,price_snapshot,starts_at,expires_at,grant_kind)
 values(u,v_package,'mst',1,1,0,now(),v_expires,'trial') returning id into v_lot;
 insert into public.addon_mst_assignments(user_id,mst) values(u,m);
 insert into public.addon_usage_modes(user_id,mode) values(u,'mst')
 on conflict(user_id) do update set mode='mst',updated_at=now();
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(u,u,'mst_trial_started',jsonb_build_object('mst',m,'lot_id',v_lot,'expires_at',v_expires));
 return jsonb_build_object('success',true,'mst',m,'expires_at',v_expires,'days',7);
end $$;

-- A compact purchase/admin-grant ledger, with transaction identifiers and
-- reversible lot references, still limited to TEN records per page.
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
 ), filtered as (
  select * from events
  where (p_user_id is null or user_id=p_user_id)
    and (p_kind='all' or event_type=p_kind)
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
revoke all on function public.addon_admin_package_transactions_v32(integer,text,uuid)
 from public,anon,authenticated;
grant execute on function public.addon_admin_package_transactions_v32(integer,text,uuid)
 to authenticated;

notify pgrst, 'reload schema';
