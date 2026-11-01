-- AutoTax V3.2: harden invoice claim and enable zero-credit invoice replay mode.
-- Apply AFTER 018_remove_legacy_plan_order_dependency.sql.
-- A user can switch to invoice mode even when remaining is zero IF they have already
-- paid for and read invoices; this permits replay-free rereads across modes.
create or replace function public.addon_set_usage_mode(p_mode text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid();
begin
 if u is null or p_mode not in ('invoice','mst') then raise exception 'invalid_mode'; end if;
 if p_mode='invoice' and not (
  exists(select 1 from public.addon_package_lots where user_id=u and family='invoice' and remaining>0)
  or exists(select 1 from public.addon_invoice_deductions where user_id=u)
 ) then raise exception 'invoice_package_required'; end if;
 if p_mode='mst' and not exists (
  select 1 from public.addon_package_lots where user_id=u and family='mst'
   and (expires_at is null or expires_at>now())
 ) then raise exception 'mst_package_required'; end if;
 insert into public.addon_usage_modes(user_id,mode) values(u,p_mode)
 on conflict(user_id) do update set mode=excluded.mode,updated_at=now();
 return jsonb_build_object('success',true,'mode',p_mode);
end $$;
revoke all on function public.addon_set_usage_mode(text) from public,anon;
grant execute on function public.addon_set_usage_mode(text) to authenticated;

-- AutoTax V3.2: bounded invoice claim batches, safe rereads and mode changes.
-- Deploy after 014_invoice_reread_entitlements.sql.
-- A successful claim reserves exactly one quota unit before exporting.
-- Claims of previously charged invoices do not charge again.
create or replace function public.addon_claim_invoice_quota(p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
 u uuid := auth.uid();
 item jsonb;
 v_mst text; v_direction text; v_form text; v_series text; v_invoice text;
 v_new integer := 0; v_seen integer := 0; v_denied integer := 0;
 v_id bigint; v_lot uuid;
 v_keys jsonb := '[]'::jsonb; v_denied_keys jsonb := '[]'::jsonb;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce(
  (select mode from public.addon_usage_modes where user_id=u),
  (case when exists(select 1 from public.addon_package_lots
   where user_id=u and family='invoice')
   and not exists(select 1 from public.addon_package_lots
   where user_id=u and family='mst' and (expires_at is null or expires_at>now()))
   then 'invoice' else 'mst' end)
 ) <> 'invoice' then
  raise exception 'invoice_mode_not_selected';
 end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_items'; end if;
 if jsonb_array_length(p_items)>250 then raise exception 'too_many_invoice_items'; end if;
 -- Serialize claims per account, including concurrent Chrome tabs.
 perform pg_advisory_xact_lock(hashtextextended(u::text, 774219));
 for item in select value from jsonb_array_elements(p_items) loop
  v_mst := trim(coalesce(item->>'mst',''));
  v_direction := trim(coalesce(item->>'direction',''));
  v_form := trim(coalesce(item->>'form_code',''));
  v_series := trim(coalesce(item->>'series',''));
  v_invoice := trim(coalesce(item->>'invoice_number',''));
  if v_mst = '' or v_invoice = '' then
   v_denied := v_denied + 1;
   v_denied_keys := v_denied_keys || jsonb_build_array(item);
   continue;
  end if;
  if exists(select 1 from public.addon_invoice_deductions d
            where d.user_id=u and d.mst=v_mst and d.direction=v_direction
              and d.form_code=v_form and d.series=v_series and d.invoice_number=v_invoice) then
   v_seen := v_seen + 1;
   v_keys := v_keys || jsonb_build_array(item);
   continue;
  end if;
  select id into v_lot from public.addon_package_lots
  where user_id=u and family='invoice' and remaining>0
  order by created_at,id for update limit 1;
  if v_lot is null then
   v_denied := v_denied + 1;
   v_denied_keys := v_denied_keys || jsonb_build_array(item);
   continue;
  end if;
  update public.addon_package_lots set remaining=remaining-1 where id=v_lot;
  insert into public.addon_invoice_deductions(user_id,mst,direction,form_code,series,invoice_number)
  values(u,v_mst,v_direction,v_form,v_series,v_invoice)
  returning id into v_id;
  v_new := v_new+1;
  v_keys := v_keys || jsonb_build_array(item);
 end loop;
 return jsonb_build_object('deducted',v_new,'previously_deducted',v_seen,
   'denied',v_denied,'allowed_items',v_keys,'denied_items',v_denied_keys);
end $$;
revoke all on function public.addon_claim_invoice_quota(jsonb) from public;
grant execute on function public.addon_claim_invoice_quota(jsonb) to authenticated;
