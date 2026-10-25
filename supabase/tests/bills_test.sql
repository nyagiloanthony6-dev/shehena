\set ON_ERROR_STOP 0
-- run after rls_test.sql + found_test.sql (company A admin …01, cashier …02, ceo …03; company B admin)
reset role;
update profiles set active=true where id='a0000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- B1 cashier cannot open a bill account (expect ERROR)'
insert into bill_accounts(company_id,name) values ('aaaaaaaa-0000-0000-0000-000000000000','Duka la Juma');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
\echo '--- B2 admin opens bill account'
insert into bill_accounts(id,company_id,name,phone) values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Duka la Juma','0712000111') returning name;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- B3 cashier receives goods on bill with items and a discount (expect gross 50000, discount 5000, charge 45000)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,pay,account_id,items,discount,discount_reason)
 values ('aaaaaaaa-0000-0000-0000-000000000000','BL-1','Juma','0712','Asha','0754','x',1,'DAR','DOD','bill','dddddddd-0000-0000-0000-000000000001',
 '[{"name":"Rice","pkgs":5,"charge":50000}]', 5000, 'Regular customer') returning gross_charge, discount, charge, pay;
\echo '--- B4 bill without account (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,pay) values ('aaaaaaaa-0000-0000-0000-000000000000','BL-2','J','1','A','2','x',1,'DAR','DOD','bill');
\echo '--- B5 billed goods can be released without paying (expect UPDATE 1 / collected)'
update shipments set status='collected', collected_at=now() where no='BL-1' returning status;
\echo '--- B6 cashier cannot take a consignment off the bill (expect ERROR)'
update shipments set pay='unpaid' where no='BL-1';
\echo '--- B7 discount bigger than the charge (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,items,discount) values ('aaaaaaaa-0000-0000-0000-000000000000','D-1','J','1','A','2','x',1,'DAR','DOD','[{"name":"Box","pkgs":1,"charge":1000}]',2000);
\echo '--- B8 discount later on unpaid legacy row (no items): A-2 charge 30000 -> discount 3000 (expect 30000 3000 27000)'
reset role;
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,charge) values ('aaaaaaaa-0000-0000-0000-000000000000','A-2','J','1','A','2','Bags',2,'DAR','DOD',30000);
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
update shipments set discount=3000, discount_reason='Late' where no='A-2' returning gross_charge, discount, charge;
\echo '--- B9 change discount again 3000 -> 1000 (expect 30000 1000 29000)'
update shipments set discount=1000 where no='A-2' returning gross_charge, discount, charge;
\echo '--- B10 normal unpaid still cannot be released (expect ERROR)'
update shipments set status='collected' where no='A-2';
\echo '--- B11 pay it, then try discount (expect ERROR)'
update shipments set pay='paid' where no='A-2';
update shipments set discount=0 where no='A-2';
\echo '--- B12 cashier records bill payment (expect INSERT)'
insert into bill_payments(company_id,account_id,amount,paid_on,method) values ('aaaaaaaa-0000-0000-0000-000000000000','dddddddd-0000-0000-0000-000000000001',20000,'2026-10-20','M-Pesa') returning amount;
\echo '--- B13 cashier cannot delete bill payment (expect DELETE 0)'
delete from bill_payments returning id;
\echo '--- C1 cashier records a claim and a payment'
insert into claims(id,company_id,customer_name,kind,goods_value,compensation,waybill) values ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Asha','broken',120000,80000,'BL-1') returning kind, compensation;
insert into claim_payments(company_id,claim_id,amount,paid_on) values ('aaaaaaaa-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001',30000,'2026-10-22') returning amount;
\echo '--- C2 cashier cannot change compensation (expect UPDATE 0 rows)'
update claims set compensation=1 returning id;
\echo '--- C3 bad kind (expect ERROR)'
insert into claims(company_id,customer_name,kind) values ('aaaaaaaa-0000-0000-0000-000000000000','X','stolen');
\echo '--- C4 company B admin sees no claims/bills of A (expect 0 0)'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select (select count(*) from claims) claims, (select count(*) from bill_accounts) accounts;
\echo '--- C5 company B cannot pay into A claim (expect ERROR)'
insert into claim_payments(company_id,claim_id,amount) values ('bbbbbbbb-0000-0000-0000-000000000000','eeeeeeee-0000-0000-0000-000000000001',1);
\echo '--- C6 CEO A reads claims but cannot add (expect 1 then ERROR)'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
select count(*) from claims;
insert into claims(company_id,customer_name,kind) values ('aaaaaaaa-0000-0000-0000-000000000000','X','lost');
