-- Tendoo Add-on: admin pricing, one-time gift codes and password-reset support.
-- Run in the dedicated Add-on Supabase project only.

create table if not exists public.addon_gift_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  months integer not null check (months between 1 and 120),
  used boolean not null default false,
  active boolean not null default true,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.addon_gift_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid references public.addon_gift_codes(id) on delete set null,
  code_snapshot text not null,
  user_id uuid not null references auth.users(id),
  months integer not null,
  subscription_id uuid references public.addon_subscriptions(id) on delete set null,
  redeemed_at timestamptz not null default now()
);
create unique index if not exists addon_gift_redemption_once_idx
  on public.addon_gift_redemptions(code_snapshot);
alter table public.addon_gift_codes enable row level security;
alter table public.addon_gift_redemptions enable row level security;
revoke all on public.addon_gift_codes, public.addon_gift_redemptions from public, anon, authenticated;

create or replace function public.addon_admin_set_price(p_plan_code text,p_price_vnd bigint)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_plan_code not in ('monthly','yearly') then raise exception 'invalid_paid_plan'; end if;
 if p_price_vnd < 1000 or p_price_vnd > 100000000 then raise exception 'invalid_price'; end if;
 update public.addon_plans set price_vnd=p_price_vnd where code=p_plan_code;
 insert into public.addon_audit_logs(actor_id,action,details)
 values(auth.uid(),'plan_price_updated',jsonb_build_object('plan_code',p_plan_code,'price_vnd',p_price_vnd));
 return jsonb_build_object('success',true,'plan_code',p_plan_code,'price_vnd',p_price_vnd);
end $$;

create or replace function public.addon_admin_create_gift(p_months integer,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_code text;
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 if p_months < 1 or p_months > 120 then raise exception 'invalid_months'; end if;
 loop
  v_code := 'TENDOO-' || upper(encode(public.gen_random_bytes(5),'hex'));
  exit when not exists(select 1 from public.addon_gift_codes where code=v_code);
 end loop;
 insert into public.addon_gift_codes(code,months,expires_at,created_by)
 values(v_code,p_months,p_expires_at,auth.uid());
 insert into public.addon_audit_logs(actor_id,action,details)
 values(auth.uid(),'gift_code_created',jsonb_build_object('code',v_code,'months',p_months,'expires_at',p_expires_at));
 return jsonb_build_object('success',true,'code',v_code,'months',p_months,'expires_at',p_expires_at);
end $$;

create or replace function public.addon_admin_list_gifts()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 return coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at desc)
   from public.addon_gift_codes g),'[]'::jsonb);
end $$;

create or replace function public.addon_admin_set_gift_active(p_gift_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 update public.addon_gift_codes set active=p_active where id=p_gift_id;
 if not found then raise exception 'gift_not_found'; end if;
 insert into public.addon_audit_logs(actor_id,action,details)
 values(auth.uid(),case when p_active then 'gift_code_reopened' else 'gift_code_closed' end,jsonb_build_object('gift_id',p_gift_id));
 return jsonb_build_object('success',true);
end $$;

create or replace function public.addon_admin_delete_gift(p_gift_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_code text; v_used boolean;
begin
 if not public.addon_is_admin() then raise exception 'admin_required'; end if;
 select code,used into v_code,v_used from public.addon_gift_codes where id=p_gift_id for update;
 if not found then raise exception 'gift_not_found'; end if;
 -- Redemption history stores a code snapshot; subscriptions are independent and remain untouched.
 delete from public.addon_gift_codes where id=p_gift_id;
 insert into public.addon_audit_logs(actor_id,action,details)
 values(auth.uid(),'gift_code_deleted',jsonb_build_object('gift_id',p_gift_id,'code',v_code,'was_used',v_used));
 return jsonb_build_object('success',true,'was_used',v_used);
end $$;

create or replace function public.addon_redeem_gift(p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid := auth.uid(); v_gift public.addon_gift_codes%rowtype;
 v_start timestamptz; v_end timestamptz; v_sub uuid;
begin
 if v_user is null then raise exception 'authentication_required'; end if;
 select * into v_gift from public.addon_gift_codes
 where code=upper(trim(p_code)) for update;
 if not found or not v_gift.active then raise exception 'gift_invalid_or_closed'; end if;
 if v_gift.used then raise exception 'gift_already_used'; end if;
 if v_gift.expires_at is not null and v_gift.expires_at <= now() then raise exception 'gift_expired'; end if;
 select greatest(coalesce(max(ends_at) filter(where status='active' and ends_at>now()),now()),now())
 into v_start from public.addon_subscriptions where user_id=v_user;
 v_end := v_start + make_interval(months=>v_gift.months);
 insert into public.addon_subscriptions(user_id,plan_code,starts_at,ends_at,source,created_by)
 values(v_user,'monthly',v_start,v_end,'admin',v_user) returning id into v_sub;
 update public.addon_gift_codes set used=true,active=false where id=v_gift.id;
 insert into public.addon_gift_redemptions(gift_id,code_snapshot,user_id,months,subscription_id)
 values(v_gift.id,v_gift.code,v_user,v_gift.months,v_sub);
 insert into public.addon_audit_logs(actor_id,target_user_id,action,details)
 values(v_user,v_user,'gift_code_redeemed',jsonb_build_object('code',v_gift.code,'months',v_gift.months,'subscription_id',v_sub));
 return jsonb_build_object('success',true,'months',v_gift.months,'ends_at',v_end);
end $$;

revoke all on function public.addon_admin_set_price(text,bigint) from public, anon;\nrevoke all on function public.addon_admin_create_gift(integer,timestamptz) from public, anon;\nrevoke all on function public.addon_admin_list_gifts() from public, anon;\nrevoke all on function public.addon_admin_set_gift_active(uuid,boolean) from public, anon;\nrevoke all on function public.addon_admin_delete_gift(uuid) from public, anon;\nrevoke all on function public.addon_redeem_gift(text) from public, anon;\ngrant execute on function public.addon_admin_set_price(text,bigint) to authenticated;
grant execute on function public.addon_admin_create_gift(integer,timestamptz) to authenticated;
grant execute on function public.addon_admin_list_gifts() to authenticated;
grant execute on function public.addon_admin_set_gift_active(uuid,boolean) to authenticated;
grant execute on function public.addon_admin_delete_gift(uuid) to authenticated;
grant execute on function public.addon_redeem_gift(text) to authenticated;
