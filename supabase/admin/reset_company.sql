-- Shehena — clear ONE company's data so it can start afresh.
-- Run in Supabase → SQL Editor. THIS CANNOT BE UNDONE.
--
-- Deletes for that company: consignments, trips, saved vehicles, monthly bill customers and their
-- payments, claims and claim payments. Resets company details (branch, phone, offices, default
-- origin, message language, found-goods rule) so the Admin sets them up again.
-- Keeps: the company and its name, all staff and their sign-ins, and its Shehena subscription
-- (status, trial, payments to Serengeti Labs).
--
-- STEP 1. Replace PUT THE COMPANY NAME HERE below with the company's name, exactly as in the Owner console.
-- STEP 2. Run. It refuses unless exactly one company has that name, and shows what was deleted.

do $$
declare
  target_name constant text := 'PUT THE COMPANY NAME HERE';
  cid uuid;
  n int;
  report text := '';
begin
  select count(*) into n from public.companies where lower(trim(name)) = lower(trim(target_name));
  if n <> 1 then
    raise exception 'Found % companies named "%". Check the name (Owner console lists them) and try again.', n, target_name;
  end if;
  select id into cid from public.companies where lower(trim(name)) = lower(trim(target_name));

  if to_regclass('public.claim_payments') is not null then
    delete from public.claim_payments where company_id = cid; get diagnostics n = row_count; report := report || format('claim payments %s, ', n);
    delete from public.claims         where company_id = cid; get diagnostics n = row_count; report := report || format('claims %s, ', n);
    delete from public.bill_payments  where company_id = cid; get diagnostics n = row_count; report := report || format('bill payments %s, ', n);
  end if;
  delete from public.shipments where company_id = cid; get diagnostics n = row_count; report := report || format('consignments %s, ', n);
  if to_regclass('public.bill_accounts') is not null then
    delete from public.bill_accounts where company_id = cid; get diagnostics n = row_count; report := report || format('bill customers %s, ', n);
  end if;
  delete from public.trips    where company_id = cid; get diagnostics n = row_count; report := report || format('trips %s, ', n);
  delete from public.vehicles where company_id = cid; get diagnostics n = row_count; report := report || format('vehicles %s', n);

  update public.companies set branch = default, phone = default, default_origin = default, message_lang = default where id = cid;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'offices') then
    update public.companies set offices = default where id = cid;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'found_goods_by') then
    update public.companies set found_goods_by = default where id = cid;
  end if;

  raise notice 'Cleared "%": %. Staff and subscription kept.', target_name, report;
end $$;
