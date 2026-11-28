-- 0031: Connect NextSMS from the owner console (no Vercel step).
-- One row with the NextSMS login. Row level security is on with NO policies, so app users
-- (clients, staff) can never read it; only the server (service role) can.
-- If this row is empty, Shehena uses NEXTSMS_USERNAME / NEXTSMS_PASSWORD from Vercel.
-- Run after 0030.
create table if not exists public.sms_provider (
  id           integer primary key default 1 check (id = 1),
  username     text not null default '',
  password     text not null default '',
  connected_at timestamptz,
  connected_by text not null default ''
);
alter table public.sms_provider enable row level security;
revoke all on public.sms_provider from anon, authenticated;
