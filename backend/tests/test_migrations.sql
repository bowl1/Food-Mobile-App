-- Run against an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
\set legacy_only true
\ir sql/setup.sql
-- Seed an old installation with more than ten recipes before upgrading.
insert into recipes(user_id,session_id,recipe_name,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,created_at)
select user_id,session_id,'Legacy '||i,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,
 now()-interval '100 days'+make_interval(hours=>i)
from recipes cross join generate_series(1,12) i;
update recipes set image_path=user_id::text||'/legacy-'||id::text||'.jpg';
-- Existing manual installations must also accept the initial migrations.
\ir ../../supabase/migrations/001_fridgechef.sql
\ir ../../supabase/migrations/002_recipe_images.sql
\ir ../../supabase/migrations/003_ai_cost_controls.sql
\ir ../../supabase/migrations/004_image_recovery.sql
\ir ../../supabase/migrations/005_storage_cleanup.sql
\ir ../../supabase/migrations/006_trusted_image_uploads.sql
\ir ../../supabase/migrations/007_once_only_free_trial.sql
\ir ../../supabase/migrations/008_permanent_recent_history.sql
\ir ../../supabase/migrations/009_three_lifetime_free_uses.sql
insert into ai_jobs(id,user_id,kind,payload_hash,reserved_usd,result,status)
select gen_random_uuid(),user_id,'generate','legacy-private-result',.1,
 jsonb_build_object('recipes',jsonb_build_array(jsonb_build_object('id',id,'recipe_name',recipe_name))),'complete'
from recipes limit 1;
\ir ../../supabase/migrations/010_explicit_favorite_recipes.sql
update auth.users set email='bowenivy0@gmail.com', email_confirmed_at=now()
where id='00000000-0000-0000-0000-000000000001';
\ir ../../supabase/migrations/011_unlimited_recipe_generation_role.sql
\ir ../../supabase/migrations/012_ios_monthly_subscriptions.sql
\ir ../../supabase/migrations/013_release_failed_ai_uses.sql
do $$ begin
 if not exists(select 1 from ai_account_roles where user_id='00000000-0000-0000-0000-000000000001') then
  raise exception 'confirmed target account did not receive role'; end if;
 if (select count(*) from ai_account_roles)<>1 then raise exception 'other account received role'; end if;
 if exists(select 1 from public.recipe_drafts) or exists(select 1 from public.favorite_recipes) then
  raise exception 'old history was retained or automatically favorited';
 end if;
 if (select count(*) from image_cleanup_queue)<>13 then raise exception 'legacy images not queued'; end if;
 if exists(select 1 from ai_jobs where payload_hash='legacy-private-result' and result->'recipes'<>'[]'::jsonb) then raise exception 'old cached history retained'; end if;
 if (select relkind from pg_class where oid='public.recipes'::regclass)<>'v' then
  raise exception 'legacy history table still exists';
 end if;
end $$;
select 'migration deletes old history and creates explicit favorites' as result;
