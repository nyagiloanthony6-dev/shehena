-- Shehena — price per active truck instead of truck bands
--
-- A client pays for each truck that made a trip in Shehena in the last 30 days (any plate loaded,
-- saved under Vehicles or hired for one trip), with a minimum monthly fee. A custom fee on a
-- company's account still overrides this. The old billing_bands table is kept but no longer used.

alter table public.platform_settings
  add column if not exists truck_price numeric(14, 2) not null default 50000 check (truck_price >= 0),
  add column if not exists min_fee     numeric(14, 2) not null default 80000 check (min_fee >= 0);

-- Speeds up counting active trucks for each company.
create index if not exists trips_company_created on public.trips (company_id, created_at);

-- Each subscription payment keeps how many trucks were active when it was recorded (for the receipt).
alter table public.billing_payments add column if not exists trucks int check (trucks >= 0);
