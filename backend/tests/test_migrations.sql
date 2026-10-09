-- Run against an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
\set legacy_only true
\ir sql/setup.sql
-- Existing manual installations must also accept the initial migrations.
\ir ../../supabase/migrations/001_fridgechef.sql
\ir ../../supabase/migrations/002_recipe_images.sql
\ir ../../supabase/migrations/003_ai_cost_controls.sql
\ir ../../supabase/migrations/007_once_only_free_trial.sql
\ir ../../supabase/migrations/009_three_lifetime_free_uses.sql
do $$ begin
 if (select count(*) from public.recipes) <> 1 then
  raise exception 'existing recipe lost during repeated migration';
 end if;
 if (select recipe_name from public.recipes limit 1) <> 'Eggs' then
  raise exception 'existing recipe changed during repeated migration';
 end if;
end $$;
select 'migration and existing data checks passed' as result;
