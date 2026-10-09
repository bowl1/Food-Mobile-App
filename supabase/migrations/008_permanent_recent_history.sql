-- No hidden recipe archive: keep exactly the latest ten per user, regardless of age.
alter table public.image_cleanup_queue alter column next_attempt_at set default now();
update public.image_cleanup_queue set next_attempt_at=least(next_attempt_at,now()) where attempts=0;
create or replace function public.queue_recipe_image_cleanup() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.image_path is not null and old.image_path like old.user_id::text||'/%'
 and (tg_op='DELETE' or old.image_path is distinct from new.image_path) then
   insert into image_cleanup_queue(path,user_id) values(old.image_path,old.user_id) on conflict(path) do nothing;
 end if;
 if tg_op='DELETE' then
   -- Remove recipe copies from idempotent response caches as well as the main row.
   update ai_jobs j set result=jsonb_set(j.result,'{recipes}',coalesce((
     select jsonb_agg(item) from jsonb_array_elements(j.result->'recipes') item
     where item->>'id'<>old.id::text),'[]'::jsonb))
   where j.user_id=old.user_id and j.kind='generate' and jsonb_typeof(j.result->'recipes')='array'
   and j.result->'recipes' @> jsonb_build_array(jsonb_build_object('id',old.id::text));
   if not exists(select 1 from recipes where session_id=old.session_id and user_id=old.user_id) then
     delete from recipe_sessions where id=old.session_id and user_id=old.user_id;
   end if;
   return old;
 end if;
 return new;
end $$;
revoke all on function public.queue_recipe_image_cleanup() from public,authenticated;

-- A delayed generation response must not reintroduce an already deleted recipe copy.
create function public.filter_cached_recipe_result() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.kind='generate' and jsonb_typeof(new.result->'recipes')='array' then
   new.result:=jsonb_set(new.result,'{recipes}',coalesce((
     select jsonb_agg(item) from jsonb_array_elements(new.result->'recipes') item
     where exists(select 1 from recipes r where r.user_id=new.user_id and r.id::text=item->>'id')),'[]'::jsonb));
 end if;
 return new;
end $$;
revoke all on function public.filter_cached_recipe_result() from public,authenticated;
create trigger filter_recipe_cache before insert or update of result on public.ai_jobs
for each row execute function public.filter_cached_recipe_result();

create function public.trim_user_recipe_history(owner_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,731280494));
 delete from recipes where user_id=owner_id and id in (
   select id from recipes where user_id=owner_id order by created_at desc,id desc offset 10
 );
end $$;
revoke all on function public.trim_user_recipe_history(uuid) from public,authenticated;
create function public.enforce_recent_recipe_history() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 perform trim_user_recipe_history(new.user_id);
 return new;
end $$;
revoke all on function public.enforce_recent_recipe_history() from public,authenticated;
create trigger keep_recent_recipes after insert on public.recipes
for each row execute function public.enforce_recent_recipe_history();

-- Upgrade existing users immediately; deletions enqueue their Storage files.
do $$ declare owner_id uuid; begin
 for owner_id in select distinct user_id from recipes loop
   perform trim_user_recipe_history(owner_id);
 end loop;
end $$;

create or replace function public.prune_app_data(retention_days integer default 0,batch_size integer default 100)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare removed integer:=0; removed_sessions integer:=0;
begin
 if batch_size<1 or batch_size>500 then raise exception 'Invalid cleanup batch size'; end if;
 -- retention_days is accepted for old API compatibility, but no age archive remains.
 perform pg_advisory_xact_lock(731280493);
 with old_rows as (
   select r.id from recipes r where (select count(*) from (
     select 1 from recipes newer where newer.user_id=r.user_id
     and (newer.created_at,newer.id)>(r.created_at,r.id) limit 10
   ) recent)>=10 order by r.created_at limit batch_size
 ) delete from recipes where id in(select id from old_rows);
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
 and (j.kind<>'image' or j.subject_id is null or not exists(select 1 from recipes r where r.id=j.subject_id));
 delete from ai_usage where created_at<now()-interval '90 days';
 return jsonb_build_object('recipes',removed,'sessions',removed_sessions);
end $$;
revoke all on function public.prune_app_data(integer,integer) from public,authenticated;
grant execute on function public.prune_app_data(integer,integer) to service_role;
