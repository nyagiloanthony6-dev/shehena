-- Shehena — part payments (road and air)
--
-- A customer can pay part of the charge at the origin and the rest at the destination (or in several
-- payments). shipments.paid_amount is what has been paid so far; the balance is charge − paid_amount.
-- When the payments reach the charge the consignment becomes "paid" by itself.
-- shipment_payments keeps every payment (amount, method, when, who, at which office) for receipts
-- and reports. Run after 0016.

alter table public.shipments add column if not exists paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0);
update public.shipments set paid_amount = charge where pay = 'paid' and paid_amount = 0;

create table if not exists public.shipment_payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  method      text not null default '',
  station     text,                     -- office where the money was taken
  paid_at     timestamptz not null default now(),
  paid_by     text,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists shipment_payments_ship on public.shipment_payments (shipment_id);
create index if not exists shipment_payments_company on public.shipment_payments (company_id, paid_at);
alter table public.shipment_payments enable row level security;
grant select, insert, delete on public.shipment_payments to authenticated;

-- Visible to whoever can see the consignment; recorded by staff who take payments; removed by the Admin.
drop policy if exists shipment_payments_select on public.shipment_payments;
create policy shipment_payments_select on public.shipment_payments for select to authenticated
  using (company_id = public.my_company() and exists (select 1 from public.shipments s where s.id = shipment_id));
drop policy if exists shipment_payments_insert on public.shipment_payments;
create policy shipment_payments_insert on public.shipment_payments for insert to authenticated
  with check (company_id = public.my_company() and public.my_role()::text in ('admin', 'cashier', 'agent')
              and exists (select 1 from public.shipments s where s.id = shipment_id and s.company_id = public.my_company()));
drop policy if exists shipment_payments_delete on public.shipment_payments;
create policy shipment_payments_delete on public.shipment_payments for delete to authenticated
  using (company_id = public.my_company() and public.my_role()::text = 'admin');

-- Keep paid_amount and pay in step (runs after the item totals and discount are worked out, so a
-- discount can't bring the charge below what has already been paid).
create or replace function public.sync_paid_amount() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pay = 'paid' then
    new.paid_amount := new.charge;                       -- paid in full
  elsif new.pay = 'unpaid' then
    if tg_op = 'UPDATE' and old.pay = 'paid' then        -- the Admin undid a payment: start again
      new.paid_amount := 0;
      delete from public.shipment_payments where shipment_id = new.id;
    end if;
    if new.paid_amount > new.charge then
      raise exception 'Payments (TZS %) can''t be more than the charge (TZS %)', new.paid_amount, new.charge;
    end if;
    if new.charge > 0 and new.paid_amount >= new.charge then   -- the last part payment completes it
      new.pay := 'paid';
      new.paid_at := coalesce(new.paid_at, now());
    end if;
  elsif new.pay = 'bill' and coalesce(new.paid_amount, 0) > 0 and (tg_op = 'INSERT' or old.pay <> 'bill') then
    raise exception 'This consignment is part paid; collect the balance instead of putting it on a monthly bill';
  end if;
  return new;
end $$;
drop trigger if exists shipments_paid on public.shipments;
create trigger shipments_paid before insert or update on public.shipments
  for each row execute function public.sync_paid_amount();
