-- 0025: Customers.
--
-- Every sender and receiver is kept as a customer of the company, one per phone number.
-- * Existing customers are created from all past consignments: the name is the latest one used
--   with that phone, and the registration date is the date of their first consignment.
-- * From now on, saving or editing a consignment registers the sender and receiver automatically
--   (a new name for a known phone updates the customer's name; an empty name never wipes it).
-- * Staff can correct a customer's name and add notes in the Customers screen.
-- Phones are stored as 255XXXXXXXXX (digits only), the same way the app compares them.
-- Run after 0024.

create or replace function public.norm_phone(p text) returns text
language sql immutable as $$
  select case
    when d like '0%' then '255' || substr(d, 2)
    when length(d) = 9 then '255' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies (id) on delete cascade,
  phone      text not null check (length(phone) >= 9),
  name       text not null default '',
  notes      text not null default '',
  created_at timestamptz not null default now(),   -- registration date
  updated_at timestamptz,
  updated_by text
);
create unique index if not exists customers_phone_unique on public.customers (company_id, phone);
create index if not exists customers_company_created on public.customers (company_id, created_at desc);
alter table public.customers enable row level security;
grant select, insert, update on public.customers to authenticated;
grant delete on public.customers to authenticated;

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (company_id = public.my_company());
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (company_id = public.my_company() and public.my_role()::text in ('admin', 'cashier', 'agent'));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (company_id = public.my_company() and public.my_role()::text in ('admin', 'cashier', 'agent'))
  with check (company_id = public.my_company());
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete to authenticated
  using (company_id = public.my_company() and public.my_role()::text = 'admin');

-- The phone is the customer's key: keep it normalised and unchangeable.
create or replace function public.guard_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.phone := public.norm_phone(new.phone);
  new.name := trim(coalesce(new.name, ''));
  if tg_op = 'UPDATE' then
    if new.phone is distinct from old.phone then raise exception 'A customer''s phone number can''t change. Add the new number as a new customer.'; end if;
    if new.created_at is distinct from old.created_at and public.my_role() is not null then new.created_at := old.created_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists customers_guard on public.customers;
create trigger customers_guard before insert or update on public.customers
  for each row execute function public.guard_customer();

-- Register the sender and receiver of a consignment.
create or replace function public.register_customers() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who record;
begin
  for who in select * from (values (public.norm_phone(new.s_phone), trim(coalesce(new.s_name, ''))),
                                   (public.norm_phone(new.r_phone), trim(coalesce(new.r_name, '')))) v(phone, name)
  loop
    if length(who.phone) >= 9 then
      insert into public.customers (company_id, phone, name, created_at)
      values (new.company_id, who.phone, who.name, coalesce(new.received_at, now()))
      on conflict (company_id, phone) do update
        set name = case when excluded.name <> '' and tg_op = 'UPDATE' then excluded.name
                        when excluded.name <> '' and public.customers.name = '' then excluded.name
                        when excluded.name <> '' and excluded.created_at >= public.customers.created_at then excluded.name
                        else public.customers.name end,
            created_at = least(public.customers.created_at, excluded.created_at);
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists shipments_customers on public.shipments;
create trigger shipments_customers after insert or update of s_phone, s_name, r_phone, r_name on public.shipments
  for each row execute function public.register_customers();

-- Everyone who sent or received goods before today becomes a customer,
-- registered on the date of their first consignment, under the latest name they used.
with p as (
  select company_id, public.norm_phone(s_phone) as phone, trim(coalesce(s_name, '')) as name, received_at from public.shipments
  union all
  select company_id, public.norm_phone(r_phone), trim(coalesce(r_name, '')), received_at from public.shipments
), first_seen as (
  select company_id, phone, min(received_at) as created_at from p where length(phone) >= 9 group by company_id, phone
), last_name as (
  select distinct on (company_id, phone) company_id, phone, name
  from p where length(phone) >= 9 and name <> ''
  order by company_id, phone, received_at desc
)
insert into public.customers (company_id, phone, name, created_at)
select f.company_id, f.phone, coalesce(l.name, ''), f.created_at
from first_seen f left join last_name l using (company_id, phone)
on conflict (company_id, phone) do nothing;

-- Live updates in the app.
do $$ begin
  alter publication supabase_realtime add table public.customers;
exception when others then null; end $$;
