\set ON_ERROR_STOP 0
-- run after rls_test.sql + bills_test.sql setup (company A); adds a Dodoma branch user
reset role;
insert into auth.users values ('a0000000-0000-0000-0000-000000000009','dodoma@a.tz');
insert into public.profiles(id,company_id,full_name,email,role,active,created_at,station) values ('a0000000-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000000','Branch Dodoma','dodoma@a.tz','agent',true,now(),'DOD');
update profiles set active=true where id='a0000000-0000-0000-0000-000000000002';
insert into trips(id,company_id,no,plate,origin,dest,status) values
 ('ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','TR-DOD','T 915 CBA','DAR','DOD','departed'),
 ('ffffffff-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','TR-MWZ','T 999 MWZ','DAR','MWZ','departed');
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,charge,status,trip_id) values
 ('aaaaaaaa-0000-0000-0000-000000000000','S1','J','1','R','2','Box',1,'DAR','DOD',1000,'transit','ffffffff-0000-0000-0000-000000000001'),
 ('aaaaaaaa-0000-0000-0000-000000000000','S2','J','1','R','2','Box',1,'DAR','MWZ',1000,'transit','ffffffff-0000-0000-0000-000000000002'),
 ('aaaaaaaa-0000-0000-0000-000000000000','S3','J','1','R','2','Box',1,'DAR','DOD',1000,'received',null);
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
\echo '--- G1 branch receives goods at Dodoma for Dar (expect INSERT)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,charge,created_by) values ('aaaaaaaa-0000-0000-0000-000000000000','S4','Ali','0712','Bakari','0754','Beans',3,'DOD','DAR',9000,'a0000000-0000-0000-0000-000000000009') returning no;
\echo '--- G2 branch cannot receive goods "at" Dar (expect ERROR)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,item,pkgs,origin,dest,created_by) values ('aaaaaaaa-0000-0000-0000-000000000000','S5','x','1','y','2','z',1,'DAR','DOD','a0000000-0000-0000-0000-000000000009');
\echo '--- G3 branch sees only S1 (loaded to Dodoma) and S4 (own) (expect S1,S4)'
select string_agg(no, ',' order by no) from shipments;
\echo '--- G4 branch sees trips to/from Dodoma only (expect TR-DOD)'
select string_agg(no, ',' order by no) from trips;
\echo '--- G5 branch marks S1 arrived (expect UPDATE 1) but cannot touch S2 (expect UPDATE 0)'
update shipments set status='arrived', arrived_at=now() where no='S1';
update shipments set status='arrived' where no='S2';
\echo '--- G6 branch starts a trip from Dodoma (expect INSERT) but not from Dar (expect ERROR)'
insert into trips(company_id,no,plate,origin,dest) values ('aaaaaaaa-0000-0000-0000-000000000000','TR-BACK','T 915 CBA','DOD','DAR') returning no;
insert into trips(company_id,no,plate,origin,dest) values ('aaaaaaaa-0000-0000-0000-000000000000','TR-BAD','T 915 CBA','DAR','DOD');
\echo '--- G7 branch cannot change a target (expect ERROR)'
update trips set target=1 where no='TR-DOD';
\echo '--- G8 branch sees no claims, claim payments or bill payments (expect 0 0 0)'
select (select count(*) from claims) c, (select count(*) from claim_payments) cp, (select count(*) from bill_payments) bp;
\echo '--- G9 cashier still sees everything (expect 7 or more shipments incl. S2,S3)'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select count(*) >= 5 as many, bool_or(no='S2') s2, bool_or(no='S3') s3 from shipments;
\echo '--- G10 branch cannot undo a paid consignment (expect ERROR)'
reset role; update shipments set pay='paid' where no='S1';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
update shipments set pay='unpaid' where no='S1';
