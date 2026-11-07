\set ON_ERROR_STOP 0
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
\echo '--- L1 branch adds Hamisi, stamped DOD (expect DOD)'
insert into runners(name, phone, station) values ('Hamisi','0716','DAR') returning name, station;
\echo '--- L2 duplicate name refused (expect ERROR)'
insert into runners(name) values ('hamisi ');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
\echo '--- L3 admin adds a Dar person; branch cannot see or change them (expect 0 then UPDATE 0)'
insert into runners(name, station) values ('Dar Guy','DAR');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
select count(*) from runners where name='Dar Guy';
update runners set active=false where name='Dar Guy';
\echo '--- L4 branch deactivates own person (expect f)'
update runners set active=false where name='Hamisi' returning active;
