-- Shehena — billing cargo companies (Serengeti Labs subscriptions)
--
-- billing_bands     : monthly fee by number of trucks (1 truck, 2–3, 4–6 …). Edited in the owner console.
-- billing_payments  : each subscription payment a company makes, and the months it covers.
-- company_accounts  : + trial end, paid-until date, optional custom fee, automatic status on/off.
-- platform_settings : + trial length, grace days, auto-suspend, and how clients pay Serengeti Labs.
-- sales_agents      : the sales team, each with a marketing ref code and commission rates.
-- commissions       : what each agent earned from each client payment (signing bonus, setup share,
--                     monthly commission), plus allowances and adjustments. Rates are fixed when earned.
-- agent_payouts     : money paid out to agents; each commission line points at the payout that settled it.
--
-- Status is worked out from the dates by the app (daily, and whenever someone opens the app):
--   paid up → Active · in free trial → Trial · past due → Overdue · past due + grace days → Suspended.
-- Existing companies keep their current status until their first payment is recorded.
-- Only the server (service role) can read or change any of this.

create table if not exists public.billing_bands (
  id          bigint generated always as identity primary key,
  min_trucks  int not null check (min_trucks >= 0),
  max_trucks  int check (max_trucks is null or max_trucks >= min_trucks),
  monthly_fee numeric(14, 2) not null check (monthly_fee >= 0),
  unique (min_trucks)
);
insert into public.billing_bands (min_trucks, max_trucks, monthly_fee)
select * from (values (0, 1, 50000), (2, 3, 100000), (4, 6, 180000), (7, 10, 270000), (11, null::int, 350000)) v
where not exists (select 1 from public.billing_bands);

create table if not exists public.billing_payments (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  months      int not null check (months between 1 and 36),
  period_from date not null,
  period_to   date not null check (period_to >= period_from),
  method      text not null default '',
  reference   text not null default '',
  paid_on     date not null default current_date,
  setup_fee   numeric(14, 2) not null default 0 check (setup_fee >= 0),  -- part of amount that was a one-off setup fee
  recorded_by text not null,
  created_at  timestamptz not null default now(),
  check (setup_fee <= amount)
);
create index if not exists billing_payments_company_idx on public.billing_payments (company_id, period_to desc);

create table if not exists public.sales_agents (
  id               bigint generated always as identity primary key,
  name             text not null check (btrim(name) <> ''),
  phone            text not null default '',
  email            text not null default '',
  ref_code         text not null unique check (ref_code ~ '^[a-z0-9_-]{2,40}$'),
  active           boolean not null default true,
  signing_pct      numeric(5, 2) not null default 100 check (signing_pct between 0 and 300),  -- % of the first month's fee
  setup_pct        numeric(5, 2) not null default 30  check (setup_pct between 0 and 100),    -- % of setup fees
  commission_pct   numeric(5, 2) not null default 10  check (commission_pct between 0 and 100), -- % of later subscription payments
  commission_months int not null default 12 check (commission_months between 0 and 120),     -- for this many months after signing
  notes            text not null default '',
  created_at       timestamptz not null default now()
);

create table if not exists public.agent_payouts (
  id          bigint generated always as identity primary key,
  agent_id    bigint not null references public.sales_agents (id) on delete cascade,
  amount      numeric(14, 2) not null,
  paid_on     date not null default current_date,
  method      text not null default '',
  reference   text not null default '',
  recorded_by text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.commissions (
  id          bigint generated always as identity primary key,
  agent_id    bigint not null references public.sales_agents (id) on delete cascade,
  company_id  uuid references public.companies (id) on delete set null,
  payment_id  bigint references public.billing_payments (id) on delete set null,
  kind        text not null check (kind in ('signing', 'setup', 'monthly', 'allowance', 'adjustment')),
  amount      numeric(14, 2) not null,
  note        text not null default '',
  earned_on   date not null default current_date,
  payout_id   bigint references public.agent_payouts (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists commissions_agent_idx on public.commissions (agent_id, payout_id);

alter table public.company_accounts
  add column if not exists agent_id    bigint references public.sales_agents (id) on delete set null,
  add column if not exists agent_since date,
  add column if not exists trial_ends  date,
  add column if not exists paid_until  date,
  add column if not exists custom_fee  numeric(14, 2) check (custom_fee is null or custom_fee >= 0),
  add column if not exists auto_status boolean not null default true;

alter table public.platform_settings
  add column if not exists trial_days           int  not null default 14 check (trial_days between 0 and 365),
  add column if not exists grace_days           int  not null default 7  check (grace_days between 0 and 90),
  add column if not exists auto_suspend         boolean not null default true,
  add column if not exists billing_instructions text not null default '';

-- New companies start on a free trial.
create or replace function public.new_company_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  select trial_days into d from public.platform_settings where id = 1;
  insert into public.company_accounts (company_id, status, trial_ends)
  values (new.id, 'trial', current_date + coalesce(d, 14))
  on conflict do nothing;
  return new;
end $$;

alter table public.billing_bands    enable row level security;
alter table public.billing_payments enable row level security;
alter table public.sales_agents     enable row level security;
alter table public.agent_payouts    enable row level security;
alter table public.commissions      enable row level security;
-- No policies: only the server (service role) reads or writes billing and the sales team.
-- The announcement row stays readable; the billing columns on it are harmless (fees and pay instructions).
