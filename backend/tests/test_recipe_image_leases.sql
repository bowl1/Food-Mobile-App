-- Run against an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
\ir sql/setup.sql
set role authenticated;
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
select 'image lease deduplication, retry and stale recovery checks passed' as result;
