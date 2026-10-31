-- Tendoo Add-on: show queued renewals in the customer license status.
-- The payment processor schedules a paid renewal after the current subscription
-- ends. The old addon_my_license() filtered starts_at <= now(), hiding that
-- future subscription and making the customer portal appear not to renew.

create or replace function public.addon_my_license()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_sub public.addon_subscriptions%rowtype;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;

  -- Return the subscription with the furthest active expiry, including
  -- a future-dated renewal queued immediately after the current package.
  select *
    into v_sub
  from public.addon_subscriptions
  where user_id = v_user
    and status = 'active'
    and ends_at > now()
  order by ends_at desc, created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'active', false,
      'reason', 'no_active_subscription'
    );
  end if;

  return jsonb_build_object(
    'active', true,
    'plan_code', v_sub.plan_code,
    'starts_at', v_sub.starts_at,
    'ends_at', v_sub.ends_at,
    'days_left', greatest(
      0,
      ceil(extract(epoch from (v_sub.ends_at - now())) / 86400)::int
    )
  );
end;
$$;

grant execute on function public.addon_my_license() to authenticated;
