\set ON_ERROR_STOP 0
-- run after rls_test.sql (company A admin …01, cashier …02 re-enabled here)
reset role;
update profiles set active=true where id='a0000000-0000-0000-0000-000000000002';
insert into vehicles(company_id,plate,ownership,owner_name,rent_amount,rent_basis) values ('aaaaaaaa-0000-0000-0000-000000000000','T 100 RNT','rental','Mzee Ally',300000,'trip');
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- R1 trip on saved rental truck takes owner and per-trip rent (expect rental Mzee Ally 300000)'
insert into trips(company_id,no,plate,origin,dest) values ('aaaaaaaa-0000-0000-0000-000000000000','TR-R1','T 100 RNT','DAR','DOD') returning ownership, owner_name, rent_cost;
\echo '--- R2 trip on own saved truck ignores typed rent (expect own 0)'
insert into trips(company_id,no,plate,origin,dest,ownership,rent_cost) values ('aaaaaaaa-0000-0000-0000-000000000000','TR-R2','T 915 CBA','DAR','DOD','rental',5) returning ownership, rent_cost;
\echo '--- R3 one-off hired truck (not saved) keeps typed rental details (expect rental Hassani 250000)'
insert into trips(company_id,no,plate,origin,dest,ownership,owner_name,rent_cost) values ('aaaaaaaa-0000-0000-0000-000000000000','TR-R3','T 777 HIR','DAR','DOD','rental','Hassani',250000) returning ownership, owner_name, rent_cost;
\echo '--- R4 cashier cannot change trip rent (expect ERROR)'
update trips set rent_cost=1 where no='TR-R3';
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
\echo '--- R5 admin can (expect 260000)'
update trips set rent_cost=260000 where no='TR-R3' returning rent_cost;
\echo '--- D1 release with delivery note details'
update shipments set status='collected', collected_at=now(), dn_no='DN-1', collector_name='Neema', collector_id='NIDA 1990', collector_phone='0754' where no='A-1' returning dn_no, collector_name;
\echo '--- D2 duplicate DN number in same company (expect ERROR)'
reset role; insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,pay,status,dn_no) values ('aaaaaaaa-0000-0000-0000-000000000000','A-9','x','1','y','2','z',1,'DAR','DOD','paid','collected','DN-1');
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
\echo '--- D3 undo collection clears DN (expect null and empty)'
update shipments set status='arrived', collected_at=null where no='A-1' returning dn_no is null as cleared, collector_name;
