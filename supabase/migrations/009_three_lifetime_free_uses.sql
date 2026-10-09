-- Replace timed trial with three lifetime uses per authenticated account.
-- Existing operations remain counted; changing dates or reinstalling cannot reset usage.
drop function public.reserve_free_ai_job(uuid,uuid,text,text,numeric,integer,numeric,integer,integer,uuid,uuid);
drop function public.free_trial_status(uuid,integer,integer);
create function public.reserve_free_ai_job(
 owner_id uuid,job_id uuid,job_kind text,fingerprint text,cost_usd numeric,
 minute_limit integer,daily_budget numeric,total_operations integer,
 included_operation_id uuid default null,recipe_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare existing ai_jobs; started timestamptz; day_index integer; op ai_free_operations;
 operation_id uuid; root_operation boolean:=false; day_start timestamptz;
begin
 perform pg_advisory_xact_lock(731280492);
 if cost_usd<=0 or minute_limit<1 or daily_budget<=0 or total_operations<1 then
   raise exception 'Invalid cost configuration';
 end if;
 select * into existing from ai_jobs where user_id=owner_id and id=job_id;
 if found then
   if existing.kind<>job_kind or existing.payload_hash<>fingerprint then
     return jsonb_build_object('state','conflict');
   end if;
   if existing.status='running' and existing.expires_at<now() then
     update ai_jobs set status='failed' where user_id=owner_id and id=job_id;
     return jsonb_build_object('state','failed');
   end if;
   return jsonb_build_object('state',existing.status,'result',existing.result,
                            'free_operation_id',existing.free_operation_id);
 end if;
 if job_kind='recognize' then
   operation_id:=job_id; root_operation:=true;
 elsif job_kind='generate' then
   if included_operation_id is not null then
     select * into op from ai_free_operations where user_id=owner_id and id=included_operation_id;
     if not found then return jsonb_build_object('state','operation_required'); end if;
     if op.generation_job_id is not null then return jsonb_build_object('state','operation_used'); end if;
     if not exists(select 1 from ai_jobs where user_id=owner_id and id=op.recognition_job_id and status='complete') then
       return jsonb_build_object('state','operation_required');
     end if;
     operation_id:=included_operation_id;
   else operation_id:=job_id; root_operation:=true;
   end if;
 elsif job_kind='image' then
   -- Derive the included operation from the OWNED persisted recipe, never a client token.
   select s.free_operation_id into operation_id from recipes r join recipe_sessions s on s.id=r.session_id
     where r.id=recipe_id and r.user_id=owner_id and s.user_id=owner_id;
   if operation_id is null then return jsonb_build_object('state','operation_required'); end if;
   if not exists(select 1 from ai_free_operations o join ai_jobs j
     on j.user_id=o.user_id and j.id=o.generation_job_id
     where o.user_id=owner_id and o.id=operation_id and j.status='complete'
     and j.result->'recipes' @> jsonb_build_array(jsonb_build_object('id',recipe_id::text))) then
     return jsonb_build_object('state','operation_required');
   end if;
   if (select count(*) from ai_jobs where user_id=owner_id and kind='image' and subject_id=recipe_id)>=3 then
     return jsonb_build_object('state','image_limit');
   end if;
 else raise exception 'Unknown AI operation';
 end if;
 select started_at into started from ai_free_trials where user_id=owner_id;
 day_index:=0; -- Legacy column retained; usage no longer has trial days.
 if root_operation and (select count(*) from ai_free_operations where user_id=owner_id)>=total_operations then
   return jsonb_build_object('state','free_limit');
 end if;
 if (select count(*) from ai_jobs where user_id=owner_id and kind=job_kind and created_at>now()-interval '1 minute')>=minute_limit then
   return jsonb_build_object('state','rate_limit');
 end if;
 if (select count(*) from ai_jobs where user_id=owner_id and kind=job_kind and status='running' and expires_at>now()) >=
   (case when job_kind='image' then 2 else 1 end) then return jsonb_build_object('state','busy'); end if;
 day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if (select coalesce(sum(reserved_usd),0) from ai_jobs where created_at>=day_start)+cost_usd>daily_budget then
   return jsonb_build_object('state','daily_limit');
 end if;
 -- Start/debit only after all checks pass. Failed paid work retains this internal use.
 if started is null then insert into ai_free_trials(user_id) values(owner_id); end if;
 if root_operation then
   insert into ai_free_operations(user_id,id,trial_day,recognition_job_id,generation_job_id)
   values(owner_id,operation_id,day_index,case when job_kind='recognize' then job_id end,
          case when job_kind='generate' then job_id end);
 elsif job_kind='generate' then
   update ai_free_operations set generation_job_id=job_id where user_id=owner_id and id=operation_id;
 end if;
 insert into ai_jobs(user_id,id,kind,payload_hash,reserved_usd,free_operation_id,subject_id)
 values(owner_id,job_id,job_kind,fingerprint,cost_usd,operation_id,recipe_id);
 return jsonb_build_object('state','reserved','free_operation_id',operation_id);
end $$;
revoke all on function public.reserve_free_ai_job(uuid,uuid,text,text,numeric,integer,numeric,integer,uuid,uuid) from public,authenticated;
grant execute on function public.reserve_free_ai_job(uuid,uuid,text,text,numeric,integer,numeric,integer,uuid,uuid) to service_role;

create function public.free_trial_status(owner_id uuid,total_operations integer)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare used integer;
begin
 select count(*) into used from ai_free_operations where user_id=owner_id;
 return jsonb_build_object('total_uses',total_operations,'remaining_uses',greatest(0,total_operations-used),
                          'exhausted',used>=total_operations);
end $$;
revoke all on function public.free_trial_status(uuid,integer) from public,authenticated;
grant execute on function public.free_trial_status(uuid,integer) to service_role;

-- Unlimited time must also survive scheduled metadata housekeeping.
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
