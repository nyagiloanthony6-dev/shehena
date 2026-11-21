-- 0026: Expenses.
--
-- Money the company spends, recorded by the office that paid it:
-- * trip expenses, linked to a truck trip (TRA, Mizani / weighbridge, fuel, driver allowance, tolls, ...)
-- * office expenses (wages, day workers, security, city council, rent, petty cash, ...)
-- Who can record: Admin, cashiers and branch staff (branch staff only for their own office).
-- Who sees: everyone in the company except branch staff, who see their own office's expenses.
-- Corrections: the person who recorded an expense can edit or delete it for 24 hours; after that only the Admin.
-- Run after 0025.

create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null default public.my_company() references public.companies (id) on delete cascade,
  kind            text not null default 'office' check (kind in ('office', 'trip')),
  trip_id         uuid references public.trips (id) on delete set null,
  station         text not null,                         -- office (region code) that paid
  category        text not null check (length(trim(category)) > 0),
  description     text not null default '',
  amount          numeric(14, 2) not null check (amount > 0),
  method          text not null default 'Cash',
  paid_to         text not null default '',
  reference       text not null default '',              -- receipt / control number
  spent_on        date not null default current_date,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  created_by_name text not null default '',
  updated_at      timestamptz,
  updated_by      text
);
create index if not exists expenses_company_spent on public.expenses (company_id, spent_on desc);
create index if not exists expenses_trip on public.expenses (trip_id) where trip_id is not null;
alter table public.expenses enable row level security;
grant select, insert, update, delete on public.expenses to authenticated;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (company_id = public.my_company() and (not public.is_branch() or station = public.my_station()));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (company_id = public.my_company() and public.my_role()::text in ('admin', 'cashier', 'agent')
              and (not public.is_branch() or station = public.my_station()));

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (company_id = public.my_company() and (
    public.my_role()::text = 'admin'
    or (created_by = auth.uid() and created_at > now() - interval '24 hours')))
  with check (company_id = public.my_company() and (not public.is_branch() or station = public.my_station()));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses for delete to authenticated
  using (company_id = public.my_company() and (
    public.my_role()::text = 'admin'
    or (created_by = auth.uid() and created_at > now() - interval '24 hours')));

-- Stamp who recorded it; a trip expense must belong to a trip of the same company.
create or replace function public.stamp_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.trips%rowtype;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if auth.uid() is not null then
      new.created_by := auth.uid();
      select full_name into new.created_by_name from public.profiles where id = auth.uid();
      new.created_by_name := coalesce(new.created_by_name, '');
    end if;
  else
    new.created_at := old.created_at; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.updated_at := now();
    if auth.uid() is not null then select full_name into new.updated_by from public.profiles where id = auth.uid(); end if;
  end if;
  new.category := trim(new.category);
  if new.kind = 'trip' then
    if new.trip_id is null then raise exception 'Choose the trip this expense belongs to.'; end if;
    select * into t from public.trips where id = new.trip_id and company_id = new.company_id;
    if not found then raise exception 'That trip was not found.'; end if;
  else
    new.trip_id := null;
  end if;
  return new;
end $$;
drop trigger if exists expenses_stamp on public.expenses;
create trigger expenses_stamp before insert or update on public.expenses
  for each row execute function public.stamp_expense();

do $$ begin
  alter publication supabase_realtime add table public.expenses;
exception when others then null; end $$;
