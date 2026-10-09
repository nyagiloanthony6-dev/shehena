\set ON_ERROR_STOP 0
-- run after rls_test.sql data: company A (admin a..1, cashier a..2 disabled, ceo a..3), company B (admin b..1)
\echo '--- T1 accounts backfilled for both companies (expect 2)'
select count(*) from company_accounts;
set role authenticated; set request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001';
\echo '--- T2 client admin cannot read accounts or audit (expect 0, 0)'
select count(*) from company_accounts; select count(*) from owner_audit;
\echo '--- T3 client admin cannot change own status (expect UPDATE 0 or ERROR)'
update company_accounts set status='active';
\echo '--- T4 client reads announcement row (expect 1) but cannot change it (expect UPDATE 0)'
select count(*) from platform_settings;
update platform_settings set announcement='hacked';
\echo '--- T5 client cannot call owner stats (expect ERROR permission denied)'
select * from owner_company_stats();
reset role;
\echo '--- T6 owner (server) stats work (expect 2 rows)'
select count(*) from owner_company_stats();
update company_accounts set status='suspended' where company_id='aaaaaaaa-0000-0000-0000-000000000000';
set role authenticated; set request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001';
\echo '--- T7 suspended company admin sees nothing (expect 0 shipments, 0 companies)'
select count(*) from shipments; select count(*) from companies;
\echo '--- T8 suspended company cannot write (expect ERROR)'
insert into vehicles(company_id,plate) values ('aaaaaaaa-0000-0000-0000-000000000000','T 1');
set request.jwt.claim.sub='b0000000-0000-0000-0000-000000000001';
\echo '--- T9 other company unaffected (expect 1 shipment)'
select count(*) from shipments;
reset role;
update company_accounts set status='active' where company_id='aaaaaaaa-0000-0000-0000-000000000000';
set role authenticated; set request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001';
\echo '--- T10 reactivated company sees its data again (expect 1)'
select count(*) from shipments;
reset role;
\echo '--- T11 new company gets an account row automatically (expect active)'
insert into companies(id,name) values ('cccccccc-0000-0000-0000-000000000000','Company C');
select status from company_accounts where company_id='cccccccc-0000-0000-0000-000000000000';
