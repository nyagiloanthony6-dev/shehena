\set ON_ERROR_STOP 0
-- after rls_test, bills_test, branch_test, branch_money_test (needs 0014)
reset role; update profiles set active=true where id='a0000000-0000-0000-0000-000000000002';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- C1 head-office cashier sees no bill accounts, bill payments, claims or claim payments (expect 0 0 0 0)'
select (select count(*) from bill_accounts) a, (select count(*) from bill_payments) bp, (select count(*) from claims) c, (select count(*) from claim_payments) cp;
\echo '--- C2 cashier cannot open an account or record a claim (expect ERROR x2)'
insert into bill_accounts(company_id,name) values ('aaaaaaaa-0000-0000-0000-000000000000','X');
insert into claims(company_id,customer_name,kind) values ('aaaaaaaa-0000-0000-0000-000000000000','X','lost');
\echo '--- C3 cashier cannot receive goods on a bill (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay,account_id)
values ('aaaaaaaa-0000-0000-0000-000000000000','CB-1','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":1,"charge":1000}]',1,1000,'bill','dddddddd-0000-0000-0000-000000000001');
\echo '--- C4 cashier can still receive unpaid goods (expect INSERT) but not move them to a bill (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay)
values ('aaaaaaaa-0000-0000-0000-000000000000','CB-2','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":1,"charge":1000}]',1,1000,'unpaid') returning no;
update shipments set pay='bill', account_id='dddddddd-0000-0000-0000-000000000001' where no='CB-2';
\echo '--- C5 cashier can take payment (expect paid)'
update shipments set pay='paid', method='Cash' where no='CB-2' returning pay;
\echo '--- C6 branch staff can put goods on their own bill (expect bill); admin sees all accounts (expect >=2)'
reset role; insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay,status)
values ('aaaaaaaa-0000-0000-0000-000000000000','CB-3','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":1,"charge":1000}]',1,1000,'unpaid','arrived');
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
update shipments set pay='bill', account_id='dddddddd-0000-0000-0000-000000000009' where no='CB-3' returning pay;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select count(*) >= 2 as admin_sees from bill_accounts;
\echo '--- C7 CEO still sees claims (expect true)'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select count(*) >= 1 as ceo_sees from claims;
