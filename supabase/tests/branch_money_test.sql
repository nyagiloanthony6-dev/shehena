\set ON_ERROR_STOP 0
-- after rls_test, bills_test, branch_test (Dodoma branch …09 at DOD)
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
\echo '--- M1 branch sees no head-office accounts or claims yet (expect 0 0)'
select (select count(*) from bill_accounts) a, (select count(*) from claims) c;
\echo '--- M2 branch opens a bill account; it is stamped DOD even if it says MWZ (expect DOD)'
insert into bill_accounts(id,company_id,name,station) values ('dddddddd-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000000','Duka la Dodoma','MWZ') returning station;
\echo '--- M3 branch records a payment on it (expect INSERT) but not on the head-office account (expect ERROR)'
insert into bill_payments(company_id,account_id,amount) values ('aaaaaaaa-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000009',5000) returning amount;
insert into bill_payments(company_id,account_id,amount) values ('aaaaaaaa-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000001',5000);
\echo '--- M4 branch cannot edit or close an account (expect UPDATE 0)'
update bill_accounts set active=false returning id;
\echo '--- M5 branch records a claim and a payment (expect DOD, then INSERT)'
insert into claims(id,company_id,customer_name,kind,compensation) values ('eeeeeeee-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000000','Rehema','damaged',40000) returning station;
insert into claim_payments(company_id,claim_id,amount) values ('aaaaaaaa-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000009',10000) returning amount;
\echo '--- M6 branch cannot pay the head-office claim (expect ERROR) nor change compensation (expect UPDATE 0)'
insert into claim_payments(company_id,claim_id,amount) values ('aaaaaaaa-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001',1);
update claims set compensation=1 returning id;
\echo '--- M7 branch sees only its own account, claim and payments (expect 1 1 1 1)'
select (select count(*) from bill_accounts) a, (select count(*) from claims) c, (select count(*) from bill_payments) bp, (select count(*) from claim_payments) cp;
\echo '--- M8 admin sees everything (expect 2 2)'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select (select count(*) from bill_accounts) a, (select count(*) from claims) c;
