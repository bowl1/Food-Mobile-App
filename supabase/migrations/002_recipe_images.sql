-- Apply after 001_fridgechef.sql. Existing recipes remain opt-in (none).
alter table public.recipes
add column if not exists image_status text not null default 'none' check (
    image_status in (
      'none',
      'pending',
      'generating',
      'ready',
      'failed'
    )
  ),
  add column if not exists image_path text,
  add column if not exists image_started_at timestamptz;
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  )
values (
    'recipe-images',
    'recipe-images',
    false,
    5242880,
    array ['image/jpeg']
  ) on conflict (id) do nothing;
drop policy if exists own_recipe_images on storage.objects;
create policy own_recipe_images on storage.objects for all to authenticated using (
  bucket_id = 'recipe-images'
  and (storage.foldername(name)) [1] = (
    select auth.uid()
  )::text
) with check (
  bucket_id = 'recipe-images'
  and (storage.foldername(name)) [1] = (
    select auth.uid()
  )::text
);
-- Atomic lease prevents duplicate paid generation across requests/instances.
-- Invoker privileges preserve recipes RLS. Stale jobs can be retried after 4 min.
create or replace function public.claim_recipe_image(
    recipe_id uuid,
    lease_id uuid,
    retry_failed boolean default false
  ) returns setof public.recipes language sql security invoker
set search_path = public as $$
update public.recipes
set image_status = 'generating',
  image_started_at = now(),
  image_path = auth.uid()::text || '/' || recipe_id::text || '/' || lease_id::text || '.jpg'
where id = recipe_id
  and user_id = auth.uid()
  and (
    image_status in ('none', 'pending')
    or (
      image_status = 'failed'
      and retry_failed
    )
    or (
      image_status = 'generating'
      and image_started_at < now() - interval '4 minutes'
    )
  )
returning *;
$$;
revoke all on function public.claim_recipe_image(uuid, uuid, boolean)
from public;
grant execute on function public.claim_recipe_image(uuid, uuid, boolean) to authenticated;
