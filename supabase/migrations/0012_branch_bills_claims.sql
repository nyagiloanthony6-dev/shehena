-- Shehena — branch staff can work with monthly bill customers and claims for their own office
--
-- bill_accounts.station / claims.station: the office a bill customer or claim belongs to.
-- Branch staff see and add bill customers and claims for their office only (and record payments on them).
-- The Admin, cashiers and CEO still see everything. Only the Admin edits or closes accounts and claims.
-- Run after 0010.

alter table public.bill_accounts add column if not exists station text;
alter table public.claims        add column if not exists station text;

-- Branch staff's new records always belong to their own office.
create or replace function public.stamp_station() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_branch() then new.station := public.my_station(); end if;
  return new;
end $$;
drop trigger if exists bill_accounts_station on public.bill_accounts;
create trigger bill_accounts_station before insert on public.bill_accounts for each row execute function public.stamp_station();
drop trigger if exists claims_station on public.claims;
create trigger claims_station before insert on public.claims for each row execute function public.stamp_station();

-- bill accounts
drop policy if exists bill_accounts_select on public.bill_accounts;
create policy bill_accounts_select on public.bill_accounts for select to authenticated
  using (company_id = public.my_company() and (not public.is_branch() or station = public.my_station()));
drop policy if exists bill_accounts_insert on public.bill_accounts;
create policy bill_accounts_insert on public.bill_accounts for insert to authenticated
  with check (company_id = public.my_company() and (public.my_role() = 'admin' or (public.is_branch() and station = public.my_station())));

-- bill payments
drop policy if exists bill_payments_select on public.bill_payments;
create policy bill_payments_select on public.bill_payments for select to authenticated
  using (company_id = public.my_company() and (not public.is_branch() or exists (
    select 1 from public.bill_accounts a where a.id = account_id and a.station = public.my_station())));
drop policy if exists bill_payments_insert on public.bill_payments;
create policy bill_payments_insert on public.bill_payments for insert to authenticated
  with check (company_id = public.my_company() and exists (
    select 1 from public.bill_accounts a where a.id = account_id and a.company_id = public.my_company()
      and (public.my_role() in ('admin', 'cashier') or (public.is_branch() and a.station = public.my_station()))));

-- claims
drop policy if exists claims_select on public.claims;
create policy claims_select on public.claims for select to authenticated
  using (company_id = public.my_company() and (not public.is_branch() or station = public.my_station()));
drop policy if exists claims_insert on public.claims;
create policy claims_insert on public.claims for insert to authenticated
  with check (company_id = public.my_company() and (public.my_role() in ('admin', 'cashier') or (public.is_branch() and station = public.my_station())));

-- claim payments
drop policy if exists claim_payments_select on public.claim_payments;
create policy claim_payments_select on public.claim_payments for select to authenticated
  using (company_id = public.my_company() and (not public.is_branch() or exists (
    select 1 from public.claims c where c.id = claim_id and c.station = public.my_station())));
drop policy if exists claim_payments_insert on public.claim_payments;
create policy claim_payments_insert on public.claim_payments for insert to authenticated
  with check (company_id = public.my_company() and exists (
    select 1 from public.claims c where c.id = claim_id and c.company_id = public.my_company()
      and (public.my_role() in ('admin', 'cashier') or (public.is_branch() and c.station = public.my_station()))));

-- Existing claims tied to a consignment belong to that consignment's destination office.
update public.claims c set station = s.dest from public.shipments s where c.shipment_id = s.id and c.station is null;
