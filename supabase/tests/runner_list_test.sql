\set ON_ERROR_STOP 0
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
\echo '--- L1 branch adds a person: stamped DOD (expect DOD)'
insert into runners(company_id,name,phone,station) values ('aaaaaaaa-0000-0000-0000-000000000000','Juma','0711','DAR') returning name, station;
\echo '--- L2 duplicate name refused (expect ERROR)'
insert into runners(company_id,name) values ('aaaaaaaa-0000-0000-0000-000000000000',' juma ');
\echo '--- L3 admin adds a Dar person; branch does not see them (expect 0)'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
insert into runners(company_id,name,station) values ('aaaaaaaa-0000-0000-0000-000000000000','Hamisi','DAR');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
select count(*) from runners where name='Hamisi';
\echo '--- L4 branch cannot edit the Dar person (expect UPDATE 0) but can deactivate own (expect f)'
update runners set active=false where name='Hamisi';
update runners set active=false where name='Juma' returning active;
\echo '--- L5 CEO cannot add (expect ERROR)'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
insert into runners(company_id,name) values ('aaaaaaaa-0000-0000-0000-000000000000','X');
