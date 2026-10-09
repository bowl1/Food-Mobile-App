\set ON_ERROR_STOP on
\ir sql/setup.sql
-- Generation alone creates no favorite. Saving moves the exact row, idempotently.
update recipe_drafts set image_status='generating',image_path=user_id::text||'/saved.jpg',image_lease_id=gen_random_uuid(),image_started_at=now();
insert into ai_jobs(id,user_id,kind,payload_hash,reserved_usd,result,status)
select gen_random_uuid(),user_id,'generate','favorite-cache',.1,
 jsonb_build_object('recipes',jsonb_build_array(jsonb_build_object('id',id,'recipe_name',recipe_name))),'complete'
from recipe_drafts;
insert into ai_free_operations(user_id,id,trial_day,generation_job_id)
select user_id,id,0,id from ai_jobs where payload_hash='favorite-cache';
update ai_jobs set free_operation_id=id where payload_hash='favorite-cache';
update recipe_sessions set free_operation_id=(select id from ai_jobs where payload_hash='favorite-cache');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select * from save_favorite_recipe('20000000-0000-0000-0000-000000000001')) then raise exception 'foreign save'; end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ begin
 if exists(select 1 from favorite_recipes) then raise exception 'automatic favorite'; end if;
 perform save_favorite_recipe('20000000-0000-0000-0000-000000000001');
 perform save_favorite_recipe('20000000-0000-0000-0000-000000000001');
 if (select count(*) from favorite_recipes)<>1 then raise exception 'duplicate favorite'; end if;
 if exists(select 1 from recipe_drafts) then raise exception 'saved draft retained'; end if;
 if not exists(select 1 from recipes where image_lease_id is not null) then raise exception 'image lease lost on save'; end if;
 -- An in-flight image finishes against the same ID after the move to favorites.
 update recipes set image_status='ready' where id='20000000-0000-0000-0000-000000000001';
 if not exists(select 1 from favorite_recipes where image_status='ready') then raise exception 'favorite image update'; end if;
end $$;
reset role;
do $$ begin
 if (select jsonb_array_length(result->'recipes') from ai_jobs where payload_hash='favorite-cache')<>1 then raise exception 'save lost image authorization'; end if;
 if reserve_free_ai_job('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'image','saved image',.05,6,10,3,null,
 '20000000-0000-0000-0000-000000000001')->>'state'<>'reserved' then raise exception 'saved favorite image not authorized'; end if;
end $$;
-- More than ten favorites survive future generation and age cleanup.
insert into recipe_drafts(user_id,session_id,recipe_name,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,created_at)
select user_id,session_id,'Meal '||i,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,
 now()-interval '100 days' from favorite_recipes cross join generate_series(1,12) i;
set role authenticated;
do $$ declare r record; begin
 for r in select id from recipe_drafts loop perform save_favorite_recipe(r.id); end loop;
end $$;
reset role;
update favorite_recipes set created_at=now()-interval '200 days';
insert into recipe_drafts(user_id,session_id,recipe_name,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,created_at,image_path)
select user_id,session_id,'Expired unsaved',ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,
 now()-interval '2 days',user_id::text||'/draft.jpg' from favorite_recipes limit 1;
insert into storage.objects(bucket_id,name,created_at) values
('recipe-images','00000000-0000-0000-0000-000000000001/orphan.jpg',now()-interval '2 days'),
('recipe-images','00000000-0000-0000-0000-000000000001/inflight.jpg',now());
set role service_role;
do $$ begin
 perform prune_app_data();
 if (select count(*) from favorite_recipes)<>13 then raise exception 'favorite auto trimmed or expired'; end if;
 if exists(select 1 from recipe_drafts) then raise exception 'expired drafts retained'; end if;
 if not exists(select 1 from image_cleanup_queue where path like '%/draft.jpg') then raise exception 'draft image cleanup missing'; end if;
 if not exists(select 1 from image_cleanup_queue where path like '%/orphan.jpg') then raise exception 'legacy orphan missing'; end if;
 if exists(select 1 from image_cleanup_queue where path like '%/inflight.jpg') then raise exception 'young upload swept'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select 1 from favorite_recipes) or exists(select 1 from recipes) then raise exception 'foreign read'; end if;
 delete from favorite_recipes;
 if found then raise exception 'foreign delete'; end if;
 begin
  perform prune_app_data();
  raise exception 'client can prune all users';
 exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
delete from favorite_recipes where id='20000000-0000-0000-0000-000000000001';
reset role;
do $$ begin
 if (select result->'recipes' from ai_jobs where payload_hash='favorite-cache')<>'[]'::jsonb then raise exception 'deleted favorite cache retained'; end if;
 if (select count(*) from favorite_recipes)<>12 then raise exception 'favorite delete'; end if;
end $$;
delete from favorite_recipes;
do $$ begin
 if exists(select 1 from recipe_sessions) then raise exception 'empty sessions retained'; end if;
end $$;
select 'explicit unlimited favorites, RLS, in-flight images, draft expiry and permanent deletion passed' as result;
