-- 0030: Price per SMS, shown to clients.
--   platform_settings.sms_price  - the standard price per SMS (TZS)
--   company_accounts.sms_price   - a special price for one client (empty = standard price)
-- Run after 0029.
alter table public.platform_settings
  add column if not exists sms_price numeric(10, 2) not null default 30;
alter table public.company_accounts
  add column if not exists sms_price numeric(10, 2);
