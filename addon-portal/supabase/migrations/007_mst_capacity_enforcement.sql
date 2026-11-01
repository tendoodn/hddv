-- AutoTax v3.2.2: server-enforced deterministic MST profile capacity.
create table if not exists public.addon_mst_assignments(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 mst text not null,
 assigned_at timestamptz not null default now(),
 unique(user_id,mst)
);
alter table public.addon_mst_assignments enable row level security;
drop policy if exists addon_mst_assignments_read on public.addon_mst_assignments;
create policy addon_mst_assignments_read on public.addon_mst_assignments for select to authenticated using(user_id=auth.uid() or public.addon_is_admin());
create or replace function public.addon_authorize_mst(p_mst text) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); cap integer; assigned_rank bigint; existing_id bigint;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'mst' then
  return jsonb_build_object('allowed',false,'reason','mst_mode_not_selected');
 end if;
 if p_mst is null or length(trim(p_mst))=0 then raise exception 'mst_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select coalesce(sum(quantity),0)::int into cap from public.addon_package_lots
 where user_id=u and family='mst' and (expires_at is null or expires_at>now());
 select id into existing_id from public.addon_mst_assignments where user_id=u and mst=trim(p_mst);
 if existing_id is null then
  if (select count(*) from public.addon_mst_assignments where user_id=u)>=cap then
   return jsonb_build_object('allowed',false,'reason','mst_capacity_reached','capacity',cap);
  end if;
  insert into public.addon_mst_assignments(user_id,mst) values(u,trim(p_mst)) returning id into existing_id;
 end if;
 select count(*) into assigned_rank from public.addon_mst_assignments where user_id=u and id<=existing_id;
 return jsonb_build_object('allowed',assigned_rank<=cap,'reason',case when assigned_rank<=cap then 'ok' else 'mst_capacity_reduced' end,'capacity',cap,'assigned_rank',assigned_rank);
end $$;
grant execute on function public.addon_authorize_mst(text) to authenticated;
-- Correct locking clause order and only create a deduction when a quota lot is available.
create or replace function public.addon_record_invoice_download(p_items jsonb) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare u uuid:=auth.uid(); item jsonb; n int:=0; lot uuid; v_mst text; v_dir text; v_form text; v_series text; v_no text;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if coalesce((select mode from public.addon_usage_modes where user_id=u),'mst')<>'invoice' then raise exception 'invoice_mode_not_selected'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  v_mst:=coalesce(item->>'mst','');v_dir:=coalesce(item->>'direction','');v_form:=coalesce(item->>'form_code','');v_series:=coalesce(item->>'series','');v_no:=coalesce(item->>'invoice_number','');
  if v_mst='' or v_no='' then continue; end if;
  select id into lot from public.addon_package_lots where user_id=u and family='invoice' and remaining>0 order by created_at,id limit 1 for update skip locked;
  if lot is null then exit; end if;
  insert into public.addon_invoice_deductions(user_id,mst,direction,form_code,series,invoice_number)
  values(u,v_mst,v_dir,v_form,v_series,v_no) on conflict do nothing;
  if found then update public.addon_package_lots set remaining=remaining-1 where id=lot; n:=n+1; end if;
  lot:=null;
 end loop;
 return jsonb_build_object('deducted',n);
end $$;
