-- Tendoo Add-on: secure SePay webhook payment processing.
-- Apply to the dedicated Add-on Supabase project after migrations 001 and 002.

-- A subscription may be issued at most once for a paid order.
create unique index if not exists addon_subscriptions_order_id_unique
  on public.addon_subscriptions(order_id)
  where order_id is not null;

create or replace function public.addon_process_sepay_payment(
  p_payment_reference text,
  p_provider_event_id text,
  p_amount bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.addon_orders%rowtype;
  v_plan public.addon_plans%rowtype;
  v_start timestamptz := pg_catalog.now();
  v_existing_end timestamptz;
  v_end timestamptz;
  v_event_id uuid;
begin
  if p_payment_reference is null or pg_catalog.length(pg_catalog.btrim(p_payment_reference)) = 0
     or p_provider_event_id is null or pg_catalog.length(pg_catalog.btrim(p_provider_event_id)) = 0
     or p_amount is null or p_amount <= 0 then
    raise exception 'invalid_payment_parameters';
  end if;

  select * into v_order
  from public.addon_orders
  where payment_reference = pg_catalog.upper(pg_catalog.btrim(p_payment_reference))
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.amount_vnd <> p_amount then
    raise exception 'payment_amount_mismatch';
  end if;

  -- A repeated SePay event is acknowledged without issuing another subscription.
  insert into public.addon_payment_events(
    provider, provider_event_id, order_id, payload, processed_at
  )
  values ('sepay', p_provider_event_id, v_order.id, coalesce(p_payload, '{}'::jsonb), pg_catalog.now())
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return pg_catalog.jsonb_build_object(
      'success', true, 'duplicate', true, 'order_id', v_order.id
    );
  end if;

  if v_order.status = 'paid' then
    update public.addon_payment_events
      set processed_at = pg_catalog.now()
      where id = v_event_id;
    return pg_catalog.jsonb_build_object(
      'success', true, 'duplicate', true, 'order_id', v_order.id
    );
  end if;

  if v_order.status <> 'pending' then
    raise exception 'order_not_payable';
  end if;

  select * into v_plan
  from public.addon_plans
  where code = v_order.plan_code and active = true;

  if not found then
    raise exception 'plan_unavailable';
  end if;

  select pg_catalog.max(ends_at) into v_existing_end
  from public.addon_subscriptions
  where user_id = v_order.user_id
    and status = 'active'
    and ends_at > v_start;

  if v_existing_end is not null then
    v_start := v_existing_end;
  end if;

  v_end := case
    when v_plan.duration_months is not null
      then v_start + pg_catalog.make_interval(months => v_plan.duration_months)
    else v_start + pg_catalog.make_interval(days => v_plan.duration_days)
  end;

  update public.addon_orders
    set status = 'paid', paid_at = pg_catalog.now()
    where id = v_order.id;

  insert into public.addon_subscriptions(
    user_id, plan_code, starts_at, ends_at, status, source, order_id
  )
  values (
    v_order.user_id, v_order.plan_code, v_start, v_end, 'active', 'payment', v_order.id
  )
  on conflict (order_id) where order_id is not null do nothing;

  insert into public.addon_audit_logs(actor_id, target_user_id, action, details)
  values (
    null, v_order.user_id, 'payment_confirmed',
    pg_catalog.jsonb_build_object(
      'order_id', v_order.id,
      'plan_code', v_order.plan_code,
      'amount_vnd', v_order.amount_vnd,
      'provider_event_id', p_provider_event_id
    )
  );

  return pg_catalog.jsonb_build_object(
    'success', true, 'duplicate', false, 'order_id', v_order.id
  );
end;
$$;

revoke all on function public.addon_process_sepay_payment(text, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.addon_process_sepay_payment(text, text, bigint, jsonb)
  to service_role;
