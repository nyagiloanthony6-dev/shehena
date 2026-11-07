-- Shehena — delivery people (casual workers who take goods to customers)
--
-- At a destination, arrived goods can be handed to a delivery person with their receipts. When the
-- person comes back they hand in the money for the goods they delivered, and the office marks those
-- consignments delivered (paid and released) or returned. Each consignment keeps who took it out, when,
-- who handed it out, and when it was settled, for the per-person report. Run after 0018.

alter table public.shipments
  add column if not exists runner_name       text not null default '',
  add column if not exists runner_phone      text not null default '',
  add column if not exists runner_out_at     timestamptz,
  add column if not exists runner_by         text,
  add column if not exists runner_settled_at timestamptz,
  add column if not exists runner_amount     numeric(14, 2) not null default 0 check (runner_amount >= 0);  -- money the person handed in

create index if not exists shipments_runner on public.shipments (company_id, runner_name) where runner_name <> '';

-- Goods can only go out with a delivery person once they have arrived, and come back to the office
-- (returned) only while not yet collected.
create or replace function public.guard_runner() returns trigger
language plpgsql as $$
begin
  if new.runner_name <> '' and coalesce(old.runner_name, '') = '' and new.status <> 'arrived' then
    raise exception 'Only goods that have arrived can be given to a delivery person';
  end if;
  return new;
end $$;
drop trigger if exists shipments_runner_guard on public.shipments;
create trigger shipments_runner_guard before update of runner_name on public.shipments
  for each row execute function public.guard_runner();
