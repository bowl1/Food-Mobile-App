-- History is removed, not automatically promoted to favorites.
-- Deleting old history also scrubs cached recipe copies and queues its images.
delete from public.recipes;
update public.ai_jobs set result=jsonb_set(result,'{recipes}','[]'::jsonb)
where kind='generate' and jsonb_typeof(result->'recipes')='array';
delete from public.recipe_sessions where not exists(select 1 from public.recipes r where r.session_id=recipe_sessions.id);
drop trigger keep_recent_recipes on public.recipes;
drop function public.enforce_recent_recipe_history();
drop function public.trim_user_recipe_history(uuid);
alter table public.recipes rename to recipe_drafts;
create table public.favorite_recipes (like public.recipe_drafts including defaults including constraints);
alter table public.favorite_recipes add primary key(id);
alter table public.favorite_recipes add foreign key(session_id,user_id)
 references public.recipe_sessions(id,user_id) on delete cascade;
create index favorite_recipes_owner on public.favorite_recipes(user_id,created_at desc,id desc);
alter table public.favorite_recipes enable row level security;
create policy own_favorites on public.favorite_recipes for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.favorite_recipes to authenticated,service_role;
-- Shared image/accounting code sees current drafts and saved favorites, never a history table.
do $$ declare columns text; begin
 select string_agg(quote_ident(attname),',' order by attnum) into columns from pg_attribute
 where attrelid='public.recipe_drafts'::regclass and attnum>0 and not attisdropped;
 execute format('create view public.recipes with (security_invoker=true) as select %s from public.recipe_drafts union all select %s from public.favorite_recipes',columns,columns);
end $$;
grant select,update on public.recipes to authenticated,service_role;
create function public.update_recipe_image() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.user_id is distinct from old.user_id or new.id is distinct from old.id then
   raise exception 'Cannot change recipe ownership';
 end if;
 update recipe_drafts set image_status=new.image_status,image_path=new.image_path,
 image_started_at=new.image_started_at,image_lease_id=new.image_lease_id
 where id=old.id and user_id=old.user_id and image_lease_id is not distinct from old.image_lease_id;
 if not found then
   update favorite_recipes set image_status=new.image_status,image_path=new.image_path,
   image_started_at=new.image_started_at,image_lease_id=new.image_lease_id
   where id=old.id and user_id=old.user_id and image_lease_id is not distinct from old.image_lease_id;
 end if;
 if not found then return null; end if;
 return new;
end $$;
revoke all on function public.update_recipe_image() from public,authenticated;
create trigger update_shared_recipe_image instead of update on public.recipes
for each row execute function public.update_recipe_image();

create or replace function public.claim_recipe_image(recipe_id uuid,lease_id uuid,retry_failed boolean default false)
returns setof public.recipe_drafts language sql security invoker set search_path=public as $$
 update public.recipes set image_status='generating',image_started_at=now(),image_lease_id=lease_id,
 image_path=coalesce(image_path,auth.uid()::text||'/'||recipe_id::text||'/image.jpg')
 where id=recipe_id and user_id=auth.uid() and (
 image_status in ('none','pending') or (image_status='failed' and retry_failed)
 or (image_status='generating' and image_started_at<now()-interval '4 minutes'))
 returning *;
$$;

-- Moving a recipe into favorites keeps its image and protected generation authorization.
create or replace function public.queue_recipe_image_cleanup() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.image_path is not null and old.image_path like old.user_id::text||'/%'
 and (tg_op='DELETE' or old.image_path is distinct from new.image_path) then
   insert into image_cleanup_queue(path,user_id) values(old.image_path,old.user_id) on conflict(path) do nothing;
 end if;
 if tg_op='DELETE' then
   if not exists(select 1 from recipes where id=old.id and user_id=old.user_id) then
     update ai_jobs j set result=jsonb_set(j.result,'{recipes}',coalesce((
       select jsonb_agg(item) from jsonb_array_elements(j.result->'recipes') item
       where item->>'id'<>old.id::text),'[]'::jsonb))
     where j.user_id=old.user_id and j.kind='generate' and jsonb_typeof(j.result->'recipes')='array'
     and j.result->'recipes' @> jsonb_build_array(jsonb_build_object('id',old.id::text));
   end if;
   if not exists(select 1 from recipes where session_id=old.session_id and user_id=old.user_id) then
     delete from recipe_sessions where id=old.session_id and user_id=old.user_id;
   end if;
   return old;
 end if;
 return new;
end $$;
create trigger favorite_image_cleanup after delete or update of image_path on public.favorite_recipes
for each row execute function public.queue_recipe_image_cleanup();

create function public.save_favorite_recipe(recipe_id uuid) returns setof public.favorite_recipes
language plpgsql security invoker set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,731280494));
 if exists(select 1 from favorite_recipes where id=recipe_id and user_id=auth.uid()) then
   return query select * from favorite_recipes where id=recipe_id and user_id=auth.uid();
   return;
 end if;
 -- Row lock serializes saves with image updates and draft replacement.
 perform 1 from recipe_drafts where id=recipe_id and user_id=auth.uid() for update;
 if not found then return; end if;
 insert into favorite_recipes select d.* from recipe_drafts d where d.id=recipe_id and d.user_id=auth.uid();
 update favorite_recipes set created_at=now() where id=recipe_id and user_id=auth.uid();
 delete from recipe_drafts where id=recipe_id and user_id=auth.uid();
 return query select * from favorite_recipes where id=recipe_id and user_id=auth.uid();
end $$;
revoke all on function public.save_favorite_recipe(uuid) from public;
grant execute on function public.save_favorite_recipe(uuid) to authenticated;

create or replace function public.prune_app_data(retention_days integer default 0,batch_size integer default 100)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare removed integer:=0; removed_sessions integer:=0;
begin
 if batch_size<1 or batch_size>500 then raise exception 'Invalid cleanup batch size'; end if;
 -- retention_days is accepted for old API compatibility, but no age archive remains.
 perform pg_advisory_xact_lock(731280493);
 -- Favorites never expire. Unsaved drafts expire after 24 hours, or on the next generation.
 delete from recipe_drafts where id in (
   select id from recipe_drafts where created_at<now()-interval '24 hours' order by created_at limit batch_size
 );
 get diagnostics removed=row_count;
 with empty_sessions as (
   select s.id from recipe_sessions s where not exists(select 1 from recipes r where r.session_id=s.id)
   limit batch_size
 ) delete from recipe_sessions where id in(select id from empty_sessions);
 get diagnostics removed_sessions=row_count;
 -- Repair stale cached recipe copies left by deletions before this migration.
 update ai_jobs j set result=jsonb_set(j.result,'{recipes}',coalesce((
   select jsonb_agg(item) from jsonb_array_elements(j.result->'recipes') item
   where exists(select 1 from recipes r where r.user_id=j.user_id and r.id::text=item->>'id')),'[]'::jsonb))
 where j.kind='generate' and jsonb_typeof(j.result->'recipes')='array'
 and exists(select 1 from jsonb_array_elements(j.result->'recipes') item where not exists(
   select 1 from recipes r where r.user_id=j.user_id and r.id::text=item->>'id'));
 insert into image_cleanup_queue(path,user_id)
 select distinct regexp_replace(o.name,'\.thumb\.jpg$',''),split_part(o.name,'/',1)::uuid
 from storage.objects o where o.bucket_id='recipe-images' and o.created_at<now()-interval '24 hours'
 and split_part(o.name,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 and not exists(select 1 from recipes r where o.name=r.image_path or o.name=r.image_path||'.thumb.jpg')
 limit batch_size on conflict(path) do nothing;
 -- Metadata needed for budgets/one-time trial is not a recipe archive.
 delete from ai_jobs j where j.created_at<now()-interval '90 days'
 and (j.kind<>'image' or j.subject_id is null or not exists(select 1 from recipes r where r.id=j.subject_id))
 -- Preserve unused scan entitlements and image authorization for retained recipes.
 and not (j.kind='recognize' and exists(select 1 from ai_free_operations o
   where o.user_id=j.user_id and o.recognition_job_id=j.id and o.generation_job_id is null))
 and not (j.kind='generate' and exists(select 1 from recipes r join recipe_sessions s on s.id=r.session_id
   where r.user_id=j.user_id and s.free_operation_id=j.free_operation_id));
 delete from ai_usage where created_at<now()-interval '90 days';
 return jsonb_build_object('recipes',removed,'sessions',removed_sessions);
end $$;
revoke all on function public.prune_app_data(integer,integer) from public,authenticated;
grant execute on function public.prune_app_data(integer,integer) to service_role;
