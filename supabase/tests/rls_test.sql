\set ON_ERROR_STOP 0
-- two companies, each with admin / cashier / ceo
insert into auth.users values
 ('a0000000-0000-0000-0000-000000000001','admin@a.tz'),('a0000000-0000-0000-0000-000000000002','cash@a.tz'),('a0000000-0000-0000-0000-000000000003','ceo@a.tz'),
 ('b0000000-0000-0000-0000-000000000001','admin@b.tz');
insert into public.companies(id,name) values ('aaaaaaaa-0000-0000-0000-000000000000','Company A'),('bbbbbbbb-0000-0000-0000-000000000000','Company B');
insert into public.profiles values
 ('a0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Admin A','admin@a.tz','admin',true,now()),
 ('a0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Cashier A','cash@a.tz','cashier',true,now()),
 ('a0000000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','CEO A','ceo@a.tz','ceo',true,now()),
 ('b0000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000000','Admin B','admin@b.tz','admin',true,now());

set role authenticated;
-- Company B admin creates data
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,charge) values ('bbbbbbbb-0000-0000-0000-000000000000','B-1','x','0712','y','0754','Rice',2,'DAR','DOD',5000);
-- Company A admin
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
\echo '--- T1 admin A sees only own company (expect 0 shipments, 1 company, 3 profiles)'
select count(*) shipments from shipments; select count(*) companies from companies; select count(*) profiles from profiles;
\echo '--- T2 admin A cannot insert into company B (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest) values ('bbbbbbbb-0000-0000-0000-000000000000','X','x','1','y','2','z',1,'DAR','DOD');
insert into vehicles(company_id,plate,target) values ('aaaaaaaa-0000-0000-0000-000000000000','T 915 CBA',2500000);
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,charge,pay) values ('aaaaaaaa-0000-0000-0000-000000000000','A-1','Juma','0712','Neema','0754','Oil',12,'DAR','DOD',84000,'paid');
\echo '--- T3 admin A cannot update company B shipment (expect UPDATE 0)'
update shipments set charge=1 where no='B-1';
-- Cashier
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- T4 cashier trip insert ignores typed target, takes vehicle target (expect 2500000.00)'
insert into trips(company_id,no,plate,origin,dest,target) values ('aaaaaaaa-0000-0000-0000-000000000000','TRIP-1','T 915 CBA','DAR','DOD',1) returning target;
\echo '--- T5 cashier cannot change target (expect ERROR)'
update trips set target=10 where no='TRIP-1';
\echo '--- T6 cashier cannot undo payment (expect ERROR)'
update shipments set pay='unpaid' where no='A-1';
\echo '--- T7 cashier cannot delete shipments (expect DELETE 0)'
delete from shipments where no='A-1';
\echo '--- T8 cashier cannot edit company settings (expect UPDATE 0)'
update companies set name='Hacked';
-- CEO
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
\echo '--- T9 CEO can set trip target (expect UPDATE 1)'
update trips set target=3000000, target_set_by='CEO A' where no='TRIP-1';
\echo '--- T10 CEO cannot change trip status (expect ERROR)'
update trips set status='departed' where no='TRIP-1';
\echo '--- T11 CEO cannot edit shipments (expect UPDATE 0)'
update shipments set charge=1 where no='A-1';
\echo '--- T12 CEO reads company data (expect 1 shipment, 1 trip)'
select count(*) from shipments; select count(*) from trips;
-- deactivated user loses access
reset role;
update profiles set active=false where id='a0000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- T13 disabled cashier sees nothing (expect 0)'
select count(*) from shipments;
\echo '--- T14 anonymous sees nothing (expect 0 or permission denied)'
reset role; set role anon; select count(*) from shipments;
