-- Shehena — goods found on an arrived truck that were never recorded at loading
--
-- The destination office (or the Admin) records them against the arrived trip, with the proper
-- charge. They are marked found_on_arrival so the Admin can check every one of them.
--
-- companies.found_goods_by : who may record found goods — 'all' (Admin and cashiers) or 'admin' (Admin only)
-- shipments.found_*        : flag, how it was found, and the Admin's check (checked_by / checked_at)

alter table public.companies
  add column if not exists found_goods_by text not null default 'all' check (found_goods_by in ('all', 'admin'));

alter table public.shipments
  add column if not exists found_on_arrival boolean not null default false,
  add column if not exists found_note       text not null default '',
  add column if not exists checked_by       text,
  add column if not exists checked_at       timestamptz;

create index if not exists shipments_found_idx on public.shipments (company_id) where found_on_arrival and checked_at is null;

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
      if r <> 'admin' and not (r = 'cashier' and coalesce(who, 'all') = 'all') then
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

drop trigger if exists shipments_found on public.shipments;
create trigger shipments_found before insert or update on public.shipments
  for each row execute function public.guard_found_goods();

-- Only the Admin may change who can record found goods (companies_update is already Admin-only).
