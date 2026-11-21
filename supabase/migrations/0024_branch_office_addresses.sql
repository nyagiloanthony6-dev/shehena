-- 0024: address and phone of each branch office (e.g. Dodoma), by region code.
--   office_info = {"DOD": {"address": "Majengo, near the bus stand", "phone": "0754 000 000"}}
-- Shown on receipts ("Collect at"), delivery notes and arrival messages.
-- The head office keeps using companies.branch and companies.phone.
alter table public.companies
  add column if not exists office_info jsonb not null default '{}'::jsonb;
