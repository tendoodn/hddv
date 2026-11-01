-- TEST ONLY: unrelated third-party table referencing an AutoTax order.
-- Upgrader must refuse TRUNCATE ... RESTRICT and roll back every change.
create table public.external_order_review(
 id bigint generated always as identity primary key,
 order_id uuid not null references public.addon_orders(id),
 note text not null default 'external_reference_must_survive'
);
insert into public.external_order_review(order_id)
 select id from public.addon_orders where payment_reference='ADDONABCDEF1234';
