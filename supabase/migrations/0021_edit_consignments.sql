-- 0021: edit a consignment after it is saved.
--
-- * Staff can correct a saved consignment (names, phones, goods, charge, route, notes).
-- * Every edit is kept: who, when, and what changed (edit_log), newest last.
-- * Money stays safe: the charge of a consignment that is paid in full can't change
--   (the Admin undoes the payment first), and a part-paid one can't go below what was paid.
-- * The route can only change before the goods are loaded.
-- * Once goods are collected, only the Admin can edit them.
--
-- Goods can now also be saved without a charge ("price later"): the charge is then 0
-- and must be added by editing before the goods are released (the app enforces that).

alter table public.shipments
  add column if not exists edited_at  timestamptz,
  add column if not exists edited_by  text,
  add column if not exists edit_log   jsonb not null default '[]'::jsonb;

create or replace function public.guard_shipment_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only edits made from the Edit screen carry a new edited_at; other updates
  -- (loading, payments, release, notices) are not checked here.
  if new.edited_at is not distinct from old.edited_at then
    return new;
  end if;
  if old.status = 'collected' and public.my_role() <> 'admin' then
    raise exception 'These goods were already collected. Only the Admin can edit them now.';
  end if;
  if (new.origin is distinct from old.origin or new.dest is distinct from old.dest) and old.status <> 'received' then
    raise exception 'The route can''t change after the goods are loaded.';
  end if;
  if old.pay = 'paid' and new.pay = 'paid' and new.charge is distinct from old.charge then
    raise exception 'This consignment is paid in full, so its charge can''t change. The Admin must undo the payment first.';
  end if;
  if coalesce(old.paid_amount, 0) > 0 and new.pay = 'unpaid' and new.charge < old.paid_amount then
    raise exception 'TZS % has already been paid; the charge can''t be less than that.', old.paid_amount;
  end if;
  return new;
end $$;

-- Runs after the items trigger has worked out the new charge ("shipments_items" < "shipments_zedit").
drop trigger if exists shipments_zedit on public.shipments;
create trigger shipments_zedit before update on public.shipments
  for each row execute function public.guard_shipment_edit();
