-- Shehena — the company's offices (branches)
--
-- companies.offices: the region codes where the company has an office, e.g. {DAR,DOD,MWZ}.
-- The head office is companies.default_origin (where goods are mostly received). Set at registration
-- ("where do you send goods from, and where do you deliver to?") and changed by the Admin in Settings.
-- Branch staff are assigned to one of these offices; receiving and loading list them first.

alter table public.companies add column if not exists offices text[] not null default '{}';

-- Existing companies: start with the head office plus every town they have already sent goods to.
update public.companies c
   set offices = (
     select array_agg(distinct x order by x) from (
       select c.default_origin as x
       union select s.dest from public.shipments s where s.company_id = c.id
       union select s.origin from public.shipments s where s.company_id = c.id
     ) t where x is not null and x <> ''
   )
 where cardinality(c.offices) = 0;
