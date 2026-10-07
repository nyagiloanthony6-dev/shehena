-- Shehena — arrival & payment collection
-- 1. Companies can store payment instructions (M-Pesa Lipa Namba, bank account…)
--    that go into messages to customers who still owe money.
-- 2. Goods cannot be released (status 'collected') until they are paid.

alter table public.companies
  add column if not exists payment_instructions text not null default '';

create or replace function public.guard_release() returns trigger
language plpgsql as $$
begin
  if new.status = 'collected' and new.pay <> 'paid' then
    raise exception 'Record the payment before releasing the goods';
  end if;
  return new;
end $$;

drop trigger if exists shipments_release on public.shipments;
create trigger shipments_release before insert or update on public.shipments
  for each row execute function public.guard_release();
