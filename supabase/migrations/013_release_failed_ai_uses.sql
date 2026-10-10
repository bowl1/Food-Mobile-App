-- Release user quota on failed recognition/generation; retain provider cost and retry limits.
alter table public.ai_free_operations add column use_released boolean not null default false;
create function public.release_failed_ai_use() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if (new.status='failed' and new.kind in ('recognize','generate'))
 or (new.status='complete' and new.kind='generate' and new.result->'recipes'='[]'::jsonb) then
  update ai_free_operations set use_released=true
   where user_id=new.user_id and id=new.free_operation_id;
 end if;
 return new;
end $$;
revoke all on function public.release_failed_ai_use() from public,authenticated;
create trigger release_failed_ai_use after update of status on public.ai_jobs
for each row execute function public.release_failed_ai_use();
-- Apply the new policy to existing failed operations, without deleting audit records.
update ai_free_operations o set use_released=true where exists(
 select 1 from ai_jobs j where j.user_id=o.user_id and j.free_operation_id=o.id
 and ((j.kind in ('recognize','generate') and j.status='failed')
 or (j.kind='generate' and j.status='complete' and j.result->'recipes'='[]'::jsonb)));

create or replace function public.reserve_free_ai_job(
 owner_id uuid,job_id uuid,job_kind text,fingerprint text,cost_usd numeric,
 minute_limit integer,daily_budget numeric,total_operations integer,
 included_operation_id uuid default null,recipe_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare existing ai_jobs; started timestamptz; day_index integer; op ai_free_operations;
 funding ai_subscription_periods; free_used integer; unlimited_generation boolean; operation_id uuid; root_operation boolean:=false; day_start timestamptz;
begin
 perform pg_advisory_xact_lock(731280492);
 update ai_jobs set status='failed' where user_id=owner_id and status='running' and expires_at<now();
 select exists(select 1 from ai_account_roles where user_id=owner_id and role='unlimited_recipe_generation') into unlimited_generation;
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
     if not found or op.use_released then return jsonb_build_object('state','operation_required'); end if;
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
 if root_operation and not (unlimited_generation and job_kind='generate') then
   select count(*) into free_used from ai_free_operations where user_id=owner_id
     and not use_released and subscription_period_id is null and (not unlimited_generation or recognition_job_id is not null);
   if free_used>=total_operations then
     select * into funding from ai_subscription_periods where user_id=owner_id and active
       and starts_at<=now() and ends_at>now() order by starts_at desc limit 1;
     if not found or (select count(*) from ai_free_operations where subscription_period_id=funding.id and not use_released)>=funding.allowance then
       return jsonb_build_object('state','free_limit');
     end if;
   end if;
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
 -- Start/debit only after all checks pass. Failure trigger releases user quota.
 if started is null then insert into ai_free_trials(user_id) values(owner_id); end if;
 if root_operation then
   insert into ai_free_operations(user_id,id,trial_day,recognition_job_id,generation_job_id,subscription_period_id)
   values(owner_id,operation_id,day_index,case when job_kind='recognize' then job_id end,
          case when job_kind='generate' then job_id end,funding.id);
 elsif job_kind='generate' then
   update ai_free_operations set generation_job_id=job_id where user_id=owner_id and id=operation_id;
 end if;
 insert into ai_jobs(user_id,id,kind,payload_hash,reserved_usd,free_operation_id,subject_id)
 values(owner_id,job_id,job_kind,fingerprint,cost_usd,operation_id,recipe_id);
 return jsonb_build_object('state','reserved','free_operation_id',operation_id);
end $$;
revoke all on function public.reserve_free_ai_job(uuid,uuid,text,text,numeric,integer,numeric,integer,uuid,uuid) from public,authenticated;
grant execute on function public.reserve_free_ai_job(uuid,uuid,text,text,numeric,integer,numeric,integer,uuid,uuid) to service_role;

create or replace function public.free_trial_status(owner_id uuid,total_operations integer)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare used integer; paid_used integer:=0; unlimited_generation boolean; funding ai_subscription_periods;
begin
 update ai_jobs set status='failed' where user_id=owner_id and status='running' and expires_at<now();
 select exists(select 1 from ai_account_roles where user_id=owner_id and role='unlimited_recipe_generation') into unlimited_generation;
 select count(*) into used from ai_free_operations where user_id=owner_id and not use_released and subscription_period_id is null
   and (not unlimited_generation or recognition_job_id is not null);
 select * into funding from ai_subscription_periods where user_id=owner_id and active
   and starts_at<=now() and ends_at>now() order by starts_at desc limit 1;
 if found then select count(*) into paid_used from ai_free_operations where subscription_period_id=funding.id and not use_released; end if;
 return jsonb_build_object('total_uses',total_operations,'remaining_uses',greatest(0,total_operations-used),
   'exhausted',used>=total_operations and (funding.id is null or paid_used>=funding.allowance),
   'unlimited_generation',unlimited_generation,'subscribed',funding.id is not null,
   'monthly_uses',coalesce(funding.allowance,20),'monthly_remaining',greatest(0,coalesce(funding.allowance,0)-paid_used),
   'period_ends_at',funding.ends_at);
end $$;
revoke all on function public.free_trial_status(uuid,integer) from public,authenticated;
grant execute on function public.free_trial_status(uuid,integer) to service_role;
