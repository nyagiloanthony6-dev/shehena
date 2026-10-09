-- Shehena — demo requests from the public marketing page.
-- Only the server writes and reads them (owner console); visitors never see other requests.

create table if not exists public.leads (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text not null,
  company    text not null default '',
  phone      text not null,
  email      text not null default '',
  region     text not null default '',
  trucks     text not null default '',
  message    text not null default '',
  source     text not null default '',
  status     text not null default 'new' check (status in ('new', 'contacted', 'demo', 'won', 'lost')),
  notes      text not null default ''
);
create index if not exists leads_created_idx on public.leads (created_at desc);
alter table public.leads enable row level security;
