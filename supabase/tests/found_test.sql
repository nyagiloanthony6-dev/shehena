\set ON_ERROR_STOP 0
-- run after rls_test.sql (company A: admin …01, cashier …02 (disabled there, re-enabled here), ceo …03)
reset role;
update profiles set active=true where id='a0000000-0000-0000-0000-000000000002';
insert into trips(id,company_id,no,plate,origin,dest,status,departed_at,arrived_at) values
 ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','TRIP-ARR','T 915 CBA','DAR','MWZ','arrived',now()-interval '1 day',now()),
 ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','TRIP-LOAD','T 915 CBA','DAR','DOD','loading',null,null);
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- F1 cashier records found goods on arrived trip; route/status come from the trip (expect DAR MWZ arrived, unchecked)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,charge,trip_id,found_on_arrival,status)
 values ('aaaaaaaa-0000-0000-0000-000000000000','F-1','','','Rehema','0754','Bicycle',1,'XXX','YYY',20000,'cccccccc-0000-0000-0000-000000000001',true,'received')
 returning origin,dest,status,checked_by is null as unchecked;
\echo '--- F2 found goods on a truck still loading (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,trip_id,found_on_arrival) values ('aaaaaaaa-0000-0000-0000-000000000000','F-2','','','R','0754','Box',1,'DAR','DOD','cccccccc-0000-0000-0000-000000000002',true);
\echo '--- F3 cashier cannot mark checked (expect ERROR)'
update shipments set checked_by='Cashier A', checked_at=now() where no='F-1';
\echo '--- F4 cashier cannot clear the found flag (expect ERROR)'
update shipments set found_on_arrival=false where no='F-1';
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
\echo '--- F5 admin marks checked (expect UPDATE 1)'
update shipments set checked_by='Admin A', checked_at=now() where no='F-1';
\echo '--- F6 admin switches to admin-only'
update companies set found_goods_by='admin';
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- F7 cashier blocked when admin-only (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,trip_id,found_on_arrival) values ('aaaaaaaa-0000-0000-0000-000000000000','F-3','','','R','0754','Box',1,'DAR','MWZ','cccccccc-0000-0000-0000-000000000001',true);
\echo '--- F8 cashier cannot change charge of checked found goods (expect ERROR)'
update shipments set charge=1 where no='F-1';
\echo '--- F9 cashier cannot change company setting (expect UPDATE 0)'
update companies set found_goods_by='all';
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
\echo '--- F10 admin records found goods: auto-checked by Admin A (expect Admin A)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,trip_id,found_on_arrival) values ('aaaaaaaa-0000-0000-0000-000000000000','F-4','','','R','0754','Box',1,'DAR','MWZ','cccccccc-0000-0000-0000-000000000001',true) returning checked_by;
\echo '--- F11 normal receive still works for cashier after reset (expect INSERT)'
update companies set found_goods_by='all';
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest) values ('aaaaaaaa-0000-0000-0000-000000000000','N-1','J','0712','R','0754','Box',1,'DAR','MWZ') returning status, found_on_arrival;
