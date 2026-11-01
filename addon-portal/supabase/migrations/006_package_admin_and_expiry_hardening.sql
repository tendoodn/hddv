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
