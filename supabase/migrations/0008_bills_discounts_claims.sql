-- Shehena — monthly bill customers, discounts, and claims for lost / damaged goods
--
-- 1. Monthly bill customers (wateja wa bili)
--    bill_accounts : customers who pay monthly instead of per consignment (the Admin opens them)
--    shipments.pay : now 'paid', 'unpaid' or 'bill'; a 'bill' consignment names its account
--    bill_payments : money received against an account; balance = billed − paid
--    Goods on a bill may be released without paying at the counter.
-- 2. Discounts
--    shipments.gross_charge = before discount, discount, reason, who and when;
--    shipments.charge stays the amount actually owed (gross − discount), so every total keeps working.
--    A discount can't be changed once the consignment is paid.
-- 3. Claims (changamoto: lost, damaged, broken goods)
--    claims         : customer, consignment, type, goods value, compensation agreed
--    claim_payments : each compensation payment with its date; balance = compensation − paid

-- ---------------------------------------------------------------- 1. bill accounts

create table if not exists public.bill_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  phone       text not null default '',
  notes       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by_name text
);
create index if not exists bill_accounts_company_idx on public.bill_accounts (company_id, name);

create table if not exists public.bill_payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  account_id  uuid not null references public.bill_accounts (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      text not null default '',
  reference   text not null default '',
  note        text not null default '',
  recorded_by text,
  created_at  timestamptz not null default now()
);
create index if not exists bill_payments_account_idx on public.bill_payments (account_id, paid_on desc);

alter table public.shipments
  add column if not exists account_id uuid references public.bill_accounts (id) on delete restrict;
create index if not exists shipments_account_idx on public.shipments (account_id) where account_id is not null;

alter table public.shipments drop constraint if exists shipments_pay_check;
alter table public.shipments add constraint shipments_pay_check check (pay in ('paid', 'unpaid', 'bill'));
alter table public.shipments drop constraint if exists shipments_bill_account;
alter table public.shipments add constraint shipments_bill_account check (pay <> 'bill' or account_id is not null);

-- Goods on a monthly bill can be released; otherwise payment first.
create or replace function public.guard_release() returns trigger
language plpgsql as $$
begin
  if new.status = 'collected' and new.pay not in ('paid', 'bill') then
    raise exception 'Record the payment before releasing the goods';
  end if;
  return new;
end $$;

-- Only the Admin can take a consignment off "paid" or off a monthly bill.
create or replace function public.guard_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'cashier' and old.pay in ('paid', 'bill') and new.pay is distinct from old.pay then
    raise exception 'Only the Admin can change the payment of this consignment';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 2. discounts

alter table public.shipments
  add column if not exists gross_charge    numeric(14, 2),
  add column if not exists discount        numeric(14, 2) not null default 0 check (discount >= 0),
  add column if not exists discount_reason text not null default '',
  add column if not exists discount_by     text,
  add column if not exists discount_at     timestamptz;
update public.shipments set gross_charge = charge where gross_charge is null;

-- Totals from the item lines, then the discount: charge = gross − discount.
create or replace function public.shipment_items_summary() returns trigger
language plpgsql as $$
declare g numeric;
begin
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise exception 'items must be a list';
  end if;
  if jsonb_array_length(new.items) > 0 then
    if exists (
      select 1 from jsonb_array_elements(new.items) e
      where coalesce(btrim(e->>'name'), '') = ''
         or coalesce((e->>'pkgs')::numeric, 0) < 1
         or coalesce((e->>'charge')::numeric, 0) < 0
    ) then
      raise exception 'Each item needs a name, at least 1 package and a charge of 0 or more';
    end if;
    select string_agg(btrim(e->>'name'), ', '),
           sum((e->>'pkgs')::numeric)::int,
           sum(coalesce((e->>'charge')::numeric, 0)),
           nullif(sum(coalesce((e->>'kg')::numeric, 0)), 0)
      into new.item, new.pkgs, g, new.kg
      from jsonb_array_elements(new.items) e;
  elsif tg_op = 'UPDATE' then
    g := coalesce(old.gross_charge, old.charge + coalesce(old.discount, 0));
  else
    g := coalesce(new.gross_charge, new.charge);
  end if;
  new.discount := coalesce(new.discount, 0);
  if new.discount > g then
    raise exception 'The discount can''t be more than the charge (TZS %)', g;
  end if;
  if tg_op = 'UPDATE' and new.discount is distinct from old.discount and old.pay = 'paid' then
    raise exception 'This consignment is already paid; a discount can''t be added now';
  end if;
  new.gross_charge := g;
  new.charge := g - new.discount;
  return new;
end $$;

drop trigger if exists shipments_items on public.shipments;
create trigger shipments_items before insert or update of items, discount on public.shipments
  for each row execute function public.shipment_items_summary();

-- ---------------------------------------------------------------- 3. claims

create table if not exists public.claims (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  shipment_id     uuid references public.shipments (id) on delete set null,
  waybill         text not null default '',
  customer_name   text not null check (btrim(customer_name) <> ''),
  customer_phone  text not null default '',
  kind            text not null check (kind in ('lost', 'damaged', 'broken', 'other')),
  description     text not null default '',
  goods_value     numeric(14, 2) not null default 0 check (goods_value >= 0),
  compensation    numeric(14, 2) not null default 0 check (compensation >= 0),
  reported_on     date not null default current_date,
  closed          boolean not null default false,
  created_at      timestamptz not null default now(),
  created_by_name text
);
create index if not exists claims_company_idx on public.claims (company_id, created_at desc);

create table if not exists public.claim_payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  claim_id    uuid not null references public.claims (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      text not null default '',
  reference   text not null default '',
  recorded_by text,
  created_at  timestamptz not null default now()
);
create index if not exists claim_payments_claim_idx on public.claim_payments (claim_id, paid_on);

-- ---------------------------------------------------------------- security

alter table public.bill_accounts  enable row level security;
alter table public.bill_payments  enable row level security;
alter table public.claims         enable row level security;
alter table public.claim_payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['bill_accounts', 'bill_payments', 'claims', 'claim_payments'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    -- everyone in the company can see
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (company_id = public.my_company())', t);
    -- only the Admin deletes
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (company_id = public.my_company() and public.my_role() = ''admin'')', t);
  end loop;
end $$;

-- Bill accounts: the Admin opens and changes them (it's a credit decision).
create policy bill_accounts_insert on public.bill_accounts for insert to authenticated
  with check (company_id = public.my_company() and public.my_role() = 'admin');
create policy bill_accounts_update on public.bill_accounts for update to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin') with check (company_id = public.my_company());
-- Bill payments: Admin and cashiers record; only the Admin corrects.
create policy bill_payments_insert on public.bill_payments for insert to authenticated
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'cashier')
              and exists (select 1 from public.bill_accounts a where a.id = account_id and a.company_id = public.my_company()));
create policy bill_payments_update on public.bill_payments for update to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin') with check (company_id = public.my_company());
-- Claims: Admin and cashiers record; only the Admin changes the agreed amounts or closes.
create policy claims_insert on public.claims for insert to authenticated
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'cashier'));
create policy claims_update on public.claims for update to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin') with check (company_id = public.my_company());
create policy claim_payments_insert on public.claim_payments for insert to authenticated
  with check (company_id = public.my_company() and public.my_role() in ('admin', 'cashier')
              and exists (select 1 from public.claims c where c.id = claim_id and c.company_id = public.my_company()));
create policy claim_payments_update on public.claim_payments for update to authenticated
  using (company_id = public.my_company() and public.my_role() = 'admin') with check (company_id = public.my_company());

grant select, insert, update, delete on public.bill_accounts, public.bill_payments, public.claims, public.claim_payments to authenticated;

-- A consignment can only be billed to an account of the same company.
create or replace function public.guard_bill_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.bill_accounts a where a.id = new.account_id and a.company_id = new.company_id
  ) then
    raise exception 'Unknown bill account';
  end if;
  if new.pay <> 'bill' then new.account_id := null; end if;
  return new;
end $$;
drop trigger if exists shipments_bill on public.shipments;
create trigger shipments_bill before insert or update of pay, account_id on public.shipments
  for each row execute function public.guard_bill_account();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.bill_accounts, public.bill_payments, public.claims, public.claim_payments;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
