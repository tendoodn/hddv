-- Tendoo Add-on: set agreed prices and add secure authenticated order creation.
-- Apply only to the dedicated Add-on Supabase project.

update public.addon_plans
set price_vnd = case
  when code = 'monthly' then 20000
  when code = 'yearly' then 200000
  else price_vnd
end
where code in ('monthly', 'yearly');

create or replace function public.addon_create_order(p_plan_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.addon_plans%rowtype;
  v_reference text;
  v_order public.addon_orders%rowtype;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;

  if p_plan_code not in ('monthly', 'yearly') then
    raise exception 'invalid_paid_plan';
  end if;

  select * into v_plan
  from public.addon_plans
  where code = p_plan_code and active = true;

  if not found or v_plan.price_vnd <= 0 then
    raise exception 'plan_unavailable';
  end if;

  -- Unique, uppercase reference compatible with the SePay webhook parser.
  loop
    v_reference := 'ADDON' || upper(encode(gen_random_bytes(5), 'hex'));
    exit when not exists (
      select 1 from public.addon_orders
      where payment_reference = v_reference
    );
  end loop;

  insert into public.addon_orders(
    user_id, plan_code, amount_vnd, currency,
    status, payment_reference, payment_provider
  )
  values (
    v_user, v_plan.code, v_plan.price_vnd, 'VND',
    'pending', v_reference, 'sepay'
  )
  returning * into v_order;

  return jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'plan_code', v_order.plan_code,
    'amount_vnd', v_order.amount_vnd,
    'payment_reference', v_order.payment_reference,
    'created_at', v_order.created_at
  );
end;
$$;

revoke all on function public.addon_create_order(text) from public, anon;
grant execute on function public.addon_create_order(text) to authenticated;

-- Payment activation must only be callable by the trusted Edge Function
-- using the Supabase service-role key, never directly by browser clients.
revoke all on function public.addon_process_sepay_payment(text, text, bigint, jsonb)
from public, anon, authenticated;
grant execute on function public.addon_process_sepay_payment(text, text, bigint, jsonb)
to service_role;
