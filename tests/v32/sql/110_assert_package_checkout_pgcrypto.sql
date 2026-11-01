-- Regression: Supabase production installs pgcrypto in the extensions schema.
-- The checkout RPC must work for authenticated users with that layout.
-- The entire trial is rolled back (no test orders or balance changes survive).
begin;
create schema if not exists extensions;
alter extension pgcrypto set schema extensions;
select set_config(
 'request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true
);
set local role authenticated;
do $checkout$
declare
 a jsonb;
 b jsonb;
begin
 a := public.addon_create_package_order('T100');
 b := public.addon_create_package_order('MST1');
 if a->>'package_code'<>'T100' or b->>'package_code'<>'MST1'
 then raise exception 'checkout_wrong_package_codes'; end if;
 if a->>'payment_reference' !~ '^ADDON[0-9A-F]{10}$'
   or b->>'payment_reference' !~ '^ADDON[0-9A-F]{10}$'
 then raise exception 'checkout_reference_invalid'; end if;
 if a->>'payment_reference'=b->>'payment_reference'
 then raise exception 'checkout_duplicate_reference'; end if;
end $checkout$;
rollback;

do $cfg$
declare v_config text[];
begin
 select proconfig into v_config from pg_proc
 where oid='public.addon_create_package_order(text)'::regprocedure;
 if not ('search_path=public, auth, extensions'=any(v_config))
 then raise exception 'checkout_pgcrypto_search_path_regressed'; end if;
end $cfg$;
select 'checkout_pgcrypto_extensions_schema_test_passed' as status;
