-- Shehena cargo management — initial schema
-- Multi-company: every row belongs to a company; Row Level Security keeps each
-- company's data invisible to every other company.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'cashier', 'ceo');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  branch         text not null default '',
  phone          text not null default '',
  default_origin text not null default 'DAR',
  message_lang   text not null default 'sw' check (message_lang in ('sw', 'en')),
  created_at     timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  full_name  text not null,
  email      text not null,
  role       public.app_role not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index profiles_company_idx on public.profiles (company_id);

create table public.vehicles (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  plate          text not null,
  driver         text not null default '',
  driver_phone   text not null default '',
  target         numeric(14, 2) not null default 0 check (target >= 0),
  target_set_by  text,
  target_set_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (company_id, plate)
);

create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  no              text not null,
  plate           text not null,
  driver          text not null default '',
  driver_phone    text not null default '',
  target          numeric(14, 2) not null default 0 check (target >= 0),
  target_set_by   text,
  origin          text not null,
  dest            text not null,
  status          text not null default 'loading' check (status in ('loading', 'departed', 'arrived')),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  created_by_name text,
  departed_at     timestamptz,
  departed_by     text,
  arrived_at      timestamptz,
  arrived_by      text,
  unique (company_id, no)
);
create index trips_company_idx on public.trips (company_id, created_at desc);

create table public.shipments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  no              text not null,
  s_name          text not null,
  s_phone         text not null,
  r_name          text not null,
  r_phone         text not null,
  item            text not null,
  pkgs            integer not null check (pkgs > 0),
  kg              numeric(10, 2),
  origin          text not null,
  dest            text not null,
  charge          numeric(14, 2) not null default 0 check (charge >= 0),
  pay             text not null default 'unpaid' check (pay in ('paid', 'unpaid')),
  method          text,
  paid_at         timestamptz,
  paid_by         text,
  notes           text not null default '',
  status          text not null default 'received'
                  check (status in ('received', 'loaded', 'transit', 'arrived', 'collected')),
  trip_id         uuid references public.trips (id) on delete set null,
  received_at     timestamptz not null default now(),
  loaded_at       timestamptz,
  transit_at      timestamptz,
  arrived_at      timestamptz,
  collected_at    timestamptz,
  collected_by    text,
  notices         jsonb not null default '[]'::jsonb,
  created_by      uuid references auth.users (id) on delete set null,
  created_by_name text,
  unique (company_id, no)
);
create index shipments_company_idx on public.shipments (company_id, received_at desc);
create index shipments_trip_idx on public.shipments (trip_id);
create index shipments_rphone_idx on public.shipments (company_id, r_phone);
create index shipments_sphone_idx on public.shipments (company_id, s_phone);

-- ---------------------------------------------------------------- helpers
-- SECURITY DEFINER so policies can read the caller's profile without recursion.

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ---------------------------------------------------------------- row level security

alter table public.companies enable row level security;
alter table public.profiles  enable row level security;
alter table public.vehicles  enable row level security;
alter table public.trips     enable row level security;
alter table public.shipments enable row level security;

-- companies: staff read their own company; only admins edit it
create policy companies_select on public.companies for select to authenticated
  using (id = public.my_company());
create policy companies_update on public.companies for update to authenticated
  using (id = public.my_company() and public.my_role() = 'admin')
  with check (id = public.my_company());

-- profiles: staff see colleagues; all changes go through the server (service role)
create policy profiles_select on public.profiles for select to authenticated
  using (company_id = public.my_company());

-- vehicles: everyone reads; admin manages; CEO may set targets (trigger below)
create policy vehicles_select on public.vehicles for select to authenticated
  using (company_id = public.my_company());
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (company_id = public.my_company() and public.my_role() = 'admin');
create policy vehicles_update on public.vehicles for update to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'ceo'))
  with check (company_id = public.my_company());
create policy vehicles_delete on public.vehicles for delete to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin');

-- trips: admin + cashier run loading; CEO may set targets (trigger below)
create policy trips_select on public.trips for select to authenticated
  using (company_id = public.my_company());
create policy trips_insert on public.trips for insert to authenticated
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'cashier'));
create policy trips_update on public.trips for update to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'cashier', 'ceo'))
  with check (company_id = public.my_company());
create policy trips_delete on public.trips for delete to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin');

-- shipments: admin + cashier work them; CEO reads only
create policy shipments_select on public.shipments for select to authenticated
  using (company_id = public.my_company());
create policy shipments_insert on public.shipments for insert to authenticated
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'cashier'));
create policy shipments_update on public.shipments for update to authenticated
  using (company_id = public.my_company() and public.my_role() in ('admin', 'cashier'))
  with check (company_id = public.my_company());
create policy shipments_delete on public.shipments for delete to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin');

-- ---------------------------------------------------------------- role rules the policies can't express

-- Targets: only admin and CEO set them. CEO may change nothing else.
create or replace function public.guard_targets() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role();
begin
  if r is null then return new; end if;              -- service role / server
  if r = 'cashier' and new.target is distinct from old.target then
    raise exception 'Only the Admin or CEO can change a target';
  end if;
  if r = 'ceo' and (to_jsonb(new) - array['target','target_set_by','target_set_at'])
                 is distinct from (to_jsonb(old) - array['target','target_set_by','target_set_at']) then
    raise exception 'The CEO can only change targets';
  end if;
  return new;
end $$;
create trigger vehicles_guard before update on public.vehicles
  for each row execute function public.guard_targets();
create trigger trips_guard before update on public.trips
  for each row execute function public.guard_targets();

-- New trips: a cashier cannot pick their own target; it comes from the saved vehicle.
create or replace function public.trip_target_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'cashier' then
    select coalesce(v.target, 0), v.target_set_by into new.target, new.target_set_by
    from public.vehicles v where v.company_id = new.company_id and v.plate = new.plate;
    new.target := coalesce(new.target, 0);
  end if;
  return new;
end $$;
create trigger trips_target_insert before insert on public.trips
  for each row execute function public.trip_target_on_insert();

-- Payments: only the admin can undo a recorded payment.
create or replace function public.guard_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'cashier' and old.pay = 'paid' and new.pay = 'unpaid' then
    raise exception 'Only the Admin can undo a payment';
  end if;
  return new;
end $$;
create trigger shipments_guard before update on public.shipments
  for each row execute function public.guard_payment();

-- Nobody moves a row to another company.
create or replace function public.keep_company() returns trigger
language plpgsql as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'company_id cannot change';
  end if;
  return new;
end $$;
create trigger vehicles_keep before update on public.vehicles  for each row execute function public.keep_company();
create trigger trips_keep    before update on public.trips     for each row execute function public.keep_company();
create trigger ship_keep     before update on public.shipments for each row execute function public.keep_company();

-- ---------------------------------------------------------------- grants

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.vehicles, public.trips, public.shipments to authenticated;
grant select, update on public.companies to authenticated;
grant select on public.profiles to authenticated;
grant execute on function public.my_company(), public.my_role() to authenticated;

-- ---------------------------------------------------------------- realtime (Supabase only)

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.companies, public.profiles, public.vehicles, public.trips, public.shipments;
  end if;
end $$;
