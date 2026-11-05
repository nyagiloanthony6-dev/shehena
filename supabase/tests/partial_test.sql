\set ON_ERROR_STOP 0
-- after rls_test, branch_test (needs 0017). Cashier …02, branch …09 at DOD, admin …01.
reset role; update profiles set active=true where id='a0000000-0000-0000-0000-000000000002';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- P1 receive with 20,000 of 50,000 paid (expect unpaid 20000)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay,paid_amount)
values ('aaaaaaaa-0000-0000-0000-000000000000','PP-1','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":2,"charge":50000}]',2,50000,'unpaid',20000) returning pay, paid_amount, charge;
insert into shipment_payments(company_id,shipment_id,amount,method,station,paid_by) select company_id,id,20000,'Cash','DAR','Cashier A' from shipments where no='PP-1' returning amount;
\echo '--- P2 more than the charge is refused (expect ERROR)'
update shipments set paid_amount=60000 where no='PP-1';
\echo '--- P3 discount below what is paid is refused (expect ERROR)'
update shipments set discount=35000 where no='PP-1';
\echo '--- P4 a part-paid consignment cannot go on a bill (expect ERROR)'
reset role; update shipments set pay='bill', account_id=(select id from bill_accounts limit 1) where no='PP-1';
\echo '--- P5 branch staff collect the balance at the destination: it becomes paid (expect paid 50000)'
update shipments set status='arrived' where no='PP-1';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
update shipments set paid_amount=50000, method='M-Pesa' where no='PP-1' returning pay, paid_amount;
insert into shipment_payments(company_id,shipment_id,amount,method,station,paid_by) select company_id,id,30000,'M-Pesa','DOD','Neema' from shipments where no='PP-1' returning amount;
select count(*) as payments_branch_sees from shipment_payments;
\echo '--- P6 release now allowed (expect collected)'
update shipments set status='collected', collected_at=now() where no='PP-1' returning status;
\echo '--- P7 full payment the old way sets paid_amount (expect 40000)'
reset role;
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay) values ('aaaaaaaa-0000-0000-0000-000000000000','PP-2','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":1,"charge":40000}]',1,40000,'paid') returning paid_amount;
\echo '--- P8 admin undo clears payments (expect unpaid 0, 0 rows)'
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
update shipments set pay='unpaid', status='arrived' where no='PP-1' returning pay, paid_amount;
select count(*) from shipment_payments where shipment_id=(select id from shipments where no='PP-1');
\echo '--- P9 cashier cannot delete payments (expect DELETE 0 rows)'
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002'; delete from shipment_payments returning id;
