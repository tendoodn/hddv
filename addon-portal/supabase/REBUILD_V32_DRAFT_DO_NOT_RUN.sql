-- AutoTax V3.2 REBUILD - DESTRUCTIVE. RUN ONLY AFTER DATABASE BACKUP.
-- Keeps auth.users and existing addon_admins membership; deletes addon_* business records.
-- WARNING: This is a one-time rebuild, not a repeatable migration.
begin;
create temporary table autotax_preserved_admins on commit drop as select user_id from public.addon_admins;
drop trigger if exists addon_auth_user_profile on auth.users;
-- Drop dependent public functions first; avoid CASCADE touching unrelated objects.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'addon_%' loop
  execute format('drop function if exists %s cascade',r.signature);
 end loop;
end $$;
-- Drop only addon_ tables; cascade can remove dependent policies/views, inspect dependencies first.
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' and tablename like 'addon_%' loop
  execute format('drop table if exists public.%I cascade',r.tablename);
 end loop;
end $$;

-- ========== 001_addon_license_portal.sql ==========
-- Tendoo Add-on license portal: initial schema
-- Apply only to a NEW, dedicated Supabase project. Never run in Tendoo K's project.

create extension if not exists pgcrypto;

create table if not exists public.addon_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.addon_plans (
  code text primary key check (code in ('trial_7d','monthly','yearly')),
  name text not null,
  duration_days integer,
  duration_months integer,
  price_vnd bigint not null default 0 check (price_vnd >= 0),
  currency text not null default 'VND',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (code = 'trial_7d' and duration_days = 7 and duration_months is null)
    or (code = 'monthly' and duration_months = 1 and duration_days is null)
    or (code = 'yearly' and duration_months = 12 and duration_days is null)
  )
);

insert into public.addon_plans(code,name,duration_days,duration_months,price_vnd)
values
 ('trial_7d','Dùng thử 7 ngày',7,null,0),
 ('monthly','Gói 1 tháng',null,1,0),
 ('yearly','Gói 1 năm',null,12,0)
on conflict (code) do nothing;

create table if not exists public.addon_trial_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  email_normalized text not null unique,
  claimed_at timestamptz not null default now()
);

create table if not exists public.addon_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.addon_plans(code),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  source text not null check (source in ('trial','admin','payment')),
  created_by uuid references auth.users(id),
  order_id uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists addon_subscriptions_user_period_idx
  on public.addon_subscriptions(user_id, starts_at desc, ends_at desc);

create table if not exists public.addon_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.addon_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.addon_plans(code),
  amount_vnd bigint not null check (amount_vnd > 0),
  currency text not null default 'VND',
  status text not null default 'pending' check (status in ('pending','paid','cancelled','failed','refunded')),
  payment_reference text not null unique,
  payment_provider text not null default 'vietqr',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists addon_orders_user_created_idx
  on public.addon_orders(user_id, created_at desc);

create table if not exists public.addon_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  order_id uuid references public.addon_orders(id),
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create table if not exists public.addon_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text,
  device_fingerprint_hash text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.addon_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  target_user_id uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.addon_is_admin()
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select exists(select 1 from public.addon_admins where user_id = auth.uid());
$$;

create or replace function public.addon_sync_profile()
returns trigger language plpgsql security definer
set search_path = public, auth
as $$
begin
  insert into public.addon_profiles(user_id,email)
  values(new.id, lower(new.email))
  on conflict(user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists addon_auth_user_profile on auth.users;
create trigger addon_auth_user_profile
after insert or update of email on auth.users
for each row execute function public.addon_sync_profile();

alter table public.addon_profiles enable row level security;
alter table public.addon_plans enable row level security;
alter table public.addon_trial_claims enable row level security;
alter table public.addon_subscriptions enable row level security;
alter table public.addon_admins enable row level security;
alter table public.addon_orders enable row level security;
alter table public.addon_payment_events enable row level security;
alter table public.addon_device_sessions enable row level security;
alter table public.addon_audit_logs enable row level security;

create policy "profile self read" on public.addon_profiles
for select to authenticated using (user_id = auth.uid() or public.addon_is_admin());
create policy "plans visible" on public.addon_plans
for select to authenticated using (active or public.addon_is_admin());
create policy "subscription self read" on public.addon_subscriptions
for select to authenticated using (user_id = auth.uid() or public.addon_is_admin());
create policy "orders self read" on public.addon_orders
for select to authenticated using (user_id = auth.uid() or public.addon_is_admin());
create policy "admin list admins" on public.addon_admins
for select to authenticated using (user_id = auth.uid() or public.addon_is_admin());
create policy "device sessions self read" on public.addon_device_sessions
for select to authenticated using (user_id = auth.uid() or public.addon_is_admin());
create policy "audit admin read" on public.addon_audit_logs
for select to authenticated using (public.addon_is_admin());

-- No client-side insert/update/delete policies are intentionally provided for
-- licenses, trial claims, payment events, admin roles, or audit logs.

create or replace function public.addon_claim_trial()
returns jsonb language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_start timestamptz := now();
  v_end timestamptz;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  select lower(email) into v_email from auth.users where id = v_user;
  if v_email is null then raise exception 'email_required'; end if;

  insert into public.addon_trial_claims(user_id,email_normalized)
  values(v_user,v_email);

  v_end := v_start + interval '7 days';
  insert into public.addon_subscriptions(user_id,plan_code,starts_at,ends_at,source)
  values(v_user,'trial_7d',v_start,v_end,'trial');

  insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
  values(v_user,v_user,'trial_claimed',jsonb_build_object('ends_at',v_end));
  return jsonb_build_object('success',true,'starts_at',v_start,'ends_at',v_end);
exception
  when unique_violation then
    raise exception 'trial_already_used';
end;
$$;

create or replace function public.addon_my_license()
returns jsonb language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_sub public.addon_subscriptions%rowtype;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  select * into v_sub
  from public.addon_subscriptions
  where user_id = v_user and status = 'active' and starts_at <= now() and ends_at > now()
  order by ends_at desc limit 1;

  if not found then
    return jsonb_build_object('active',false,'reason','no_active_subscription');
  end if;
  return jsonb_build_object(
    'active',true,'plan_code',v_sub.plan_code,
    'starts_at',v_sub.starts_at,'ends_at',v_sub.ends_at,
    'days_left',greatest(0,ceil(extract(epoch from (v_sub.ends_at-now()))/86400)::int)
  );
end;
$$;

create or replace function public.addon_admin_grant(
  p_user_id uuid, p_plan_code text, p_start_now boolean default true
)
returns jsonb language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_plan public.addon_plans%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_existing timestamptz;
  v_sub_id uuid;
begin
  if not public.addon_is_admin() then raise exception 'admin_required'; end if;
  if p_plan_code not in ('monthly','yearly') then raise exception 'invalid_paid_plan'; end if;
  select * into v_plan from public.addon_plans where code = p_plan_code and active;
  if not found then raise exception 'plan_unavailable'; end if;

  select max(ends_at) into v_existing
  from public.addon_subscriptions
  where user_id = p_user_id and status = 'active' and ends_at > now();

  v_start := case when v_existing is not null then v_existing else now() end;
  if not p_start_now and v_existing is null then v_start := now(); end if;
  v_end := case when p_plan_code = 'monthly' then v_start + interval '1 month'
                else v_start + interval '1 year' end;

  insert into public.addon_subscriptions(user_id,plan_code,starts_at,ends_at,source,created_by)
  values(p_user_id,p_plan_code,v_start,v_end,'admin',auth.uid())
  returning id into v_sub_id;

  insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
  values(auth.uid(),p_user_id,'subscription_granted',
    jsonb_build_object('subscription_id',v_sub_id,'plan_code',p_plan_code,'ends_at',v_end));
  return jsonb_build_object('success',true,'subscription_id',v_sub_id,'starts_at',v_start,'ends_at',v_end);
end;
$$;

grant execute on function public.addon_claim_trial() to authenticated;
grant execute on function public.addon_my_license() to authenticated;
grant execute on function public.addon_admin_grant(uuid,text,boolean) to authenticated;
grant execute on function public.addon_is_admin() to authenticated;


-- ========== 002_addon_pricing_and_order_creation.sql ==========
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


-- ========== 003_sepay_webhook_processing.sql ==========
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


-- ========== 004_admin_payment_details.sql ==========
-- Admin subscription history: readable plan names and SePay transaction identifiers.
-- Apply once in the Tendoo Add-on Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.addon_admin_list_users(p_search text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.addon_is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      u.id AS user_id,
      u.email,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'plan_code', s.plan_code,
            'plan_name', p.name,
            'status', s.status,
            'source', s.source,
            'starts_at', s.starts_at,
            'ends_at', s.ends_at,
            'created_at', s.created_at,
            'provider_event_id', pay.provider_event_id,
            'bank_reference', pay.bank_reference,
            'payment_reference', pay.payment_reference
          ) ORDER BY s.created_at DESC
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'::jsonb
      ) AS subscriptions,
      MAX(s.ends_at) FILTER (
        WHERE s.status = 'active' AND s.ends_at > pg_catalog.now()
      ) AS latest_active_until,
      COALESCE(
        bool_or(
          s.status = 'active'
          AND s.starts_at <= pg_catalog.now()
          AND s.ends_at > pg_catalog.now()
        ),
        false
      ) AS active_now
    FROM auth.users u
    LEFT JOIN public.addon_subscriptions s ON s.user_id = u.id
    LEFT JOIN public.addon_plans p ON p.code = s.plan_code
    LEFT JOIN LATERAL (
      SELECT
        pe.provider_event_id,
        pe.payload ->> 'referenceCode' AS bank_reference,
        o.payment_reference
      FROM public.addon_orders o
      LEFT JOIN public.addon_payment_events pe
        ON pe.order_id = o.id AND pe.provider = 'sepay'
      WHERE o.id = s.order_id
      ORDER BY pe.created_at DESC NULLS LAST
      LIMIT 1
    ) pay ON true
    WHERE COALESCE(p_search, '') = ''
       OR u.email ILIKE '%' || p_search || '%'
    GROUP BY u.id, u.email
    ORDER BY MAX(s.created_at) DESC NULLS LAST, u.created_at DESC
    LIMIT 500
  ) x;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.addon_admin_list_users(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addon_admin_list_users(text) TO authenticated;


-- ========== 004_show_queued_renewals.sql ==========
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


-- ========== 005_package_entitlements_v32.sql ==========
-- AutoTax v3.2 package model. Apply after migrations 001-004 on the dedicated Add-on Supabase project.
create table if not exists public.addon_package_catalog(
 code text primary key, family text not null check(family in ('invoice','mst')), name text not null,
 quantity integer not null check(quantity>0), price_vnd bigint not null check(price_vnd>=0),
 description text not null default '', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.addon_package_catalog(code,family,name,quantity,price_vnd,description) values
 ('T100','invoice','100 hóa đơn',100,50000,'100 lượt tải hóa đơn'),('T200','invoice','200 hóa đơn',200,90000,'200 lượt tải hóa đơn'),
 ('T500','invoice','500 hóa đơn',500,150000,'500 lượt tải hóa đơn'),('T1000','invoice','1.000 hóa đơn',1000,250000,'1.000 lượt tải hóa đơn'),
 ('T5000','invoice','5.000 hóa đơn',5000,500000,'5.000 lượt tải hóa đơn'),('MST1','mst','1 MST',1,35000,'Quản lý 1 MST'),
 ('MST5','mst','5 MST',5,125000,'Quản lý 5 MST'),('MST10','mst','10 MST',10,200000,'Quản lý 10 MST'),
 ('MST20','mst','20 MST',20,300000,'Quản lý 20 MST'),('MST50','mst','50 MST',50,500000,'Quản lý 50 MST')
on conflict(code) do nothing;
alter table public.addon_orders add column if not exists package_code text references public.addon_package_catalog(code);
create table if not exists public.addon_package_lots(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 package_code text not null references public.addon_package_catalog(code),family text not null check(family in ('invoice','mst')),
 quantity integer not null check(quantity>0),remaining integer not null check(remaining>=0),
 price_snapshot bigint not null,starts_at timestamptz not null default now(),expires_at timestamptz,
 order_id uuid unique references public.addon_orders(id),created_at timestamptz not null default now()
);
create table if not exists public.addon_invoice_deductions(
 id bigint generated always as identity primary key,user_id uuid not null references auth.users(id) on delete cascade,
 mst text not null,direction text not null,form_code text not null,series text not null,invoice_number text not null,
 deducted_at timestamptz not null default now(),unique(user_id,mst,direction,form_code,series,invoice_number)
);
create table if not exists public.addon_usage_modes(user_id uuid primary key references auth.users(id) on delete cascade,mode text not null check(mode in ('invoice','mst')),updated_at timestamptz not null default now());
alter table public.addon_package_catalog enable row level security;
alter table public.addon_package_lots enable row level security;
alter table public.addon_invoice_deductions enable row level security;
alter table public.addon_usage_modes enable row level security;
drop policy if exists addon_catalog_read on public.addon_package_catalog;
create policy addon_catalog_read on public.addon_package_catalog for select to authenticated using(active or public.addon_is_admin());
drop policy if exists addon_lots_read on public.addon_package_lots;
create policy addon_lots_read on public.addon_package_lots for select to authenticated using(user_id=auth.uid() or public.addon_is_admin());
drop policy if exists addon_deductions_read on public.addon_invoice_deductions;
create policy addon_deductions_read on public.addon_invoice_deductions for select to authenticated using(user_id=auth.uid() or public.addon_is_admin());
create or replace function public.addon_list_packages() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'family',family,'name',name,'quantity',quantity,'price_vnd',price_vnd,'description',description) order by family,quantity),'[]'::jsonb) from public.addon_package_catalog where active;
$$;
create or replace function public.addon_my_entitlements() returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); inv jsonb; ms jsonb; v_mode text;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select jsonb_build_object('remaining',coalesce(sum(remaining),0),'purchased',coalesce(sum(quantity),0)) into inv
 from public.addon_package_lots where user_id=u and family='invoice';
 select jsonb_build_object('active_quantity',coalesce(sum(quantity),0),
 'nearest_expiry',min(expires_at),'farthest_expiry',max(expires_at),
 'expiring_quantity',coalesce(sum(quantity) filter(where expires_at=(select min(expires_at) from public.addon_package_lots where user_id=u and family='mst' and expires_at>now())),0))
 into ms from public.addon_package_lots where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select mode into v_mode from public.addon_usage_modes where user_id=u;
 if v_mode is null then v_mode:='mst'; end if;
 return jsonb_build_object('allowed',case when v_mode='invoice' then coalesce((inv->>'remaining')::int,0)>0 else coalesce((ms->>'active_quantity')::int,0)>0 end,
 'packages',jsonb_build_object('invoice',inv,'mst',ms),'mode',v_mode,'updated_at',now());
end $$;
create or replace function public.addon_set_usage_mode(p_mode text) returns jsonb language plpgsql security definer set search_path=public,auth as $$
begin
 if auth.uid() is null or p_mode not in ('invoice','mst') then raise exception 'invalid_mode'; end if;
 if p_mode='invoice' and not exists(select 1 from public.addon_package_lots where user_id=auth.uid() and family='invoice' and remaining>0) then raise exception 'invoice_package_required'; end if;
 if p_mode='mst' and not exists(select 1 from public.addon_package_lots where user_id=auth.uid() and family='mst' and (expires_at is null or expires_at>now())) then raise exception 'mst_package_required'; end if;
 insert into public.addon_usage_modes(user_id,mode) values(auth.uid(),p_mode) on conflict(user_id) do update set mode=excluded.mode,updated_at=now();
 return jsonb_build_object('success',true,'mode',p_mode);
end $$;
create or replace function public.addon_create_package_order(p_package_code text) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); p public.addon_package_catalog%rowtype; ref text; o public.addon_orders%rowtype;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select * into p from public.addon_package_catalog where code=p_package_code and active for share;
 if not found or p.price_vnd<=0 then raise exception 'package_unavailable'; end if;
 loop ref:='ADDON'||upper(encode(gen_random_bytes(5),'hex')); exit when not exists(select 1 from public.addon_orders where payment_reference=ref); end loop;
 insert into public.addon_orders(user_id,plan_code,package_code,amount_vnd,currency,status,payment_reference,payment_provider)
 values(u,'monthly',p.code,p.price_vnd,'VND','pending',ref,'sepay') returning * into o;
 return jsonb_build_object('success',true,'order_id',o.id,'package_code',p.code,'amount_vnd',o.amount_vnd,'payment_reference',ref);
end $$;
create or replace function public.addon_record_invoice_download(p_items jsonb) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); item jsonb; n int:=0; v text; lot uuid;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'invoice' then raise exception 'invoice_mode_not_selected'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  if coalesce(item->>'mst','')='' or coalesce(item->>'invoice_number','')='' then continue; end if;
  insert into public.addon_invoice_deductions(user_id,mst,direction,form_code,series,invoice_number)
  values(u,item->>'mst',coalesce(item->>'direction',''),coalesce(item->>'form_code',''),coalesce(item->>'series',''),item->>'invoice_number')
  on conflict do nothing returning invoice_number into v;
  if v is not null then
   select id into lot from public.addon_package_lots where user_id=u and family='invoice' and remaining>0 order by created_at,id for update skip locked limit 1;
   if lot is not null then update public.addon_package_lots set remaining=remaining-1 where id=lot; n:=n+1; end if;
   v:=null; lot:=null;
  end if;
 end loop;
 return jsonb_build_object('deducted',n);
end $$;
create or replace function public.addon_admin_set_package_price(p_code text,p_price_vnd bigint) returns void language plpgsql security definer set search_path=public,auth as $$
declare old bigint;
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_price_vnd<0 then raise exception 'invalid_price'; end if;
 select price_vnd into old from public.addon_package_catalog where code=p_code for update;
 if not found then raise exception 'package_not_found'; end if;
 update public.addon_package_catalog set price_vnd=p_price_vnd,updated_at=now() where code=p_code;
 insert into public.addon_audit_logs(actor_id,action,details) values(auth.uid(),'package_price_changed',jsonb_build_object('code',p_code,'old_price_vnd',old,'new_price_vnd',p_price_vnd));
end $$;
create or replace function public.addon_admin_set_package_active(p_code text,p_active boolean) returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 update public.addon_package_catalog set active=p_active,updated_at=now() where code=p_code;
 if not found then raise exception 'package_not_found'; end if;
 insert into public.addon_audit_logs(actor_id,action,details) values(auth.uid(),'package_active_changed',jsonb_build_object('code',p_code,'active',p_active));
end $$;
-- A paid package order issues a distinct lot; pending orders keep their captured amount and code.
create or replace function public.addon_process_sepay_payment(p_payment_reference text,p_provider_event_id text,p_amount bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.addon_orders%rowtype; p public.addon_package_catalog%rowtype; ev uuid; v_start timestamptz:=pg_catalog.now(); v_end timestamptz;
begin
 select * into o from public.addon_orders where payment_reference=pg_catalog.upper(pg_catalog.btrim(p_payment_reference)) for update;
 if not found then raise exception 'order_not_found'; end if;
 if o.amount_vnd<>p_amount then raise exception 'payment_amount_mismatch'; end if;
 insert into public.addon_payment_events(provider,provider_event_id,order_id,payload,processed_at) values('sepay',p_provider_event_id,o.id,coalesce(p_payload,'{}'::jsonb),pg_catalog.now()) on conflict(provider,provider_event_id) do nothing returning id into ev;
 if ev is null or o.status='paid' then return pg_catalog.jsonb_build_object('success',true,'duplicate',true,'order_id',o.id); end if;
 if o.status<>'pending' then raise exception 'order_not_payable'; end if;
 if o.package_code is not null then
  select * into p from public.addon_package_catalog where code=o.package_code;
  if not found then raise exception 'package_missing'; end if;
  update public.addon_orders set status='paid',paid_at=pg_catalog.now() where id=o.id;
  if p.family='invoice' then
   insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot,order_id)
   values(o.user_id,p.code,p.family,p.quantity,p.quantity,o.amount_vnd,o.id);
  else
   v_end:=pg_catalog.now()+case when p.quantity=1 then interval '1 year' else interval '1 year' end;
   insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot,starts_at,expires_at,order_id)
   values(o.user_id,p.code,p.family,p.quantity,p.quantity,o.amount_vnd,pg_catalog.now(),v_end,o.id);
  end if;
  insert into public.addon_audit_logs(actor_id,target_user_id,action,details) values(null,o.user_id,'package_payment_confirmed',pg_catalog.jsonb_build_object('order_id',o.id,'package_code',p.code,'quantity',p.quantity,'amount_vnd',o.amount_vnd));
  return pg_catalog.jsonb_build_object('success',true,'duplicate',false,'order_id',o.id);
 end if;
 raise exception 'legacy_subscription_order_not_supported_by_v32';
end $$;
grant execute on function public.addon_list_packages() to authenticated;
grant execute on function public.addon_my_entitlements() to authenticated;
grant execute on function public.addon_set_usage_mode(text) to authenticated;
grant execute on function public.addon_create_package_order(text) to authenticated;
grant execute on function public.addon_record_invoice_download(jsonb) to authenticated;
grant execute on function public.addon_admin_set_package_price(text,bigint) to authenticated;
grant execute on function public.addon_admin_set_package_active(text,boolean) to authenticated;
revoke all on function public.addon_process_sepay_payment(text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.addon_process_sepay_payment(text,text,bigint,jsonb) to service_role;


-- ========== 006_package_admin_and_expiry_hardening.sql ==========
-- AutoTax v3.2.1 hardening: configurable MST lot validity, admin package catalog and safe atomic deduction.
alter table public.addon_package_catalog add column if not exists validity_days integer;
alter table public.addon_package_catalog drop constraint if exists addon_package_catalog_validity_days_check;
alter table public.addon_package_catalog add constraint addon_package_catalog_validity_days_check
 check(validity_days is null or validity_days between 1 and 3650);
-- Existing MST products intentionally remain unconfigured until the business selects a validity term.
create or replace function public.addon_admin_list_packages() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('code',code,'family',family,'name',name,'quantity',quantity,
 'price_vnd',price_vnd,'description',description,'active',active,'validity_days',validity_days) order by family,quantity)
 from public.addon_package_catalog),'[]'::jsonb);
end $$;
create or replace function public.addon_admin_set_package_terms(p_code text,p_validity_days integer) returns void
language plpgsql security definer set search_path=public,auth as $$
declare v_family text;
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 select family into v_family from public.addon_package_catalog where code=p_code for update;
 if not found then raise exception 'package_not_found'; end if;
 if v_family='mst' and (p_validity_days is null or p_validity_days not between 1 and 3650) then raise exception 'mst_validity_required'; end if;
 if v_family='invoice' and p_validity_days is not null then raise exception 'invoice_package_has_no_expiry'; end if;
 update public.addon_package_catalog set validity_days=p_validity_days,updated_at=now() where code=p_code;
 insert into public.addon_audit_logs(actor_id,action,details) values(auth.uid(),'package_terms_changed',
 jsonb_build_object('code',p_code,'validity_days',p_validity_days));
end $$;
create or replace function public.addon_admin_create_package(p_code text,p_family text,p_name text,p_quantity integer,p_price_vnd bigint,p_description text,p_validity_days integer default null)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_code !~ '^[A-Z0-9_]{2,24}$' or p_family not in ('invoice','mst') or p_quantity<1 or p_price_vnd<0 or length(trim(p_name))=0 then raise exception 'invalid_package';
 end if;
 if p_family='mst' and (p_validity_days is null or p_validity_days not between 1 and 3650) then raise exception 'mst_validity_required'; end if;
 if p_family='invoice' and p_validity_days is not null then raise exception 'invoice_package_has_no_expiry'; end if;
 insert into public.addon_package_catalog(code,family,name,quantity,price_vnd,description,validity_days)
 values(p_code,p_family,p_name,p_quantity,p_price_vnd,coalesce(p_description,''),p_validity_days);
 insert into public.addon_audit_logs(actor_id,action,details) values(auth.uid(),'package_created',
 jsonb_build_object('code',p_code,'family',p_family,'quantity',p_quantity,'price_vnd',p_price_vnd,'validity_days',p_validity_days));
end $$;
create or replace function public.addon_create_package_order(p_package_code text) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); p public.addon_package_catalog%rowtype; ref text; o public.addon_orders%rowtype;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select * into p from public.addon_package_catalog where code=p_package_code and active for share;
 if not found or p.price_vnd<=0 then raise exception 'package_unavailable'; end if;
 if p.family='mst' and p.validity_days is null then raise exception 'mst_validity_not_configured'; end if;
 loop ref:='ADDON'||upper(encode(gen_random_bytes(5),'hex')); exit when not exists(select 1 from public.addon_orders where payment_reference=ref); end loop;
 insert into public.addon_orders(user_id,plan_code,package_code,amount_vnd,currency,status,payment_reference,payment_provider)
 values(u,'monthly',p.code,p.price_vnd,'VND','pending',ref,'sepay') returning * into o;
 return jsonb_build_object('success',true,'order_id',o.id,'package_code',p.code,'amount_vnd',o.amount_vnd,'payment_reference',ref);
end $$;
create or replace function public.addon_process_sepay_payment(p_payment_reference text,p_provider_event_id text,p_amount bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.addon_orders%rowtype; p public.addon_package_catalog%rowtype; ev uuid; v_end timestamptz;
begin
 if p_payment_reference is null or p_provider_event_id is null or p_amount is null or p_amount<=0 then raise exception 'invalid_payment_parameters'; end if;
 select * into o from public.addon_orders where payment_reference=pg_catalog.upper(pg_catalog.btrim(p_payment_reference)) for update;
 if not found then raise exception 'order_not_found'; end if;
 if o.amount_vnd<>p_amount then raise exception 'payment_amount_mismatch'; end if;
 insert into public.addon_payment_events(provider,provider_event_id,order_id,payload,processed_at)
 values('sepay',p_provider_event_id,o.id,coalesce(p_payload,'{}'::jsonb),pg_catalog.now())
 on conflict(provider,provider_event_id) do nothing returning id into ev;
 if ev is null or o.status='paid' then return pg_catalog.jsonb_build_object('success',true,'duplicate',true,'order_id',o.id); end if;
 if o.status<>'pending' then raise exception 'order_not_payable'; end if;
 if o.package_code is null then raise exception 'legacy_subscription_order_not_supported_by_v32'; end if;
 select * into p from public.addon_package_catalog where code=o.package_code;
 if not found then raise exception 'package_missing'; end if;
 if p.family='mst' and p.validity_days is null then raise exception 'mst_validity_not_configured'; end if;
 update public.addon_orders set status='paid',paid_at=pg_catalog.now() where id=o.id;
 insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot,starts_at,expires_at,order_id)
 values(o.user_id,p.code,p.family,p.quantity,p.quantity,o.amount_vnd,pg_catalog.now(),
 case when p.family='mst' then pg_catalog.now()+pg_catalog.make_interval(days=>p.validity_days) else null end,o.id);
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(null,o.user_id,'package_payment_confirmed',pg_catalog.jsonb_build_object('order_id',o.id,'package_code',p.code,'quantity',p.quantity,'amount_vnd',o.amount_vnd,'expires_at',case when p.family='mst' then pg_catalog.now()+pg_catalog.make_interval(days=>p.validity_days) else null end));
 return pg_catalog.jsonb_build_object('success',true,'duplicate',false,'order_id',o.id);
end $$;
create or replace function public.addon_record_invoice_download(p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); item jsonb; n int:=0; lot uuid; v_mst text; v_dir text; v_form text; v_series text; v_no text;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'invoice' then raise exception 'invoice_mode_not_selected'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  v_mst:=coalesce(item->>'mst','');v_dir:=coalesce(item->>'direction','');v_form:=coalesce(item->>'form_code','');v_series:=coalesce(item->>'series','');v_no:=coalesce(item->>'invoice_number','');
  if v_mst='' or v_no='' then continue; end if;
  select id into lot from public.addon_package_lots where user_id=u and family='invoice' and remaining>0 order by created_at,id for update skip locked limit 1;
  if lot is null then exit; end if;
  insert into public.addon_invoice_deductions(user_id,mst,direction,form_code,series,invoice_number)
  values(u,v_mst,v_dir,v_form,v_series,v_no) on conflict do nothing;
  if found then update public.addon_package_lots set remaining=remaining-1 where id=lot; n:=n+1; end if;
  lot:=null;
 end loop;
 return jsonb_build_object('deducted',n);
end $$;
grant execute on function public.addon_admin_list_packages() to authenticated;
grant execute on function public.addon_admin_set_package_terms(text,integer) to authenticated;
grant execute on function public.addon_admin_create_package(text,text,text,integer,bigint,text,integer) to authenticated;


-- ========== 007_mst_capacity_enforcement.sql ==========
-- AutoTax v3.2.2: server-enforced deterministic MST profile capacity.
create table if not exists public.addon_mst_assignments(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 mst text not null,
 assigned_at timestamptz not null default now(),
 unique(user_id,mst)
);
alter table public.addon_mst_assignments enable row level security;
drop policy if exists addon_mst_assignments_read on public.addon_mst_assignments;
create policy addon_mst_assignments_read on public.addon_mst_assignments for select to authenticated using(user_id=auth.uid() or public.addon_is_admin());
create or replace function public.addon_authorize_mst(p_mst text) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); cap integer; assigned_rank bigint; existing_id bigint;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'mst' then
  return jsonb_build_object('allowed',false,'reason','mst_mode_not_selected');
 end if;
 if p_mst is null or length(trim(p_mst))=0 then raise exception 'mst_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select coalesce(sum(quantity),0)::int into cap from public.addon_package_lots
 where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select id into existing_id from public.addon_mst_assignments where user_id=u and mst=trim(p_mst);
 if existing_id is null then
  if (select count(*) from public.addon_mst_assignments where user_id=u)>=cap then
   return jsonb_build_object('allowed',false,'reason','mst_capacity_reached','capacity',cap);
  end if;
  insert into public.addon_mst_assignments(user_id,mst) values(u,trim(p_mst)) returning id into existing_id;
 end if;
 select count(*) into assigned_rank from public.addon_mst_assignments where user_id=u and id<=existing_id;
 return jsonb_build_object('allowed',assigned_rank<=cap,'reason',case when assigned_rank<=cap then 'ok' else 'mst_capacity_reduced' end,'capacity',cap,'assigned_rank',assigned_rank);
end $$;
grant execute on function public.addon_authorize_mst(text) to authenticated;
-- Correct locking clause order and only create a deduction when a quota lot is available.
create or replace function public.addon_record_invoice_download(p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); item jsonb; n int:=0; lot uuid; v_mst text; v_dir text; v_form text; v_series text; v_no text;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'invoice' then raise exception 'invoice_mode_not_selected'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  v_mst:=coalesce(item->>'mst','');v_dir:=coalesce(item->>'direction','');v_form:=coalesce(item->>'form_code','');v_series:=coalesce(item->>'series','');v_no:=coalesce(item->>'invoice_number','');
  if v_mst='' or v_no='' then continue; end if;
  select id into lot from public.addon_package_lots where user_id=u and family='invoice' and remaining>0 order by created_at,id limit 1 for update skip locked;
  if lot is null then exit; end if;
  insert into public.addon_invoice_deductions(user_id,mst,direction,form_code,series,invoice_number)
  values(u,v_mst,v_dir,v_form,v_series,v_no) on conflict do nothing;
  if found then update public.addon_package_lots set remaining=remaining-1 where id=lot; n:=n+1; end if;
  lot:=null;
 end loop;
 return jsonb_build_object('deducted',n);
end $$;


-- ========== 008_order_snapshot_and_expiry_display.sql ==========
-- AutoTax v3.2.3: snapshot package terms on order creation and count MST expiry by calendar date.
alter table public.addon_orders add column if not exists package_quantity_snapshot integer;
alter table public.addon_orders add column if not exists package_validity_days_snapshot integer;
create or replace function public.addon_create_package_order(p_package_code text) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); p public.addon_package_catalog%rowtype; ref text; o public.addon_orders%rowtype;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select * into p from public.addon_package_catalog where code=p_package_code and active for share;
 if not found or p.price_vnd<=0 then raise exception 'package_unavailable'; end if;
 if p.family='mst' and p.validity_days is null then raise exception 'mst_validity_not_configured'; end if;
 loop ref:='ADDON'||upper(encode(gen_random_bytes(5),'hex')); exit when not exists(select 1 from public.addon_orders where payment_reference=ref); end loop;
 insert into public.addon_orders(user_id,plan_code,package_code,package_quantity_snapshot,package_validity_days_snapshot,amount_vnd,currency,status,payment_reference,payment_provider)
 values(u,'monthly',p.code,p.quantity,p.validity_days,p.price_vnd,'VND','pending',ref,'sepay') returning * into o;
 return jsonb_build_object('success',true,'order_id',o.id,'package_code',p.code,'amount_vnd',o.amount_vnd,'payment_reference',ref);
end $$;
create or replace function public.addon_process_sepay_payment(p_payment_reference text,p_provider_event_id text,p_amount bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.addon_orders%rowtype; p public.addon_package_catalog%rowtype; ev uuid; v_end timestamptz; v_qty integer; v_days integer;
begin
 if p_payment_reference is null or p_provider_event_id is null or p_amount is null or p_amount<=0 then raise exception 'invalid_payment_parameters'; end if;
 select * into o from public.addon_orders where payment_reference=pg_catalog.upper(pg_catalog.btrim(p_payment_reference)) for update;
 if not found then raise exception 'order_not_found'; end if;
 if o.amount_vnd<>p_amount then raise exception 'payment_amount_mismatch'; end if;
 insert into public.addon_payment_events(provider,provider_event_id,order_id,payload,processed_at)
 values('sepay',p_provider_event_id,o.id,coalesce(p_payload,'{}'::jsonb),pg_catalog.now())
 on conflict(provider,provider_event_id) do nothing returning id into ev;
 if ev is null or o.status='paid' then return pg_catalog.jsonb_build_object('success',true,'duplicate',true,'order_id',o.id); end if;
 if o.status<>'pending' then raise exception 'order_not_payable'; end if;
 if o.package_code is null then raise exception 'legacy_subscription_order_not_supported_by_v32'; end if;
 select * into p from public.addon_package_catalog where code=o.package_code;
 if not found then raise exception 'package_missing'; end if;
 v_qty:=coalesce(o.package_quantity_snapshot,p.quantity);v_days:=o.package_validity_days_snapshot;
 if p.family='mst' and (v_days is null or v_days<1) then raise exception 'mst_validity_not_configured'; end if;
 update public.addon_orders set status='paid',paid_at=pg_catalog.now() where id=o.id;
 if p.family='mst' then v_end:=pg_catalog.now()+pg_catalog.make_interval(days=>v_days); end if;
 insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot,starts_at,expires_at,order_id)
 values(o.user_id,p.code,p.family,v_qty,v_qty,o.amount_vnd,pg_catalog.now(),v_end,o.id);
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(null,o.user_id,'package_payment_confirmed',pg_catalog.jsonb_build_object('order_id',o.id,'package_code',p.code,'quantity',v_qty,'validity_days',v_days,'amount_vnd',o.amount_vnd,'expires_at',v_end));
 return pg_catalog.jsonb_build_object('success',true,'duplicate',false,'order_id',o.id);
end $$;
create or replace function public.addon_my_entitlements() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); inv jsonb; ms jsonb; v_mode text; v_nearest timestamptz; v_expiring integer;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select jsonb_build_object('remaining',coalesce(sum(remaining),0),'purchased',coalesce(sum(quantity),0)) into inv
 from public.addon_package_lots where user_id=u and family='invoice';
 select min(expires_at) into v_nearest from public.addon_package_lots where user_id=u and family='mst' and expires_at>now();
 select coalesce(sum(quantity),0)::int into v_expiring from public.addon_package_lots
 where user_id=u and family='mst' and expires_at::date=v_nearest::date;
 select jsonb_build_object('active_quantity',coalesce(sum(quantity),0),'nearest_expiry',v_nearest,
 'farthest_expiry',max(expires_at),'expiring_quantity',v_expiring)
 into ms from public.addon_package_lots where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select mode into v_mode from public.addon_usage_modes where user_id=u;
 if v_mode is null then v_mode:='mst'; end if;
 return jsonb_build_object('allowed',case when v_mode='invoice' then coalesce((inv->>'remaining')::int,0)>0 else coalesce((ms->>'active_quantity')::int,0)>0 end,
 'packages',jsonb_build_object('invoice',inv,'mst',ms),'mode',v_mode,'updated_at',now());
end $$;


-- ========== 009_initial_entitlement_mode.sql ==========
-- AutoTax v3.2.4: choose the only available entitlement family on first login.
create or replace function public.addon_my_entitlements() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); inv jsonb; ms jsonb; v_mode text; v_invoice_remaining integer; v_mst_capacity integer; v_nearest timestamptz; v_expiring integer;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select jsonb_build_object('remaining',coalesce(sum(remaining),0),'purchased',coalesce(sum(quantity),0)),
 coalesce(sum(remaining),0)::int into inv,v_invoice_remaining
 from public.addon_package_lots where user_id=u and family='invoice';
 select min(expires_at) into v_nearest from public.addon_package_lots where user_id=u and family='mst' and expires_at>now();
 select coalesce(sum(quantity),0)::int into v_expiring from public.addon_package_lots
 where user_id=u and family='mst' and expires_at::date=v_nearest::date;
 select jsonb_build_object('active_quantity',coalesce(sum(quantity),0),'nearest_expiry',v_nearest,
 'farthest_expiry',max(expires_at),'expiring_quantity',v_expiring),
 coalesce(sum(quantity),0)::int into ms,v_mst_capacity
 from public.addon_package_lots where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select mode into v_mode from public.addon_usage_modes where user_id=u;
 if v_mode is null then
  v_mode:=case when v_invoice_remaining>0 and v_mst_capacity=0 then 'invoice' else 'mst' end;
 end if;
 return jsonb_build_object('allowed',case when v_mode='invoice' then v_invoice_remaining>0 else v_mst_capacity>0 end,
 'packages',jsonb_build_object('invoice',inv,'mst',ms),'mode',v_mode,'updated_at',now());
end $$;


-- ========== 010_package_unlock_codes.sql ==========
-- AutoTax v3.2.5: package-specific one-time unlock codes (not generic subscription coupons).
create table if not exists public.addon_package_unlock_codes(
 id uuid primary key default gen_random_uuid(),
 code text not null unique,
 package_code text not null references public.addon_package_catalog(code),
 quantity_snapshot integer not null check(quantity_snapshot>0),
 validity_days_snapshot integer,
 expires_at timestamptz,
 active boolean not null default true,
 redeemed_by uuid references auth.users(id),
 redeemed_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.addon_package_unlock_codes enable row level security;
drop policy if exists addon_unlock_codes_admin_read on public.addon_package_unlock_codes;
create policy addon_unlock_codes_admin_read on public.addon_package_unlock_codes for select to authenticated using(public.addon_is_admin());
create or replace function public.addon_admin_create_package_unlock(p_package_code text,p_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare p public.addon_package_catalog%rowtype; v_code text; v_id uuid;
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 select * into p from public.addon_package_catalog where code=p_package_code and active;
 if not found then raise exception 'package_unavailable'; end if;
 if p.family='mst' and (p.validity_days is null or p.validity_days<1) then raise exception 'mst_validity_not_configured'; end if;
 loop v_code:='UNLOCK-'||upper(encode(gen_random_bytes(6),'hex'));
 exit when not exists(select 1 from public.addon_package_unlock_codes where code=v_code);
 end loop;
 insert into public.addon_package_unlock_codes(code,package_code,quantity_snapshot,validity_days_snapshot,expires_at,created_by)
 values(v_code,p.code,p.quantity,p.validity_days,p_expires_at,auth.uid()) returning id into v_id;
 insert into public.addon_audit_logs(actor_id,action,details)
 values(auth.uid(),'package_unlock_created',jsonb_build_object('unlock_id',v_id,'code',v_code,'package_code',p.code,'quantity',p.quantity,'validity_days',p.validity_days,'expires_at',p_expires_at));
 return jsonb_build_object('id',v_id,'code',v_code,'package_code',p.code,'quantity',p.quantity,'family',p.family,'expires_at',p_expires_at);
end $$;
create or replace function public.addon_admin_list_package_unlocks() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'code',u.code,'package_code',u.package_code,'quantity',u.quantity_snapshot,'validity_days',u.validity_days_snapshot,'expires_at',u.expires_at,'active',u.active,'redeemed_by',u.redeemed_by,'redeemed_at',u.redeemed_at,'created_at',u.created_at) order by u.created_at desc) from public.addon_package_unlock_codes u),'[]'::jsonb);
end $$;
create or replace function public.addon_admin_set_package_unlock_active(p_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path=public,auth as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 update public.addon_package_unlock_codes set active=p_active where id=p_id and redeemed_at is null;
 if not found then raise exception 'unlock_not_found_or_already_redeemed'; end if;
 insert into public.addon_audit_logs(actor_id,action,details) values(auth.uid(),'package_unlock_status_changed',jsonb_build_object('unlock_id',p_id,'active',p_active));
end $$;
create or replace function public.addon_redeem_package_unlock(p_code text) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); v public.addon_package_unlock_codes%rowtype; p public.addon_package_catalog%rowtype; v_end timestamptz;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if p_code is null or length(trim(p_code))<6 then raise exception 'invalid_unlock_code'; end if;
 select * into v from public.addon_package_unlock_codes where code=upper(trim(p_code)) for update;
 if not found or not v.active then raise exception 'unlock_code_invalid_or_disabled'; end if;
 if v.redeemed_at is not null then raise exception 'unlock_code_already_used'; end if;
 if v.expires_at is not null and v.expires_at<=now() then raise exception 'unlock_code_expired'; end if;
 select * into p from public.addon_package_catalog where code=v.package_code;
 if not found then raise exception 'package_missing'; end if;
 if p.family='mst' then
  if v.validity_days_snapshot is null or v.validity_days_snapshot<1 then raise exception 'mst_validity_not_configured'; end if;
  v_end:=now()+make_interval(days=>v.validity_days_snapshot);
 end if;
 update public.addon_package_unlock_codes set redeemed_by=u,redeemed_at=now(),active=false where id=v.id;
 insert into public.addon_package_lots(user_id,package_code,family,quantity,remaining,price_snapshot,starts_at,expires_at,order_id)
 values(u,p.code,p.family,v.quantity_snapshot,v.quantity_snapshot,0,now(),v_end,null);
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(u,u,'package_unlock_redeemed',jsonb_build_object('unlock_id',v.id,'package_code',p.code,'quantity',v.quantity_snapshot,'validity_days',v.validity_days_snapshot,'expires_at',v_end));
 return jsonb_build_object('success',true,'package_code',p.code,'family',p.family,'quantity',v.quantity_snapshot,'expires_at',v_end);
end $$;
grant execute on function public.addon_admin_create_package_unlock(text,timestamptz) to authenticated;
grant execute on function public.addon_admin_list_package_unlocks() to authenticated;
grant execute on function public.addon_admin_set_package_unlock_active(uuid,boolean) to authenticated;
grant execute on function public.addon_redeem_package_unlock(text) to authenticated;


-- ========== 011_atomic_invoice_quota_claim.sql ==========
-- AutoTax 3.2: atomic invoice reservations and retry-safe quota accounting.
-- Deploy after 010_package_unlock_codes.sql.
-- A successful claim reserves exactly one quota unit before exporting.
-- Claims of previously charged invoices do not charge again.
create or replace function public.addon_claim_invoice_quota(p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
 u uuid := auth.uid();
 item jsonb;
 v_mst text; v_direction text; v_form text; v_series text; v_invoice text;
 v_new integer := 0; v_seen integer := 0; v_denied integer := 0;
 v_id bigint; v_lot uuid;
 v_keys jsonb := '[]'::jsonb; v_denied_keys jsonb := '[]'::jsonb;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst') <> 'invoice' then
  raise exception 'invoice_mode_not_selected';
 end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_items'; end if;
 -- Serialize claims per account, including concurrent Chrome tabs.
 perform pg_advisory_xact_lock(hashtextextended(u::text, 774219));
 for item in select value from jsonb_array_elements(p_items) loop
  v_mst := trim(coalesce(item->>'mst',''));
  v_direction := trim(coalesce(item->>'direction',''));
  v_form := trim(coalesce(item->>'form_code',''));
  v_series := trim(coalesce(item->>'series',''));
  v_invoice := trim(coalesce(item->>'invoice_number',''));
  if v_mst = '' or v_invoice = '' then
   v_denied := v_denied + 1;
   v_denied_keys := v_denied_keys || jsonb_build_array(item);
   continue;
  end if;
  if exists(select 1 from public.addon_invoice_deductions d
            where d.user_id=u and d.mst=v_mst and d.direction=v_direction
              and d.form_code=v_form and d.series=v_series and d.invoice_number=v_invoice) then
   v_seen := v_seen + 1;
   v_keys := v_keys || jsonb_build_array(item);
   continue;
  end if;
  select id into v_lot from public.addon_package_lots
  where user_id=u and family='invoice' and remaining>0
  order by created_at,id for update limit 1;
  if v_lot is null then
   v_denied := v_denied + 1;
   v_denied_keys := v_denied_keys || jsonb_build_array(item);
   continue;
  end if;
  update public.addon_package_lots set remaining=remaining-1 where id=v_lot;
  insert into public.addon_invoice_deductions(user_id,mst,direction,form_code,series,invoice_number)
  values(u,v_mst,v_direction,v_form,v_series,v_invoice)
  returning id into v_id;
  v_new := v_new+1;
  v_keys := v_keys || jsonb_build_array(item);
 end loop;
 return jsonb_build_object('deducted',v_new,'previously_deducted',v_seen,
   'denied',v_denied,'allowed_items',v_keys,'denied_items',v_denied_keys);
end $$;
revoke all on function public.addon_claim_invoice_quota(jsonb) from public;
grant execute on function public.addon_claim_invoice_quota(jsonb) to authenticated;


-- ========== 012_trial_mst_assignment_controls.sql ==========
-- AutoTax V3.2: MST assignment management and one-time trial safeguards.
-- Apply AFTER 011. This migration does NOT grant trial packages.
alter table public.addon_package_lots
 add column if not exists grant_kind text not null default 'paid'
 check (grant_kind in ('paid','gift','trial'));

create table if not exists public.addon_trial_email_registry(
 email_normalized text primary key,
 first_user_id uuid,
 claimed_at timestamptz not null default now()
);
create table if not exists public.addon_trial_mst_registry(
 mst text primary key,
 first_user_id uuid,
 claimed_at timestamptz not null default now()
);
alter table public.addon_trial_email_registry enable row level security;
alter table public.addon_trial_mst_registry enable row level security;
-- No direct table policies. Only SECURITY DEFINER RPCs may access registries.

-- Reserved for a future trusted trial issuer. A service-role caller needs an explicit
-- target-user implementation; do NOT expose this auth.uid()-based function as a public RPC.
-- A trial issuer MUST reserve identity atomically with issuing a trial lot.
-- Records survive removal of an assignment; neither registry is cascaded on user deletion.
create or replace function public.addon_reserve_trial_identity(p_mst text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); e text; m text;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select lower(btrim(email)) into e from auth.users where id=u;
 m:=upper(regexp_replace(coalesce(p_mst,''),'[[:space:]-]','','g'));
 if e is null or e='' or m='' then raise exception 'trial_identity_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('trial:'||e,0));
 perform pg_advisory_xact_lock(hashtextextended('trial:'||m,1));
 if exists(select 1 from public.addon_trial_email_registry where email_normalized=e) then
  raise exception 'trial_email_already_used';
 end if;
 if exists(select 1 from public.addon_trial_mst_registry where mst=m) then
  raise exception 'trial_mst_already_used';
 end if;
 insert into public.addon_trial_email_registry(email_normalized,first_user_id) values(e,u);
 insert into public.addon_trial_mst_registry(mst,first_user_id) values(m,u);
end $$;

create or replace function public.addon_authorize_mst(p_mst text) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); cap integer; assigned_rank bigint; existing_id bigint;
 m text; trial_only boolean;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'mst' then
  return jsonb_build_object('allowed',false,'reason','mst_mode_not_selected');
 end if;
 m:=upper(regexp_replace(coalesce(p_mst,''),'[[:space:]-]','','g'));
 if m !~ '^[0-9]{10}([0-9]{3})?$' then raise exception 'invalid_mst'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select coalesce(sum(quantity),0)::int into cap from public.addon_package_lots
 where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 if cap=0 then return jsonb_build_object('allowed',false,'reason','mst_package_expired','capacity',0); end if;
 select not exists(select 1 from public.addon_package_lots where user_id=u and family='mst'
   and grant_kind<>'trial' and (expires_at is null or expires_at>now())) into trial_only;
 select id into existing_id from public.addon_mst_assignments where user_id=u and mst=m;
 if existing_id is null then
  if (select count(*) from public.addon_mst_assignments where user_id=u)>=cap then
   return jsonb_build_object('allowed',false,'reason','mst_capacity_reached','capacity',cap);
  end if;
  if trial_only then
   -- Trial issuance must have reserved the identity; no cross-account reuse.
   if not exists(select 1 from public.addon_trial_mst_registry where mst=m and first_user_id=u) then
    return jsonb_build_object('allowed',false,'reason','trial_mst_not_reserved');
   end if;
  end if;
  insert into public.addon_mst_assignments(user_id,mst) values(u,m) returning id into existing_id;
 end if;
 select count(*) into assigned_rank from public.addon_mst_assignments where user_id=u and id<=existing_id;
 return jsonb_build_object('allowed',assigned_rank<=cap,
  'reason',case when assigned_rank<=cap then 'ok' else 'mst_capacity_reduced' end,
  'capacity',cap,'assigned_rank',assigned_rank);
end $$;

create or replace function public.addon_list_my_mst_assignments() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'mst',mst,'assigned_at',assigned_at)
  order by assigned_at,id) from public.addon_mst_assignments where user_id=auth.uid()),'[]'::jsonb);
end $$;

create or replace function public.addon_admin_list_mst_assignments(p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,
 'email',u.email,'mst',a.mst,'assigned_at',a.assigned_at) order by a.assigned_at,a.id)
 from public.addon_mst_assignments a join auth.users u on u.id=a.user_id
 where p_user_id is null or a.user_id=p_user_id),'[]'::jsonb);
end $$;

create or replace function public.addon_unlink_mst(p_mst text,p_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare actor uuid:=auth.uid(); target uuid; m text; deleted_count int; admin_mode boolean;
begin
 if actor is null then raise exception 'authentication_required'; end if;
 admin_mode:=public.addon_is_admin();
 target:=coalesce(p_user_id,actor);
 if target<>actor and not admin_mode then raise exception 'admin_required'; end if;
 if not admin_mode then
  if not exists(select 1 from public.addon_package_lots where user_id=target and family='mst'
   and (expires_at is null or expires_at>now())) then
   raise exception 'mst_unlink_requires_active_package';
  end if;
 end if;
 m:=upper(regexp_replace(coalesce(p_mst,''),'[[:space:]-]','','g'));
 if m='' then raise exception 'mst_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 delete from public.addon_mst_assignments where user_id=target and mst=m;
 get diagnostics deleted_count=row_count;
 if deleted_count=0 then raise exception 'mst_assignment_not_found'; end if;
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(actor,target,'mst_assignment_removed',jsonb_build_object('mst',m,'by_admin',admin_mode));
 -- Historical trial identity remains reserved, preventing trial farming.
 return jsonb_build_object('success',true,'mst',m);
end $$;

revoke all on function public.addon_reserve_trial_identity(text) from public,anon;
revoke all on function public.addon_authorize_mst(text) from public,anon;
revoke all on function public.addon_list_my_mst_assignments() from public,anon;
revoke all on function public.addon_admin_list_mst_assignments(uuid) from public,anon;
revoke all on function public.addon_unlink_mst(text,uuid) from public,anon;
-- Trial issuance must be a trusted server-side operation; never expose reservation to end users.
-- Trial reservation is intentionally not exposed until the trusted issuer is implemented.
grant execute on function public.addon_authorize_mst(text) to authenticated;
grant execute on function public.addon_list_my_mst_assignments() to authenticated;
grant execute on function public.addon_admin_list_mst_assignments(uuid) to authenticated;
grant execute on function public.addon_unlink_mst(text,uuid) to authenticated;

-- ========== 013_one_time_mst_trial.sql ==========
-- AutoTax V3.2 trial: one seven-day MST trial per normalized email and MST.
-- Requires 012_trial_mst_assignment_controls.sql; customer accounts remain untouched.
-- Trial issuance and identity reservation happen in one transaction.
drop function if exists public.addon_reserve_trial_identity(text);

create or replace function public.addon_start_mst_trial(p_mst text)
returns jsonb language plpgsql security definer
set search_path = public, auth as $$
declare
 u uuid := auth.uid();
 e text;
 m text := upper(regexp_replace(coalesce(p_mst,''),'[[:space:]-]','','g'));
 v_package text;
 v_lot uuid;
 v_expires timestamptz := now() + interval '7 days';
begin
 if u is null then raise exception 'authentication_required'; end if;
 if m !~ '^[0-9]{10}([0-9]{3})?$' then raise exception 'invalid_mst'; end if;
 select lower(btrim(email)) into e from auth.users where id=u;
 if e is null or e='' then raise exception 'email_required'; end if;
 -- Consistent lock ordering: email -> MST -> account.
 perform pg_advisory_xact_lock(hashtextextended('trial-email:'||e,20));
 perform pg_advisory_xact_lock(hashtextextended('trial-mst:'||m,20));
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if exists (select 1 from public.addon_trial_email_registry where email_normalized=e) then
  raise exception 'trial_email_already_used';
 end if;
 if exists (select 1 from public.addon_trial_mst_registry where mst=m) then
  raise exception 'trial_mst_already_used';
 end if;
 if exists (select 1 from public.addon_package_lots where user_id=u) then
  raise exception 'existing_package_account_not_eligible_for_trial';
 end if;
 if exists (select 1 from public.addon_mst_assignments where user_id=u) then
  raise exception 'existing_mst_account_not_eligible_for_trial';
 end if;
 -- The built-in MST1 catalog entry is the trial capacity reference, not an order.
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
revoke all on function public.addon_start_mst_trial(text) from public, anon;
grant execute on function public.addon_start_mst_trial(text) to authenticated;

-- Old subscription trial can never be used to bypass the new registry.
revoke all on function public.addon_claim_trial() from public,anon,authenticated;

-- ========== 014_invoice_reread_entitlements.sql ==========
-- AutoTax V3.2: invoice rereads remain accessible at zero quota.
-- Apply AFTER 013. This does not grant new downloads beyond purchased quota.
create or replace function public.addon_my_entitlements() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
declare
 u uuid:=auth.uid();
 inv jsonb; ms jsonb; v_mode text;
 v_invoice_remaining bigint; v_invoice_purchased bigint; v_mst_capacity bigint;
 v_nearest timestamptz; v_expiring bigint;
 v_has_history boolean; v_trial_used boolean; v_ever_had_package boolean; v_trial_expires timestamptz;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select jsonb_build_object('remaining',coalesce(sum(remaining),0),
   'purchased',coalesce(sum(quantity),0)),coalesce(sum(remaining),0),coalesce(sum(quantity),0)
 into inv,v_invoice_remaining,v_invoice_purchased
 from public.addon_package_lots where user_id=u and family='invoice';
 select exists(select 1 from public.addon_invoice_deductions where user_id=u)
 into v_has_history;
 select exists(select 1 from public.addon_package_lots where user_id=u) into v_ever_had_package;
 select exists(select 1 from public.addon_trial_email_registry where first_user_id=u or email_normalized=(select lower(btrim(email)) from auth.users where id=u)) into v_trial_used;
 select max(expires_at) into v_trial_expires from public.addon_package_lots where user_id=u and grant_kind='trial';
 select min(expires_at) into v_nearest from public.addon_package_lots
 where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select coalesce(sum(quantity),0) into v_expiring from public.addon_package_lots
 where user_id=u and family='mst' and expires_at::date=v_nearest::date and expires_at>now();
 select jsonb_build_object('active_quantity',coalesce(sum(quantity),0),
 'nearest_expiry',v_nearest,'farthest_expiry',max(expires_at),
 'expiring_quantity',v_expiring),coalesce(sum(quantity),0)
 into ms,v_mst_capacity
 from public.addon_package_lots where user_id=u and family='mst'
 and (expires_at is null or expires_at>now());
 select mode into v_mode from public.addon_usage_modes where user_id=u;
 if v_mode is null then
  v_mode:=case when (v_invoice_purchased>0 or v_has_history) and v_mst_capacity=0 then 'invoice' else 'mst' end;
 end if;
 return jsonb_build_object(
 'allowed',case when v_mode='invoice'
   then v_invoice_remaining>0 or v_has_history
   else v_mst_capacity>0 end,
 'can_download_new_invoices',v_invoice_remaining>0,
 'can_reread_charged_invoices',v_has_history,
 'trial_used',v_trial_used,
 'trial_expires_at',v_trial_expires,
 'ever_had_package',v_ever_had_package,
 'packages',jsonb_build_object('invoice',inv,'mst',ms),
 'mode',v_mode,
 -- updated_at is informational only; do not use as proof of an order.
 'updated_at',now());
end $$;

-- Legacy RPC is unsafe (it can record a deduction without charging quota).
-- Keep only the atomic, idempotent claim API introduced in 011.
revoke all on function public.addon_record_invoice_download(jsonb)
 from public,anon,authenticated;

-- ========== 015_invoice_mode_claim_hardening.sql ==========
-- AutoTax V3.2: select invoice mode for invoice-only accounts and preserve atomic quota claims.
-- Deploy after 014_invoice_reread_entitlements.sql.
-- A successful claim reserves exactly one quota unit before exporting.
-- Claims of previously charged invoices do not charge again.
create or replace function public.addon_claim_invoice_quota(p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
 u uuid := auth.uid();
 item jsonb;
 v_mst text; v_direction text; v_form text; v_series text; v_invoice text;
 v_new integer := 0; v_seen integer := 0; v_denied integer := 0;
 v_id bigint; v_lot uuid;
 v_keys jsonb := '[]'::jsonb; v_denied_keys jsonb := '[]'::jsonb;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce(
  (select mode from public.addon_usage_modes where user_id=u),
  (case when exists(select 1 from public.addon_package_lots
   where user_id=u and family='invoice')
   and not exists(select 1 from public.addon_package_lots
   where user_id=u and family='mst' and (expires_at is null or expires_at>now()))
   then 'invoice' else 'mst' end)
 ) <> 'invoice' then
  raise exception 'invoice_mode_not_selected';
 end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_items'; end if;
 -- Serialize claims per account, including concurrent Chrome tabs.
 perform pg_advisory_xact_lock(hashtextextended(u::text, 774219));
 for item in select value from jsonb_array_elements(p_items) loop
  v_mst := trim(coalesce(item->>'mst',''));
  v_direction := trim(coalesce(item->>'direction',''));
  v_form := trim(coalesce(item->>'form_code',''));
  v_series := trim(coalesce(item->>'series',''));
  v_invoice := trim(coalesce(item->>'invoice_number',''));
  if v_mst = '' or v_invoice = '' then
   v_denied := v_denied + 1;
   v_denied_keys := v_denied_keys || jsonb_build_array(item);
   continue;
  end if;
  if exists(select 1 from public.addon_invoice_deductions d
            where d.user_id=u and d.mst=v_mst and d.direction=v_direction
              and d.form_code=v_form and d.series=v_series and d.invoice_number=v_invoice) then
   v_seen := v_seen + 1;
   v_keys := v_keys || jsonb_build_array(item);
   continue;
  end if;
  select id into v_lot from public.addon_package_lots
  where user_id=u and family='invoice' and remaining>0
  order by created_at,id for update limit 1;
  if v_lot is null then
   v_denied := v_denied + 1;
   v_denied_keys := v_denied_keys || jsonb_build_array(item);
   continue;
  end if;
  update public.addon_package_lots set remaining=remaining-1 where id=v_lot;
  insert into public.addon_invoice_deductions(user_id,mst,direction,form_code,series,invoice_number)
  values(u,v_mst,v_direction,v_form,v_series,v_invoice)
  returning id into v_id;
  v_new := v_new+1;
  v_keys := v_keys || jsonb_build_array(item);
 end loop;
 return jsonb_build_object('deducted',v_new,'previously_deducted',v_seen,
   'denied',v_denied,'allowed_items',v_keys,'denied_items',v_denied_keys);
end $$;
revoke all on function public.addon_claim_invoice_quota(jsonb) from public;
grant execute on function public.addon_claim_invoice_quota(jsonb) to authenticated;

-- ========== 016_admin_customer_v32_snapshot.sql ==========
-- AutoTax V3.2: one admin-only customer snapshot for both extension and web admin.
-- Deploy after migration 015. Read-only RPC; no legacy subscription data.
create or replace function public.addon_admin_list_users_v32(p_search text default '')
returns jsonb
language plpgsql stable security definer set search_path = public, auth
as $$
declare
 v_search text := lower(left(btrim(coalesce(p_search,'')),128));
 v_result jsonb;
begin
 if auth.uid() is null or not public.addon_is_admin() then
  raise exception 'admin_required';
 end if;
 select coalesce(jsonb_agg(
  jsonb_build_object(
   'user_id',u.id,
   'email',u.email,
   'created_at',u.created_at,
   'mode',coalesce(um.mode,case when coalesce(inv.purchased,0)>0 and coalesce(ms.active_quantity,0)=0 then 'invoice' else 'mst' end),
   'invoice_remaining',coalesce(inv.remaining,0),
   'invoice_purchased',coalesce(inv.purchased,0),
   'can_reread_charged_invoices',coalesce(inv.has_history,false),
   'mst_capacity',coalesce(ms.active_quantity,0),
   'mst_nearest_expiry',ms.nearest_expiry,
   'mst_farthest_expiry',ms.farthest_expiry,
   'mst_assignments',coalesce(assn.items,'[]'::jsonb),
   'trial_used',coalesce(tr.was_used,false),
   'trial_expires_at',trial_lot.latest_expiry,
   'last_package_at',lots.last_package_at
  ) order by u.created_at desc
 ),'[]'::jsonb)
 into v_result
 from (
  select id,email,created_at from auth.users
  where v_search='' or strpos(lower(email),v_search)>0
  order by created_at desc limit 500
 ) u
 left join public.addon_usage_modes um on um.user_id=u.id
 left join lateral (
  select exists(select 1 from public.addon_trial_email_registry r
   where r.first_user_id=u.id or r.email_normalized=lower(btrim(u.email))) as was_used
 ) tr on true
 left join lateral (
  select max(l.expires_at) as latest_expiry
  from public.addon_package_lots l where l.user_id=u.id and l.grant_kind='trial'
 ) trial_lot on true
 left join lateral (
  select coalesce(sum(l.quantity),0)::bigint as purchased,
         coalesce(sum(l.remaining),0)::bigint as remaining,
         exists(select 1 from public.addon_invoice_deductions d where d.user_id=u.id) as has_history
  from public.addon_package_lots l
  where l.user_id=u.id and l.family='invoice'
 ) inv on true
 left join lateral (
  select coalesce(sum(l.quantity),0)::bigint as active_quantity,
         min(l.expires_at) as nearest_expiry,
         max(l.expires_at) as farthest_expiry,
         max(l.expires_at) filter (where l.grant_kind='trial') as trial_expires_at
  from public.addon_package_lots l
  where l.user_id=u.id and l.family='mst'
    and (l.expires_at is null or l.expires_at>now())
 ) ms on true
 left join lateral (
  select coalesce(jsonb_agg(jsonb_build_object('mst',a.mst,'assigned_at',a.assigned_at)
    order by a.assigned_at,a.id),'[]'::jsonb) as items
  from public.addon_mst_assignments a where a.user_id=u.id
 ) assn on true
 left join lateral (
  select max(l.created_at) as last_package_at
  from public.addon_package_lots l where l.user_id=u.id
 ) lots on true;
 return v_result;
end $$;

revoke all on function public.addon_admin_list_users_v32(text)
 from public,anon,authenticated;
grant execute on function public.addon_admin_list_users_v32(text) to authenticated;

-- ========== 017_shared_catalog_and_admin_logs.sql ==========
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

-- ========== 018_remove_legacy_plan_order_dependency.sql ==========
-- AutoTax V3.2: remove mandatory dependency on legacy monthly/yearly plan rows.
-- Apply after 017_shared_catalog_and_admin_logs.sql.
alter table public.addon_orders alter column plan_code drop not null;

create or replace function public.addon_create_package_order(p_package_code text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
 u uuid:=auth.uid();
 p public.addon_package_catalog%rowtype;
 ref text;
 o public.addon_orders%rowtype;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select * into p from public.addon_package_catalog
 where code=p_package_code and active for share;
 if not found or p.price_vnd<=0 then raise exception 'package_unavailable'; end if;
 if p.family='mst' and (p.validity_days is null or p.validity_days<1)
 then raise exception 'mst_validity_not_configured'; end if;
 loop
  ref:='ADDON'||upper(encode(gen_random_bytes(5),'hex'));
  exit when not exists(select 1 from public.addon_orders where payment_reference=ref);
 end loop;
 insert into public.addon_orders
  (user_id,package_code,package_quantity_snapshot,package_validity_days_snapshot,
   amount_vnd,currency,status,payment_reference,payment_provider)
 values
  (u,p.code,p.quantity,p.validity_days,p.price_vnd,'VND','pending',ref,'sepay')
 returning * into o;
 return jsonb_build_object('success',true,'order_id',o.id,
  'package_code',p.code,'amount_vnd',o.amount_vnd,'payment_reference',ref);
end $$;

revoke all on function public.addon_create_package_order(text) from public,anon;
grant execute on function public.addon_create_package_order(text) to authenticated;

-- Restore administrators; authentication accounts were never deleted.
insert into public.addon_admins(user_id) select user_id from autotax_preserved_admins on conflict do nothing;
-- Retire old subscription RPCs and legacy invoice deduction entry point.
drop function if exists public.addon_claim_trial();
drop function if exists public.addon_my_license();
drop function if exists public.addon_admin_grant(uuid,text,boolean);
drop function if exists public.addon_create_order(text);
drop function if exists public.addon_record_invoice_download(jsonb);
-- Old subscription tables are kept as empty internal dependencies of historical SQL;
-- they must not grant entitlements in V3.2.
commit;
