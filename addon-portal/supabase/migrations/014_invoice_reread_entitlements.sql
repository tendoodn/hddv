-- AutoTax V3.2: invoice rereads remain accessible at zero quota.
-- Apply AFTER 013. This does not grant new downloads beyond purchased quota.
create or replace function public.addon_my_entitlements() returns jsonb
language plpgsql stable security definer set search_path=public,auth as $$
declare
 u uuid:=auth.uid();
 inv jsonb; ms jsonb; v_mode text;
 v_invoice_remaining bigint; v_mst_capacity bigint;
 v_nearest timestamptz; v_expiring bigint;
 v_has_history boolean;
begin
 if u is null then raise exception 'authentication_required'; end if;
 select jsonb_build_object('remaining',coalesce(sum(remaining),0),
   'purchased',coalesce(sum(quantity),0)),coalesce(sum(remaining),0)
 into inv,v_invoice_remaining
 from public.addon_package_lots where user_id=u and family='invoice';
 select exists(select 1 from public.addon_invoice_deductions where user_id=u)
 into v_has_history;
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
  v_mode:=case when v_invoice_remaining>0 and v_mst_capacity=0 then 'invoice' else 'mst' end;
 end if;
 return jsonb_build_object(
 'allowed',case when v_mode='invoice'
   then v_invoice_remaining>0 or v_has_history
   else v_mst_capacity>0 end,
 'can_download_new_invoices',v_invoice_remaining>0,
 'can_reread_charged_invoices',v_has_history,
 'packages',jsonb_build_object('invoice',inv,'mst',ms),
 'mode',v_mode,
 -- updated_at is informational only; do not use as proof of an order.
 'updated_at',now());
end $$;

-- Legacy RPC is unsafe (it can record a deduction without charging quota).
-- Keep only the atomic, idempotent claim API introduced in 011.
revoke all on function public.addon_record_invoice_download(jsonb)
 from public,anon,authenticated;
