-- Run only against an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
grant usage on schema storage to authenticated;
grant all on storage.objects to authenticated;
\ir ../../supabase/migrations/001_fridgechef.sql
\ir ../../supabase/migrations/002_recipe_images.sql
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.recipe_sessions (id,user_id,agent_run_id,attempts,status) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',gen_random_uuid(),1,'complete');
insert into public.recipes (id,user_id,session_id,recipe_name,ingredients,steps,cooking_time_minutes,reason,evaluation,evaluation_score) values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Eggs','[]','[]',10,'test','{}',.9);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select * from claim_recipe_image('20000000-0000-0000-0000-000000000001',gen_random_uuid())) then raise exception 'cross-user claim'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
 if not exists(select * from claim_recipe_image('20000000-0000-0000-0000-000000000001',gen_random_uuid())) then raise exception 'first claim missing'; end if;
 if exists(select * from claim_recipe_image('20000000-0000-0000-0000-000000000001',gen_random_uuid())) then raise exception 'duplicate claim'; end if;
end $$;
update recipes set image_status='failed';
do $$ begin
 if exists(select * from claim_recipe_image('20000000-0000-0000-0000-000000000001',gen_random_uuid())) then raise exception 'automatic failed retry'; end if;
 if not exists(select * from claim_recipe_image('20000000-0000-0000-0000-000000000001',gen_random_uuid(),true)) then raise exception 'manual retry missing'; end if;
end $$;
update recipes set image_started_at=now()-interval '5 minutes';
do $$ begin
 if not exists(select * from claim_recipe_image('20000000-0000-0000-0000-000000000001',gen_random_uuid())) then raise exception 'stale recovery missing'; end if;
end $$;
insert into storage.objects (bucket_id,name) values ('recipe-images','00000000-0000-0000-0000-000000000001/test.jpg');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select * from storage.objects) then raise exception 'cross-user storage read'; end if;
 begin
  insert into storage.objects (bucket_id,name) values ('recipe-images','00000000-0000-0000-0000-000000000001/attack.jpg');
  raise exception 'cross-user storage write accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
select 'migration, deduplication, retry, stale recovery and RLS checks passed' as result;
