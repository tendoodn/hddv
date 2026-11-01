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
