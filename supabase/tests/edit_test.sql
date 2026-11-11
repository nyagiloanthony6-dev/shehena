\set ON_ERROR_STOP 0
-- after rls_test, branch_test, partial_test (needs 0021). Cashier …02, branch …09 at DOD, admin …01.
reset role;
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
\echo '--- E1 save with no names and no charge (expect charge 0)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay)
values ('aaaaaaaa-0000-0000-0000-000000000000','ED-1','','0712000000','','0713000000','DAR','DOD','[{"name":"Box","pkgs":2,"charge":0}]',2,0,'unpaid') returning charge, s_name = '' as no_name;
\echo '--- E2 edit: add names and the charge (expect 45000, 1 log entry)'
update shipments set s_name='Juma', r_name='Asha', items='[{"name":"Box","pkgs":2,"charge":45000}]', edited_at=now(), edited_by='Cashier A',
  edit_log = edit_log || '[{"at":"x","by":"Cashier A","changes":{"Charge":["TZS 0","TZS 45,000"]}}]'::jsonb
  where no='ED-1' returning charge, jsonb_array_length(edit_log) as log;
\echo '--- E3 route change after loading is refused (expect ERROR)'
reset role; update shipments set status='loaded' where no='ED-1';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
update shipments set dest='MZA', edited_at=now() where no='ED-1';
\echo '--- E4 loading/payment updates without edited_at are not affected (expect transit)'
update shipments set status='transit' where no='ED-1' returning status;
\echo '--- E5 paid in full: charge change refused (expect ERROR)'
update shipments set pay='paid', method='Cash' where no='ED-1';
update shipments set items='[{"name":"Box","pkgs":2,"charge":30000}]', edited_at=now() where no='ED-1';
\echo '--- E6 paid in full: name change is fine (expect Asha M)'
update shipments set r_name='Asha M', edited_at=now() where no='ED-1' returning r_name;
\echo '--- E7 part paid 20000: charge below that refused (expect ERROR), above fine (expect 25000)'
insert into shipments(company_id,no,s_name,s_phone,r_name,r_phone,origin,dest,items,pkgs,charge,pay,paid_amount)
values ('aaaaaaaa-0000-0000-0000-000000000000','ED-2','S','0712000000','R','0713000000','DAR','DOD','[{"name":"Box","pkgs":1,"charge":50000}]',1,50000,'unpaid',20000);
update shipments set items='[{"name":"Box","pkgs":1,"charge":15000}]', edited_at=now() where no='ED-2';
update shipments set items='[{"name":"Box","pkgs":1,"charge":25000}]', edited_at=now() where no='ED-2' returning charge;
\echo '--- E8 collected: cashier refused (expect ERROR), admin allowed (expect Fixed)'
reset role; update shipments set status='collected', collected_at=now() where no='ED-1';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
update shipments set notes='late fix', edited_at=now() where no='ED-1';
set role authenticated; set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
update shipments set notes='Fixed', edited_at=now() where no='ED-1' returning notes;
