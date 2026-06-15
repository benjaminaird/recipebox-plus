-- RecipeBox+ Supabase setup
-- Run this first to support the current shared RecipeBox+ storage model.
-- The app uses DATABASE_URL server-side, so this table is not exposed to browsers.

create extension if not exists pgcrypto;

create table if not exists public.recipebox_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.recipebox_store enable row level security;

-- Future account-ready schema draft.
-- Do not switch the app to these tables until the sign-up/login UI is added.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text,
  hero_image_url text,
  recipe_json jsonb not null,
  favorite boolean not null default false,
  rating integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.meal_plans enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "Users can view their own profile." on public.profiles;
create policy "Users can view their own profile."
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile." on public.profiles;
create policy "Users can update their own profile."
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can view their own recipes." on public.recipes;
create policy "Users can view their own recipes."
  on public.recipes for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own recipes." on public.recipes;
create policy "Users can create their own recipes."
  on public.recipes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own recipes." on public.recipes;
create policy "Users can update their own recipes."
  on public.recipes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own recipes." on public.recipes;
create policy "Users can delete their own recipes."
  on public.recipes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own meal plans." on public.meal_plans;
create policy "Users can view their own meal plans."
  on public.meal_plans for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can write their own meal plans." on public.meal_plans;
create policy "Users can write their own meal plans."
  on public.meal_plans for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own settings." on public.user_settings;
create policy "Users can view their own settings."
  on public.user_settings for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can write their own settings." on public.user_settings;
create policy "Users can write their own settings."
  on public.user_settings for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
