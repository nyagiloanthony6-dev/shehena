-- Shehena — an account number for every client company
--
-- Each company gets a unique, permanent account number (SH10001, SH10002, …) in the order they
-- joined. New companies get the next number automatically. Clients quote it when paying Serengeti
-- Labs, and it appears in the owner console, the client's Settings and subscription receipts.
-- Run after 0017.

create sequence if not exists public.company_account_seq start 10001;

alter table public.companies add column if not exists account_no text;

-- Number existing companies in the order they joined.
do $$
declare r record;
begin
  for r in select id from public.companies where account_no is null order by created_at, id loop
    update public.companies set account_no = 'SH' || nextval('public.company_account_seq') where id = r.id;
  end loop;
end $$;

alter table public.companies alter column account_no set default ('SH' || nextval('public.company_account_seq'));
alter table public.companies alter column account_no set not null;
create unique index if not exists companies_account_no on public.companies (account_no);

-- The number never changes once given.
create or replace function public.keep_account_no() returns trigger
language plpgsql as $$
begin
  new.account_no := old.account_no;
  return new;
end $$;
drop trigger if exists companies_keep_account_no on public.companies;
create trigger companies_keep_account_no before update of account_no on public.companies
  for each row execute function public.keep_account_no();
