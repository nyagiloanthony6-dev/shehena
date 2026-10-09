-- Shehena — client account management for Serengeti Labs (platform owner)
--
-- company_accounts : status of each client company (trial / active / overdue / suspended)
--                    plus private owner notes. Clients can't read or change it.
-- owner_audit      : every action taken in the owner console.
-- platform_settings: whether open sign-up is allowed, and an announcement shown to all clients.
-- Suspended companies lose access to their data (enforced in my_company / my_role).

create table if not exists public.company_accounts (
  company_id        uuid primary key references public.companies (id) on delete cascade,
  status            text not null default 'active' check (status in ('trial', 'active', 'overdue', 'suspended')),
  notes             text not null default '',
  status_changed_at timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
insert into public.company_accounts (company_id)
  select id from public.companies on conflict do nothing;

create or replace function public.new_company_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.company_accounts (company_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists companies_account on public.companies;
create trigger companies_account after insert on public.companies
  for each row execute function public.new_company_account();

create table if not exists public.owner_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  owner_email text not null,
  company_id  uuid references public.companies (id) on delete set null,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists owner_audit_at_idx on public.owner_audit (at desc);

create table if not exists public.platform_settings (
  id                      int primary key default 1 check (id = 1),
  signup_open             boolean not null default true,
  announcement            text not null default '',
  announcement_updated_at timestamptz
);
insert into public.platform_settings (id) values (1) on conflict do nothing;

-- Only the server (service role) touches accounts and the audit log.
alter table public.company_accounts  enable row level security;
alter table public.owner_audit       enable row level security;
alter table public.platform_settings enable row level security;
-- Every signed-in user may read the announcement row; nobody but the server may change it.
drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings for select to authenticated using (true);
grant select on public.platform_settings to authenticated;

-- Suspended companies: their staff resolve to no company, so every policy hides all data.
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select p.company_id
  from public.profiles p
  left join public.company_accounts a on a.company_id = p.company_id
  where p.id = auth.uid() and p.active and coalesce(a.status, 'active') <> 'suspended'
$$;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select p.role
  from public.profiles p
  left join public.company_accounts a on a.company_id = p.company_id
  where p.id = auth.uid() and p.active and coalesce(a.status, 'active') <> 'suspended'
$$;

-- Usage figures for the owner console, one row per company.
create or replace function public.owner_company_stats()
returns table (
  company_id uuid, staff int, active_staff int, vehicles int,
  trips_month int, ship_month int, billed_month numeric, paid_month numeric,
  ship_total int, last_activity timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id,
    (select count(*) from profiles p where p.company_id = c.id)::int,
    (select count(*) from profiles p where p.company_id = c.id and p.active)::int,
    (select count(*) from vehicles v where v.company_id = c.id)::int,
    (select count(*) from trips t where t.company_id = c.id and t.created_at >= date_trunc('month', now()))::int,
    (select count(*) from shipments s where s.company_id = c.id and s.received_at >= date_trunc('month', now()))::int,
    (select coalesce(sum(s.charge), 0) from shipments s where s.company_id = c.id and s.received_at >= date_trunc('month', now())),
    (select coalesce(sum(s.charge), 0) from shipments s where s.company_id = c.id and s.pay = 'paid' and s.paid_at >= date_trunc('month', now())),
    (select count(*) from shipments s where s.company_id = c.id)::int,
    greatest(
      (select max(s.received_at) from shipments s where s.company_id = c.id),
      (select max(t.created_at) from trips t where t.company_id = c.id),
      c.created_at)
  from companies c
$$;
revoke all on function public.owner_company_stats() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.owner_company_stats() from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.owner_company_stats() from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.owner_company_stats() to service_role; end if;
end $$;
