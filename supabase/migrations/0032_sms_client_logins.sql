-- 0032: Each client can send through its own NextSMS user (sub-account under your NextSMS account).
-- One row per client company with that NextSMS user's login. Row level security is on with NO policies,
-- so only the server can read it - never clients or staff. Clients without a row use the main login (sms_provider).
-- Run after 0031.
create table if not exists public.sms_client_logins (
  company_id   uuid primary key references public.companies (id) on delete cascade,
  username     text not null default '',      -- NextSMS username, or __bearer__ / __key__ for a token
  secret       text not null default '',      -- password or token
  connected_at timestamptz not null default now(),
  connected_by text not null default ''
);
alter table public.sms_client_logins enable row level security;
revoke all on public.sms_client_logins from anon, authenticated;
