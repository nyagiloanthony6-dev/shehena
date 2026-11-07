-- Shehena — optional features, and a managed list of delivery people
--
-- 1. companies.features: extra features a company switches on in Settings (for now 'delivery':
--    delivery people). Companies that don't use a feature don't see it.
-- 2. runners: the company's delivery people (name, phone, office, active). Goods are given to a person
--    from this list; each consignment keeps the person (runner_id) and their name and phone as given.
-- Run after 0019.

alter table public.companies add column if not exists features text[] not null default '{}';
-- Companies that already gave goods to delivery people keep the feature on.
update public.companies c set features = array_append(c.features, 'delivery')
  where not ('delivery' = any (c.features)) and exists (select 1 from public.shipments s where s.company_id = c.id and s.runner_name <> '');

create table if not exists public.runners (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  phone      text not null default '',
  station    text,                       -- office they work from (null = any office)
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists runners_name_unique on public.runners (company_id, lower(trim(name)));
alter table public.runners enable row level security;
grant select, insert, update on public.runners to authenticated;

-- Everyone in the company sees the list (branch staff: their office's people and those for any office);
-- the Admin manages all, branch staff and cashiers manage people for their own office.
drop policy if exists runners_select on public.runners;
create policy runners_select on public.runners for select to authenticated
  using (company_id = public.my_company() and (not public.is_branch() or station is null or station = public.my_station()));
drop policy if exists runners_insert on public.runners;
create policy runners_insert on public.runners for insert to authenticated
  with check (company_id = public.my_company() and public.my_role()::text in ('admin', 'cashier', 'agent')
              and (not public.is_branch() or station = public.my_station()));
drop policy if exists runners_update on public.runners;
create policy runners_update on public.runners for update to authenticated
  using (company_id = public.my_company() and (public.my_role()::text = 'admin' or (public.my_role()::text in ('cashier', 'agent') and (not public.is_branch() or station = public.my_station()))))
  with check (company_id = public.my_company());

-- Branch staff's new people belong to their office.
create or replace function public.stamp_runner_station() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_branch() then new.station := public.my_station(); end if;
  return new;
end $$;
drop trigger if exists runners_station on public.runners;
create trigger runners_station before insert on public.runners
  for each row execute function public.stamp_runner_station();

alter table public.shipments add column if not exists runner_id uuid references public.runners (id) on delete set null;

-- People who already delivered goods go on the list.
insert into public.runners (company_id, name, phone, station)
select distinct on (s.company_id, lower(trim(s.runner_name))) s.company_id, trim(s.runner_name), s.runner_phone, s.dest
from public.shipments s where s.runner_name <> ''
order by s.company_id, lower(trim(s.runner_name)), s.runner_out_at desc nulls last
on conflict do nothing;
update public.shipments s set runner_id = r.id from public.runners r
  where s.runner_id is null and s.runner_name <> '' and r.company_id = s.company_id and lower(trim(r.name)) = lower(trim(s.runner_name));
