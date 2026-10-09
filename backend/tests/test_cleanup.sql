\set ON_ERROR_STOP on
\ir sql/setup.sql
update recipes set created_at=now()-interval '110 days',image_path=user_id::text||'/oldest.jpg';
insert into recipes(user_id,session_id,recipe_name,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,created_at,image_path)
select user_id,session_id,'Meal '||i,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,
 now()-interval '100 days'+make_interval(hours=>i),user_id::text||'/meal-'||i||'.jpg'
from recipes cross join generate_series(1,12) i;
insert into ai_jobs(id,user_id,kind,payload_hash,reserved_usd,created_at,subject_id,status)
select gen_random_uuid(),user_id,'image','retained-recipe',.05,now()-interval '100 days',id,'failed'
from recipes order by created_at desc limit 1;
insert into storage.objects(bucket_id,name,created_at) values
('recipe-images','00000000-0000-0000-0000-000000000001/orphan.jpg',now()-interval '2 days'),
('recipe-images','00000000-0000-0000-0000-000000000001/inflight.jpg',now());
set role service_role;
do $$ begin
 perform prune_app_data(0);
 if (select count(*) from recipes)<>10 then raise exception 'insert did not permanently trim history'; end if;
 if not exists(select 1 from image_cleanup_queue where path like '%/orphan.jpg') then raise exception 'legacy orphan not queued'; end if;
 if exists(select 1 from image_cleanup_queue where path like '%/inflight.jpg') then raise exception 'active upload queued'; end if;
 perform prune_app_data(90);
 if (select count(*) from recipes)<>10 then raise exception 'latest ten not preserved'; end if;
 if (select count(*) from image_cleanup_queue)<>4 then raise exception 'deleted image not queued'; end if;
 if not exists(select 1 from ai_jobs where payload_hash='retained-recipe') then raise exception 'lifetime image attempts lost'; end if;
 perform prune_app_data(90);
 if (select count(*) from recipes)<>10 then raise exception 'repeat cleanup deleted latest ten'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin
 begin
  perform prune_app_data(1);
  raise exception 'client can prune all users';
 exception when insufficient_privilege then null; end;
 begin
  insert into image_cleanup_queue(path,user_id) values('foreign/image.jpg',auth.uid());
  raise exception 'client can add admin deletion path';
 exception when insufficient_privilege then null; end;
end $$;
select 'retention, latest-ten preservation, orphan cleanup and queue permissions passed' as result;

reset role;
insert into ai_jobs(id,user_id,kind,payload_hash,reserved_usd,result,status)
values(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','generate','deleted-owner',.1,'{"private":"recipe"}','complete');
delete from auth.users where id='00000000-0000-0000-0000-000000000002';
do $$ begin
 if not exists(select 1 from ai_jobs where payload_hash='deleted-owner' and result is null and reserved_usd=.1 and status='failed') then
  raise exception 'account deletion erased budget or left private results';
 end if;
end $$;
-- Even an old in-flight recipe must not remain as a hidden archive.
insert into recipes(user_id,session_id,recipe_name,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,created_at,image_status,image_started_at)
select user_id,session_id,'Active image',ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,
 now()-interval '200 days','generating',now() from recipes limit 1;
set role service_role;
do $$ begin
 perform prune_app_data(90);
 if exists(select 1 from recipes where recipe_name='Active image') then raise exception 'in-flight recipe kept beyond latest ten'; end if;
end $$;
reset role;
update recipes set image_started_at=now()-interval '10 minutes' where recipe_name='Active image';
set role service_role;
do $$ begin
 perform prune_app_data(90);
 if exists(select 1 from recipes where recipe_name='Active image') then raise exception 'expired old image job not pruned'; end if;
end $$;

reset role;
insert into ai_jobs(id,user_id,kind,payload_hash,reserved_usd,result,status)
select gen_random_uuid(),user_id,'generate','cached-delete',.1,
 jsonb_build_object('recipes',jsonb_build_array(jsonb_build_object('id',id,'recipe_name',recipe_name))),'complete'
from recipes order by created_at desc limit 1;
delete from recipes where id=(select (result->'recipes'->0->>'id')::uuid from ai_jobs where payload_hash='cached-delete');
do $$ begin
 if (select result->'recipes' from ai_jobs where payload_hash='cached-delete')<>'[]'::jsonb then
  raise exception 'deleted recipe retained in cached AI result';
 end if;
end $$;
delete from recipes;
do $$ begin
 if exists(select 1 from recipe_sessions) then raise exception 'empty sessions retained'; end if;
end $$;

update ai_jobs set result='{"recipes":[{"id":"20000000-0000-0000-0000-000000000001","recipe_name":"deleted"}]}'
where payload_hash='cached-delete';
do $$ begin
 if (select result->'recipes' from ai_jobs where payload_hash='cached-delete')<>'[]'::jsonb then
  raise exception 'delayed response resurrected deleted cache';
 end if;
end $$;
