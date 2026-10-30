-- Shehena — monthly bills and claims belong to the destination offices
--
-- Head-office cashiers (origin, e.g. Dar es Salaam) no longer see or record monthly bill customers,
-- bill payments, claims or claim payments, and can't put a consignment on a monthly bill.
-- Branch staff at the destination do this for their own office (0012); the Admin does everything;
-- the CEO still sees them (read only). Run after 0012.

-- bill accounts: not for cashiers
drop policy if exists bill_accounts_select on public.bill_accounts;
create policy bill_accounts_select on public.bill_accounts for select to authenticated
  using (company_id = public.my_company() and public.my_role()::text <> 'cashier'
         and (not public.is_branch() or station = public.my_station()));

-- bill payments
drop policy if exists bill_payments_select on public.bill_payments;
create policy bill_payments_select on public.bill_payments for select to authenticated
  using (company_id = public.my_company() and public.my_role()::text <> 'cashier' and (not public.is_branch() or exists (
    select 1 from public.bill_accounts a where a.id = account_id and a.station = public.my_station())));
drop policy if exists bill_payments_insert on public.bill_payments;
create policy bill_payments_insert on public.bill_payments for insert to authenticated
  with check (company_id = public.my_company() and exists (
    select 1 from public.bill_accounts a where a.id = account_id and a.company_id = public.my_company()
      and (public.my_role()::text = 'admin' or (public.is_branch() and a.station = public.my_station()))));

-- claims
drop policy if exists claims_select on public.claims;
create policy claims_select on public.claims for select to authenticated
  using (company_id = public.my_company() and public.my_role()::text <> 'cashier'
         and (not public.is_branch() or station = public.my_station()));
drop policy if exists claims_insert on public.claims;
create policy claims_insert on public.claims for insert to authenticated
  with check (company_id = public.my_company() and (public.my_role()::text = 'admin' or (public.is_branch() and station = public.my_station())));

-- claim payments
drop policy if exists claim_payments_select on public.claim_payments;
create policy claim_payments_select on public.claim_payments for select to authenticated
  using (company_id = public.my_company() and public.my_role()::text <> 'cashier' and (not public.is_branch() or exists (
    select 1 from public.claims c where c.id = claim_id and c.station = public.my_station())));
drop policy if exists claim_payments_insert on public.claim_payments;
create policy claim_payments_insert on public.claim_payments for insert to authenticated
  with check (company_id = public.my_company() and exists (
    select 1 from public.claims c where c.id = claim_id and c.company_id = public.my_company()
      and (public.my_role()::text = 'admin' or (public.is_branch() and c.station = public.my_station()))));

-- A cashier can't put goods on a monthly bill (on receiving or later).
create or replace function public.guard_cashier_bill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role()::text = 'cashier' and new.pay = 'bill'
     and (tg_op = 'INSERT' or old.pay is distinct from 'bill' or old.account_id is distinct from new.account_id) then
    raise exception 'Monthly bills are handled at the destination office or by the Admin';
  end if;
  return new;
end $$;
drop trigger if exists shipments_cashier_bill on public.shipments;
create trigger shipments_cashier_bill before insert or update on public.shipments
  for each row execute function public.guard_cashier_bill();
