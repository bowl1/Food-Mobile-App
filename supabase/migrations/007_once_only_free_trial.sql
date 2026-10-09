-- One lifetime trial per account. Credits are shared by recognition, generation
-- and recipe images; client requests cannot manufacture extra included uses.
create table public.ai_free_trials (
 user_id uuid primary key references auth.users(id) on delete cascade,
 started_at timestamptz not null default now()
);
create table public.ai_free_operations (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 trial_day integer not null check(trial_day>=0),
 recognition_job_id uuid,
 generation_job_id uuid,
 created_at timestamptz not null default now(),
 primary key(user_id,id),
 unique(user_id,recognition_job_id),
 unique(user_id,generation_job_id)
);
alter table public.ai_free_trials enable row level security;
alter table public.ai_free_operations enable row level security;
revoke all on public.ai_free_trials,public.ai_free_operations from public,authenticated;
grant select,insert,update,delete on public.ai_free_trials,public.ai_free_operations to service_role;
create index ai_free_operations_day on public.ai_free_operations(user_id,trial_day);
alter table public.ai_jobs add column if not exists subject_id uuid;
alter table public.ai_jobs add column free_operation_id uuid;
alter table public.recipe_sessions add column free_operation_id uuid;
-- Old monthly quota routine is no longer used or available.
drop function public.reserve_ai_job(uuid,uuid,text,text,numeric,integer,integer,numeric);

create function public.reserve_free_ai_job(
 owner_id uuid,job_id uuid,job_kind text,fingerprint text,cost_usd numeric,
 minute_limit integer,daily_budget numeric,trial_days integer,daily_operations integer,
 included_operation_id uuid default null,recipe_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare existing ai_jobs; started timestamptz; day_index integer; op ai_free_operations;
 operation_id uuid; root_operation boolean:=false; day_start timestamptz;
begin
 perform pg_advisory_xact_lock(731280492);
 if cost_usd<=0 or minute_limit<1 or daily_budget<=0 or trial_days<1 or daily_operations<1 then
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
 if started is not null and now()>=started+make_interval(days=>trial_days) then
   return jsonb_build_object('state','trial_expired');
 end if;
 day_index:=case when started is null then 0 else floor(extract(epoch from (now()-started))/86400)::integer end;
 if root_operation and (select count(*) from ai_free_operations where user_id=owner_id and trial_day=day_index)>=daily_operations then
   return jsonb_build_object('state','free_daily_limit');
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
revoke all on function public.reserve_free_ai_job(uuid,uuid,text,text,numeric,integer,numeric,integer,integer,uuid,uuid) from public,authenticated;
grant execute on function public.reserve_free_ai_job(uuid,uuid,text,text,numeric,integer,numeric,integer,integer,uuid,uuid) to service_role;

create function public.free_trial_status(owner_id uuid,trial_days integer,daily_operations integer)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare started timestamptz; expired boolean; day_index integer; used integer;
begin
 select started_at into started from ai_free_trials where user_id=owner_id;
 expired:=started is not null and now()>=started+make_interval(days=>trial_days);
 day_index:=case when started is null then 0 else floor(extract(epoch from(now()-started))/86400)::integer end;
 select count(*) into used from ai_free_operations where user_id=owner_id and trial_day=day_index;
 return jsonb_build_object('started_at',started,'expires_at',started+make_interval(days=>trial_days),
   'trial_days',trial_days,'remaining_today',case when expired then 0 else greatest(0,daily_operations-used) end,
   'expired',expired,'next_reset_at',case when expired or started is null then null else started+make_interval(days=>day_index+1) end);
end $$;
revoke all on function public.free_trial_status(uuid,integer,integer) from public,authenticated;
grant execute on function public.free_trial_status(uuid,integer,integer) to service_role;
