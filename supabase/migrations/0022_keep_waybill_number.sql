-- 0022: a consignment's waybill / receipt number never changes after it is saved.
-- Editing a consignment changes only the details that were corrected.

create or replace function public.keep_waybill_no() returns trigger
language plpgsql as $$
begin
  if new.no is distinct from old.no then
    new.no := old.no;
  end if;
  return new;
end $$;

drop trigger if exists shipments_keep_no on public.shipments;
create trigger shipments_keep_no before update of no on public.shipments
  for each row execute function public.keep_waybill_no();
