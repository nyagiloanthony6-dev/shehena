-- Shehena — several item lines in one consignment, each with its own charge.
-- items: [{ "name": "Cartons of cooking oil", "pkgs": 10, "kg": 200, "unit": 5000, "charge": 50000 }, …]
-- The summary columns (item, pkgs, kg, charge) are recomputed from the lines by the database,
-- so totals on trucks, reports and receipts can never disagree with the lines.

alter table public.shipments add column if not exists items jsonb not null default '[]'::jsonb;

create or replace function public.shipment_items_summary() returns trigger
language plpgsql as $$
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
      into new.item, new.pkgs, new.charge, new.kg
      from jsonb_array_elements(new.items) e;
  end if;
  return new;
end $$;

drop trigger if exists shipments_items on public.shipments;
create trigger shipments_items before insert or update of items on public.shipments
  for each row execute function public.shipment_items_summary();
