-- AutoTax V3.2: 5-minute bank QR display window and private order status.
-- Applies after 023. Safe additive migration: historical orders and payments intact.
-- The QR bank transfer itself cannot be revoked by software at 5 minutes.
-- Delayed genuine bank transfers remain processable to avoid silently losing funds.

alter table public.addon_orders
 add column if not exists qr_expires_at timestamptz;

create or replace function public.addon_create_package_order(p_package_code text)
returns jsonb language plpgsql security definer
set search_path=public,auth,extensions as $$
declare
 u uuid:=auth.uid();
 p public.addon_package_catalog%rowtype;
 ref text;
 o public.addon_orders%rowtype;
 v_now timestamptz := clock_timestamp();
begin
 if u is null then raise exception 'authentication_required'; end if;
 select * into p from public.addon_package_catalog
 where code=p_package_code and active for share;
 if not found or p.price_vnd<=0 then raise exception 'package_unavailable'; end if;
 if p.family='mst' and (p.validity_days is null or p.validity_days<1)
 then raise exception 'mst_validity_not_configured'; end if;
 loop
  ref:='ADDON'||upper(encode(extensions.gen_random_bytes(5),'hex'));
  exit when not exists(select 1 from public.addon_orders where payment_reference=ref);
 end loop;
 insert into public.addon_orders
  (user_id,package_code,package_quantity_snapshot,package_validity_days_snapshot,
   amount_vnd,currency,status,payment_reference,payment_provider,qr_expires_at)
 values
  (u,p.code,p.quantity,p.validity_days,p.price_vnd,'VND','pending',ref,'sepay',
   v_now+interval '5 minutes')
 returning * into o;
 return jsonb_build_object(
  'success',true,'order_id',o.id,'package_code',p.code,'amount_vnd',o.amount_vnd,
  'payment_reference',ref,'qr_expires_at',o.qr_expires_at);
end $$;
revoke all on function public.addon_create_package_order(text) from public,anon;
grant execute on function public.addon_create_package_order(text) to authenticated;

-- RLS already restricts order reads to owner/admin; explicitly grant the
-- authenticated role SELECT so the invoker RPC also works on fresh installs.
alter table public.addon_orders enable row level security;
grant select on public.addon_orders to authenticated;

-- SECURITY INVOKER: RLS restricts this read to the signed-in order owner.
-- The explicit auth.uid filter prevents admin access being mistaken for ownership.
create or replace function public.addon_my_order_status(p_order_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'order_id',o.id,'status',o.status,'package_code',o.package_code,
  'qr_expires_at',o.qr_expires_at,'paid_at',o.paid_at
 )
 from public.addon_orders o
 where o.id=p_order_id and o.user_id=auth.uid()
$$;
revoke all on function public.addon_my_order_status(uuid) from public,anon,authenticated;
grant execute on function public.addon_my_order_status(uuid) to authenticated;

-- pgcrypto lives in extensions on production, including for admin unlock creation.
alter function public.addon_admin_create_package_unlock(text,timestamptz)
 set search_path=public,auth,extensions;

-- Allow a subscriber to learn promptly when its OWN order is paid.
-- Existing RLS policy on addon_orders filters other customers' order rows.
do $realtime$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
   and not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='addon_orders'
   )
 then
  alter publication supabase_realtime add table public.addon_orders;
 end if;
end $realtime$;

notify pgrst, 'reload schema';
