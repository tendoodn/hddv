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
