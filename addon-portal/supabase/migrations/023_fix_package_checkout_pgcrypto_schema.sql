-- AutoTax V3.2 hotfix: pgcrypto is installed in schema 'extensions' on
-- Supabase production. The package-order RPC previously searched only public/auth,
-- causing 42883: gen_random_bytes(integer) does not exist.
-- Keep existing function body/ACL/owner unchanged; no data updates.
alter function public.addon_create_package_order(text)
  set search_path = public, auth, extensions;

-- Refresh PostgREST function schema cache: HTTP 404 was observed for RPC.
notify pgrst, 'reload schema';
