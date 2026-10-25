-- Shehena — delivery notes at collection, and own vs rental trucks
--
-- 1. Delivery note: when goods are released, who collected them (name, phone, ID) and remarks are
--    kept on the consignment with a delivery note number (DN-…), unique within the company.
-- 2. Rental trucks: a vehicle is 'own' or 'rental' (owner, phone, rent per trip or per month).
--    Each trip keeps whether the truck was own or rental and the rent cost for that trip, so
--    reports can show collections after rent. A truck hired for one trip needn't be saved.

-- ---------------------------------------------------------------- 1. delivery notes

alter table public.shipments
  add column if not exists dn_no           text,
  add column if not exists collector_name  text not null default '',
  add column if not exists collector_phone text not null default '',
  add column if not exists collector_id    text not null default '',
  add column if not exists collect_note    text not null default '';
create unique index if not exists shipments_dn_unique on public.shipments (company_id, dn_no) where dn_no is not null;

-- Undoing a collection clears the delivery note details too.
create or replace function public.clear_delivery_note() returns trigger
language plpgsql as $$
begin
  if old.status = 'collected' and new.status <> 'collected' then
    new.dn_no := null; new.collector_name := ''; new.collector_phone := ''; new.collector_id := ''; new.collect_note := '';
  end if;
  return new;
end $$;
drop trigger if exists shipments_dn on public.shipments;
create trigger shipments_dn before update of status on public.shipments
  for each row execute function public.clear_delivery_note();

-- ---------------------------------------------------------------- 2. own / rental trucks

alter table public.vehicles
  add column if not exists ownership   text not null default 'own' check (ownership in ('own', 'rental')),
  add column if not exists owner_name  text not null default '',
  add column if not exists owner_phone text not null default '',
  add column if not exists rent_amount numeric(14, 2) not null default 0 check (rent_amount >= 0),
  add column if not exists rent_basis  text not null default 'trip' check (rent_basis in ('trip', 'month'));

alter table public.trips
  add column if not exists ownership  text not null default 'own' check (ownership in ('own', 'rental')),
  add column if not exists owner_name text not null default '',
  add column if not exists rent_cost  numeric(14, 2) not null default 0 check (rent_cost >= 0);

-- A trip on a saved truck takes its ownership and per-trip rent from the vehicle.
create or replace function public.trip_vehicle_details() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.vehicles%rowtype;
begin
  select * into v from public.vehicles where company_id = new.company_id and plate = new.plate;
  if found then
    new.ownership := v.ownership;
    if v.ownership = 'rental' then
      new.owner_name := coalesce(nullif(new.owner_name, ''), v.owner_name);
      if coalesce(new.rent_cost, 0) = 0 and v.rent_basis = 'trip' then new.rent_cost := v.rent_amount; end if;
    else
      new.owner_name := ''; new.rent_cost := 0;
    end if;
  elsif new.ownership = 'own' then
    new.rent_cost := 0;
  end if;
  return new;
end $$;
drop trigger if exists trips_vehicle_details on public.trips;
create trigger trips_vehicle_details before insert on public.trips
  for each row execute function public.trip_vehicle_details();

-- Only the Admin changes a trip's rent after it has started (the CEO guard already limits the CEO to targets).
create or replace function public.guard_trip_rent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'cashier' and (new.rent_cost, new.ownership, new.owner_name) is distinct from (old.rent_cost, old.ownership, old.owner_name) then
    raise exception 'Only the Admin can change the rent of a trip';
  end if;
  return new;
end $$;
drop trigger if exists trips_rent_guard on public.trips;
create trigger trips_rent_guard before update on public.trips
  for each row execute function public.guard_trip_rent();
