-- 0027: Automatic SMS (sent by Shehena through NextSMS).
--
-- * Each client company chooses which messages go out automatically (companies.sms_auto):
--     {"received_receiver":true, "received_sender":false, "departed":true, "arrived":true,
--      "collected_sender":false, "reminder_days":3}
-- * Serengeti Labs sells SMS bundles: company_accounts.sms_balance is the number of SMS left.
--   Owners add bundles (sms_topups); every SMS sent takes its parts (1 per 160 characters) off the balance.
-- * Every SMS is logged (sms_log) with its status, so clients can see what was sent.
-- Sending happens on the server (the NextSMS login never reaches the browser).
-- Run after 0026.

alter table public.companies
  add column if not exists sms_auto jsonb not null default '{}'::jsonb;

alter table public.company_accounts
  add column if not exists sms_balance integer not null default 0;

create table if not exists public.sms_topups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  sms         integer not null check (sms <> 0),          -- negative to correct a mistake
  amount      numeric(14, 2) not null default 0,           -- TZS paid by the client
  paid_on     date not null default current_date,
  method      text not null default '',
  reference   text not null default '',
  note        text not null default '',
  recorded_by text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists sms_topups_company on public.sms_topups (company_id, created_at desc);
alter table public.sms_topups enable row level security;
grant select on public.sms_topups to authenticated;
drop policy if exists sms_topups_select on public.sms_topups;
create policy sms_topups_select on public.sms_topups for select to authenticated
  using (company_id = public.my_company() and public.my_role()::text in ('admin', 'ceo'));

create table if not exists public.sms_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  shipment_id uuid references public.shipments (id) on delete set null,
  kind        text not null,                 -- received / departed / arrived / collected / reminder / manual
  to_role     text not null default '',      -- sender / receiver
  phone       text not null,
  body        text not null,
  parts       integer not null default 1,
  status      text not null,                 -- sent / failed / no_credit / not_configured
  provider_id text not null default '',
  error       text not null default '',
  auto        boolean not null default true,
  sent_by     text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists sms_log_company on public.sms_log (company_id, created_at desc);
create index if not exists sms_log_shipment on public.sms_log (shipment_id) where shipment_id is not null;
alter table public.sms_log enable row level security;
grant select on public.sms_log to authenticated;
drop policy if exists sms_log_select on public.sms_log;
create policy sms_log_select on public.sms_log for select to authenticated
  using (company_id = public.my_company() and (not public.is_branch() or exists (
    select 1 from public.shipments s where s.id = sms_log.shipment_id)));

-- Take n SMS off a company's balance only if it has enough. Returns the new balance, or null if not enough.
create or replace function public.sms_take(p_company uuid, p_n integer) returns integer
language sql security definer set search_path = public as $$
  update public.company_accounts set sms_balance = sms_balance - p_n
  where company_id = p_company and sms_balance >= p_n
  returning sms_balance
$$;
-- Give n SMS back (a send that failed) or add a bundle.
create or replace function public.sms_give(p_company uuid, p_n integer) returns integer
language sql security definer set search_path = public as $$
  update public.company_accounts set sms_balance = greatest(0, sms_balance + p_n)
  where company_id = p_company
  returning sms_balance
$$;
-- Only the server (service role) may move SMS balances.
revoke all on function public.sms_take(uuid, integer) from public, anon, authenticated;
revoke all on function public.sms_give(uuid, integer) from public, anon, authenticated;
grant execute on function public.sms_take(uuid, integer) to service_role;
grant execute on function public.sms_give(uuid, integer) to service_role;

-- Clients must not raise their own SMS balance.
create or replace function public.guard_sms_balance() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Runs as the caller: signed-in app users are 'authenticated'; the server is 'service_role'.
  if new.sms_balance is distinct from old.sms_balance and current_user = 'authenticated' then
    new.sms_balance := old.sms_balance;
  end if;
  return new;
end $$;
drop trigger if exists company_accounts_sms on public.company_accounts;
create trigger company_accounts_sms before update on public.company_accounts
  for each row execute function public.guard_sms_balance();
