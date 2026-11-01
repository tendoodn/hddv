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
