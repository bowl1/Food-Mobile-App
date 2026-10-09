-- Run against an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
\set legacy_only true
\ir sql/setup.sql
-- Seed an old installation with more than ten recipes before upgrading.
insert into recipes(user_id,session_id,recipe_name,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,created_at)
select user_id,session_id,'Legacy '||i,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score,
 now()-interval '100 days'+make_interval(hours=>i)
from recipes cross join generate_series(1,12) i;
-- Existing manual installations must also accept the initial migrations.
\ir ../../supabase/migrations/001_fridgechef.sql
\ir ../../supabase/migrations/002_recipe_images.sql
\ir ../../supabase/migrations/003_ai_cost_controls.sql
\ir ../../supabase/migrations/004_image_recovery.sql
\ir ../../supabase/migrations/005_storage_cleanup.sql
\ir ../../supabase/migrations/007_once_only_free_trial.sql
\ir ../../supabase/migrations/008_permanent_recent_history.sql
\ir ../../supabase/migrations/009_three_lifetime_free_uses.sql
do $$ begin
 if (select count(*) from public.recipes) <> 10 then
  raise exception 'existing recipe lost during repeated migration';
 end if;
 if (select recipe_name from public.recipes order by created_at desc limit 1) <> 'Eggs' then
  raise exception 'existing recipe changed during repeated migration';
 end if;
end $$;
select 'migration and existing data checks passed' as result;
