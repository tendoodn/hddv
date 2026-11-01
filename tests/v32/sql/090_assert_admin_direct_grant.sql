-- TEST ONLY: privileged admin grants package lots directly, customers cannot.
do $preflight$
begin
 if has_function_privilege('anon','public.addon_admin_grant_package_v32(uuid,text)','EXECUTE')
 then raise exception 'anon_cannot_be_allowed_to_grant_packages'; end if;
 if not has_function_privilege('authenticated','public.addon_admin_grant_package_v32(uuid,text)','EXECUTE')
 then raise exception 'admin_client_missing_grant_rpc_permission'; end if;
end $preflight$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $customer$
begin
 begin
  perform public.addon_admin_grant_package_v32(
   '00000000-0000-4000-8000-000000000003','T200'
  );
  raise exception 'customer_must_not_grant_package';
 exception when others then
  if sqlerrm<>'admin_required' then raise; end if;
 end;
end $customer$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $admin$
declare v_result jsonb;
begin
 v_result:=public.addon_admin_grant_package_v32(
  '00000000-0000-4000-8000-000000000003','T200'
 );
 if v_result->>'success'<>'true'
  or (v_result->>'quantity')::integer<>200
  or v_result->>'expires_at' is not null
 then raise exception 'invoice_grant_wrong'; end if;

 v_result:=public.addon_admin_grant_package_v32(
  '00000000-0000-4000-8000-000000000003','MST5'
 );
 if v_result->>'success'<>'true'
  or (v_result->>'quantity')::integer<>5
  or v_result->>'expires_at' is null
 then raise exception 'mst_grant_wrong'; end if;
end $admin$;
commit;

do $verify$
begin
 if (select count(*) from public.addon_package_lots
  where user_id='00000000-0000-4000-8000-000000000003'
   and grant_kind='gift' and package_code='T200'
   and price_snapshot=0 and remaining=200 and expires_at is null)<1
 then raise exception 'invoice_admin_grant_not_persisted'; end if;

 if (select count(*) from public.addon_package_lots
  where user_id='00000000-0000-4000-8000-000000000003'
   and grant_kind='gift' and package_code='MST5'
   and price_snapshot=0 and quantity=5
   and expires_at between now()+interval '364 days'
     and now()+interval '366 days')<1
 then raise exception 'mst_admin_grant_not_one_year'; end if;

 if (select count(*) from public.addon_audit_logs
  where action='admin_package_granted_v32'
   and actor_id='00000000-0000-4000-8000-000000000001'
   and target_user_id='00000000-0000-4000-8000-000000000003')<>2
 then raise exception 'admin_grants_not_audited'; end if;
end $verify$;
select 'admin_direct_grant_passed' as status;
