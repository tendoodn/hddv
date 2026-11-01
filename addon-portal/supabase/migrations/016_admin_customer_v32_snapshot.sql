-- AutoTax V3.2: one admin-only customer snapshot for both extension and web admin.
-- Deploy after migration 015. Read-only RPC; no legacy subscription data.
create or replace function public.addon_admin_list_users_v32(p_search text default '')
returns jsonb
language plpgsql stable security definer set search_path = public, auth
as $$
declare
 v_search text := lower(left(btrim(coalesce(p_search,'')),128));
 v_result jsonb;
begin
 if auth.uid() is null or not public.addon_is_admin() then
  raise exception 'admin_required';
 end if;
 select coalesce(jsonb_agg(
  jsonb_build_object(
   'user_id',u.id,
   'email',u.email,
   'created_at',u.created_at,
   'mode',coalesce(um.mode,case when coalesce(inv.purchased,0)>0 and coalesce(ms.active_quantity,0)=0 then 'invoice' else 'mst' end),
   'invoice_remaining',coalesce(inv.remaining,0),
   'invoice_purchased',coalesce(inv.purchased,0),
   'can_reread_charged_invoices',coalesce(inv.has_history,false),
   'mst_capacity',coalesce(ms.active_quantity,0),
   'mst_nearest_expiry',ms.nearest_expiry,
   'mst_farthest_expiry',ms.farthest_expiry,
   'mst_assignments',coalesce(assn.items,'[]'::jsonb),
   'trial_used',tr.email_normalized is not null,
   'trial_expires_at',ms.trial_expires_at,
   'last_package_at',lots.last_package_at
  ) order by u.created_at desc
 ),'[]'::jsonb)
 into v_result
 from (
  select id,email,created_at from auth.users
  where v_search='' or strpos(lower(email),v_search)>0
  order by created_at desc limit 500
 ) u
 left join public.addon_usage_modes um on um.user_id=u.id
 left join public.addon_trial_email_registry tr
  on tr.email_normalized=lower(btrim(u.email))
 left join lateral (
  select coalesce(sum(l.quantity),0)::bigint as purchased,
         coalesce(sum(l.remaining),0)::bigint as remaining,
         exists(select 1 from public.addon_invoice_deductions d where d.user_id=u.id) as has_history
  from public.addon_package_lots l
  where l.user_id=u.id and l.family='invoice'
 ) inv on true
 left join lateral (
  select coalesce(sum(l.quantity),0)::bigint as active_quantity,
         min(l.expires_at) as nearest_expiry,
         max(l.expires_at) as farthest_expiry,
         max(l.expires_at) filter (where l.grant_kind='trial') as trial_expires_at
  from public.addon_package_lots l
  where l.user_id=u.id and l.family='mst'
    and (l.expires_at is null or l.expires_at>now())
 ) ms on true
 left join lateral (
  select coalesce(jsonb_agg(jsonb_build_object('mst',a.mst,'assigned_at',a.assigned_at)
    order by a.assigned_at,a.id),'[]'::jsonb) as items
  from public.addon_mst_assignments a where a.user_id=u.id
 ) assn on true
 left join lateral (
  select max(l.created_at) as last_package_at
  from public.addon_package_lots l where l.user_id=u.id
 ) lots on true;
 return v_result;
end $$;

revoke all on function public.addon_admin_list_users_v32(text)
 from public,anon,authenticated;
grant execute on function public.addon_admin_list_users_v32(text) to authenticated;
