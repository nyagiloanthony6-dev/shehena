-- 0028: Each client company has its own SMS sender name.
--   sms_sender_request: the name the client asks for (Settings > SMS), up to 11 letters/numbers.
--   sms_sender:         the name approved by NextSMS / TCRA, set by Serengeti Labs in the owner console.
-- Until sms_sender is set, that company's SMS go out under the shared name (NEXTSMS_SENDER_ID).
-- Run after 0027.
alter table public.companies
  add column if not exists sms_sender text,
  add column if not exists sms_sender_request text,
  add column if not exists sms_sender_requested_at timestamptz;

-- Only Serengeti Labs (the server) sets the approved name; a client can't use a name that isn't theirs.
create or replace function public.guard_sms_sender() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.sms_sender is distinct from old.sms_sender and current_user = 'authenticated' then
    new.sms_sender := old.sms_sender;
  end if;
  return new;
end $$;
drop trigger if exists companies_sms_sender on public.companies;
create trigger companies_sms_sender before update on public.companies
  for each row execute function public.guard_sms_sender();
