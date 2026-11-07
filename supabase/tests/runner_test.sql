\set ON_ERROR_STOP 0
reset role;
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay,status) values
 ('aaaaaaaa-0000-0000-0000-000000000000','RN-1','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":1,"charge":30000}]',1,30000,'unpaid','arrived'),
 ('aaaaaaaa-0000-0000-0000-000000000000','RN-2','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":1,"charge":20000}]',1,20000,'unpaid','received');
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
\echo '--- R1 branch hands arrived goods to Musa (expect Musa)'
update shipments set runner_name='Musa', runner_phone='0715000000', runner_out_at=now(), runner_by='Neema' where no='RN-1' returning runner_name;
\echo '--- R2 goods not yet arrived cannot go out (expect ERROR or 0 rows)'
reset role; update shipments set runner_name='Musa' where no='RN-2';
\echo '--- R3 settle: paid + released in one step (expect paid collected 30000)'
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
update shipments set pay='paid', method='Cash', paid_at=now(), status='collected', collected_at=now(), collected_by='Neema', runner_settled_at=now(), runner_amount=30000 where no='RN-1' returning pay, status, paid_amount;
