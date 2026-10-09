-- Prevent direct client uploads from bypassing app budgets and filling Storage.
drop policy if exists own_recipe_images on storage.objects;
create policy own_recipe_images on storage.objects for select to authenticated
using(bucket_id='recipe-images' and (storage.foldername(name))[1]=auth.uid()::text);
create policy own_recipe_images_delete on storage.objects for delete to authenticated
using(bucket_id='recipe-images' and (storage.foldername(name))[1]=auth.uid()::text);
-- INSERT/UPDATE have no authenticated policy. The backend alone uploads paid output.

create or replace function public.prune_app_data(retention_days integer, batch_size integer default 100)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare removed integer:=0; removed_sessions integer:=0;
begin
 if retention_days<0 or batch_size<1 or batch_size>500 then raise exception 'Invalid retention configuration'; end if;
 perform pg_advisory_xact_lock(731280493);
 if retention_days>0 then
   -- Keep at least the latest ten for every user, even if all are older than TTL.
   with old_rows as (
     select r.id from recipes r where r.created_at<now()-make_interval(days=>retention_days)
     and not (r.image_status='generating' and r.image_started_at>now()-interval '4 minutes')
     and not exists(select 1 from ai_jobs j where j.subject_id=r.id and j.kind='image'
                    and j.status='running' and j.expires_at>now())
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
