-- V3.2: bank QR display deadline, per-user order status and paid transition.
-- All test orders/payments rolled back; no bank transfer occurs.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $checkout$
declare
 v jsonb;
 v_status jsonb;
 v_other jsonb;
 v_order_id uuid;
 v_deadline timestamptz;
 v_created timestamptz;
begin
 v:=public.addon_create_package_order('T100');
 v_order_id=(v->>'order_id')::uuid;
 v_deadline=(v->>'qr_expires_at')::timestamptz;
 if v_deadline is null then raise exception 'qr_deadline_missing'; end if;
 v_status:=public.addon_my_order_status(v_order_id);
 if v_status->>'status'<>'pending' or (v_status->>'qr_expires_at')::timestamptz<>v_deadline
 then raise exception 'pending_order_status_missing_or_wrong'; end if;
 -- Server-side 5m validity: test duration instead of relying on web browser clock.
 select created_at into v_created from public.addon_orders where id=v_order_id;
 if v_deadline < v_created + interval '4 minutes 59 seconds'
    or v_deadline > v_created + interval '5 minutes 1 second'
 then raise exception 'wrong_five_minute_qr_deadline'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
 v_other:=public.addon_my_order_status(v_order_id);
 if v_other is not null then raise exception 'other_customer_can_read_order'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
end $checkout$;
rollback;

do $roles$
begin
 if has_function_privilege('anon','public.addon_my_order_status(uuid)','EXECUTE')
 then raise exception 'anonymous_can_read_private_order_status'; end if;
 if not has_function_privilege('authenticated','public.addon_my_order_status(uuid)','EXECUTE')
 then raise exception 'authenticated_cannot_read_own_order_status'; end if;
end $roles$;
select 'five_minute_qr_and_private_status_passed' as status;
