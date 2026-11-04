-- Shehena — deleting a client company from the owner console
--
-- When a company is deleted, its own data goes with it (consignments, trips, vehicles, staff, bills,
-- claims, account), but Serengeti Labs' records of what it paid stay: each subscription payment keeps
-- the company's name, and salesperson commissions stay as they were.

alter table public.billing_payments add column if not exists company_name text;
update public.billing_payments p set company_name = c.name from public.companies c where c.id = p.company_id and p.company_name is null;

alter table public.billing_payments alter column company_id drop not null;
alter table public.billing_payments drop constraint if exists billing_payments_company_id_fkey;
alter table public.billing_payments add constraint billing_payments_company_id_fkey
  foreign key (company_id) references public.companies (id) on delete set null;

-- New payments get the company's name too.
create or replace function public.billing_payment_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is not null and new.company_name is null then
    select name into new.company_name from public.companies where id = new.company_id;
  end if;
  return new;
end $$;
drop trigger if exists billing_payments_name on public.billing_payments;
create trigger billing_payments_name before insert on public.billing_payments
  for each row execute function public.billing_payment_name();
