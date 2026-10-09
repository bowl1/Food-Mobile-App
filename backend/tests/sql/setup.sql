-- Run only against an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
do $$ begin if not exists (
        select 1
        from pg_roles
        where rolname = 'authenticated'
    ) then create role authenticated;
end if;
end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
select nullif(
        current_setting('request.jwt.claim.sub', true),
        ''
    )::uuid $$;
grant usage on schema auth to authenticated;
create schema storage;
create table storage.buckets (
    id text primary key,
    name text,
    public boolean,
    file_size_limit bigint,
    allowed_mime_types text []
);
create table storage.objects (
    id uuid default gen_random_uuid(),
    bucket_id text,
    name text,
    created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text [] language sql immutable as $$
select string_to_array($1, '/') $$;
grant usage on schema storage to authenticated;
grant all on storage.objects to authenticated;
\ir ../../../supabase/migrations/001_fridgechef.sql
\ir ../../../supabase/migrations/002_recipe_images.sql
\if :{?legacy_only}
\else
\ir ../../../supabase/migrations/003_ai_cost_controls.sql
\ir ../../../supabase/migrations/004_image_recovery.sql
\ir ../../../supabase/migrations/005_storage_cleanup.sql
\ir ../../../supabase/migrations/006_trusted_image_uploads.sql
\ir ../../../supabase/migrations/007_once_only_free_trial.sql
\ir ../../../supabase/migrations/008_permanent_recent_history.sql
\ir ../../../supabase/migrations/009_three_lifetime_free_uses.sql
\ir ../../../supabase/migrations/010_explicit_favorite_recipes.sql
\endif
insert into auth.users
values ('00000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000002');
insert into public.recipe_sessions (id, user_id, agent_run_id, attempts, status)
values (
        '10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        gen_random_uuid(),
        1,
        'complete'
    );
\if :{?legacy_only}
\set recipe_table public.recipes
\else
\set recipe_table public.recipe_drafts
\endif
insert into :recipe_table (
        id,
        user_id,
        session_id,
        recipe_name,
        ingredients,
        steps,
        cooking_time_minutes,
        reason,
        evaluation,
        evaluation_score
    )
values (
        '20000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        'Eggs',
        '[]',
        '[]',
        10,
        'test',
        '{}',
.9
    );
