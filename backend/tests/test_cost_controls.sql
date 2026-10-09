\set ON_ERROR_STOP on
\ir sql/setup.sql
-- Give the protected generation result a real owned recipe to authorize images.
set role service_role;
do $$
declare a uuid := '00000000-0000-0000-0000-000000000001';
 b uuid := '00000000-0000-0000-0000-000000000002';
 scan uuid:=gen_random_uuid(); gen uuid:=gen_random_uuid(); j uuid; r jsonb; day integer;
 recipe uuid:='20000000-0000-0000-0000-000000000001';
begin
 if (free_trial_status(a,3)->>'remaining_uses')::integer<>3 then raise exception 'initial allowance'; end if;
 r:=reserve_free_ai_job(a,scan,'recognize','photo',.02,99,10,3);
 if r->>'state'<>'reserved' then raise exception 'first scan %',r; end if;
 if reserve_free_ai_job(a,scan,'recognize','photo',.02,99,10,3)->>'state'<>'running' then raise exception 'duplicate'; end if;
 if reserve_free_ai_job(a,scan,'recognize','changed',.02,99,10,3)->>'state'<>'conflict' then raise exception 'fingerprint'; end if;
 update ai_jobs set status='complete',result='{}' where id=scan;
 if reserve_free_ai_job(b,gen,'generate','cross-owner',.1,99,10,3,scan)->>'state'<>'operation_required' then raise exception 'foreign scan accepted'; end if;
 r:=reserve_free_ai_job(a,gen,'generate','meal',.1,99,10,3,scan);
 if r->>'state'<>'reserved' or r->>'free_operation_id'<>scan::text then raise exception 'included generation %',r; end if;
 update ai_jobs set status='complete',result=jsonb_build_object('recipes',jsonb_build_array(jsonb_build_object('id',recipe))) where id=gen;
 if (select count(*) from ai_free_operations where user_id=a)<>1 then raise exception 'included generation debited twice'; end if;
 if reserve_free_ai_job(a,gen_random_uuid(),'generate','again',.1,99,10,3,scan)->>'state'<>'operation_used' then raise exception 'reused scan'; end if;
end $$;
reset role;
update recipe_sessions set free_operation_id=(select id from ai_free_operations limit 1);
set role service_role;
do $$
declare a uuid := '00000000-0000-0000-0000-000000000001';
 b uuid := '00000000-0000-0000-0000-000000000002'; j uuid; day integer; r jsonb;
 recipe uuid:='20000000-0000-0000-0000-000000000001';
begin
 if reserve_free_ai_job(a,gen_random_uuid(),'image','fake',.05,99,10,3,null,gen_random_uuid())->>'state'<>'operation_required' then raise exception 'unowned image accepted'; end if;
 for i in 1..2 loop
  j:=gen_random_uuid();
  r:=reserve_free_ai_job(a,j,'image','dish',.05,99,10,3,null,recipe);
  if r->>'state'<>'reserved' then raise exception 'included image %',r; end if;
  update ai_jobs set status='failed' where id=j;
 end loop;
 if (select count(*) from ai_free_operations where user_id=a)<>1 then raise exception 'images debit root uses'; end if;
 for i in 1..2 loop
  j:=gen_random_uuid();
  r:=reserve_free_ai_job(a,j,'generate','manual',.1,99,10,3);
  if r->>'state'<>'reserved' then raise exception 'manual free use %',r; end if;
  update ai_jobs set status='complete',result='{"recipes":[]}' where id=j;
 end loop;
 if (select count(*) from ai_free_operations where user_id=a)<>3 then raise exception 'lifetime total'; end if;
 if reserve_free_ai_job(a,gen_random_uuid(),'recognize','extra',.02,99,10,3)->>'state'<>'free_limit' then raise exception 'lifetime cap'; end if;
 if (free_trial_status(a,3)->>'remaining_uses')::integer<>0 then raise exception 'remaining display'; end if;
 update ai_free_trials set started_at=now()-interval '35 days' where user_id=a;
 if reserve_free_ai_job(a,gen_random_uuid(),'generate','next month',.1,99,10,3)->>'state'<>'free_limit' then raise exception 'monthly renewal'; end if;
 -- Simulate old completed work and scheduled housekeeping.
 update ai_jobs set created_at=now()-interval '100 days' where user_id=a and kind='generate';
 perform prune_app_data();
 -- Images remain included even after the three root uses are exhausted and months pass.
 if reserve_free_ai_job(a,gen_random_uuid(),'image','late dish',.05,99,10,3,null,recipe)->>'state'<>'reserved' then raise exception 'included image expired'; end if;
 if reserve_free_ai_job(a,gen_random_uuid(),'image','dish',.05,99,10,3,null,recipe)->>'state'<>'image_limit' then raise exception 'image attempt cap'; end if;
 select id into j from ai_jobs where user_id=a and kind='recognize';
 if reserve_free_ai_job(a,j,'recognize','photo',.02,99,10,3)->>'state'<>'complete' then raise exception 'completed replay after expiry'; end if;
 if reserve_free_ai_job(b,gen_random_uuid(),'generate','budget',.1,99,.01,3)->>'state'<>'daily_limit' then raise exception 'global budget'; end if;
 if exists(select 1 from ai_free_trials where user_id=b) then raise exception 'denied request starts trial'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin
 begin
  perform reserve_free_ai_job(auth.uid(),gen_random_uuid(),'generate','attack',.001,99999,99999,99999);
  raise exception 'client can reserve arbitrary budgets';
 exception when insufficient_privilege then null; end;
 begin
  update ai_free_trials set started_at=now();
  raise exception 'client can restart trial';
 exception when insufficient_privilege then null; end;
 begin
  perform * from ai_jobs;
  raise exception 'client can read jobs';
 exception when insufficient_privilege then null; end;
end $$;
select 'three lifetime uses, included generation/images, lifetime cap, replay, budget and permissions passed' as result;

-- Only the privileged generation role bypasses lifetime recipe limits.
set role service_role;
insert into ai_account_roles(user_id,role)
values ('00000000-0000-0000-0000-000000000002','unlimited_recipe_generation');
do $$
declare owner uuid:='00000000-0000-0000-0000-000000000002'; j uuid; r jsonb;
begin
 delete from ai_jobs where user_id=owner;
 delete from ai_free_operations where user_id=owner;
 for i in 1..5 loop
  j:=gen_random_uuid();
  r:=reserve_free_ai_job(owner,j,'generate','role-test',.001,99,1000,3);
  if r->>'state'<>'reserved' then raise exception 'unlimited generation blocked: %',r; end if;
  update ai_jobs set status='complete',result='{}' where user_id=owner and id=j;
 end loop;
 if (free_trial_status(owner,3)->>'remaining_uses')::integer<>3 then
  raise exception 'unlimited generation consumed scan allowance'; end if;
 if not (free_trial_status(owner,3)->>'unlimited_generation')::boolean then
  raise exception 'role missing from status'; end if;
 for i in 1..3 loop
  j:=gen_random_uuid();
  r:=reserve_free_ai_job(owner,j,'recognize','scan-test',.001,99,1000,3);
  if r->>'state'<>'reserved' then raise exception 'role scan blocked: %',r; end if;
  update ai_jobs set status='complete',result='{}' where user_id=owner and id=j;
 end loop;
 if reserve_free_ai_job(owner,gen_random_uuid(),'recognize','scan-test',.001,99,1000,3)->>'state'<>'free_limit' then
  raise exception 'role incorrectly grants unlimited recognition'; end if;
 if reserve_free_ai_job(owner,gen_random_uuid(),'generate','rate-test',.001,1,1000,3)->>'state'<>'rate_limit' then
  raise exception 'role bypassed rate limit'; end if;
end $$;
reset role;
set role authenticated;
do $$ begin
 begin
  insert into public.ai_account_roles(user_id,role)
  values ('00000000-0000-0000-0000-000000000001','unlimited_recipe_generation');
  raise exception 'user granted own entitlement';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
