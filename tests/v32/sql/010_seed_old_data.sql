-- TEST ONLY: three real-looking identities and legacy business data to discard.
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','admin@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','buyer@example.invalid'),
 ('00000000-0000-4000-8000-000000000003','second@example.invalid');
insert into public.addon_admins(user_id)
 values('00000000-0000-4000-8000-000000000001');
insert into public.addon_trial_claims(user_id,email_normalized)
 values('00000000-0000-4000-8000-000000000002','buyer@example.invalid');
insert into public.addon_subscriptions(user_id,plan_code,starts_at,ends_at,source)
 values('00000000-0000-4000-8000-000000000002','trial_7d',now()-interval '5 days',now()+interval '2 days','trial');
insert into public.addon_orders(user_id,plan_code,amount_vnd,payment_reference,payment_provider)
 values('00000000-0000-4000-8000-000000000003','monthly',20000,'ADDONABCDEF1234','sepay');
insert into public.addon_gift_codes(code,months)
 values('TENDOO-OLDGIFT1',1);
do $assert$
begin
 if (select count(*) from auth.users)<>3 then raise exception 'bad_old_account_fixture'; end if;
 if (select count(*) from public.addon_admins)<>1 then raise exception 'bad_old_admin_fixture'; end if;
 if (select count(*) from public.addon_subscriptions)<>1 then raise exception 'bad_old_subscription_fixture'; end if;
end $assert$;
