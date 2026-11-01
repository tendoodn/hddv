-- TEST ONLY. Verify Supabase exposed RPCs work with real limited client roles.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $check$
declare r jsonb;
begin
 r:=public.addon_my_entitlements();
 if r is null then raise exception 'authenticated_cannot_read_own_license'; end if;
 r:=public.addon_list_packages();
 if jsonb_array_length(r)<10 then raise exception 'authenticated_cannot_list_packages'; end if;
 r:=public.addon_list_my_mst_assignments();
 if r is null then raise exception 'authenticated_cannot_list_own_mst'; end if;
 begin
  perform public.addon_admin_list_users_v32();
  raise exception 'customer_can_query_admin_users';
 exception when others then
  if sqlerrm<>'admin_required' then raise; end if;
 end;
 begin
  perform public.addon_admin_list_mst_assignments();
  raise exception 'customer_can_query_admin_mst';
 exception when others then
  if sqlerrm<>'admin_required' then raise; end if;
 end;
end $check$;
rollback;

begin;
set local role anon;
do $anon$
begin
 if has_function_privilege('anon','public.addon_my_entitlements()','EXECUTE')
 then raise exception 'anon_can_read_entitlements'; end if;
 if has_function_privilege('anon','public.addon_admin_list_users_v32(text)','EXECUTE')
 then raise exception 'anon_can_read_admin_customer_snapshot'; end if;
 if has_function_privilege('anon','public.addon_process_sepay_payment(text,text,bigint,jsonb)','EXECUTE')
 then raise exception 'anon_can_process_payments'; end if;
 if has_function_privilege('anon','public.addon_start_mst_trial(text)','EXECUTE')
 then raise exception 'anon_can_start_trial'; end if;
end $anon$;
rollback;
select 'restricted_role_permissions_passed' as status;
