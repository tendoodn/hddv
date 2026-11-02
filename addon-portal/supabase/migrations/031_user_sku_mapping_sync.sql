-- AutoTax Web + Chrome Extension: per-user SKU mapping sync (no invoice files or credentials).
create table if not exists public.addon_user_sku_mappings(
 user_id uuid not null references auth.users(id) on delete cascade,
 platform text not null check(platform in ('misa','tendoo')),
 catalog_key text not null check(length(catalog_key) between 5 and 160),
 product_key text not null check(length(product_key) between 1 and 300),
 sku text not null check(length(sku) between 1 and 160),
 updated_at timestamptz not null default now(),
 primary key(user_id,platform,catalog_key,product_key)
);
alter table public.addon_user_sku_mappings enable row level security;
grant select,insert,update,delete on public.addon_user_sku_mappings to authenticated;
revoke all on public.addon_user_sku_mappings from anon;
drop policy if exists addon_user_sku_select_own on public.addon_user_sku_mappings;
create policy addon_user_sku_select_own on public.addon_user_sku_mappings for select to authenticated
 using(user_id=(select auth.uid()));
drop policy if exists addon_user_sku_insert_own on public.addon_user_sku_mappings;
create policy addon_user_sku_insert_own on public.addon_user_sku_mappings for insert to authenticated
 with check(user_id=(select auth.uid()));
drop policy if exists addon_user_sku_update_own on public.addon_user_sku_mappings;
create policy addon_user_sku_update_own on public.addon_user_sku_mappings for update to authenticated
 using(user_id=(select auth.uid()))
 with check(user_id=(select auth.uid()));
drop policy if exists addon_user_sku_delete_own on public.addon_user_sku_mappings;
create policy addon_user_sku_delete_own on public.addon_user_sku_mappings for delete to authenticated
 using(user_id=(select auth.uid()));
