-- 0023: a price for each client.
--
-- Every client can be billed one of four ways:
--   list       the standard price list (price per active truck, never below the minimum) — the default
--   per_truck  their own price per active truck (trucks that made a trip in the last 30 days)
--   per_trip   a price for every trip loaded in the last 30 days
--   flat       a fixed monthly fee
-- price_min is an optional minimum for per_truck / per_trip.
-- Existing custom fees become flat fees, so nobody's price changes.

alter table public.company_accounts
  add column if not exists price_model text not null default 'list',
  add column if not exists price_rate  numeric,
  add column if not exists price_min   numeric;

do $$ begin
  alter table public.company_accounts add constraint company_accounts_price_model_chk
    check (price_model in ('list', 'per_truck', 'per_trip', 'flat'));
exception when duplicate_object then null; end $$;

update public.company_accounts
   set price_model = 'flat', price_rate = custom_fee
 where custom_fee is not null and price_model = 'list';

-- How many trips a payment was worked out on (alongside the trucks count from 0013).
alter table public.billing_payments add column if not exists trips integer;
