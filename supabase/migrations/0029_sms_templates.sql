-- 0029: Clients write their own SMS wording.
--   companies.sms_templates = {"arrived_receiver": "Habari {receiver}, mzigo {waybill} umefika {to}...", ...}
-- Keys: received_receiver, received_sender, departed_receiver, arrived_receiver, reminder_receiver, collected_receiver.
-- Blanks like {receiver} are filled in for each consignment. An empty or missing template uses Shehena's standard text.
-- Run after 0028.
alter table public.companies
  add column if not exists sms_templates jsonb not null default '{}'::jsonb;
