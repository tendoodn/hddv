-- Public read-only download URL, writable exclusively by authenticated addon admins.
-- Only HTTPS links are allowed. Empty string means the download is not published.
create table if not exists public.addon_public_settings (
  setting_key text primary key check (setting_key = 'extension_download_url'),
  value text not null default '' check (value = '' or (value ~ '^https://[^[:space:]]+$' and length(value) <= 2048)),
  updated_at timestamptz not null default now()
);
alter table public.addon_public_settings enable row level security;
revoke all on public.addon_public_settings from public, anon, authenticated;
grant select on public.addon_public_settings to anon, authenticated;
grant insert, update on public.addon_public_settings to authenticated;
drop policy if exists addon_settings_public_read on public.addon_public_settings;
create policy addon_settings_public_read on public.addon_public_settings
  for select to anon, authenticated using (true);
drop policy if exists addon_settings_admin_insert on public.addon_public_settings;
create policy addon_settings_admin_insert on public.addon_public_settings
  for insert to authenticated with check ((select public.addon_is_admin()));
drop policy if exists addon_settings_admin_update on public.addon_public_settings;
create policy addon_settings_admin_update on public.addon_public_settings
  for update to authenticated using ((select public.addon_is_admin()))
  with check ((select public.addon_is_admin()));
insert into public.addon_public_settings (setting_key,value)
values ('extension_download_url','') on conflict (setting_key) do nothing;
