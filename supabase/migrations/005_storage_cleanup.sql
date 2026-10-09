-- Durable cleanup queue survives failed Storage calls and user/account deletion.
create table public.image_cleanup_queue (
  path text primary key,
  user_id uuid not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now() + interval '5 minutes',
  created_at timestamptz not null default now()
);
alter table public.image_cleanup_queue enable row level security;
revoke all on public.image_cleanup_queue from public,authenticated;
grant select,insert,update,delete on public.image_cleanup_queue to service_role;
create index image_cleanup_due on public.image_cleanup_queue(next_attempt_at);
alter table public.ai_jobs add column subject_id uuid;
-- Deleting an account must not erase today's reserved global spending.
alter table public.ai_jobs drop constraint ai_jobs_user_id_fkey;
alter table public.ai_usage drop constraint ai_usage_user_id_fkey;
create function public.redact_deleted_account_jobs() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update ai_jobs set result=null,status='failed' where user_id=old.id;
 delete from ai_usage where user_id=old.id;
 return old;
end $$;
revoke all on function public.redact_deleted_account_jobs() from public,authenticated;
create trigger redact_ai_account after delete on auth.users
for each row execute function public.redact_deleted_account_jobs();

create function public.queue_recipe_image_cleanup() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.image_path is not null and old.image_path like old.user_id::text || '/%'
 and (tg_op='DELETE' or old.image_path is distinct from new.image_path) then
   insert into image_cleanup_queue(path,user_id) values(old.image_path,old.user_id)
     on conflict(path) do nothing;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.queue_recipe_image_cleanup() from public,authenticated;
create trigger recipe_image_cleanup after delete or update of image_path on public.recipes
for each row execute function public.queue_recipe_image_cleanup();

grant select,delete on public.recipes, public.recipe_sessions to service_role;
grant usage on schema storage to service_role;
grant select on storage.objects to service_role;
create index recipes_owner_created on public.recipes(user_id,created_at desc,id desc);
create index sessions_created on public.recipe_sessions(created_at);
create function public.prune_app_data(retention_days integer, batch_size integer default 100)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare removed integer:=0; removed_sessions integer:=0;
begin
 if retention_days<0 or batch_size<1 or batch_size>500 then raise exception 'Invalid retention configuration'; end if;
 perform pg_advisory_xact_lock(731280493);
 if retention_days>0 then
   -- Keep at least the latest ten for every user, even if all are older than TTL.
   with old_rows as (
     select r.id from recipes r where r.created_at<now()-make_interval(days=>retention_days)
     and (select count(*) from (
       select 1 from recipes newer where newer.user_id=r.user_id
       and (newer.created_at,newer.id)>(r.created_at,r.id) limit 10
     ) recent)>=10 order by r.created_at limit batch_size
   ) delete from recipes where id in (select id from old_rows);
   get diagnostics removed=row_count;
   with empty_sessions as (
     select s.id from recipe_sessions s where s.created_at<now()-make_interval(days=>retention_days)
     and not exists(select 1 from recipes r where r.session_id=s.id)
     order by s.created_at limit batch_size
   ) delete from recipe_sessions where id in (select id from empty_sessions);
   get diagnostics removed_sessions=row_count;
 end if;
 -- Recover legacy orphan objects too, but only in this app's bucket and after
 -- 24 hours, so a currently uploading object is never swept.
 insert into image_cleanup_queue(path,user_id)
 select distinct regexp_replace(o.name,'\.thumb\.jpg$',''),split_part(o.name,'/',1)::uuid
 from storage.objects o where o.bucket_id='recipe-images'
 and o.created_at<now()-interval '24 hours'
 and split_part(o.name,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 and not exists(select 1 from recipes r where o.name=r.image_path or o.name=r.image_path||'.thumb.jpg')
 limit batch_size on conflict(path) do nothing;
 -- Never remove current-month quota records or lifetime image attempts for retained recipes.
 delete from ai_jobs j where j.created_at<now()-interval '90 days'
 and (j.kind<>'image' or (j.subject_id is null or not exists(select 1 from recipes r where r.id=j.subject_id)));
 delete from ai_usage where created_at<now()-interval '90 days';
 return jsonb_build_object('recipes',removed,'sessions',removed_sessions);
end $$;
revoke all on function public.prune_app_data(integer,integer) from public,authenticated;
grant execute on function public.prune_app_data(integer,integer) to service_role;
