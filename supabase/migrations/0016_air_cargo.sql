-- Shehena — air cargo companies (international consolidators)
--
-- A company is either a road transporter (trucks) or an air cargo company (flights). Air companies
-- charge by chargeable weight (the higher of actual and volume weight) at a price per kg, and put
-- consignments (house air waybills) on a master air waybill (MAWB) for a flight.
-- The item lines keep each line's size, volume weight, chargeable weight and price per kg, so the
-- totals are still worked out from the lines as before. Run after 0015.

alter table public.companies
  add column if not exists mode        text not null default 'road' check (mode in ('road', 'air')),
  add column if not exists kg_rate     numeric(14, 2) not null default 0 check (kg_rate >= 0),
  add column if not exists vol_divisor int not null default 6000 check (vol_divisor between 1000 and 10000);

alter table public.trips
  add column if not exists mawb    text not null default '',
  add column if not exists airline text not null default '';
