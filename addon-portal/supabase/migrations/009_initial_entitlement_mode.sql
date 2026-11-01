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
