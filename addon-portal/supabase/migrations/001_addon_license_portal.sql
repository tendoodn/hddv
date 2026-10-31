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
