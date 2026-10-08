-- Run once in Supabase SQL editor, or apply with `supabase db push`.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  vegetarian boolean not null default false,
  vegan boolean not null default false,
  keto boolean not null default false,
  gluten_free boolean not null default false,
  dairy_free boolean not null default false,
  high_protein boolean not null default false,
  max_cooking_time integer not null default 30 check (max_cooking_time between 5 and 180)
);
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  food_name text not null check (length(trim(food_name)) between 1 and 80),
  quantity numeric not null check (quantity > 0 and quantity <= 100000),
  unit text not null,
  source text not null default 'manual' check (source in ('manual', 'image_recognition')),
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.recipe_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_run_id uuid not null,
  attempts integer not null check (attempts between 0 and 3),
  status text not null check (status in ('complete', 'no_match')),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  recipe_name text not null,
  ingredients jsonb not null,
  pantry_staples jsonb not null default '[]',
  steps jsonb not null,
  cooking_time_minutes integer not null check (cooking_time_minutes > 0),
  dietary_tags jsonb not null default '[]',
  reason text not null,
  evaluation jsonb not null,
  evaluation_score numeric not null check (evaluation_score between 0 and 1),
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.recipe_sessions(id, user_id) on delete cascade
);
alter table public.profiles enable row level security;
create policy own_profile on public.profiles for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- No service-role key is used by this application. All requests use the user's JWT.
do $$
declare t text;
begin
  foreach t in array array['user_preferences', 'inventory_items', 'recipe_sessions', 'recipes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create index on public.%I (user_id)', t);
  end loop;
end $$;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.user_preferences, public.inventory_items, public.recipe_sessions, public.recipes to authenticated;
