alter table public.recipes add column image_lease_id uuid;
-- Keep a stable path across retries so uploaded output can be recovered, rather
-- than generating again when an upload acknowledgement or DB update was lost.
create or replace function public.claim_recipe_image(recipe_id uuid,lease_id uuid,retry_failed boolean default false)
returns setof public.recipes language sql security invoker set search_path=public as $$
 update public.recipes set image_status='generating',image_started_at=now(),image_lease_id=lease_id,
 image_path=coalesce(image_path,auth.uid()::text||'/'||recipe_id::text||'/image.jpg')
 where id=recipe_id and user_id=auth.uid() and (
 image_status in ('none','pending') or (image_status='failed' and retry_failed)
 or (image_status='generating' and image_started_at<now()-interval '4 minutes'))
 returning *;
$$;
revoke all on function public.claim_recipe_image(uuid,uuid,boolean) from public;
grant execute on function public.claim_recipe_image(uuid,uuid,boolean) to authenticated;

-- Bound lifetime paid image attempts per recipe as well as monthly totals.
create or replace function public.reserve_ai_job(
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
  if job_kind='image' and (select count(*) from ai_jobs where user_id=owner_id and kind='image' and payload_hash=fingerprint) >= 3 then
    return jsonb_build_object('state','image_limit');
  end if;
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
