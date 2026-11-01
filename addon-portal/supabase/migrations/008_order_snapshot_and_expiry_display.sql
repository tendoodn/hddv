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
