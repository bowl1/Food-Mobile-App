-- Run in Supabase SQL Editor as project administrator. Read-only, last 30 UTC days.
select (created_at at time zone 'UTC')::date as utc_day,
       model, modality, count(*) as usage_events,
       sum(coalesce((usage->>'input_tokens')::bigint,
                    (usage->>'prompt_tokens')::bigint, 0)) as input_tokens,
       sum(coalesce((usage->>'output_tokens')::bigint,
                    (usage->>'completion_tokens')::bigint, 0)) as output_tokens,
       sum(coalesce(estimated_usd, 0)) as estimated_usd
from public.ai_usage
where created_at >= now() - interval '30 days'
group by 1, 2, 3
order by 1 desc, 2, 3;
