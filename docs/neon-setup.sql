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
  role text not null default 'user',
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

create table if not exists ai_usage_monthly (
  user_id text not null references profiles(user_id) on delete cascade,
  period text not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(user_id, period)
);

create index if not exists ai_usage_monthly_period_idx
  on ai_usage_monthly (period);

create table if not exists user_entitlements (
  user_id text primary key references profiles(user_id) on delete cascade,
  plan text not null default 'beta',
  subscription_status text not null default 'beta',
  ai_monthly_limit integer,
  ai_daily_limit integer,
  import_daily_limit integer,
  adjust_daily_limit integer,
  pantry_daily_limit integer,
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz not null default now(),
  updated_by text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id text references profiles(user_id) on delete set null,
  provider text not null,
  event_type text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);

create index if not exists subscription_events_user_idx
  on subscription_events (user_id, processed_at desc);

create table if not exists rate_limit_counters (
  key text not null,
  bucket text not null,
  count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key(key, bucket)
);

create index if not exists rate_limit_counters_reset_idx
  on rate_limit_counters (reset_at);

create table if not exists ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  user_id text references profiles(user_id) on delete set null,
  feature text not null,
  model text not null,
  tier text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_user_created_idx
  on ai_usage_events (user_id, created_at desc);

create index if not exists ai_usage_events_created_idx
  on ai_usage_events (created_at desc);

create table if not exists app_control_sources (
  id text primary key,
  title text not null,
  category text not null,
  content text not null,
  use_when text not null,
  scope_type text not null,
  scope_value text not null default '',
  applies_to_features jsonb not null default '[]'::jsonb,
  priority integer not null default 50,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  version integer not null default 1,
  last_synced_at timestamptz,
  source_origin text not null default 'RecipeBox'
);

create index if not exists app_control_sources_active_idx
  on app_control_sources (active, category);

create table if not exists app_control_change_log (
  id uuid primary key default gen_random_uuid(),
  source_id text,
  action text not null,
  changed_by text,
  changed_at timestamptz not null default now(),
  previous_value jsonb,
  next_value jsonb,
  note text
);

create index if not exists app_control_change_log_source_idx
  on app_control_change_log (source_id, changed_at desc);
