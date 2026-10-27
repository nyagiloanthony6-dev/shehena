-- Shehena — branch staff at a destination office
--
-- A new staff role, 'agent' (shown as "Branch staff"), tied to one office (profiles.station, a region code).
-- Branch staff see ONLY:
--   • goods already loaded on trucks to their office (loaded, in transit, arrived, collected), and
--   • goods they received themselves (to be sent from their office, e.g. Dodoma back to Dar).
-- They can receive goods at their office, load and dispatch trucks leaving their office,
-- mark trucks arriving at their office, notify customers, take payment and release with a delivery note,
-- and record goods found on arrival (if the Admin allows cashiers to). They don't see money reports,
-- monthly bill payments, claims, settings or other offices' work.
-- All of this is enforced by the database (row level security), not just hidden in the screens.
--
-- Note: the new role value can't be used in the same transaction it is added, so the policies below
-- compare my_role()::text with 'agent' instead of using it as an enum value.

alter type public.app_role add value if not exists 'agent';

alter table public.profiles add column if not exists station text;

create or replace function public.my_station() returns text
language sql stable security definer set search_path = public as $$
  select station from public.profiles where id = auth.uid() and active
$$;
grant execute on function public.my_station() to authenticated;

-- true for branch staff
create or replace function public.is_branch() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role()::text = 'agent', false)
$$;
grant execute on function public.is_branch() to authenticated;

-- ---------------------------------------------------------------- shipments

drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments for select to authenticated
  using (company_id = public.my_company() and (
    not public.is_branch()
    or created_by = auth.uid()
    or (status <> 'received' and dest = public.my_station())
  ));

drop policy if exists shipments_insert on public.shipments;
create policy shipments_insert on public.shipments for insert to authenticated
  with check (company_id = public.my_company() and (
    public.my_role() in ('admin', 'cashier')
    or (public.is_branch() and (origin = public.my_station() or (found_on_arrival and dest = public.my_station())))
  ));

drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments for update to authenticated
  using (company_id = public.my_company() and (
    public.my_role() in ('admin', 'cashier')
    or (public.is_branch() and (created_by = auth.uid() or (status <> 'received' and dest = public.my_station())))
  ))
  with check (company_id = public.my_company());

-- ---------------------------------------------------------------- trips

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (company_id = public.my_company() and (
    not public.is_branch() or origin = public.my_station() or dest = public.my_station()
  ));

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (company_id = public.my_company() and (
    public.my_role() in ('admin', 'cashier') or (public.is_branch() and origin = public.my_station())
  ));

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (company_id = public.my_company() and (
    public.my_role() in ('admin', 'cashier', 'ceo')
    or (public.is_branch() and (origin = public.my_station() or dest = public.my_station()))
  ))
  with check (company_id = public.my_company());

-- ---------------------------------------------------------------- money tables branch staff don't see

do $$
declare t text;
begin
  foreach t in array array['bill_payments', 'claims', 'claim_payments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %1$s_select on public.%1$s', t);
      execute format('create policy %1$s_select on public.%1$s for select to authenticated using (company_id = public.my_company() and not public.is_branch())', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- role rules: branch staff = cashier rules

create or replace function public.guard_targets() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.app_role := public.my_role();
begin
  if r is null then return new; end if;              -- service role / server
  if r::text in ('cashier', 'agent') and new.target is distinct from old.target then
    raise exception 'Only the Admin or CEO can change a target';
  end if;
  if r = 'ceo' and (to_jsonb(new) - array['target','target_set_by','target_set_at'])
                 is distinct from (to_jsonb(old) - array['target','target_set_by','target_set_at']) then
    raise exception 'The CEO can only change targets';
  end if;
  return new;
end $$;

create or replace function public.trip_target_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role()::text in ('cashier', 'agent') then
    select coalesce(v.target, 0), v.target_set_by into new.target, new.target_set_by
    from public.vehicles v where v.company_id = new.company_id and v.plate = new.plate;
    new.target := coalesce(new.target, 0);
  end if;
  return new;
end $$;

create or replace function public.guard_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role()::text in ('cashier', 'agent') and old.pay in ('paid', 'bill') and new.pay is distinct from old.pay then
    raise exception 'Only the Admin can change the payment of this consignment';
  end if;
  return new;
end $$;

do $$ begin
  if to_regprocedure('public.guard_trip_rent()') is not null then
    execute $f$
      create or replace function public.guard_trip_rent() returns trigger
      language plpgsql security definer set search_path = public as $b$
      begin
        if public.my_role()::text in ('cashier', 'agent') and (new.rent_cost, new.ownership, new.owner_name) is distinct from (old.rent_cost, old.ownership, old.owner_name) then
          raise exception 'Only the Admin can change the rent of a trip';
        end if;
        return new;
      end $b$;
    $f$;
  end if;
end $$;

create or replace function public.guard_found_goods() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.app_role := public.my_role();
  t public.trips%rowtype;
  who text;
begin
  if r is null then return new; end if;                 -- server / service role

  if tg_op = 'INSERT' then
    if new.found_on_arrival then
      select found_goods_by into who from public.companies where id = new.company_id;
      if r <> 'admin' and not (r::text in ('cashier', 'agent') and coalesce(who, 'all') = 'all') then
        raise exception 'Only the Admin can record goods found on arrival';
      end if;
      select * into t from public.trips where id = new.trip_id and company_id = new.company_id;
      if not found or t.status <> 'arrived' then
        raise exception 'Found goods must be recorded on a truck that has arrived';
      end if;
      -- They travelled on that truck: same route, already arrived.
      new.origin := t.origin; new.dest := t.dest; new.status := 'arrived';
      new.loaded_at := coalesce(t.departed_at, now()); new.transit_at := coalesce(t.departed_at, now());
      new.arrived_at := coalesce(t.arrived_at, now());
    end if;
    -- Recorded by the Admin: already checked. Recorded by a cashier: waits for the Admin.
    if new.found_on_arrival and r = 'admin' then
      select full_name into new.checked_by from public.profiles where id = auth.uid();
      new.checked_at := now();
    else
      new.checked_by := null; new.checked_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.found_on_arrival is distinct from old.found_on_arrival then
    raise exception 'The found-on-arrival flag cannot be changed';
  end if;
  if (new.checked_by, new.checked_at) is distinct from (old.checked_by, old.checked_at) and r <> 'admin' then
    raise exception 'Only the Admin can mark found goods as checked';
  end if;
  -- Once found goods are checked, only the Admin may change their charge.
  if old.found_on_arrival and old.checked_at is not null and r <> 'admin'
     and (new.charge, new.items) is distinct from (old.charge, old.items) then
    raise exception 'Only the Admin can change the charge of checked goods';
  end if;
  return new;
end $$;


