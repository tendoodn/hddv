-- TEST ONLY. Emulates minimal Supabase Auth for local GitHub Actions PostgreSQL.
create extension if not exists pgcrypto;
create schema if not exists auth;
do $r$
begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $r$;
create table auth.users(
 id uuid primary key,
 email text unique not null,
 created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema public,auth to authenticated,anon,service_role;
