-- Run against an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
\ir sql/setup.sql
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select * from claim_recipe_image('20000000-0000-0000-0000-000000000001',gen_random_uuid())) then raise exception 'cross-user claim'; end if;
end $$;
do $$ begin
 if exists(select * from public.recipes) then
  raise exception 'cross-user recipe read';
 end if;
 if exists(select * from public.recipe_sessions) then
  raise exception 'cross-user session read';
 end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
 if (select count(*) from public.recipes) <> 1 then
  raise exception 'owner recipe read blocked';
 end if;
end $$;
reset role;
insert into storage.objects (bucket_id,name) values ('recipe-images','00000000-0000-0000-0000-000000000001/test.jpg');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select * from storage.objects) then raise exception 'cross-user storage read'; end if;
 begin
  insert into storage.objects (bucket_id,name) values ('recipe-images','00000000-0000-0000-0000-000000000001/attack.jpg');
  raise exception 'cross-user storage write accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
select 'cross-user recipe, session, image claim and Storage RLS checks passed' as result;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
 if not exists(select 1 from storage.objects) then raise exception 'owner cannot read paid image'; end if;
 begin
   insert into storage.objects(bucket_id,name) values('recipe-images',auth.uid()::text||'/unbudgeted.jpg');
   raise exception 'client can upload outside budget controls';
 exception when insufficient_privilege then null; end;
 update storage.objects set name=auth.uid()::text||'/overwrite.jpg';
 if found then raise exception 'client can overwrite paid images'; end if;
end $$;
