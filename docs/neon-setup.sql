-- RecipeBox Neon setup
-- The current app only needs recipebox_store. The Express server will also
-- create this table automatically on first boot when DATABASE_URL is set.

create extension if not exists pgcrypto;

create table if not exists recipebox_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Future account-ready schema draft.
-- These tables are intentionally auth-provider-neutral. Wire user_id to Neon
-- Auth, Clerk, Auth.js, or another identity provider in the auth iteration.

create table if not exists profiles (
  user_id text primary key,
  email text,
  display_name text,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_idx
  on profiles (email);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null,
  category text,
  hero_image_url text,
  recipe_json jsonb not null,
  favorite boolean not null default false,
  rating integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_user_id_created_at_idx
  on recipes (user_id, created_at desc);

create table if not exists meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  plan_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meal_plans_user_id_updated_at_idx
  on meal_plans (user_id, updated_at desc);

create table if not exists user_settings (
  user_id text primary key,
  settings_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists account_sessions (
  token_hash text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists account_sessions_user_id_idx
  on account_sessions (user_id);

create table if not exists password_reset_tokens (
  token_hash text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx
  on password_reset_tokens (user_id);
