-- Trusted backend-only accounting. Clients cannot grant themselves quota or edit jobs.
create table public.ai_jobs (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('generate','recognize','image')),
  payload_hash text not null,
  status text not null default 'running' check (status in ('running','complete','failed')),
  reserved_usd numeric not null check (reserved_usd > 0),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 minutes',
  primary key (user_id,id)
);
alter table public.ai_jobs enable row level security;
create index ai_jobs_user_kind_time on public.ai_jobs(user_id,kind,created_at desc);
create index ai_jobs_time on public.ai_jobs(created_at);
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  model text not null,
  modality text not null,
  usage jsonb not null,
  estimated_usd numeric,
  created_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
create index ai_usage_user_time on public.ai_usage(user_id,created_at desc);
revoke all on public.ai_jobs, public.ai_usage from public, authenticated;
grant select, insert, update, delete on public.ai_jobs, public.ai_usage to service_role;

create function public.reserve_ai_job(
  owner_id uuid, job_id uuid, job_kind text, fingerprint text,
  cost_usd numeric, monthly_limit integer, minute_limit integer, daily_budget numeric
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare existing ai_jobs; month_start timestamptz; day_start timestamptz;
begin
  -- Serializes reservation checks across ALL instances; cheap, brief DB transaction.
  perform pg_advisory_xact_lock(731280492);
  if cost_usd <= 0 or monthly_limit < 1 or minute_limit < 1 or daily_budget <= 0 then
    raise exception 'Invalid cost limits';
  end if;
  select * into existing from ai_jobs where user_id=owner_id and id=job_id;
  if found then
    if existing.kind <> job_kind or existing.payload_hash <> fingerprint then
      return jsonb_build_object('state','conflict');
    end if;
    if existing.status='running' and existing.expires_at < now() then
      update ai_jobs set status='failed' where user_id=owner_id and id=job_id;
      return jsonb_build_object('state','failed');
    end if;
    return jsonb_build_object('state',existing.status,'result',existing.result);
  end if;
  month_start := date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  day_start := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from ai_jobs where user_id=owner_id and kind=job_kind and created_at >= month_start) >= monthly_limit then
    return jsonb_build_object('state','monthly_limit');
  end if;
  if (select count(*) from ai_jobs where user_id=owner_id and kind=job_kind and created_at > now()-interval '1 minute') >= minute_limit then
    return jsonb_build_object('state','rate_limit');
  end if;
  if (select count(*) from ai_jobs where user_id=owner_id and kind=job_kind and status='running' and expires_at>now()) >= (case when job_kind='image' then 2 else 1 end) then
    return jsonb_build_object('state','busy');
  end if;
  if (select coalesce(sum(reserved_usd),0) from ai_jobs where created_at>=day_start) + cost_usd > daily_budget then
    return jsonb_build_object('state','daily_limit');
  end if;
  insert into ai_jobs(user_id,id,kind,payload_hash,reserved_usd)
    values(owner_id,job_id,job_kind,fingerprint,cost_usd);
  return jsonb_build_object('state','reserved');
end $$;
revoke all on function public.reserve_ai_job(uuid,uuid,text,text,numeric,integer,integer,numeric) from public, authenticated;
grant execute on function public.reserve_ai_job(uuid,uuid,text,text,numeric,integer,integer,numeric) to service_role;
