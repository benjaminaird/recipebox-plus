const express = require('express');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;
const { fetchTranscript } = require('youtube-transcript');
// Deterministic structured-data extractor (shared with the client). Lets URL
// imports skip the AI entirely when a page has complete schema.org data.
const RecipeBoxExtract = require('./public/recipe-extract');
// Shared shopping-list/pantry sanitizers (reused server-side for household data).
const RecipeBoxShopping = require('./public/shopping-list');

const app = express();
app.disable('x-powered-by');
app.use(function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});
app.use(function(req, res, next) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// Per-route body limits: only the routes that legitimately carry images get a
// large limit; everything else (auth, feedback, admin, etc.) is capped small so
// a single request can't push tens of MB at any endpoint.
app.use(['/api/ai'], express.json({ limit: '16mb' }));           // photo/PDF imports (base64 images)
app.use(['/api/recipes', '/api/auth/signup', '/api/auth/migrate'], express.json({ limit: '40mb' })); // full library w/ hero + original-source images
app.use(express.json({ limit: '1mb' }));                          // default for all other JSON endpoints
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_COOKIE = 'rb_session';
const SESSION_DAYS = 3650;
const PASSWORD_MIN_LENGTH = 6;
const AUTH_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LIMIT_MAX = 20;
const RESET_TOKEN_MINUTES = 60;
const VERIFY_TOKEN_MINUTES = 60 * 24; // email verification links last 24h
const AI_MONTHLY_LIMIT = Number(process.env.AI_MONTHLY_LIMIT || 50);
const authAttempts = new Map();

const ADMIN_KB_CATEGORIES = [
  'Methodology',
  'AI Instruction',
  'Import Rule',
  'Recipe Normalization',
  'Meal Planning',
  'Pantry Logic',
  'Image Handling',
  'User Experience',
  'Safety / Guardrail',
  'Legal / Copyright',
  'Product Strategy',
  'WhatsNext Sync',
];
const ADMIN_FEATURES = [
  'Import',
  'Manual Recipe Entry',
  'AI Adjust',
  'AI Chat Editor',
  'Pantry Chef',
  'Meal Planner',
  'Shopping List',
  'Cook Mode',
  'PDF Export',
  'Recipe Detail',
  'Library',
  'Settings',
];
const ADMIN_SCOPE_TYPES = ['Global', 'Feature', 'Account', 'Recipe Category'];
const ADMIN_SECTION_NAMES = [
  'Knowledge Base',
  'AI Prompt Control',
  'Import Rules',
  'Recipe Rules',
  'Meal Planner Rules',
  'Pantry Chef Rules',
  'Image & Hero Photo Rules',
  'Feature Flags',
  'User Limits & Entitlements',
  'Integrations',
  'WhatsNext Sync',
  'Change Log / Rollback',
];
const DEFAULT_PLAN = process.env.DEFAULT_ACCOUNT_PLAN || 'beta';
// 'beta' = pre-launch (beta tier has unlimited AI). 'launched' = enforce tier caps.
const LAUNCH_PHASE = (process.env.LAUNCH_PHASE || 'beta').toLowerCase();
const BETA_UNLIMITED = LAUNCH_PHASE === 'beta';
// Monthly included AI Assists per tier are the source of truth here, server-side.
// Cost per action varies (see AI_ACTION_COSTS). Beta is unlimited only while
// LAUNCH_PHASE === 'beta'. aiMonthlyLimit is the recurring monthly assist
// allowance; Free's one-time welcome grant (FREE_WELCOME_ASSISTS) is separate.
const PLAN_ENTITLEMENTS = {
  free:    { aiMonthlyLimit: 5,   aiDailyLimit: 10,  importDailyLimit: 8,    adjustDailyLimit: 8,   pantryDailyLimit: 10 },
  plus:    { aiMonthlyLimit: 250, aiDailyLimit: 80,  importDailyLimit: 80,   adjustDailyLimit: 80,  pantryDailyLimit: 100 },
  family:  { aiMonthlyLimit: 600, aiDailyLimit: 150, importDailyLimit: 150,  adjustDailyLimit: 150, pantryDailyLimit: 200 },
  founder: { aiMonthlyLimit: 300, aiDailyLimit: 100, importDailyLimit: 100,  adjustDailyLimit: 100, pantryDailyLimit: 120 },
  founder_family: { aiMonthlyLimit: 700, aiDailyLimit: 150, importDailyLimit: 150, adjustDailyLimit: 150, pantryDailyLimit: 200 },
  beta:    { aiMonthlyLimit: BETA_UNLIMITED ? null : 50, aiDailyLimit: 60, importDailyLimit: 35, adjustDailyLimit: 40, pantryDailyLimit: 50, unlimited: BETA_UNLIMITED },
  master_admin: { aiMonthlyLimit: null, aiDailyLimit: null, importDailyLimit: null, adjustDailyLimit: null, pantryDailyLimit: null, unlimited: true },
};
// One-time welcome AI Assists granted to a new Free account on signup (bonus
// bucket, never expires). After this is used, Free recurs at 5 assists/month.
const FREE_WELCOME_ASSISTS = Number(process.env.FREE_WELCOME_ASSISTS || 15);
// Referral bonus foundation. Triggered (later) only on a referred user's paid
// conversion; both sides get bonusAssists, capped per referrer per month.
const REFERRAL_CONFIG = { bonusAssists: 25, monthlyCap: 10, triggersOn: 'paid_conversion' };
// Family household sharing. Foundation (M1): membership, roles, invites. Shared
// library/plan and the shared AI Assist pool follow in M2.
const FAMILY_MEMBER_CAP = 4;
const HOUSEHOLD_ROLES = ['owner', 'adult', 'member'];
const INVITE_TTL_DAYS = 7;
// Unambiguous alphabet (no O/0/I/1/L) for human-shareable invite codes.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function normalizeHouseholdRole(role) {
  const r = String(role || '').toLowerCase();
  return HOUSEHOLD_ROLES.includes(r) ? r : 'member';
}
function generateInviteCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}
// Cap enforcement (pure): can another member still be added?
function canAddHouseholdMember(currentCount, cap = FAMILY_MEMBER_CAP) {
  return Number(currentCount || 0) < Number(cap || FAMILY_MEMBER_CAP);
}
// Owner and adults can invite/manage members; only the owner can rename/remove/disband.
function canInviteToHousehold(role) { const r = normalizeHouseholdRole(role); return r === 'owner' || r === 'adult'; }
function isHouseholdOwner(role) { return normalizeHouseholdRole(role) === 'owner'; }
// Invite usability (pure): unused and not expired.
function inviteIsUsable(invite, now = Date.now()) {
  if (!invite || invite.accepted_by || invite.accepted_at) return false;
  const exp = new Date(invite.expires_at).getTime();
  return Number.isFinite(exp) && exp > now;
}
// Sanitize a household meal plan to { day: [recipeId,...] }, keeping only recipe
// ids the writer is allowed to plan (their own + recipes shared to the household)
// so a member can't slip another member's private recipe into the shared plan.
// Pure/testable. allowedIds is a Set (or array) of permitted recipe ids.
function sanitizeMealPlan(plan, allowedIds) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return {};
  const allowed = allowedIds instanceof Set ? allowedIds : new Set(allowedIds || []);
  const out = {};
  for (const [day, ids] of Object.entries(plan)) {
    if (typeof day !== 'string' || !Array.isArray(ids)) continue;
    const kept = ids.filter((id) => typeof id === 'string' && allowed.has(id)).slice(0, 50);
    if (kept.length) out[String(day).slice(0, 40)] = kept;
  }
  return out;
}
// Burst protection: even a high-balance user can't script the AI endpoints.
const AI_BURST_MAX = Number(process.env.AI_BURST_MAX || 20);        // actions / 10 min
const AI_BURST_SCOPE = 'tenminutes';
// Single source of truth for tiers/pricing/packs/flags. Safe to expose a
// read-only copy to clients for display; it is NEVER trusted for enforcement.
const ENTITLEMENT_CONFIG = {
  launchPhase: LAUNCH_PHASE,
  adsEnabled: String(process.env.ADS_ENABLED || 'false').toLowerCase() === 'true', // ads-ready flag; no network at launch
  assistRules: { unit: 'AI Assists; cost varies by action', monthlyRollover: false, purchasedExpire: false, bonusExpire: false, spendOrder: ['monthly', 'bonus', 'purchased'] },
  familyMemberCap: FAMILY_MEMBER_CAP,
  referral: REFERRAL_CONFIG,
  freeWelcomeAssists: FREE_WELCOME_ASSISTS,
  tiers: {
    free:    { name: 'Free',    monthlyAssists: 5,   welcomeAssists: FREE_WELCOME_ASSISTS, manualRecipes: 'unlimited', price: null,
               tagline: 'Start your RecipeBox with unlimited manual recipes, search, tags, favorites, shopping list basics, and 15 welcome AI Assists. After that, get 5 AI Assists each month.',
               features: ['Unlimited manual recipes', 'Library, search, categories, tags, favorites', 'Basic shopping list & pantry tracking', '15 welcome AI Assists, then 5 each month'] },
    plus:    { name: 'Plus',    monthlyAssists: 250, price: { monthly: 4.99, yearly: 39.99 },
               tagline: 'For home cooks who want AI help all month. Includes 250 AI Assists/month for imports, recipe edits, Pantry Chef, meal planning, and more.',
               features: ['Everything in Free', '250 AI Assists every month', 'AI imports (web, photo, PDF, text, video)', 'AI adjust & chat editor', 'Pantry Chef', 'Meal planning', 'PDF exports', 'Nutrition tools'] },
    family:  { name: 'Family',  monthlyAssists: 600, shared: true, memberCap: FAMILY_MEMBER_CAP, price: { monthly: 7.99, yearly: 69.99 },
               tagline: 'For households who cook together. Includes up to 4 members, shared recipe planning tools, and 600 shared AI Assists/month.',
               features: ['Everything in Plus', 'Up to 4 household members', '600 shared AI Assists every month', 'Shared library, meal plan, shopping list & pantry'] },
    // Founder tiers are HIDDEN from the public config — offered only to beta
    // testers on the post-beta thank-you screen, never selectable off the street.
    founder: { name: 'Founder', monthlyAssists: 300, hidden: true, betaOnly: true, price: { yearly: 29.99, note: 'Beta-only, locked forever' },
               tagline: 'Beta-only forever pricing. $29.99/year for 300 AI Assists/month and Plus features, locked for as long as the subscription remains active.',
               features: ['Beta-only forever pricing', '300 AI Assists every month', 'All Plus features', 'Locked pricing while subscribed'] },
    founder_family: { name: 'Founder Family', monthlyAssists: 700, shared: true, memberCap: FAMILY_MEMBER_CAP, hidden: true, betaOnly: true, price: { yearly: 49.99, note: 'Beta-only, locked forever' },
               tagline: 'Beta-only forever pricing for households. $49.99/year for 700 shared AI Assists/month, up to 4 members, and all Family features — locked for as long as the subscription remains active.',
               features: ['Beta-only forever pricing', '700 shared AI Assists every month', 'Up to 4 household members', 'All Family features', 'Locked pricing while subscribed'] },
    beta:    { name: 'Beta',    monthlyAssists: BETA_UNLIMITED ? 'unlimited' : 50, unlimitedDuringBeta: true,
               tagline: 'Unlimited AI Assists during beta, with standard abuse protections.',
               features: ['Unlimited AI Assists during beta', 'Founder conversion offer after launch'] },
  },
  assistPacks: [
    { id: 'pack_25',  assists: 25,  price: 1.99 },
    { id: 'pack_75',  assists: 75,  price: 4.99 },
    { id: 'pack_200', assists: 200, price: 9.99 },
    { id: 'pack_500', assists: 500, price: 19.99 },
  ],
};
// Beta-only "Founder" lifetime tiers, never shown to the public.
const FOUNDER_TIERS = ['founder', 'founder_family'];
// Go-live decision policy (enforced once LAUNCH_PHASE flips + LAUNCH_DATE is set):
//  - beta testers get `decisionGraceDays` after launch to choose; if they don't,
//    their account auto-moves to Free.
//  - Founder pricing can be claimed up to `offerWindowDays` after launch.
// Surfaced to the client so the thank-you screen can show a live countdown; the
// auto-downgrade/offer-close enforcement is a launch-time scheduled job (TODO at
// go-live, needs LAUNCH_DATE).
const FOUNDER_OFFER_CONFIG = {
  decisionGraceDays: Number(process.env.FOUNDER_DECISION_GRACE_DAYS || 7),
  offerWindowDays: Number(process.env.FOUNDER_OFFER_WINDOW_DAYS || 30),
  launchDate: process.env.LAUNCH_DATE || null,
};
// Public-safe view of the entitlement config: strips hidden (beta-only Founder)
// tiers so someone off the street can never see or pick Founder pricing.
function publicEntitlementConfig() {
  const tiers = {};
  for (const [k, v] of Object.entries(ENTITLEMENT_CONFIG.tiers)) { if (!v.hidden) tiers[k] = v; }
  return { ...ENTITLEMENT_CONFIG, tiers };
}
// The founder options offered to an eligible beta user (with id attached).
function founderOfferTiers() {
  return FOUNDER_TIERS.filter((k) => ENTITLEMENT_CONFIG.tiers[k]).map((k) => ({ id: k, ...ENTITLEMENT_CONFIG.tiers[k] }));
}
// A user can claim Founder pricing only if they are (or were) a beta tester.
function isFounderEligible(plan, metadata) {
  return plan === 'beta' || !!(metadata && metadata.founderEligible);
}

// Pure spend-order helper (testable, no DB): monthly credits first, then bonus,
// then purchased. Returns the bucket to debit, or null when out of credits.
function chooseSpendBucket({ monthlyRemaining = 0, bonus = 0, purchased = 0 } = {}) {
  if (monthlyRemaining > 0) return 'monthly';
  if (bonus > 0) return 'bonus';
  if (purchased > 0) return 'purchased';
  return null;
}
function planMonthlyCredits(plan) {
  const p = PLAN_ENTITLEMENTS[plan];
  if (!p) return null;
  return p.unlimited ? null : (p.aiMonthlyLimit ?? null);
}
function referralBonusAllowed(grantsThisMonth) {
  return Number(grantsThisMonth || 0) < REFERRAL_CONFIG.monthlyCap;
}
const AI_FEATURE_PATTERNS = [
  // 'repair' must be checked before 'import': a malformed-JSON cleanup pass is an
  // internal helper for an already-billed action, so it is logged but never costs
  // the user another AI Assist (see NON_BILLABLE_FEATURES).
  { feature: 'repair', patterns: ['you repair malformed recipe', 'repair this malformed recipebox recipe', 'repair malformed recipe json'] },
  // Specific multi-cost features are matched before the broad 'adjust' pattern.
  { feature: 'meal-plan', patterns: ['weekly meal plan', 'meal plan for the week', 'generate a meal plan', 'plan my week'] },
  { feature: 'nutrition', patterns: ['nutrition estimate', 'estimate the nutrition', 'nutrition facts for', 'macros for this recipe'] },
  { feature: 'shopping-optimize', patterns: ['optimize this shopping list', 'consolidate this shopping list', 'shopping list optimization'] },
  { feature: 'import', patterns: ['extract the recipe', 'recipe extraction'] },
  { feature: 'pantry', patterns: ['pantry chef', 'what i have', 'ingredients i have'] },
  { feature: 'chat-editor', patterns: ['recipe editor', 'chat editor'] },
  { feature: 'adjust', patterns: ['adjust this recipe', 'request:'] },
];
// Internal helper passes (detection, cleanup, JSON repair) are logged for admin
// cost visibility but do not consume a user-facing AI Assist.
const NON_BILLABLE_FEATURES = new Set(['repair']);
function isBillableAiFeature(feature) { return !NON_BILLABLE_FEATURES.has(feature); }

// Central, configurable AI Assist cost map. Adjust here without hunting through
// the code. Deterministic (non-AI) actions never reach /api/ai and cost 0.
const AI_ACTION_COSTS = {
  import: 1,             // URL / photo / PDF / pasted-text-cleanup / video import
  'chat-editor': 1,      // one AI chat-editor message/action
  nutrition: 1,          // nutrition/macros estimate
  'shopping-optimize': 1,// shopping list optimization
  adjust: 2,             // AI recipe adjustment
  pantry: 2,             // Pantry Chef generation
  'meal-plan': 4,        // weekly AI meal plan generation
  'general-ai': 1,       // unknown billable call (conservative)
  repair: 0,             // internal helper pass — never billed
};
const DEFAULT_AI_ASSIST_COST = Number(process.env.DEFAULT_AI_ASSIST_COST || 1);
// AI Assists charged for a feature. Non-billable features cost 0.
function aiAssistCost(feature) {
  if (NON_BILLABLE_FEATURES.has(feature)) return 0;
  const c = AI_ACTION_COSTS[feature];
  return Number.isFinite(c) ? c : DEFAULT_AI_ASSIST_COST;
}
ENTITLEMENT_CONFIG.actionCosts = AI_ACTION_COSTS;

// The /api/ai proxy forwards the client body to Anthropic, so the client could
// otherwise pick an arbitrary (expensive) model or a huge max_tokens. Clamp
// both server-side: coerce any non-allowlisted model to the default, and cap
// output tokens. Coerce rather than reject so a future model rename can't break
// the app. Cost is further bounded by the per-user/IP rate limits + cost cap.
const ALLOWED_AI_MODELS = new Set([
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
]);
const DEFAULT_AI_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_AI_OUTPUT_TOKENS = 8000;
function sanitizeAiBody(body) {
  const b = (body && typeof body === 'object') ? { ...body } : {};
  if (!ALLOWED_AI_MODELS.has(String(b.model || ''))) b.model = DEFAULT_AI_MODEL;
  const n = Number(b.max_tokens);
  b.max_tokens = Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), MAX_AI_OUTPUT_TOKENS) : 4096;
  return b;
}

let pool = null;
async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS recipebox_store (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query(`CREATE TABLE IF NOT EXISTS profiles (
      user_id text PRIMARY KEY,
      email text UNIQUE,
      display_name text,
      role text NOT NULL DEFAULT 'user',
      password_hash text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text');
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'");
    await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at timestamptz');
    // Email verification. DEFAULT true grandfathers all existing accounts so beta
    // users are never locked out; only new signups insert email_verified=false.
    await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true');
    await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified_at timestamptz');
    await pool.query(`CREATE TABLE IF NOT EXISTS recipes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      title text NOT NULL,
      category text,
      hero_image_url text,
      recipe_json jsonb NOT NULL,
      favorite boolean NOT NULL DEFAULT false,
      rating integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS recipes_user_id_created_at_idx ON recipes (user_id, created_at desc)');
    await pool.query(`CREATE TABLE IF NOT EXISTS meal_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS meal_plans_user_id_updated_at_idx ON meal_plans (user_id, updated_at desc)');
    await pool.query(`CREATE TABLE IF NOT EXISTS user_settings (
      user_id text PRIMARY KEY,
      settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS account_sessions_user_id_idx ON account_sessions (user_id)');
    await pool.query(`CREATE TABLE IF NOT EXISTS user_activity (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text REFERENCES profiles(user_id) ON DELETE CASCADE,
      action text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS user_activity_user_created_idx ON user_activity (user_id, created_at desc)');
    await pool.query('CREATE INDEX IF NOT EXISTS user_activity_action_created_idx ON user_activity (action, created_at desc)');
    await pool.query(`CREATE TABLE IF NOT EXISTS user_feedback (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text REFERENCES profiles(user_id) ON DELETE CASCADE,
      type text NOT NULL DEFAULT 'general',
      message text NOT NULL,
      page text,
      device text,
      status text NOT NULL DEFAULT 'new',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS user_feedback_user_created_idx ON user_feedback (user_id, created_at desc)');
    await pool.query('CREATE INDEX IF NOT EXISTS user_feedback_status_created_idx ON user_feedback (status, created_at desc)');
    await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens (user_id)');
    await pool.query(`CREATE TABLE IF NOT EXISTS email_verification_tokens (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx ON email_verification_tokens (user_id)');
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_usage_monthly (
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      period text NOT NULL,
      request_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id, period)
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS ai_usage_monthly_period_idx ON ai_usage_monthly (period)');
    await pool.query(`CREATE TABLE IF NOT EXISTS user_entitlements (
      user_id text PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
      plan text NOT NULL DEFAULT 'beta',
      subscription_status text NOT NULL DEFAULT 'beta',
      ai_monthly_limit integer,
      ai_daily_limit integer,
      import_daily_limit integer,
      adjust_daily_limit integer,
      pantry_daily_limit integer,
      stripe_customer_id text,
      stripe_subscription_id text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS subscription_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text REFERENCES profiles(user_id) ON DELETE SET NULL,
      provider text NOT NULL,
      event_type text NOT NULL,
      provider_event_id text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      processed_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS subscription_events_user_idx ON subscription_events (user_id, processed_at desc)');
    await pool.query(`CREATE TABLE IF NOT EXISTS rate_limit_counters (
      key text NOT NULL,
      bucket text NOT NULL,
      count integer NOT NULL DEFAULT 0,
      reset_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(key, bucket)
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS rate_limit_counters_reset_idx ON rate_limit_counters (reset_at)');
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_usage_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id text NOT NULL,
      user_id text REFERENCES profiles(user_id) ON DELETE SET NULL,
      feature text NOT NULL,
      model text NOT NULL,
      tier text NOT NULL,
      input_tokens integer,
      output_tokens integer,
      estimated_cost_usd numeric(12,6),
      success boolean NOT NULL,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS ai_usage_events_user_created_idx ON ai_usage_events (user_id, created_at desc)');
    await pool.query('CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx ON ai_usage_events (created_at desc)');
    // Non-monthly AI credit ledger: purchased + bonus buckets, plus debits.
    // Monthly allowance is tracked separately by ai_usage_monthly. Purchased and
    // bonus grants never expire (expires_at null); positive amount = grant,
    // negative = debit. The client can never write here.
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_credit_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      kind text NOT NULL,
      bucket text NOT NULL,
      amount integer NOT NULL,
      reason text,
      request_id text,
      expires_at timestamptz,
      created_by text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS ai_credit_ledger_user_idx ON ai_credit_ledger (user_id, created_at desc)');
    await pool.query("CREATE INDEX IF NOT EXISTS ai_credit_ledger_referral_idx ON ai_credit_ledger (user_id, kind) WHERE kind = 'referral_bonus'");
    // Per-action AI Assist audit ledger: one row per charge/refund attempt with
    // the full accounting trail. The balance-affecting buckets live in
    // ai_credit_ledger (bonus/purchased) + ai_usage_monthly (monthly); this table
    // is the human-readable record. The client can never write here.
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_assist_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      household_id text,
      action_type text NOT NULL,
      assists_charged integer NOT NULL DEFAULT 0,
      buckets jsonb NOT NULL DEFAULT '{}'::jsonb,
      previous_balance integer,
      new_balance integer,
      recipe_id text,
      request_id text,
      status text NOT NULL DEFAULT 'charged',
      error_reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS ai_assist_ledger_user_idx ON ai_assist_ledger (user_id, created_at desc)');
    await pool.query('CREATE INDEX IF NOT EXISTS ai_assist_ledger_request_idx ON ai_assist_ledger (request_id)');
    await pool.query(`CREATE TABLE IF NOT EXISTS app_control_sources (
      id text PRIMARY KEY,
      title text NOT NULL,
      category text NOT NULL,
      content text NOT NULL,
      use_when text NOT NULL,
      scope_type text NOT NULL,
      scope_value text NOT NULL DEFAULT '',
      applies_to_features jsonb NOT NULL DEFAULT '[]'::jsonb,
      priority integer NOT NULL DEFAULT 50,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_by text,
      updated_by text,
      version integer NOT NULL DEFAULT 1,
      last_synced_at timestamptz,
      source_origin text NOT NULL DEFAULT 'RecipeBox'
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS app_control_sources_active_idx ON app_control_sources (active, category)');
    await pool.query(`CREATE TABLE IF NOT EXISTS app_control_change_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id text,
      action text NOT NULL,
      changed_by text,
      changed_at timestamptz NOT NULL DEFAULT now(),
      previous_value jsonb,
      next_value jsonb,
      note text
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS app_control_change_log_source_idx ON app_control_change_log (source_id, changed_at desc)');
    // --- Family / household sharing (foundation). Additive: existing per-user
    //     recipe/meal-plan storage is untouched. A user belongs to at most one
    //     household in v1 (the unique index on user_id). Roles: owner|adult|member.
    await pool.query(`CREATE TABLE IF NOT EXISTS households (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL DEFAULT 'My Household',
      owner_user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS household_members (
      household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'member',
      joined_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (household_id, user_id)
    )`);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS household_members_user_unique ON household_members (user_id)');
    await pool.query(`CREATE TABLE IF NOT EXISTS household_invites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      code text NOT NULL UNIQUE,
      role text NOT NULL DEFAULT 'member',
      created_by text REFERENCES profiles(user_id) ON DELETE SET NULL,
      expires_at timestamptz NOT NULL,
      accepted_by text REFERENCES profiles(user_id) ON DELETE SET NULL,
      accepted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS household_invites_household_idx ON household_invites (household_id, created_at desc)');
    // Household-scoped shared surfaces (M2 slice 2). One row per household; only
    // members can read/write their own household's data. Personal meal-plan/
    // shopping/pantry storage is untouched (households start empty).
    await pool.query(`CREATE TABLE IF NOT EXISTS household_meal_plans (
      household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
      meal_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text REFERENCES profiles(user_id) ON DELETE SET NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS household_shopping_lists (
      household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
      shopping_list_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text REFERENCES profiles(user_id) ON DELETE SET NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS household_pantries (
      household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
      pantry_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text REFERENCES profiles(user_id) ON DELETE SET NULL
    )`);
    await seedAppControlKnowledge(pool);
    await ensureConfiguredMasterAdmin(pool);
  }
  return pool;
}

async function readStore(key, fallback) {
  const db = await getPool();
  if (!db) return fallback;
  const result = await db.query('SELECT value FROM recipebox_store WHERE key=$1', [key]);
  return result.rows[0]?.value ?? fallback;
}

async function writeStore(key, value) {
  const db = await getPool();
  if (!db) return false;
  await db.query(
    `INSERT INTO recipebox_store(key, value, updated_at)
     VALUES($1, $2::jsonb, now())
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, JSON.stringify(value)]
  );
  return true;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
}

function authLimitKey(req) {
  return `${clientIp(req)}|${normalizeEmail(req.body?.email)}`;
}

// Auth attempt throttling. DB-backed (rate_limit_counters) so it actually works
// across serverless instances; falls back to the in-memory map when there is no
// database (local dev). Per IP+email, max AUTH_LIMIT_MAX per 15 minutes.
async function checkAuthLimit(req, res) {
  const db = await getPool();
  if (db) {
    try {
      const rl = await checkRateLimit(authLimitKey(req), 'auth', AUTH_LIMIT_MAX, 'quarterhour');
      if (!rl.allowed) {
        res.status(429).json({ error: 'Too many sign-in attempts. Wait a few minutes and try again.' });
        return false;
      }
      return true;
    } catch { /* fall through to in-memory */ }
  }
  const key = authLimitKey(req);
  const now = Date.now();
  const entry = authAttempts.get(key) || { count: 0, resetAt: now + AUTH_LIMIT_WINDOW_MS };
  if (entry.resetAt <= now) {
    entry.count = 0;
    entry.resetAt = now + AUTH_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  authAttempts.set(key, entry);
  if (entry.count > AUTH_LIMIT_MAX) {
    res.status(429).json({ error: 'Too many sign-in attempts. Wait a few minutes and try again.' });
    return false;
  }
  return true;
}

function clearAuthLimit(req) {
  authAttempts.delete(authLimitKey(req));
}

function configuredOrigins() {
  return [
    process.env.APP_BASE_URL,
    process.env.PUBLIC_APP_URL,
    'https://recipebox-kappa.vercel.app',
    'https://recipeboxapp.com',
    'https://www.recipeboxapp.com',
    process.env.NATIVE_APP_ORIGIN,
  ].filter(Boolean).map((value) => String(value).replace(/\/$/, ''));
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const clean = String(origin).replace(/\/$/, '');
  if (configuredOrigins().includes(clean)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(clean);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function publicUser(row) {
  if (!row) return null;
  const role = row.role || 'user';
  // emailVerified defaults to true when the column isn't selected, so callers
  // that don't fetch it never accidentally show a verify prompt.
  return { id: row.user_id, email: row.email, displayName: row.display_name || '', role, isMasterAdmin: role === 'master_admin', emailVerified: row.email_verified !== false };
}

function isMasterAdminUser(user) {
  return !!user && user.role === 'master_admin';
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
    const i = part.indexOf('=');
    if (i >= 0) acc[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    return acc;
  }, {});
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function requestOrigin(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${proto}://${host}` : 'http://localhost:3000';
}

// Origin used to build links emailed to users (password reset, email
// verification). This must NEVER trust an attacker-controllable Host /
// X-Forwarded-Host header — otherwise a spoofed Host could point a victim's
// reset/verify link at an attacker domain and leak the token. We use the
// configured APP_BASE_URL, fall back to the known production domain, and only
// honour the request host for genuine localhost development.
const PROD_APP_ORIGIN = 'https://recipebox-kappa.vercel.app';
function trustedAppOrigin(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const host = String((req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '');
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    const proto = String((req.headers['x-forwarded-proto'] || req.protocol || 'http')).split(',')[0].trim();
    return `${proto}://${host}`;
  }
  return PROD_APP_ORIGIN;
}

function hashPassword(password, salt) {
  const clean = String(password || '');
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clean, actualSalt, 32).toString('hex');
  return `scrypt$${actualSalt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const candidate = hashPassword(password, parts[1]).split('$')[2];
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(parts[2], 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function masterAdminEmail() {
  return normalizeEmail(process.env.MASTER_ADMIN_EMAIL || '');
}

function isConfiguredMasterEmail(email) {
  const masterEmail = masterAdminEmail();
  return !!masterEmail && normalizeEmail(email) === masterEmail;
}

function configuredMasterHash() {
  if (process.env.MASTER_ADMIN_PASSWORD_HASH) return process.env.MASTER_ADMIN_PASSWORD_HASH;
  if (process.env.MASTER_ADMIN_PASSWORD) return hashPassword(process.env.MASTER_ADMIN_PASSWORD);
  return '';
}

function verifyConfiguredMasterPassword(password) {
  if (process.env.MASTER_ADMIN_PASSWORD_HASH) return verifyPassword(password, process.env.MASTER_ADMIN_PASSWORD_HASH);
  if (process.env.MASTER_ADMIN_PASSWORD) return String(password || '') === String(process.env.MASTER_ADMIN_PASSWORD);
  return false;
}

async function ensureConfiguredMasterAdmin(db) {
  const email = masterAdminEmail();
  const passwordHash = configuredMasterHash();
  if (!email || !passwordHash) return null;
  const displayName = String(process.env.MASTER_ADMIN_NAME || 'Master Admin').trim().slice(0, 120);
  const existing = await db.query('SELECT user_id FROM profiles WHERE email=$1', [email]);
  if (existing.rows[0]) {
    await db.query(
      `UPDATE profiles
       SET role='master_admin',
           display_name=COALESCE(NULLIF(display_name, ''), $2),
           password_hash=COALESCE(password_hash, $3),
           updated_at=now()
       WHERE email=$1`,
      [email, displayName, passwordHash]
    );
    return existing.rows[0].user_id;
  }
  const userId = crypto.randomUUID();
  await db.query(
    `INSERT INTO profiles(user_id, email, display_name, role, password_hash)
     VALUES($1, $2, $3, 'master_admin', $4)`,
    [userId, email, displayName, passwordHash]
  );
  return userId;
}

function kbSeedEntries() {
  const now = new Date().toISOString();
  const common = { scopeType: 'Global', scopeValue: '', priority: 50, active: true, createdBy: 'system', updatedBy: 'system', version: 1, lastSyncedAt: null, sourceOrigin: 'RecipeBox Seed' };
  return [
    {
      id: 'core-operating-philosophy',
      title: 'RecipeBox Core Operating Philosophy',
      category: 'Methodology',
      useWhen: 'All AI interactions, recommendations, imports, and adjustments.',
      appliesToFeatures: ADMIN_FEATURES,
      content: 'Preserve the user intent and the spirit of the recipe. Do not overcomplicate family recipes. Prefer practical home-cooking language that is easy to read on a phone. Separate ingredients from directions clearly. Preserve the original recipe when making major AI changes unless the user confirms replacement. Always preview destructive or major changes before saving.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 90,
    },
    {
      id: 'recipe-import-normalization-framework',
      title: 'Recipe Import Normalization Framework',
      category: 'Recipe Normalization',
      useWhen: 'Importing from URL, pasted text, image, PDF, YouTube, or social links.',
      appliesToFeatures: ['Import', 'Manual Recipe Entry', 'PDF Export'],
      content: 'Extract title, description, ingredients, directions, servings, prep time, cook time, notes, tags, and nutrition when available. Never invent missing exact measurements unless clearly inferred from the source. Flag uncertainty in notes when needed. Preserve the source URL when available. Separate recipe text from blog/story content. Normalize ingredient lines without losing the original meaning.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 88,
    },
    {
      id: 'ai-adjust-guardrails',
      title: 'AI Adjust Guardrails',
      category: 'Safety / Guardrail',
      useWhen: 'AI Adjust modifies a recipe.',
      appliesToFeatures: ['AI Adjust', 'AI Chat Editor', 'Recipe Detail'],
      content: 'Always generate a preview before saving. Do not silently duplicate unless the user chooses Save as new. Offer Replace existing, Save as new, and Cancel for meaningful changes. Show what changed. Preserve the original recipe if the user cancels.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 86,
    },
    {
      id: 'family-recipe-preservation-rules',
      title: 'Family Recipe Preservation Rules',
      category: 'AI Instruction',
      useWhen: 'Recipe looks personal, handwritten, scanned, or manually entered.',
      appliesToFeatures: ['Import', 'Manual Recipe Entry', 'AI Adjust', 'Recipe Detail'],
      content: 'Treat family recipes carefully. Avoid improving away the character of handwritten or inherited recipes. Keep wording where meaningful. Add clarifying notes instead of overwriting uncertain original wording. Prefer gentle cleanup over aggressive modernization.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 84,
    },
    {
      id: 'original-recipe-card-future-milestone',
      title: 'Future Milestone: Original Recipe Card Preservation',
      category: 'Product Strategy',
      useWhen: 'Planning import, handwritten recipe, PDF, screenshot, or recipe-detail source preservation features.',
      appliesToFeatures: ['Import', 'Recipe Detail', 'Manual Recipe Entry'],
      content: 'Future feature: when users import handwritten cards, family recipe photos, screenshots, or PDFs, optionally preserve the original source with the cleaned recipe. Recipe detail should expose this warmly, e.g. Original Recipe Card or Let’s see what the original says, with a small thumbnail that opens a full-screen viewer. The original should serve as both source of truth and sentimental artifact. Edit Recipe should allow adding, replacing, downloading, or removing the original source. Keep the first pass lightweight; avoid OCR history/versioning until import reliability is stronger. Long term, store originals in Blob/object storage instead of bloating recipe JSON with large base64 payloads.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 73,
    },
    {
      id: 'pantry-chef-rules',
      title: 'Pantry Chef Rules',
      category: 'Pantry Logic',
      useWhen: 'Generating ideas from pantry ingredients.',
      appliesToFeatures: ['Pantry Chef'],
      content: 'Prioritize ingredients the user already has. Clearly list optional missing ingredients. Do not assume expensive or specialty items. Suggest practical substitutions. Prefer saved RecipeBox recipes before inventing new ideas.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 80,
    },
    {
      id: 'meal-planner-rules',
      title: 'Meal Planner Rules',
      category: 'Meal Planning',
      useWhen: 'Adding recipes to the weekly meal plan.',
      appliesToFeatures: ['Meal Planner'],
      content: 'Keep rows compact on mobile. Preserve planned recipe access. Make empty days tappable. Avoid hiding important recipe metadata. Support quick open and remove behavior. Meal planning should feel fast, not like calendar administration.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 76,
    },
    {
      id: 'shopping-list-aggregation-rules',
      title: 'Shopping List Aggregation Rules',
      category: 'Product Strategy',
      useWhen: 'Generating recipe or meal-plan shopping lists.',
      appliesToFeatures: ['Shopping List', 'Meal Planner', 'Recipe Detail'],
      content: 'Shopping lists should be deterministic at tap time and should not require a fresh AI call. Use structured ingredient fields when available, fall back to local parsing for older recipes, combine duplicate ingredients only when units and names are compatible, preserve prep notes, keep ambiguous items separate, and group items by grocery-store category.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 83,
    },
    {
      id: 'referral-program-future-milestone',
      title: 'Future Milestone: Referral Program',
      category: 'Product Strategy',
      useWhen: 'Planning monetization, AI Assists, or account growth features.',
      appliesToFeatures: ['Settings'],
      content: 'Future referral program: users may receive a referral code or link. When a referred friend completes a qualifying RecipeBox+ signup or conversion, both accounts receive a one-time AI credit bonus. Referral credit grants must happen server-side only, be auditable, prevent self-referrals, prevent repeated bonuses from the same referred user, and track referral source, referred user, referrer user, qualification date, and granted credits. Possible future tables include referrals, ai_credit_ledger, and referral_events.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 64,
    },
    {
      id: 'native-widgets-future-milestone',
      title: 'Future Milestone: iOS and Android Widgets',
      category: 'Product Strategy',
      useWhen: 'Planning native app release or mobile quick-access features.',
      appliesToFeatures: ['Meal Planner', 'Shopping List', 'Import', 'Pantry Chef', 'Cook Mode'],
      content: 'Future native widgets should surface useful food decisions without opening the app. Candidate widgets: Tonight’s Meal with recipe/Cook Mode/missing-ingredient deep links, Shopping List preview, Quick Import/Add Recipe, Pantry Chef, and Cook Mode current step. Do not build widgets before native wrapping and release planning, but avoid architecture decisions that would make deep links and widget data hard later.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 62,
    },
    {
      id: 'family-plan-future-milestone',
      title: 'Future Milestone: Family Plan',
      category: 'Product Strategy',
      useWhen: 'Planning subscriptions, sharing, household accounts, or permissions.',
      appliesToFeatures: ['Settings', 'Library', 'Meal Planner', 'Shopping List', 'Pantry Chef'],
      content: 'Future Family Plan recommendation: cap at 4 members. Roles should include Owner, Adult, and Member. Owner controls billing and invites. Support shared library, favorites, meal plans, shopping lists, and pantry while preserving personal/private recipes unless explicitly shared. Sharing should be permission-based rather than a shared login, and members should not be required to live in the same household.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 61,
    },
    {
      id: 'pdf-export-polish-future-milestone',
      title: 'Future Milestone: Better PDF Export',
      category: 'Product Strategy',
      useWhen: 'Improving recipe PDF export design.',
      appliesToFeatures: ['PDF Export', 'Recipe Detail'],
      content: 'Recipe PDF exports should feel polished, branded, and worth sharing. Add RecipeBox branding and logo if available, stronger typography hierarchy, a title section, metadata chips, clean ingredient and directions sections, estimated nutrition when available, and an Exported from RecipeBox footer. Avoid imported recipe photos by default unless licensing or ownership is clear; if image inclusion exists, make it optional and default off.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 60,
    },
    {
      id: 'hero-image-rules',
      title: 'Hero Image Rules',
      category: 'Image Handling',
      useWhen: 'Recipe has no hero image.',
      appliesToFeatures: ['Import', 'Recipe Detail', 'Library'],
      content: 'Prompt the user to add a photo after import or manual save when no image exists. Allow Skip for Now. Use category fallback imagery only when no real image exists. Do not block recipe save because an image is missing.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 72,
    },
    {
      id: 'copyright-published-cookbook-guidance',
      title: 'Copyright / Published Cookbook Import Guidance',
      category: 'Legal / Copyright',
      useWhen: 'Importing from photos, screenshots, PDFs, websites, or cookbooks.',
      appliesToFeatures: ['Import', 'PDF Export', 'Recipe Detail'],
      content: 'Personal use import is different from public redistribution. Store user-provided recipes for personal use. Do not publish copyrighted cookbook text publicly. Avoid presenting imported copyrighted recipes as RecipeBox-owned content. Maintain source attribution where possible. This is not legal advice.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 78,
    },
    {
      id: 'mobile-ux-rules',
      title: 'Mobile UX Rules',
      category: 'User Experience',
      useWhen: 'Rendering recipe detail, import screens, meal plan, cook mode, and library.',
      appliesToFeatures: ['Import', 'Recipe Detail', 'Meal Planner', 'Cook Mode', 'Library', 'Settings'],
      content: 'Design phone-first. Avoid horizontal scrolling. Keep ingredients above directions when practical. Make buttons large enough for thumbs. Support iPhone PWA safe areas. Avoid bottom nav being blocked by iOS app bars. Compact tool surfaces should use compact headings, not hero-scale type.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 82,
    },
    {
      id: 'whatsnext-sync-rules',
      title: 'WhatsNext Sync Rules',
      category: 'WhatsNext Sync',
      useWhen: 'App Control changes are created, edited, activated, deactivated, or rolled back.',
      appliesToFeatures: ['Settings'],
      content: 'App Control changes should eventually sync to WhatsNext as system knowledge and change events. Keep a local source of truth in RecipeBox. If sync is unavailable, log the pending intent and keep RecipeBox behavior stable.',
      createdAt: now,
      updatedAt: now,
      ...common,
      priority: 70,
    },
  ];
}

function sanitizeFeatures(features) {
  const list = Array.isArray(features) ? features : [];
  return Array.from(new Set(list.map(String).filter((f) => ADMIN_FEATURES.includes(f))));
}

function validateKnowledgeInput(input, existing = {}) {
  const title = String(input.title ?? existing.title ?? '').trim().slice(0, 160);
  const category = String(input.category ?? existing.category ?? ADMIN_KB_CATEGORIES[0]).trim();
  const content = String(input.content ?? existing.content ?? '').trim().slice(0, 24000);
  const useWhen = String(input.useWhen ?? existing.useWhen ?? input.use_when ?? existing.use_when ?? '').trim().slice(0, 1000);
  const scopeType = String(input.scopeType ?? existing.scopeType ?? input.scope_type ?? existing.scope_type ?? 'Global').trim();
  const scopeValue = String(input.scopeValue ?? existing.scopeValue ?? input.scope_value ?? existing.scope_value ?? '').trim().slice(0, 180);
  const priority = Math.max(0, Math.min(100, Math.round(Number(input.priority ?? existing.priority ?? 50) || 50)));
  const active = typeof input.active === 'boolean' ? input.active : existing.active !== false;
  const sourceOrigin = String(input.sourceOrigin ?? existing.sourceOrigin ?? input.source_origin ?? existing.source_origin ?? 'RecipeBox').trim().slice(0, 120) || 'RecipeBox';
  const appliesToFeatures = sanitizeFeatures(input.appliesToFeatures ?? existing.appliesToFeatures ?? input.applies_to_features ?? existing.applies_to_features);
  if (!title) throw new Error('Title is required.');
  if (!content) throw new Error('Content is required.');
  if (!useWhen) throw new Error('Use-when is required.');
  if (!ADMIN_KB_CATEGORIES.includes(category)) throw new Error('Category is not allowed.');
  if (!ADMIN_SCOPE_TYPES.includes(scopeType)) throw new Error('Scope type is not allowed.');
  if (scopeType === 'Feature' && !ADMIN_FEATURES.includes(scopeValue)) throw new Error('Feature scope value is not allowed.');
  return { title, category, content, useWhen, scopeType, scopeValue, appliesToFeatures, priority, active, sourceOrigin };
}

function sourceRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    content: row.content,
    useWhen: row.use_when,
    scopeType: row.scope_type,
    scopeValue: row.scope_value || '',
    appliesToFeatures: Array.isArray(row.applies_to_features) ? row.applies_to_features : [],
    priority: row.priority,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    version: row.version,
    lastSyncedAt: row.last_synced_at,
    sourceOrigin: row.source_origin,
  };
}

async function seedAppControlKnowledge(db) {
  const count = await db.query('SELECT count(*)::int AS count FROM app_control_sources');
  if (count.rows[0]?.count > 0) return;
  for (const entry of kbSeedEntries()) {
    await db.query(
      `INSERT INTO app_control_sources(id, title, category, content, use_when, scope_type, scope_value, applies_to_features, priority, active, created_at, updated_at, created_by, updated_by, version, last_synced_at, source_origin)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [entry.id, entry.title, entry.category, entry.content, entry.useWhen, entry.scopeType, entry.scopeValue, JSON.stringify(entry.appliesToFeatures), entry.priority, entry.active, entry.createdAt, entry.updatedAt, entry.createdBy, entry.updatedBy, entry.version, entry.lastSyncedAt, entry.sourceOrigin]
    );
  }
  await db.query(
    `INSERT INTO app_control_change_log(source_id, action, changed_by, next_value, note)
     VALUES($1, 'seed', 'system', $2::jsonb, 'Seeded initial RecipeBox App Control knowledge base.')`,
    ['system', JSON.stringify({ count: kbSeedEntries().length })]
  );
}

async function logAppControlChange(db, sourceId, action, user, previousValue, nextValue, note = '') {
  await db.query(
    `INSERT INTO app_control_change_log(source_id, action, changed_by, previous_value, next_value, note)
     VALUES($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [
      sourceId,
      action,
      user?.user_id || 'system',
      previousValue ? JSON.stringify(previousValue) : null,
      nextValue ? JSON.stringify(nextValue) : null,
      note,
    ]
  );
}

function periodKey(scope = 'day') {
  const now = new Date();
  if (scope === 'month') return now.toISOString().slice(0, 7);
  if (scope === 'hour') return now.toISOString().slice(0, 13);
  if (scope === 'quarterhour') return now.toISOString().slice(0, 13) + ':' + Math.floor(now.getUTCMinutes() / 15);
  if (scope === 'tenminutes') return now.toISOString().slice(0, 13) + ':' + Math.floor(now.getUTCMinutes() / 10);
  if (scope === 'twominutes') return now.toISOString().slice(0, 13) + ':' + Math.floor(now.getUTCMinutes() / 2);
  return now.toISOString().slice(0, 10);
}

function resetAfter(scope = 'day') {
  const now = new Date();
  if (scope === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (scope === 'hour') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1));
  if (scope === 'quarterhour') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), (Math.floor(now.getUTCMinutes() / 15) + 1) * 15));
  if (scope === 'tenminutes') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), (Math.floor(now.getUTCMinutes() / 10) + 1) * 10));
  if (scope === 'twominutes') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), (Math.floor(now.getUTCMinutes() / 2) + 1) * 2));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function detectAiFeature(body) {
  const text = JSON.stringify(body || {}).toLowerCase().slice(0, 12000);
  const found = AI_FEATURE_PATTERNS.find((item) => item.patterns.some((pattern) => text.includes(pattern)));
  return found?.feature || 'general-ai';
}

async function readEntitlements(user) {
  const db = await getPool();
  const master = isMasterAdminUser(user);
  const defaults = PLAN_ENTITLEMENTS[master ? 'master_admin' : DEFAULT_PLAN] || PLAN_ENTITLEMENTS.beta;
  if (!db || !user) return { plan: DEFAULT_PLAN, subscriptionStatus: 'unknown', ...defaults };
  const result = await db.query('SELECT * FROM user_entitlements WHERE user_id=$1', [user.user_id]);
  const row = result.rows[0];
  if (!row) return { plan: master ? 'master_admin' : DEFAULT_PLAN, subscriptionStatus: master ? 'master_admin' : DEFAULT_PLAN, ...defaults };
  const planDefaults = PLAN_ENTITLEMENTS[row.plan] || defaults;
  return {
    plan: master ? 'master_admin' : row.plan,
    subscriptionStatus: master ? 'master_admin' : row.subscription_status,
    aiMonthlyLimit: master ? null : Number(row.ai_monthly_limit ?? planDefaults.aiMonthlyLimit),
    aiDailyLimit: master ? null : Number(row.ai_daily_limit ?? planDefaults.aiDailyLimit),
    importDailyLimit: master ? null : Number(row.import_daily_limit ?? planDefaults.importDailyLimit),
    adjustDailyLimit: master ? null : Number(row.adjust_daily_limit ?? planDefaults.adjustDailyLimit),
    pantryDailyLimit: master ? null : Number(row.pantry_daily_limit ?? planDefaults.pantryDailyLimit),
    unlimited: master || !!planDefaults.unlimited,
  };
}

async function readEntitlementMetadata(userId) {
  const db = await getPool();
  if (!db || !userId) return {};
  const r = await db.query('SELECT metadata FROM user_entitlements WHERE user_id=$1', [userId]);
  return r.rows[0]?.metadata || {};
}

// Set a user's plan + its default limits, merging metadata. Used by the beta
// Founders conversion (Free applies immediately). Never callable by the client.
async function setUserPlan(userId, plan, metadata) {
  const db = await getPool();
  if (!db) return false;
  const p = PLAN_ENTITLEMENTS[plan] || PLAN_ENTITLEMENTS.free;
  await db.query(
    `INSERT INTO user_entitlements(user_id, plan, subscription_status, ai_monthly_limit, ai_daily_limit, import_daily_limit, adjust_daily_limit, pantry_daily_limit, metadata, updated_at, updated_by)
     VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8::jsonb,now(),'beta_convert')
     ON CONFLICT(user_id) DO UPDATE SET plan=EXCLUDED.plan, subscription_status=EXCLUDED.subscription_status, ai_monthly_limit=EXCLUDED.ai_monthly_limit, ai_daily_limit=EXCLUDED.ai_daily_limit, import_daily_limit=EXCLUDED.import_daily_limit, adjust_daily_limit=EXCLUDED.adjust_daily_limit, pantry_daily_limit=EXCLUDED.pantry_daily_limit, metadata=EXCLUDED.metadata, updated_at=now(), updated_by='beta_convert'`,
    [userId, plan, p.aiMonthlyLimit, p.aiDailyLimit, p.importDailyLimit, p.adjustDailyLimit, p.pantryDailyLimit, JSON.stringify(metadata || {})]
  );
  return true;
}

// Reserve a founder choice: record metadata without changing the plan (no charge
// until billing exists; the user keeps beta-unlimited meanwhile).
async function reserveFounderChoice(userId, currentPlan, currentStatus, metadata) {
  const db = await getPool();
  if (!db) return false;
  await db.query(
    `INSERT INTO user_entitlements(user_id, plan, subscription_status, metadata, updated_at, updated_by)
     VALUES($1,$2,$3,$4::jsonb,now(),'beta_convert')
     ON CONFLICT(user_id) DO UPDATE SET metadata=EXCLUDED.metadata, updated_at=now(), updated_by='beta_convert'`,
    [userId, currentPlan || DEFAULT_PLAN, currentStatus || DEFAULT_PLAN, JSON.stringify(metadata || {})]
  );
  return true;
}

async function checkRateLimit(key, bucket, max, scope = 'day') {
  if (!Number.isFinite(Number(max)) || Number(max) <= 0) return { allowed: true, limit: null, remaining: null };
  const db = await getPool();
  if (!db) return { allowed: true, limit: Number(max), remaining: Number(max) };
  const scopedBucket = `${bucket}:${periodKey(scope)}`;
  const result = await db.query(
    `INSERT INTO rate_limit_counters(key, bucket, count, reset_at, updated_at)
     VALUES($1, $2, 1, $3, now())
     ON CONFLICT(key, bucket)
     DO UPDATE SET count=CASE WHEN rate_limit_counters.reset_at <= now() THEN 1 ELSE rate_limit_counters.count + 1 END,
                   reset_at=CASE WHEN rate_limit_counters.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit_counters.reset_at END,
                   updated_at=now()
     RETURNING count, reset_at`,
    [key, scopedBucket, resetAfter(scope)]
  );
  const count = Number(result.rows[0]?.count || 0);
  const limit = Number(max);
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: result.rows[0]?.reset_at };
}

function estimateAiCostUsd(model, inputTokens, outputTokens) {
  const input = Number(inputTokens || 0);
  const output = Number(outputTokens || 0);
  const name = String(model || '').toLowerCase();
  const rates = name.includes('haiku')
    ? { input: 0.0000008, output: 0.000004 }
    : { input: 0.000003, output: 0.000015 };
  return Number(((input * rates.input) + (output * rates.output)).toFixed(6));
}

async function logAiUsageEvent({ requestId, user, feature, model, tier, inputTokens, outputTokens, success, errorMessage }) {
  const db = await getPool();
  if (!db) return;
  await db.query(
    `INSERT INTO ai_usage_events(request_id, user_id, feature, model, tier, input_tokens, output_tokens, estimated_cost_usd, success, error_message)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      requestId,
      user?.user_id || null,
      feature || 'general-ai',
      String(model || ''),
      tier || 'unknown',
      Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : null,
      Number.isFinite(Number(outputTokens)) ? Number(outputTokens) : null,
      estimateAiCostUsd(model, inputTokens, outputTokens),
      !!success,
      errorMessage ? String(errorMessage).slice(0, 1000) : null,
    ]
  );
}

// Wallet circuit breaker ceiling on total estimated Anthropic spend this month.
// ON by default ($75) so a bug/abuse can't run up an unbounded bill; override
// with AI_MONTHLY_GLOBAL_MAX_COST_USD (set to 0 to disable).
function resolveMonthlyCostCap() {
  return process.env.AI_MONTHLY_GLOBAL_MAX_COST_USD !== undefined
    ? Number(process.env.AI_MONTHLY_GLOBAL_MAX_COST_USD)
    : 75;
}

async function checkGlobalAiControls() {
  if (String(process.env.AI_FEATURES_ENABLED || 'true').toLowerCase() === 'false') {
    return { allowed: false, error: process.env.AI_EMERGENCY_DISABLE_REASON || 'RecipeBox AI is temporarily unavailable.' };
  }
  const dailyMax = Number(process.env.AI_DAILY_GLOBAL_MAX_REQUESTS || 0);
  if (dailyMax > 0) {
    const daily = await checkRateLimit('global', 'ai-requests', dailyMax, 'day');
    if (!daily.allowed) return { allowed: false, error: 'RecipeBox AI is busy today. Please try again tomorrow.' };
  }
  const monthlyCostCap = resolveMonthlyCostCap();
  if (monthlyCostCap > 0) {
    const db = await getPool();
    const result = await db.query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::numeric AS total
       FROM ai_usage_events
       WHERE created_at >= date_trunc('month', now()) AND success=true`
    );
    if (Number(result.rows[0]?.total || 0) >= monthlyCostCap) {
      return { allowed: false, error: 'RecipeBox AI monthly budget is paused for now.' };
    }
  }
  return { allowed: true };
}

function cookieOptions(req) {
  const origin = req.headers.origin ? String(req.headers.origin).replace(/\/$/, '') : '';
  const crossOrigin = !!origin && isAllowedOrigin(origin) && origin !== requestOrigin(req);
  return {
    httpOnly: true,
    sameSite: crossOrigin ? 'none' : 'lax',
    secure: crossOrigin || !!(process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https'),
    maxAge: 1000 * 60 * 60 * 24 * SESSION_DAYS,
    path: '/',
  };
}

async function createSession(req, res, userId) {
  const db = await getPool();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  await db.query(
    `INSERT INTO account_sessions(token_hash, user_id, expires_at)
     VALUES($1, $2, now() + ($3::text || ' days')::interval)`,
    [tokenHash, userId, SESSION_DAYS]
  );
  res.cookie(SESSION_COOKIE, token, cookieOptions(req));
}

async function sendPasswordResetEmail(email, resetUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Password reset email is not configured.');
  const from = process.env.RESEND_FROM || 'RecipeBox <onboarding@resend.dev>';
  const safeUrl = escapeHtml(resetUrl);
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#2F211B">
      <h1 style="font-family:Georgia,serif">Reset your RecipeBox password</h1>
      <p>Use the button below to choose a new password. This link expires in ${RESET_TOKEN_MINUTES} minutes.</p>
      <p><a href="${safeUrl}" style="display:inline-block;background:#C76F3A;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px">Reset password</a></p>
      <p>If you did not ask for this, you can ignore this email.</p>
    </div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your RecipeBox password',
      html,
      text: `Reset your RecipeBox password: ${resetUrl}\n\nThis link expires in ${RESET_TOKEN_MINUTES} minutes.`,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || 'Could not send reset email.');
  }
}

async function sendVerificationEmail(email, verifyUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email sending is not configured.');
  const from = process.env.RESEND_FROM || 'RecipeBox <onboarding@resend.dev>';
  const safeUrl = escapeHtml(verifyUrl);
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;color:#2F211B">
      <h1 style="font-family:Georgia,serif">Confirm your email</h1>
      <p>Welcome to RecipeBox! Tap the button below to confirm your email address. This link expires in 24 hours.</p>
      <p><a href="${safeUrl}" style="display:inline-block;background:#2C4A33;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px">Confirm email</a></p>
      <p>If you did not create a RecipeBox account, you can ignore this email.</p>
    </div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Confirm your RecipeBox email',
      html,
      text: `Confirm your RecipeBox email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || data.error || 'Could not send verification email.');
  }
}

// Create a single-use, hashed, expiring email-verification token and return the
// raw token (mirrors password reset). Caller emails the verify link.
async function createEmailVerification(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO email_verification_tokens(token_hash, user_id, expires_at)
     VALUES($1, $2, now() + ($3::text || ' minutes')::interval)`,
    [hashToken(token), userId, VERIFY_TOKEN_MINUTES]
  );
  return token;
}

// Best-effort: never block signup/resend if email delivery fails or is
// unconfigured. Returns true if an email was actually sent.
async function issueVerificationEmail(db, req, userId, email) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const token = await createEmailVerification(db, userId);
    await sendVerificationEmail(email, `${trustedAppOrigin(req)}/?verify=${encodeURIComponent(token)}`);
    return true;
  } catch (err) {
    console.warn('verification email failed:', err.message);
    return false;
  }
}

async function currentUser(req) {
  const db = await getPool();
  if (!db) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await db.query(
    `SELECT p.user_id, p.email, p.display_name, p.role, p.email_verified
     FROM account_sessions s
     JOIN profiles p ON p.user_id = s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  if (!result.rows[0]) return null;
  await db.query(
    `UPDATE account_sessions
     SET last_seen_at=now(), expires_at=now() + ($2::text || ' days')::interval
     WHERE token_hash=$1`,
    [hashToken(token), SESSION_DAYS]
  );
  await db.query('UPDATE profiles SET last_active_at=now(), updated_at=now() WHERE user_id=$1', [result.rows[0].user_id]);
  return result.rows[0];
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'sign in required' });
    req.user = user;
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function requireMasterAdmin(req, res, next) {
  if (!req.user) {
    return requireAuth(req, res, () => requireMasterAdmin(req, res, next));
  }
  if (!isMasterAdminUser(req.user)) return res.status(403).json({ error: 'master admin required' });
  next();
}

function normalizeRecipeForDb(recipe) {
  const r = recipe || {};
  // Strip transient household-share annotations so they never persist in a row
  // (they're re-applied on read for other members' shared recipes only).
  const { householdShared, ownerId, ownerName, ...clean } = r;
  return {
    title: String(r.title || 'Untitled Recipe').slice(0, 240),
    category: r.category || null,
    heroImage: r.heroImage || null,
    favorite: !!r.favorite,
    rating: Number.isFinite(Number(r.rating)) ? Number(r.rating) : 0,
    json: clean,
  };
}

async function readUserRecipes(userId) {
  const db = await getPool();
  if (!db) return [];
  const result = await db.query(
    'SELECT recipe_json FROM recipes WHERE user_id=$1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows.map((row) => row.recipe_json);
}

// Recipes shared by OTHER members of the user's household (private by default —
// only those with recipe_json.shared === true). Annotated read-only so the client
// shows them with an "added by" badge and never writes them back as the user's own.
async function readHouseholdSharedRecipes(userId) {
  const db = await getPool();
  if (!db || !userId) return [];
  const hh = await db.query('SELECT household_id FROM household_members WHERE user_id=$1', [userId]);
  const householdId = hh.rows[0]?.household_id;
  if (!householdId) return [];
  const result = await db.query(
    `SELECT r.recipe_json, r.user_id, p.display_name
       FROM recipes r
       JOIN household_members m ON m.user_id = r.user_id AND m.household_id = $1
       JOIN profiles p ON p.user_id = r.user_id
      WHERE r.user_id <> $2 AND (r.recipe_json->>'shared') = 'true'
      ORDER BY r.created_at DESC`,
    [householdId, userId]
  );
  return result.rows.map((row) => ({
    ...row.recipe_json,
    householdShared: true,
    ownerId: row.user_id,
    ownerName: row.display_name || 'A household member',
  }));
}

async function replaceUserRecipes(userId, recipes) {
  const db = await getPool();
  if (!db) return false;
  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM recipes WHERE user_id=$1', [userId]);
    for (const recipe of recipes) {
      const r = normalizeRecipeForDb(recipe);
      await db.query(
        `INSERT INTO recipes(user_id, title, category, hero_image_url, recipe_json, favorite, rating)
         VALUES($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [userId, r.title, r.category, r.heroImage, JSON.stringify(r.json), r.favorite, r.rating]
      );
    }
    await db.query('COMMIT');
    return true;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

async function readUserMealPlan(userId) {
  const db = await getPool();
  if (!db) return {};
  const result = await db.query(
    'SELECT plan_json FROM meal_plans WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1',
    [userId]
  );
  return result.rows[0]?.plan_json || {};
}

async function replaceUserMealPlan(userId, mealPlan) {
  const db = await getPool();
  if (!db) return false;
  await db.query('DELETE FROM meal_plans WHERE user_id=$1', [userId]);
  await db.query(
    `INSERT INTO meal_plans(user_id, plan_json, updated_at)
     VALUES($1, $2::jsonb, now())`,
    [userId, JSON.stringify(mealPlan || {})]
  );
  return true;
}

async function logUserActivity(user, action, metadata = {}) {
  const db = await getPool();
  if (!db || !user?.user_id) return;
  await db.query(
    `INSERT INTO user_activity(user_id, action, metadata)
     VALUES($1, $2, $3::jsonb)`,
    [user.user_id, String(action || 'activity').slice(0, 80), JSON.stringify(metadata || {})]
  );
}

function currentAiPeriod() {
  return new Date().toISOString().slice(0, 7);
}

async function readAiUsage(userId) {
  const db = await getPool();
  const period = currentAiPeriod();
  if (!db || !userId) return { period, count: 0, limit: AI_MONTHLY_LIMIT, remaining: AI_MONTHLY_LIMIT };
  const profile = await db.query('SELECT user_id, email, display_name, role FROM profiles WHERE user_id=$1', [userId]);
  const entitlement = await readEntitlements(profile.rows[0]);
  if (entitlement.unlimited) return { period, count: 0, limit: null, remaining: null, unlimited: true, plan: entitlement.plan };
  const result = await db.query(
    'SELECT request_count FROM ai_usage_monthly WHERE user_id=$1 AND period=$2',
    [userId, period]
  );
  const count = Number(result.rows[0]?.request_count || 0);
  const limit = Number(entitlement.aiMonthlyLimit ?? AI_MONTHLY_LIMIT);
  return { period, count, limit, remaining: Math.max(0, limit - count), plan: entitlement.plan };
}

async function incrementAiUsage(userId, amount = 1) {
  const db = await getPool();
  const period = currentAiPeriod();
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return readAiUsage(userId);
  const profile = await db.query('SELECT role FROM profiles WHERE user_id=$1', [userId]);
  if (profile.rows[0]?.role === 'master_admin') return readAiUsage(userId);
  await db.query(
    `INSERT INTO ai_usage_monthly(user_id, period, request_count, updated_at)
     VALUES($1, $2, $3, now())
     ON CONFLICT(user_id, period)
     DO UPDATE SET request_count=GREATEST(0, ai_usage_monthly.request_count + $3), updated_at=now()`,
    [userId, period, n]
  );
  return readAiUsage(userId);
}

// --- AI credit ledger (purchased + bonus buckets) ---
async function readLedgerBalances(userId) {
  const db = await getPool();
  if (!db || !userId) return { bonus: 0, purchased: 0 };
  const result = await db.query(
    `SELECT bucket, COALESCE(SUM(amount), 0)::int AS bal
       FROM ai_credit_ledger
      WHERE user_id=$1 AND bucket IN ('bonus','purchased')
      GROUP BY bucket`,
    [userId]
  );
  const out = { bonus: 0, purchased: 0 };
  result.rows.forEach((row) => { out[row.bucket] = Math.max(0, Number(row.bal) || 0); });
  return out;
}

async function grantCredits(userId, bucket, amount, kind, reason, createdBy) {
  const db = await getPool();
  if (!db || !userId) return false;
  if (!['bonus', 'purchased'].includes(bucket)) throw new Error('Invalid AI Assist bucket.');
  await db.query(
    `INSERT INTO ai_credit_ledger(user_id, kind, bucket, amount, reason, created_by) VALUES($1,$2,$3,$4,$5,$6)`,
    [userId, kind || 'admin_grant', bucket, Math.round(Number(amount) || 0), reason || null, createdBy || null]
  );
  return true;
}

// Pure spend-split: distribute a cost of `cost` AI Assists across buckets in
// spend order (monthly allowance first, then bonus, then purchased). Returns the
// per-bucket amounts plus any shortfall. Testable, no DB.
function splitAssistCharge(cost, { monthlyRemaining = 0, bonus = 0, purchased = 0 } = {}) {
  let remaining = Math.max(0, Math.round(Number(cost) || 0));
  const take = (avail) => { const n = Math.min(remaining, Math.max(0, Math.round(Number(avail) || 0))); remaining -= n; return n; };
  const fromMonthly = take(monthlyRemaining);
  const fromBonus = take(bonus);
  const fromPurchased = take(purchased);
  return { monthly: fromMonthly, bonus: fromBonus, purchased: fromPurchased, shortfall: remaining, covered: remaining === 0 };
}

// Spend `cost` AI Assists using the spend order: monthly allowance first, then
// bonus, then purchased. Monthly is tracked by ai_usage_monthly; bonus/purchased
// are negative ai_credit_ledger rows. Writes a single ai_assist_ledger audit row
// (action_type, per-bucket split, prev/new total, status). No-op for unlimited
// (master/beta) accounts. Returns the charge summary (or null if uncharged).
async function debitAiAssists(userId, { requestId, cost, actionType, recipeId, householdId } = {}) {
  const db = await getPool();
  if (!db || !userId) return null;
  const usage = await readAiUsage(userId);
  if (usage.unlimited) return null;
  const charge = Math.max(0, Math.round(Number(cost) || 0));
  if (charge === 0) return null;
  const monthlyRemaining = Math.max(0, (Number(usage.limit) || 0) - (Number(usage.count) || 0));
  const balances = await readLedgerBalances(userId);
  const prevTotal = monthlyRemaining + balances.bonus + balances.purchased;
  const split = splitAssistCharge(charge, { monthlyRemaining, bonus: balances.bonus, purchased: balances.purchased });
  if (split.monthly > 0) await incrementAiUsage(userId, split.monthly);
  for (const bucket of ['bonus', 'purchased']) {
    if (split[bucket] > 0) {
      await db.query(
        `INSERT INTO ai_credit_ledger(user_id, kind, bucket, amount, reason, request_id) VALUES($1,'debit',$2,$3,'ai_action',$4)`,
        [userId, bucket, -split[bucket], requestId || null]
      );
    }
  }
  const charged = split.monthly + split.bonus + split.purchased;
  const newTotal = Math.max(0, prevTotal - charged);
  await db.query(
    `INSERT INTO ai_assist_ledger(user_id, household_id, action_type, assists_charged, buckets, previous_balance, new_balance, recipe_id, request_id, status)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'charged')`,
    [userId, householdId || null, actionType || 'ai_action', charged,
     JSON.stringify({ monthly: split.monthly, bonus: split.bonus, purchased: split.purchased }),
     prevTotal, newTotal, recipeId || null, requestId || null]
  );
  return { charged, split, previousBalance: prevTotal, newBalance: newTotal, shortfall: split.shortfall };
}

// Reverse an earlier charge (post-charge failure). Credits the same buckets back
// and records a 'refunded' audit row so the trail is auditable.
async function refundAiAssists(userId, requestId, errorReason) {
  const db = await getPool();
  if (!db || !userId || !requestId) return null;
  const prior = await db.query(
    `SELECT id, buckets, assists_charged FROM ai_assist_ledger
      WHERE user_id=$1 AND request_id=$2 AND status='charged' ORDER BY created_at DESC LIMIT 1`,
    [userId, requestId]
  );
  const row = prior.rows[0];
  if (!row || Number(row.assists_charged) <= 0) return null;
  const buckets = row.buckets || {};
  const monthly = Math.max(0, Number(buckets.monthly) || 0);
  if (monthly > 0) await incrementAiUsage(userId, -monthly);
  for (const bucket of ['bonus', 'purchased']) {
    const amt = Math.max(0, Number(buckets[bucket]) || 0);
    if (amt > 0) {
      await db.query(
        `INSERT INTO ai_credit_ledger(user_id, kind, bucket, amount, reason, request_id) VALUES($1,'refund',$2,$3,'ai_refund',$4)`,
        [userId, bucket, amt, requestId]
      );
    }
  }
  await db.query(`UPDATE ai_assist_ledger SET status='refunded', error_reason=$2 WHERE id=$1`, [row.id, String(errorReason || 'refund').slice(0, 240)]);
  await db.query(
    `INSERT INTO ai_assist_ledger(user_id, action_type, assists_charged, buckets, request_id, status, error_reason)
     VALUES($1,$2,$3,$4::jsonb,$5,'refund',$6)`,
    [userId, 'refund', -Number(row.assists_charged), JSON.stringify(buckets), requestId, String(errorReason || 'refund').slice(0, 240)]
  );
  return { refunded: Number(row.assists_charged) };
}

function nextMonthlyResetISO() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

async function readCreditStatus(user) {
  const usage = await readAiUsage(user.user_id);
  const balances = await readLedgerBalances(user.user_id);
  const monthlyRemaining = usage.unlimited ? null : Math.max(0, (Number(usage.limit) || 0) - (Number(usage.count) || 0));
  const totalRemaining = usage.unlimited ? null : (monthlyRemaining + balances.bonus + balances.purchased);
  return {
    plan: usage.plan || (usage.unlimited ? 'beta' : DEFAULT_PLAN),
    unlimited: !!usage.unlimited,
    launchPhase: LAUNCH_PHASE,
    monthly: { limit: usage.limit ?? null, used: usage.count || 0, remaining: monthlyRemaining, period: usage.period, resetsAt: nextMonthlyResetISO() },
    // Balances, user-facing terminology is "AI Assists".
    bonusAssists: balances.bonus,
    purchasedAssists: balances.purchased,
    totalRemaining,
    rollsOver: false,
  };
}

// Referral foundation: grant the bonus to both sides, capped per referrer/month.
// Not yet wired to a live conversion event (payments are not integrated).
async function grantReferralBonus(referrerId, referredId, createdBy) {
  const db = await getPool();
  if (!db) return { ok: false, reason: 'no_db' };
  const period = currentAiPeriod();
  const r = await db.query(
    `SELECT count(*)::int AS n FROM ai_credit_ledger WHERE user_id=$1 AND kind='referral_bonus' AND to_char(created_at,'YYYY-MM')=$2`,
    [referrerId, period]
  );
  if (!referralBonusAllowed(r.rows[0]?.n || 0)) return { ok: false, reason: 'cap_reached' };
  await grantCredits(referrerId, 'bonus', REFERRAL_CONFIG.bonusAssists, 'referral_bonus', 'referral', createdBy || 'system');
  await grantCredits(referredId, 'bonus', REFERRAL_CONFIG.bonusAssists, 'referral_bonus', 'referral', createdBy || 'system');
  return { ok: true, granted: REFERRAL_CONFIG.bonusAssists };
}

// External fetch with a hard timeout so a slow/hanging source can't stall the
// whole serverless request. Throws an AbortError on timeout (caught upstream).
async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
function isAbortError(err) {
  return err && (err.name === 'AbortError' || /aborted|abort/i.test(String(err.message || '')));
}

// --- SSRF protection for user-supplied import URLs ---
// Block loopback, private, link-local (incl. cloud metadata 169.254.169.254),
// CGNAT, and reserved ranges so the server-side fetchers can't be aimed at
// internal services.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}
function ssrfError(message) {
  return Object.assign(new Error(message), { ssrf: true });
}
async function assertPublicHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw ssrfError('blocked host');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw ssrfError('blocked host');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw ssrfError('blocked host');
    return;
  }
  // Block obfuscated numeric IP encodings (decimal/hex integer, or dotted forms
  // using octal/hex labels, e.g. 2130706433, 0x7f000001, 0177.0.0.1). These are
  // NOT valid IP literals, so they'd otherwise fall through to DNS, where
  // getaddrinfo can interpret them as a private IP differently than this check.
  const labels = host.split('.');
  const numericEncoding =
    /^0x[0-9a-f]+$/i.test(host) ||
    /^[0-9]+$/.test(host) ||
    labels.some((l) => /^0x[0-9a-f]+$/i.test(l)) ||
    labels.some((l) => /^0[0-7]+$/.test(l));
  if (numericEncoding) throw ssrfError('blocked host');
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw ssrfError('unresolvable host'); }
  if (!addrs || !addrs.length) throw ssrfError('unresolvable host');
  for (const a of addrs) { if (isPrivateIp(a.address)) throw ssrfError('blocked host'); }
}
// Like fetchWithTimeout, but validates the host (and every redirect hop) against
// the SSRF guard. Use this for any fetch whose host is user-controlled.
async function safeFetch(rawUrl, options = {}, timeoutMs = 9000, maxRedirects = 5) {
  let current = String(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u;
    try { u = new URL(current); } catch { throw ssrfError('bad url'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw ssrfError('blocked protocol');
    await assertPublicHost(u.hostname);
    const resp = await fetchWithTimeout(current, { ...options, redirect: 'manual' }, timeoutMs);
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
      const next = new URL(resp.headers.get('location'), current).href;
      try { await resp.body?.cancel(); } catch {}
      current = next;
      continue;
    }
    return resp;
  }
  throw new Error('too many redirects');
}
// Read a response body but stop after maxBytes so a huge/malicious page cannot
// exhaust memory. Recipe pages are small; this just bounds the worst case.
async function readBodyCapped(response, maxBytes = 6000000) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) { try { await response.body?.cancel(); } catch {} return null; }
  const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
  if (!reader) {
    const text = await response.text();
    return text.length > maxBytes ? null : text;
  }
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > maxBytes) { try { await reader.cancel(); } catch {} return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function absoluteUrl(base, maybeUrl) {
  try { return new URL(maybeUrl, base).href; } catch { return ''; }
}
function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
function decodeHtmlText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
function matchAttr(html, re) {
  const m = html.match(re);
  return m ? (m[1] || m[2] || '').trim() : '';
}
function parseJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1].trim())
    .filter(Boolean);
  const parsed = [];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      parsed.push(data);
    } catch {}
  }
  return parsed;
}
// Heuristic: did the fetcher get a bot-challenge / consent / block page instead
// of the recipe? True only when there's no structured recipe AND the body is a
// thin or boilerplate challenge — a real recipe page has structured data or
// substantial readable text, so legitimate pages don't trip this.
const BLOCK_MARKERS = /just a moment|enable javascript|are you a (?:robot|human)|attention required|access denied|verify you are human|captcha|cf-browser-verification|requests from your network/i;
function looksBlockedPage({ title = '', text = '', hasRecipe = false } = {}) {
  if (hasRecipe) return false;
  if (BLOCK_MARKERS.test(String(title) + ' ' + String(text).slice(0, 1200))) return true;
  return String(text).length < 600;
}
function flattenJsonLd(nodes) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n === 'object') {
      out.push(n);
      if (n['@graph']) walk(n['@graph']);
      if (n.mainEntity) walk(n.mainEntity);
    }
  };
  walk(nodes);
  return out;
}
function bestImage(base, html, jsonLdNodes) {
  const candidates = [];
  for (const n of flattenJsonLd(jsonLdNodes)) {
    const image = n.image || n.thumbnailUrl;
    if (typeof image === 'string') candidates.push(image);
    if (Array.isArray(image)) image.forEach(x => typeof x === 'string' ? candidates.push(x) : x?.url && candidates.push(x.url));
    if (image?.url) candidates.push(image.url);
  }
  const og = matchAttr(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
             matchAttr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og) candidates.push(og);
  const tw = matchAttr(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (tw) candidates.push(tw);
  const imgMatches = [...html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi)].slice(0, 20);
  imgMatches.forEach(m => candidates.push(m[1]));
  return candidates.map(x => absoluteUrl(base, x)).find(x => /^https?:\/\//i.test(x)) || '';
}
function extractHelpfulLinks(base, html) {
  const keywords = /\b(rub|sauce|seasoning|marinade|dressing|stock|broth|jam|frosting|glaze|paste|mix|blend|homemade|how to|guide|tips?|substitutions?|ingredient|recipe)\b/i;
  const seen = new Set();
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((m) => {
      const href = matchAttr(m[1], /\bhref=["']([^"']+)["']/i);
      const text = decodeHtmlText(m[2]);
      const url = absoluteUrl(base, href);
      return { text, url };
    })
    .filter((link) => /^https?:\/\//i.test(link.url) && link.text && link.text.length <= 120)
    .filter((link) => keywords.test(link.text) || keywords.test(link.url))
    .filter((link) => {
      const key = link.url.replace(/#.*$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}
function detectSocialPlatform(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return 'facebook';
  } catch {}
  return 'unknown';
}
function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return matchAttr(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
    matchAttr(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'));
}
function cleanSocialCaption(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
    .slice(0, 8000);
}
function socialQuality(text, caption, description, warnings) {
  const bestLength = Math.max((text || '').length, (caption || '').length, (description || '').length);
  if (bestLength >= 500) return warnings.length ? 'partial' : 'good';
  if (bestLength >= 120) return 'partial';
  return 'low';
}
async function fetchHtmlMetadata(target, warnings) {
  const r = await safeFetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }, 9000);
  const html = (await readBodyCapped(r)) || '';
  if (!r.ok) warnings.push('Generic page fetch returned HTTP ' + r.status + '.');
  const jsonLd = parseJsonLd(html);
  const title = cleanSocialCaption(metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || matchAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = cleanSocialCaption(metaContent(html, 'og:description') || metaContent(html, 'description') || metaContent(html, 'twitter:description'));
  const image = bestImage(target, html, jsonLd);
  const text = cleanText(html).slice(0, 12000);
  return { status: r.status, finalUrl: r.url, htmlLength: html.length, title, description, image, text, htmlHash: crypto.createHash('sha256').update(html).digest('hex') };
}
async function youtubeiMetadata(videoId) {
  const { Innertube } = await import('youtubei.js');
  const youtube = await Innertube.create();
  const info = await youtube.getInfo(videoId);
  const thumbnail = info.basic_info?.thumbnail?.[0]?.url ||
    info.basic_info?.thumbnail?.contents?.[0]?.url ||
    info.basic_info?.thumbnail?.url ||
    '';
  return {
    title: info.basic_info?.title || '',
    description: (info.basic_info?.short_description || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
    thumbnail,
    captionTrackCount: info.captions?.caption_tracks?.length || 0,
  };
}
async function youtubeOembed(videoUrl) {
  const r = await fetchWithTimeout('https://www.youtube.com/oembed?url=' + encodeURIComponent(videoUrl) + '&format=json', {}, 7000);
  if (!r.ok) throw new Error('YouTube oEmbed failed with status ' + r.status);
  const data = await r.json();
  return {
    title: data.title || '',
    author: data.author_name || '',
    thumbnail: data.thumbnail_url || '',
  };
}
async function youtubeDataApiMetadata(videoId) {
  if (!process.env.YOUTUBE_API_KEY) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  const r = await fetchWithTimeout(url, {}, 7000);
  if (!r.ok) throw new Error('YouTube Data API failed with status ' + r.status);
  const data = await r.json();
  const snippet = data.items?.[0]?.snippet;
  if (!snippet) return null;
  return {
    title: snippet.title || '',
    description: (snippet.description || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
    thumbnail: snippet.thumbnails?.maxres?.url ||
      snippet.thumbnails?.standard?.url ||
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      '',
  };
}

function extractYouTubeVideoId(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((part) => ['shorts', 'embed', 'live', 'v'].includes(part));
      if (marker >= 0 && parts[marker + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[marker + 1])) return parts[marker + 1];
    }
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {}
  const loose = value.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/);
  return loose ? loose[1] : '';
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: !!process.env.DATABASE_URL }));

app.get('/api/auth/session', async (req, res) => {
  try {
    const user = await currentUser(req);
    res.json({ user: publicUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const email = normalizeEmail(req.body.email);
    const displayName = String(req.body.displayName || '').trim().slice(0, 120);
    const password = String(req.body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < PASSWORD_MIN_LENGTH) return res.status(400).json({ error: 'Use a password with at least 6 characters.' });
    if (isConfiguredMasterEmail(email) && !verifyConfiguredMasterPassword(password)) {
      return res.status(403).json({ error: 'This email is reserved for the RecipeBox master admin.' });
    }
    const exists = await db.query('SELECT user_id FROM profiles WHERE email=$1', [email]);
    if (exists.rows[0]) return res.status(409).json({ error: 'An account already exists for that email. Sign in with your password.' });
    const userId = crypto.randomUUID();
    const role = isConfiguredMasterEmail(email) ? 'master_admin' : 'user';
    const verified = role === 'master_admin'; // master admin is pre-verified
    await db.query(
      `INSERT INTO profiles(user_id, email, display_name, role, password_hash, email_verified, email_verified_at)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [userId, email, displayName, role, hashPassword(password), verified, verified ? new Date() : null]
    );
    if (Array.isArray(req.body.recipes) && req.body.recipes.length) await replaceUserRecipes(userId, req.body.recipes);
    if (req.body.mealPlan && typeof req.body.mealPlan === 'object') await replaceUserMealPlan(userId, req.body.mealPlan);
    // Welcome AI Assists for a new (non-master) account — one-time bonus grant
    // that never expires. Best-effort; never blocks signup.
    if (role !== 'master_admin' && FREE_WELCOME_ASSISTS > 0) {
      try { await grantCredits(userId, 'bonus', FREE_WELCOME_ASSISTS, 'welcome', 'signup welcome assists', 'system'); } catch {}
    }
    await createSession(req, res, userId);
    clearAuthLimit(req);
    if (!verified) await issueVerificationEmail(db, req, userId, email); // best-effort
    res.json({ ok: true, user: { id: userId, email, displayName, role, isMasterAdmin: role === 'master_admin', emailVerified: verified } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    await ensureConfiguredMasterAdmin(db);
    const email = normalizeEmail(req.body.email);
    const result = await db.query('SELECT user_id, email, display_name, role, password_hash, email_verified FROM profiles WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Email or password did not match.' });
    if (isConfiguredMasterEmail(email) && user.role !== 'master_admin') {
      await db.query("UPDATE profiles SET role='master_admin', updated_at=now() WHERE user_id=$1", [user.user_id]);
      user.role = 'master_admin';
    }
    await createSession(req, res, user.user_id);
    clearAuthLimit(req);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/request-password-reset', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(503).json({ error: 'Password reset requires DATABASE_URL to be configured.' });
    if (!process.env.RESEND_API_KEY) return res.status(503).json({ error: 'Password reset email is not configured yet.' });
    const email = normalizeEmail(req.body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: true });
    const result = await db.query('SELECT user_id, email FROM profiles WHERE email=$1', [email]);
    const user = result.rows[0];
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      await db.query(
        `INSERT INTO password_reset_tokens(token_hash, user_id, expires_at)
         VALUES($1, $2, now() + ($3::text || ' minutes')::interval)`,
        [hashToken(token), user.user_id, RESET_TOKEN_MINUTES]
      );
      const resetUrl = `${trustedAppOrigin(req)}/?reset=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }
    clearAuthLimit(req);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (password.length < PASSWORD_MIN_LENGTH) return res.status(400).json({ error: 'Use a password with at least 6 characters.' });
    const result = await db.query(
      `SELECT token_hash, user_id
       FROM password_reset_tokens
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    const reset = result.rows[0];
    if (!reset) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    await db.query('BEGIN');
    try {
      await db.query('UPDATE profiles SET password_hash=$1, updated_at=now() WHERE user_id=$2', [hashPassword(password), reset.user_id]);
      await db.query('UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1', [reset.token_hash]);
      await db.query('DELETE FROM account_sessions WHERE user_id=$1', [reset.user_id]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
    clearAuthLimit(req);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Confirm an email address from the link. Hashed, single-use, expiring token.
// Returns only ok/verified — no account data. Rate-limited; non-enumerating
// (an invalid/expired token returns the same generic message regardless).
app.post('/api/auth/verify-email', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const token = String(req.body.token || '');
    const result = await db.query(
      `SELECT token_hash, user_id FROM email_verification_tokens
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    const row = result.rows[0];
    if (!row) return res.status(400).json({ error: 'This confirmation link is invalid or has expired. Request a new one from Settings.' });
    await db.query('BEGIN');
    try {
      await db.query('UPDATE email_verification_tokens SET used_at=now() WHERE token_hash=$1', [row.token_hash]);
      await db.query('UPDATE profiles SET email_verified=true, email_verified_at=now(), updated_at=now() WHERE user_id=$1', [row.user_id]);
      // Invalidate any other outstanding tokens for this user.
      await db.query('UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [row.user_id]);
      await db.query('COMMIT');
    } catch (err) { await db.query('ROLLBACK'); throw err; }
    clearAuthLimit(req);
    res.json({ ok: true, verified: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Resend a verification email to the signed-in user (rate-limited).
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'sign in required' });
    if (user.email_verified !== false) return res.json({ ok: true, alreadyVerified: true });
    const sent = await issueVerificationEmail(db, req, user.user_id, user.email);
    clearAuthLimit(req);
    res.json({ ok: true, sent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'sign in required' });
    const currentPassword = String(req.body.currentPassword || '');
    const nextPassword = String(req.body.newPassword || '');
    if (nextPassword.length < PASSWORD_MIN_LENGTH) return res.status(400).json({ error: 'Use a password with at least 6 characters.' });
    const result = await db.query('SELECT user_id, password_hash FROM profiles WHERE user_id=$1', [user.user_id]);
    const profile = result.rows[0];
    if (!profile || !verifyPassword(currentPassword, profile.password_hash)) return res.status(401).json({ error: 'Current password did not match.' });
    const token = parseCookies(req)[SESSION_COOKIE];
    const tokenHash = token ? hashToken(token) : '';
    await db.query('BEGIN');
    try {
      await db.query('UPDATE profiles SET password_hash=$1, updated_at=now() WHERE user_id=$2', [hashPassword(nextPassword), user.user_id]);
      await db.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.user_id]);
      if (tokenHash) {
        await db.query('DELETE FROM account_sessions WHERE user_id=$1 AND token_hash<>$2', [user.user_id, tokenHash]);
      } else {
        await db.query('DELETE FROM account_sessions WHERE user_id=$1', [user.user_id]);
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
    clearAuthLimit(req);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/signout', async (req, res) => {
  try {
    const db = await getPool();
    const token = parseCookies(req)[SESSION_COOKIE];
    if (db && token) await db.query('DELETE FROM account_sessions WHERE token_hash=$1', [hashToken(token)]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/delete-account', async (req, res) => {
  try {
    if (!(await checkAuthLimit(req, res))) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'sign in required' });
    const result = await db.query('SELECT user_id, password_hash FROM profiles WHERE user_id=$1', [user.user_id]);
    const profile = result.rows[0];
    if (!profile || !verifyPassword(req.body.password, profile.password_hash)) return res.status(401).json({ error: 'Password did not match.' });
    await db.query('BEGIN');
    try {
      await db.query('DELETE FROM recipes WHERE user_id=$1', [user.user_id]);
      await db.query('DELETE FROM meal_plans WHERE user_id=$1', [user.user_id]);
      await db.query('DELETE FROM user_settings WHERE user_id=$1', [user.user_id]);
      await db.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.user_id]);
      await db.query('DELETE FROM account_sessions WHERE user_id=$1', [user.user_id]);
      await db.query('DELETE FROM profiles WHERE user_id=$1', [user.user_id]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
    clearAuthLimit(req);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/migrate', async (req, res) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'sign in required' });
    const incoming = Array.isArray(req.body.recipes) ? req.body.recipes : [];
    const existing = await readUserRecipes(user.user_id);
    const byKey = new Map();
    existing.concat(incoming).forEach((recipe) => {
      const key = recipe?.id || `${recipe?.title || 'Untitled'}|${recipe?.createdAt || ''}`;
      byKey.set(key, recipe);
    });
    const merged = Array.from(byKey.values());
    await replaceUserRecipes(user.user_id, merged);
    if (req.body.mealPlan && typeof req.body.mealPlan === 'object') await replaceUserMealPlan(user.user_id, req.body.mealPlan);
    res.json({ ok: true, recipes: merged, mealPlan: await readUserMealPlan(user.user_id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/recipes', async (req, res) => {
  try {
    const user = await currentUser(req);
    if (user) {
      const own = await readUserRecipes(user.user_id);
      const shared = await readHouseholdSharedRecipes(user.user_id);
      return res.json([...own, ...shared]);
    }
    if (process.env.ALLOW_SHARED_GUEST_STORE === '1') return res.json(await readStore('recipes', []));
    res.json([]);
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/recipes', async (req, res) => {
  try {
    if (!Array.isArray(req.body.recipes)) return res.status(400).json({ error: 'recipes must be an array' });
    const user = await currentUser(req);
    if (user) {
      // Defense: never persist another member's shared recipe into this user's
      // row (the client also filters, but the server is authoritative).
      const own = req.body.recipes.filter((r) => r && !r.householdShared);
      const saved = await replaceUserRecipes(user.user_id, own);
      await logUserActivity(user, 'recipes_saved', { count: own.length });
      return res.json({ ok: true, savedToDatabase: saved, account: true });
    }
    if (process.env.ALLOW_SHARED_GUEST_STORE === '1') {
      const saved = await writeStore('recipes', req.body.recipes);
      return res.json({ ok: true, savedToDatabase: saved, account: false });
    }
    res.json({ ok: true, savedToDatabase: false, guest: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/mealplan', async (req, res) => {
  try {
    const user = await currentUser(req);
    if (user) return res.json(await readUserMealPlan(user.user_id));
    if (process.env.ALLOW_SHARED_GUEST_STORE === '1') return res.json(await readStore('mealplan', {}));
    res.json({});
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/mealplan', async (req, res) => {
  try {
    const user = await currentUser(req);
    if (user) {
      const saved = await replaceUserMealPlan(user.user_id, req.body.mealPlan || {});
      await logUserActivity(user, 'meal_plan_saved', { plannedCount: Object.values(req.body.mealPlan || {}).flat().length });
      return res.json({ ok: true, savedToDatabase: saved, account: true });
    }
    if (process.env.ALLOW_SHARED_GUEST_STORE === '1') {
      const saved = await writeStore('mealplan', req.body.mealPlan || {});
      return res.json({ ok: true, savedToDatabase: saved, account: false });
    }
    res.json({ ok: true, savedToDatabase: false, guest: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/feedback', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const type = String(req.body?.type || 'general').trim().toLowerCase();
    const allowedTypes = new Set(['general', 'bug', 'idea', 'confusing', 'import']);
    const cleanType = allowedTypes.has(type) ? type : 'general';
    const message = String(req.body?.message || '').trim();
    if (message.length < 8) return res.status(400).json({ error: 'Tell us a little more before sending feedback.' });
    if (message.length > 4000) return res.status(400).json({ error: 'Feedback is too long. Please keep it under 4000 characters.' });
    const page = String(req.body?.page || '').slice(0, 120);
    const device = String(req.body?.device || '').slice(0, 240);
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    const result = await db.query(
      `INSERT INTO user_feedback(user_id, type, message, page, device, metadata)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING id, created_at`,
      [req.user.user_id, cleanType, message, page, device, JSON.stringify(metadata)]
    );
    await logUserActivity(req.user, 'feedback_submitted', { type: cleanType, feedbackId: result.rows[0].id });
    res.json({ ok: true, id: result.rows[0].id, createdAt: result.rows[0].created_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/users', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const search = String(req.query.search || '').trim().toLowerCase();
    const tier = String(req.query.tier || 'all').trim().toLowerCase();
    const validTiers = new Set(['all', 'free', 'beta', 'plus', 'paid', 'admin', 'master_admin']);
    const cleanTier = validTiers.has(tier) ? tier : 'all';
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(lower(p.email) LIKE $${params.length} OR lower(coalesce(p.display_name,'')) LIKE $${params.length})`);
    }
    if (cleanTier !== 'all') {
      if (cleanTier === 'admin' || cleanTier === 'master_admin') {
        where.push("p.role='master_admin'");
      } else if (cleanTier === 'paid') {
        params.push(DEFAULT_PLAN);
        where.push(`coalesce(e.plan, $${params.length})='plus'`);
      } else {
        params.push(cleanTier);
        where.push(`coalesce(e.plan, '${DEFAULT_PLAN}')=$${params.length}`);
      }
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const usersResult = await db.query(
      `SELECT
         p.user_id,
         p.email,
         p.display_name,
         p.role,
         p.created_at,
         p.last_active_at,
         coalesce(e.plan, CASE WHEN p.role='master_admin' THEN 'master_admin' ELSE '${DEFAULT_PLAN}' END) AS plan,
         coalesce(e.subscription_status, CASE WHEN p.role='master_admin' THEN 'master_admin' ELSE '${DEFAULT_PLAN}' END) AS subscription_status,
         coalesce(r.recipe_count, 0)::int AS recipe_count,
         coalesce(mp.planned_count, 0)::int AS planned_count,
         coalesce(ai.ai_count, 0)::int AS ai_usage_count,
         coalesce(ai.import_count, 0)::int AS import_count,
         coalesce(ai.repair_count, 0)::int AS repair_count,
         coalesce(ai.failed_count, 0)::int AS failed_count,
         coalesce(ai.provider_cost, 0)::numeric AS provider_cost_usd,
         coalesce(act.activity_count, 0)::int AS activity_count,
         coalesce(fb.feedback_count, 0)::int AS feedback_count
       FROM profiles p
       LEFT JOIN user_entitlements e ON e.user_id = p.user_id
       LEFT JOIN (
         SELECT user_id, count(*) AS recipe_count
         FROM recipes
         GROUP BY user_id
       ) r ON r.user_id = p.user_id
       LEFT JOIN (
         SELECT user_id, coalesce(sum(jsonb_array_length(value)),0) AS planned_count
         FROM meal_plans, jsonb_each(plan_json)
         GROUP BY user_id
       ) mp ON mp.user_id = p.user_id
       LEFT JOIN (
         SELECT user_id,
                count(*) AS ai_count,
                count(*) FILTER (WHERE feature='import') AS import_count,
                count(*) FILTER (WHERE feature='repair') AS repair_count,
                count(*) FILTER (WHERE success=false) AS failed_count,
                coalesce(sum(estimated_cost_usd), 0) AS provider_cost
         FROM ai_usage_events
         GROUP BY user_id
       ) ai ON ai.user_id = p.user_id
       LEFT JOIN (
         SELECT user_id, count(*) AS activity_count
         FROM user_activity
         GROUP BY user_id
       ) act ON act.user_id = p.user_id
       LEFT JOIN (
         SELECT user_id, count(*) AS feedback_count
         FROM user_feedback
         GROUP BY user_id
       ) fb ON fb.user_id = p.user_id
       ${whereSql}
       ORDER BY coalesce(p.last_active_at, p.created_at) DESC
       LIMIT 120`,
      params
    );
    const summaryResult = await db.query(
      `SELECT
         count(*)::int AS total_users,
         count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS new_signups,
         count(*) FILTER (WHERE last_active_at >= now() - interval '7 days')::int AS active_7,
         count(*) FILTER (WHERE last_active_at >= now() - interval '30 days')::int AS active_30
       FROM profiles`
    );
    res.json({
      summary: {
        totalUsers: summaryResult.rows[0]?.total_users || 0,
        newSignups: summaryResult.rows[0]?.new_signups || 0,
        active7: summaryResult.rows[0]?.active_7 || 0,
        active30: summaryResult.rows[0]?.active_30 || 0,
      },
      users: usersResult.rows.map((row) => ({
        id: row.user_id,
        email: row.email,
        displayName: row.display_name || '',
        role: row.role,
        tier: row.role === 'master_admin' ? 'admin' : row.plan,
        subscriptionStatus: row.subscription_status,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        recipeCount: row.recipe_count,
        plannedCount: row.planned_count,
        aiUsageCount: row.ai_usage_count,
        importCount: row.import_count,
        repairCount: row.repair_count,
        failedAiCount: row.failed_count,
        providerCostUsd: Number(row.provider_cost_usd || 0),
        feedbackCount: row.feedback_count,
        activityCount: row.activity_count,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/users/:id/entitlement', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const plan = String(req.body?.plan || '').trim().toLowerCase();
    if (!['free', 'beta', 'plus', 'family', 'founder'].includes(plan)) return res.status(400).json({ error: 'Plan must be free, beta, plus, family, or founder.' });
    const target = await db.query('SELECT user_id, role FROM profiles WHERE user_id=$1', [req.params.id]);
    if (!target.rows[0]) return res.status(404).json({ error: 'user not found' });
    if (target.rows[0].role === 'master_admin') return res.status(400).json({ error: 'Master admin tier cannot be changed here.' });
    const limits = PLAN_ENTITLEMENTS[plan] || PLAN_ENTITLEMENTS.beta;
    await db.query(
      `INSERT INTO user_entitlements(user_id, plan, subscription_status, ai_monthly_limit, ai_daily_limit, import_daily_limit, adjust_daily_limit, pantry_daily_limit, updated_by, metadata, updated_at)
       VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
       ON CONFLICT(user_id) DO UPDATE SET
         plan=EXCLUDED.plan,
         subscription_status=EXCLUDED.subscription_status,
         ai_monthly_limit=EXCLUDED.ai_monthly_limit,
         ai_daily_limit=EXCLUDED.ai_daily_limit,
         import_daily_limit=EXCLUDED.import_daily_limit,
         adjust_daily_limit=EXCLUDED.adjust_daily_limit,
         pantry_daily_limit=EXCLUDED.pantry_daily_limit,
         updated_by=EXCLUDED.updated_by,
         metadata=EXCLUDED.metadata,
         updated_at=now()`,
      [req.params.id, plan, limits.aiMonthlyLimit, limits.aiDailyLimit, limits.importDailyLimit, limits.adjustDailyLimit, limits.pantryDailyLimit, req.user.user_id, JSON.stringify({ changedFromAppControl: true })]
    );
    await logUserActivity(req.user, 'admin_user_tier_changed', { targetUserId: req.params.id, plan });
    res.json({ ok: true, userId: req.params.id, plan });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Master-admin: grant bonus/purchased AI credits to a user (until billing is
// wired). Writes the ledger; never expires. Lets the admin honor founder
// conversions, referral bonuses, or comped credit packs manually.
app.post('/api/admin/credits/grant', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.status(503).json({ error: 'Database unavailable.' });
    const userId = String(req.body?.userId || '').trim();
    const bucket = String(req.body?.bucket || 'bonus').trim().toLowerCase();
    const amount = Math.round(Number(req.body?.amount));
    const kind = ['purchase', 'referral_bonus', 'admin_grant'].includes(req.body?.kind) ? req.body.kind : 'admin_grant';
    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    if (!['bonus', 'purchased'].includes(bucket)) return res.status(400).json({ error: 'bucket must be bonus or purchased.' });
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) return res.status(400).json({ error: 'amount must be a non-zero integer.' });
    const target = await db.query('SELECT user_id FROM profiles WHERE user_id=$1', [userId]);
    if (!target.rows[0]) return res.status(404).json({ error: 'user not found' });
    await grantCredits(userId, bucket, amount, kind, String(req.body?.reason || 'admin grant').slice(0, 240), req.user.user_id);
    await logUserActivity(req.user, 'admin_credits_granted', { targetUserId: userId, bucket, amount, kind });
    res.json({ ok: true, userId, bucket, amount, balances: await readLedgerBalances(userId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/app-control/meta', requireAuth, requireMasterAdmin, async (req, res) => {
  let newFeedback = 0;
  try {
    const db = await getPool();
    if (db) {
      const r = await db.query(`SELECT count(*)::int AS n FROM user_feedback WHERE status='new'`);
      newFeedback = r.rows[0]?.n || 0;
    }
  } catch {}
  res.json({
    user: publicUser(req.user),
    sections: ADMIN_SECTION_NAMES,
    categories: ADMIN_KB_CATEGORIES,
    features: ADMIN_FEATURES,
    scopeTypes: ADMIN_SCOPE_TYPES,
    whatsNextSync: { configured: false, status: 'not_configured' },
    newFeedback,
  });
});

// Master-admin-only feedback inbox. Beta feedback is captured into user_feedback
// (write-only until now); these endpoints let the admin read it and triage status.
app.get('/api/admin/feedback', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.json({ unread: 0, total: 0, items: [] });
    const items = await db.query(
      `SELECT f.id, f.type, f.message, f.page, f.device, f.status, f.created_at,
              p.email, p.display_name
         FROM user_feedback f
         LEFT JOIN profiles p ON p.user_id = f.user_id
        ORDER BY (f.status = 'new') DESC, f.created_at DESC
        LIMIT 200`
    );
    const counts = await db.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='new')::int AS unread FROM user_feedback`
    );
    res.json({
      unread: counts.rows[0]?.unread || 0,
      total: counts.rows[0]?.total || 0,
      items: items.rows.map((row) => ({
        id: row.id,
        type: row.type,
        message: row.message,
        page: row.page || '',
        device: row.device || '',
        status: row.status,
        createdAt: row.created_at,
        email: row.email || '',
        displayName: row.display_name || '',
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/feedback/:id/status', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.status(503).json({ error: 'Database unavailable.' });
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['new', 'reviewed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const result = await db.query('UPDATE user_feedback SET status=$2 WHERE id=$1 RETURNING id, status', [req.params.id, status]);
    if (!result.rows.length) return res.status(404).json({ error: 'Feedback not found.' });
    await logUserActivity(req.user, 'admin_feedback_status', { feedbackId: req.params.id, status });
    res.json({ ok: true, id: result.rows[0].id, status: result.rows[0].status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Master-admin AI usage dashboard: real consumption to tune the tier credit
// numbers from beta data before launch. Read-only aggregation; no PII beyond
// the admin's own user list (email already visible to the admin).
app.get('/api/admin/ai-usage-summary', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.json({ period: currentAiPeriod(), totals: {}, allTime: {}, byFeature: [], daily: [], topUsers: [], perUser: {} });
    const period = currentAiPeriod();
    const totalsSql = (where) => `SELECT
        count(*)::int AS calls,
        count(*) FILTER (WHERE feature <> 'repair')::int AS billable,
        count(*) FILTER (WHERE feature = 'repair')::int AS repair,
        count(*) FILTER (WHERE success = false)::int AS failed,
        COALESCE(sum(estimated_cost_usd), 0)::numeric AS cost
      FROM ai_usage_events ${where}`;
    const [win, all, feat, daily, top, per] = await Promise.all([
      db.query(totalsSql("WHERE created_at >= now() - interval '30 days'")),
      db.query(totalsSql('')),
      db.query(`SELECT feature, count(*)::int AS calls, COALESCE(sum(estimated_cost_usd),0)::numeric AS cost
                FROM ai_usage_events WHERE created_at >= now() - interval '30 days'
                GROUP BY feature ORDER BY calls DESC`),
      db.query(`SELECT to_char(created_at::date,'YYYY-MM-DD') AS day, count(*)::int AS calls,
                count(*) FILTER (WHERE feature <> 'repair')::int AS billable
                FROM ai_usage_events WHERE created_at >= now() - interval '14 days'
                GROUP BY day ORDER BY day`),
      db.query(`SELECT e.user_id, p.email, p.display_name,
                count(*) FILTER (WHERE e.feature <> 'repair')::int AS billable,
                COALESCE(sum(e.estimated_cost_usd),0)::numeric AS cost
                FROM ai_usage_events e LEFT JOIN profiles p ON p.user_id = e.user_id
                WHERE to_char(e.created_at,'YYYY-MM') = $1
                GROUP BY e.user_id, p.email, p.display_name
                ORDER BY billable DESC LIMIT 12`, [period]),
      db.query(`SELECT COALESCE(AVG(c),0)::numeric AS avg_billable, COALESCE(MAX(c),0)::int AS max_billable, count(*)::int AS active_users
                FROM (SELECT user_id, count(*) FILTER (WHERE feature <> 'repair') AS c
                      FROM ai_usage_events WHERE to_char(created_at,'YYYY-MM') = $1
                      GROUP BY user_id) t WHERE c > 0`, [period]),
    ]);
    const num = (row) => ({ calls: row.calls || 0, billable: row.billable || 0, repair: row.repair || 0, failed: row.failed || 0, cost: Number(row.cost || 0) });
    res.json({
      period,
      totals: num(win.rows[0] || {}),
      allTime: num(all.rows[0] || {}),
      byFeature: feat.rows.map((r) => ({ feature: r.feature, calls: r.calls, cost: Number(r.cost || 0) })),
      daily: daily.rows.map((r) => ({ day: r.day, calls: r.calls, billable: r.billable })),
      topUsers: top.rows.map((r) => ({ email: r.email || '', displayName: r.display_name || '', billable: r.billable, cost: Number(r.cost || 0) })),
      perUser: { avgBillable: Number(per.rows[0]?.avg_billable || 0), maxBillable: per.rows[0]?.max_billable || 0, activeUsers: per.rows[0]?.active_users || 0 },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/knowledge', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.query(
      `SELECT *
       FROM app_control_sources
       ORDER BY active DESC, priority DESC, updated_at DESC`
    );
    res.json({ sources: result.rows.map(sourceRowToJson) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/knowledge', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const input = validateKnowledgeInput(req.body || {});
    const id = String(req.body.id || crypto.randomUUID()).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || crypto.randomUUID();
    const existing = await db.query('SELECT id FROM app_control_sources WHERE id=$1', [id]);
    if (existing.rows[0]) return res.status(409).json({ error: 'A source with that id already exists.' });
    const result = await db.query(
      `INSERT INTO app_control_sources(id, title, category, content, use_when, scope_type, scope_value, applies_to_features, priority, active, created_by, updated_by, source_origin)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$11,$12)
       RETURNING *`,
      [id, input.title, input.category, input.content, input.useWhen, input.scopeType, input.scopeValue, JSON.stringify(input.appliesToFeatures), input.priority, input.active, req.user.user_id, input.sourceOrigin]
    );
    const nextValue = sourceRowToJson(result.rows[0]);
    await logAppControlChange(db, id, 'create', req.user, null, nextValue, 'Created from App Control.');
    res.json({ ok: true, source: nextValue });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/admin/knowledge/:id', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const current = await db.query('SELECT * FROM app_control_sources WHERE id=$1', [req.params.id]);
    const previous = sourceRowToJson(current.rows[0]);
    if (!previous) return res.status(404).json({ error: 'source not found' });
    const input = validateKnowledgeInput(req.body || {}, previous);
    const result = await db.query(
      `UPDATE app_control_sources
       SET title=$2, category=$3, content=$4, use_when=$5, scope_type=$6, scope_value=$7,
           applies_to_features=$8::jsonb, priority=$9, active=$10, updated_by=$11,
           updated_at=now(), version=version + 1, source_origin=$12
       WHERE id=$1
       RETURNING *`,
      [req.params.id, input.title, input.category, input.content, input.useWhen, input.scopeType, input.scopeValue, JSON.stringify(input.appliesToFeatures), input.priority, input.active, req.user.user_id, input.sourceOrigin]
    );
    const nextValue = sourceRowToJson(result.rows[0]);
    await logAppControlChange(db, req.params.id, 'update', req.user, previous, nextValue, 'Updated from App Control.');
    res.json({ ok: true, source: nextValue });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/admin/knowledge/:id', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const current = await db.query('SELECT * FROM app_control_sources WHERE id=$1', [req.params.id]);
    const previous = sourceRowToJson(current.rows[0]);
    if (!previous) return res.status(404).json({ error: 'source not found' });
    const result = await db.query(
      `UPDATE app_control_sources
       SET active=false, updated_by=$2, updated_at=now(), version=version + 1
       WHERE id=$1
       RETURNING *`,
      [req.params.id, req.user.user_id]
    );
    const nextValue = sourceRowToJson(result.rows[0]);
    await logAppControlChange(db, req.params.id, 'deactivate', req.user, previous, nextValue, 'Deactivated from App Control.');
    res.json({ ok: true, source: nextValue });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/change-log', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.query(
      `SELECT *
       FROM app_control_change_log
       ORDER BY changed_at DESC
       LIMIT 80`
    );
    res.json({ changes: result.rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      action: row.action,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
      previousValue: row.previous_value,
      nextValue: row.next_value,
      note: row.note,
    })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/change-log/:id/rollback', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const change = await db.query('SELECT * FROM app_control_change_log WHERE id=$1', [req.params.id]);
    const row = change.rows[0];
    if (!row || !row.source_id || !row.previous_value) return res.status(400).json({ error: 'This change cannot be rolled back.' });
    const previous = validateKnowledgeInput(row.previous_value);
    const current = await db.query('SELECT * FROM app_control_sources WHERE id=$1', [row.source_id]);
    const currentValue = sourceRowToJson(current.rows[0]);
    const result = await db.query(
      `UPDATE app_control_sources
       SET title=$2, category=$3, content=$4, use_when=$5, scope_type=$6, scope_value=$7,
           applies_to_features=$8::jsonb, priority=$9, active=$10, updated_by=$11,
           updated_at=now(), version=version + 1, source_origin=$12
       WHERE id=$1
       RETURNING *`,
      [row.source_id, previous.title, previous.category, previous.content, previous.useWhen, previous.scopeType, previous.scopeValue, JSON.stringify(previous.appliesToFeatures), previous.priority, previous.active, req.user.user_id, previous.sourceOrigin]
    );
    const nextValue = sourceRowToJson(result.rows[0]);
    await logAppControlChange(db, row.source_id, 'rollback', req.user, currentValue, nextValue, `Rolled back change ${req.params.id}.`);
    res.json({ ok: true, source: nextValue });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/admin/whatsnext-sync', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    await logAppControlChange(db, 'whatsnext-sync', 'sync_requested', req.user, null, { status: 'not_configured' }, 'WhatsNext sync requested, but no integration endpoint is configured yet.');
    res.status(501).json({ error: 'WhatsNext sync is not configured yet.', configured: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Turn fetched HTML into the /api/fetch-url payload: structured-data recipe,
// jsonLd, title, hero image, helpful links, readable text, and a `blocked` flag.
// Pure (string in -> object out) so it can run on either the direct fetch or the
// scraping-proxy fallback, and be unit-tested offline.
function buildPageResult(html, finalUrl, target) {
  const jsonLd = parseJsonLd(html);
  const title = matchAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, ' ').trim();
  const image = bestImage(target, html, jsonLd);
  const helpfulLinks = extractHelpfulLinks(finalUrl || target, html);
  const text = cleanText(html).slice(0, 18000);
  let recipe = null, extractComplete = false, extractSource = null;
  try {
    const ex = RecipeBoxExtract.extractFromHtml(html, { url: finalUrl || target });
    if (ex && ex.recipe) {
      recipe = ex.recipe; extractComplete = !!ex.complete; extractSource = ex.source;
      if (!recipe.heroImage && image) recipe.heroImage = image;
    }
  } catch (e) { /* deterministic extraction is best-effort */ }
  const blocked = looksBlockedPage({ title, text, hasRecipe: !!recipe });
  return { title, image, jsonLd, text, helpfulLinks, recipe, extractComplete, extractSource, blocked, htmlHash: crypto.createHash('sha256').update(html).digest('hex') };
}

// Proxy-fetch request builders. Both return the page's RAW HTML (including
// <script type="ld+json">), so our deterministic structured-data extractor still
// runs on bot-blocked sites — keeping those imports publisher-accurate and free
// of an AI Assist. No JS render is needed (recipe JSON-LD is in the server HTML).

// Jina Reader (https://r.jina.ai) — free, keyless (rate-limited; an optional
// JINA_API_KEY raises limits). Takes the full target URL appended to its host;
// X-Return-Format: html returns the page HTML (set at call time).
function jinaRequestUrl(target) {
  return 'https://r.jina.ai/' + target;
}

// ScraperAPI — paid; returns raw HTML through a residential/premium proxy.
function scraperRequestUrl(target, opts) {
  opts = opts || {};
  const params = new URLSearchParams({ api_key: opts.key || '', url: target, render: 'false' });
  const tier = opts.tier || 'premium';
  if (tier === 'premium') params.set('premium', 'true');
  else if (tier === 'ultra') params.set('ultra_premium', 'true');
  return 'https://api.scraperapi.com/?' + params.toString();
}

// Fallback fetch through a reader/scraping proxy when a direct fetch was
// bot-blocked. Provider via IMPORT_PROXY_PROVIDER: 'jina' (default, free) |
// 'scraperapi' (needs SCRAPER_API_KEY) | 'none' (disable). Gated by a daily cap
// so a runaway loop can't hammer the proxy/burn credits. Only ever called for an
// already-validated public target we couldn't read directly. Returns HTML or null.
async function fetchViaProxy(target) {
  const provider = String(process.env.IMPORT_PROXY_PROVIDER || 'jina').toLowerCase();
  if (provider === 'none') return null;
  const cap = Number(process.env.IMPORT_PROXY_DAILY_CAP || process.env.SCRAPER_DAILY_CAP || 500);
  const allowance = await checkRateLimit('proxy:global', 'fetch', cap, 'day');
  if (!allowance.allowed) return null;
  try {
    if (provider === 'scraperapi') {
      if (!process.env.SCRAPER_API_KEY) return null;
      const endpoint = scraperRequestUrl(target, { key: process.env.SCRAPER_API_KEY, tier: process.env.SCRAPER_PROXY_TIER || 'premium' });
      const r = await fetchWithTimeout(endpoint, { headers: { 'Accept': 'text/html,application/xhtml+xml' } }, 30000);
      if (!r.ok) return null;
      return (await readBodyCapped(r)) || null;
    }
    // Default: Jina Reader, asking for HTML so JSON-LD survives.
    const headers = { 'X-Return-Format': 'html', 'Accept': 'text/html' };
    if (process.env.JINA_API_KEY) headers['Authorization'] = 'Bearer ' + process.env.JINA_API_KEY;
    const r = await fetchWithTimeout(jinaRequestUrl(target), { headers }, 30000);
    if (!r.ok) return null;
    return (await readBodyCapped(r)) || null;
  } catch (e) { return null; }
}

app.get('/api/fetch-url', async (req, res) => {
  const target = req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) return res.status(400).json({ error: 'bad url' });
  try {
    const r = await safeFetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    }, 9000);
    const contentType = String(r.headers.get('content-type') || '');
    if (contentType && !/text\/html|application\/(xhtml|xml)|text\/plain/i.test(contentType)) {
      return res.status(422).json({ error: 'That link is not a readable recipe page. Paste the recipe text or upload a screenshot instead.', url: target, finalUrl: r.url, sourceQuality: 'blocked' });
    }
    const html = await readBodyCapped(r);
    if (html === null) {
      return res.status(422).json({ error: 'This page is too large to read automatically. Try Paste Text or screenshots instead.', url: target, finalUrl: r.url, sourceQuality: 'blocked' });
    }
    const finalUrl = r.url || target;
    // Deterministic-first: extract schema.org/microdata here with no AI. When the
    // page is bot-blocked (big publishers serve a JS-challenge/consent stub to
    // datacenter IPs), retry once through the scraping-proxy fallback, which
    // returns the real HTML so deterministic extraction still applies. The retry
    // is a no-op unless SCRAPER_API_KEY is set.
    let result = buildPageResult(html, finalUrl, target);
    let via = 'direct';
    if (result.blocked) {
      const proxiedHtml = await fetchViaProxy(target);
      if (proxiedHtml) {
        const retry = buildPageResult(proxiedHtml, finalUrl, target);
        if (!retry.blocked) { result = retry; via = 'proxy'; }
      }
    }
    if (result.blocked) {
      return res.status(422).json({
        error: 'RecipeBox could not read this recipe page — the site is blocking automated access. Use Paste Text (copy the recipe) or upload a screenshot instead.',
        url: target,
        finalUrl,
        title: result.title,
        sourceQuality: 'blocked',
      });
    }
    res.json({ url: target, finalUrl, via, title: result.title, image: result.image, jsonLd: result.jsonLd, text: result.text, helpfulLinks: result.helpfulLinks, recipe: result.recipe, extractComplete: result.extractComplete, extractSource: result.extractSource, htmlHash: result.htmlHash });
  } catch (err) {
    if (err && err.ssrf) {
      return res.status(400).json({ error: 'That link can’t be imported. Enter a public recipe URL, or use Paste Text or screenshots.', url: target, sourceQuality: 'blocked' });
    }
    if (isAbortError(err)) {
      return res.status(504).json({ error: 'That recipe site took too long to respond. Try again, or use Paste Text or screenshots.', url: target, sourceQuality: 'blocked' });
    }
    res.status(502).json({ error: 'RecipeBox could not reach that page. Check the link, or try Paste Text or screenshots.', url: target, sourceQuality: 'blocked' });
  }
});

app.get('/api/fetch-social', async (req, res) => {
  const target = req.query.url;
  const debug = req.query.debug === '1';
  if (!target || !/^https?:\/\//i.test(target)) {
    const payload = { error: 'bad url', platform: 'unknown', url: target || '', warnings: ['Enter a full public TikTok, Instagram, or Facebook URL.'], sourceQuality: 'low' };
    if (debug) payload.debug = { platform: 'unknown', url: target || '', title: '', descriptionLength: 0, captionLength: 0, textLength: 0, imageFound: false, oEmbedStatus: null, warnings: payload.warnings, sourceQuality: payload.sourceQuality };
    return res.status(400).json(payload);
  }
  const platform = detectSocialPlatform(target);
  const warnings = [];
  if (platform === 'unknown') {
    const payload = { error: 'unsupported platform', platform, url: target, warnings: ['RecipeBox Social Link currently supports public TikTok, Instagram, and Facebook posts.'], sourceQuality: 'low' };
    if (debug) payload.debug = { platform, url: target, title: '', descriptionLength: 0, captionLength: 0, textLength: 0, imageFound: false, oEmbedStatus: null, warnings: payload.warnings, sourceQuality: 'low' };
    return res.status(400).json(payload);
  }

  let finalUrl = target;
  let title = '';
  let author = '';
  let description = '';
  let caption = '';
  let text = '';
  let image = '';
  let thumbnail = '';
  let embedHtml = '';
  let oEmbedStatus = null;

  try {
    if (platform === 'tiktok') {
      try {
        const oembedUrl = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(target);
        const o = await fetchWithTimeout(oembedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json,text/plain,*/*',
          },
        }, 8000);
        oEmbedStatus = o.status;
        if (o.ok) {
          const data = await o.json();
          title = cleanSocialCaption(data.title || '');
          author = cleanSocialCaption(data.author_name || '');
          thumbnail = data.thumbnail_url || '';
          image = thumbnail;
          embedHtml = data.html || '';
          caption = title;
        } else {
          warnings.push('TikTok oEmbed returned HTTP ' + o.status + '.');
        }
      } catch (err) {
        warnings.push('TikTok oEmbed failed: ' + (err.message || String(err)));
      }
    } else {
      warnings.push(platform === 'instagram'
        ? 'Instagram public oEmbed generally requires Meta app credentials, so RecipeBox used public page metadata only.'
        : 'Facebook public oEmbed generally requires Meta app credentials, so RecipeBox used public page metadata only.');
    }

    try {
      const meta = await fetchHtmlMetadata(target, warnings);
      const pageFetchOk = meta.status >= 200 && meta.status < 400;
      finalUrl = meta.finalUrl || finalUrl;
      title = title || meta.title;
      if (pageFetchOk) {
        description = description || meta.description;
        caption = caption || meta.description;
        text = meta.text || '';
        image = image || meta.image;
        thumbnail = thumbnail || meta.image;
      }
    } catch (err) {
      warnings.push('Generic social page fetch failed: ' + (err.message || String(err)));
    }

    if (!caption && description) caption = description;
    if (!text && caption) text = caption;
    if (Math.max(text.length, caption.length, description.length) < 120) {
      warnings.push('RecipeBox could not access much caption or recipe text from this post.');
    }
    const sourceQuality = socialQuality(text, caption, description, warnings);
    const payload = {
      platform,
      url: target,
      finalUrl,
      title,
      author,
      description,
      caption,
      text,
      image,
      thumbnail,
      embedHtml,
      sourceQuality,
      warnings,
    };
    if (debug) {
      payload.debug = {
        platform,
        url: target,
        finalUrl,
        title,
        descriptionLength: description.length,
        captionLength: caption.length,
        textLength: text.length,
        imageFound: !!(image || thumbnail),
        oEmbedStatus,
        warnings,
        sourceQuality,
      };
    }
    res.json(payload);
  } catch (err) {
    const payload = { error: err.message, platform, url: target, warnings: warnings.concat('Try Paste Text with the caption or upload screenshots.'), sourceQuality: 'low' };
    if (debug) payload.debug = { platform, url: target, title, descriptionLength: description.length, captionLength: caption.length, textLength: text.length, imageFound: !!(image || thumbnail), oEmbedStatus, warnings: payload.warnings, sourceQuality: 'low' };
    res.status(500).json(payload);
  }
});

app.get('/api/transcript', async function(req, res) {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'no url' });
  try {
    const debug = req.query.debug === '1';
    const warnings = [];
    const videoId = extractYouTubeVideoId(videoUrl);
    if (!videoId) return res.status(400).json({ error: 'bad url', warnings: ['Paste a full YouTube watch, Shorts, embed, or youtu.be link.'] });
    const userAgent = 'Mozilla/5.0';
    const yt = await fetchWithTimeout('https://www.youtube.com/watch?v=' + videoId, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'en-US' } }, 9000);
    const html = await yt.text();
    let title = matchAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(' - YouTube', '').trim() || 'YouTube Recipe';
    let description = '';
    const descMatch = html.match(/"shortDescription":"([\s\S]*?)"/);
    if (descMatch) description = descMatch[1].replace(/\\n/g, ' ').slice(0, 2000);
    let transcript = '';
    let thumbnail = 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg';
    let author = '';
    const debugInfo = {
      videoId,
      youtubeStatus: yt.status,
      htmlLength: html.length,
      htmlIncludesCaptionTracks: html.includes('"captionTracks"'),
      htmlIncludesShortDescription: html.includes('"shortDescription"'),
      htmlTitleRaw: matchAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      transcriptErrorName: null,
      transcriptErrorMessage: null,
      captionErrorName: null,
      captionErrorMessage: null,
      youtubeiErrorName: null,
      youtubeiErrorMessage: null,
      youtubeiCaptionTrackCount: null,
      youtubeDataApiConfigured: !!process.env.YOUTUBE_API_KEY,
      youtubeDataApiErrorName: null,
      youtubeDataApiErrorMessage: null,
      oembedErrorName: null,
      oembedErrorMessage: null,
      userAgentUsed: userAgent,
    };

    try {
      const pieces = await fetchTranscript(videoId);
      transcript = (pieces || [])
        .map((piece) => piece.text || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 12000);
    } catch (err) {
      debugInfo.transcriptErrorName = err?.name || '';
      debugInfo.transcriptErrorMessage = err?.message || String(err);
      warnings.push('transcript unavailable');
    }

    const cap = transcript ? null : html.match(/"captionTracks":\[\{"baseUrl":"([^"]+)/);
    if (cap) {
      try {
        const cu = cap[1].replace(/\\u0026/g, '&');
        const cr = await fetchWithTimeout(cu, {}, 8000);
        const cx = await cr.text();
        transcript = [...cx.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')).join(' ').slice(0, 6000);
      } catch (err) {
        debugInfo.captionErrorName = err?.name || '';
        debugInfo.captionErrorMessage = err?.message || String(err);
        if (!warnings.includes('transcript unavailable')) warnings.push('transcript unavailable');
      }
    }
    if (!description || title === '- YouTube' || title === 'YouTube Recipe') {
      try {
        const metadata = await youtubeiMetadata(videoId);
        if (metadata.title) title = metadata.title;
        if (metadata.description) description = metadata.description;
        if (metadata.thumbnail) thumbnail = metadata.thumbnail;
        debugInfo.youtubeiCaptionTrackCount = metadata.captionTrackCount;
      } catch (err) {
        debugInfo.youtubeiErrorName = err?.name || '';
        debugInfo.youtubeiErrorMessage = err?.message || String(err);
      }
    }
    if (!description || title === '- YouTube' || title === 'YouTube Recipe') {
      try {
        const metadata = await youtubeDataApiMetadata(videoId);
        if (metadata?.title) title = metadata.title;
        if (metadata?.description) description = metadata.description;
        if (metadata?.thumbnail) thumbnail = metadata.thumbnail;
      } catch (err) {
        debugInfo.youtubeDataApiErrorName = err?.name || '';
        debugInfo.youtubeDataApiErrorMessage = err?.message || String(err);
      }
    }
    if (title === '- YouTube' || title === 'YouTube Recipe') {
      try {
        const metadata = await youtubeOembed(videoUrl);
        if (metadata.title) title = metadata.title;
        if (metadata.author) author = metadata.author;
        if (metadata.thumbnail) thumbnail = metadata.thumbnail;
      } catch (err) {
        debugInfo.oembedErrorName = err?.name || '';
        debugInfo.oembedErrorMessage = err?.message || String(err);
      }
    }
    if (!author) {
      try {
        const metadata = await youtubeOembed(videoUrl);
        if (metadata.author) author = metadata.author;
        if (metadata.thumbnail && thumbnail.endsWith('/maxresdefault.jpg')) thumbnail = metadata.thumbnail;
      } catch (err) {
        debugInfo.oembedErrorName = err?.name || debugInfo.oembedErrorName || '';
        debugInfo.oembedErrorMessage = err?.message || String(err);
      }
    }
    if (!transcript && description) warnings.push('description used instead');
    const availableLength = Math.max(transcript.length, description.length);
    if (availableLength < 120) warnings.push('low confidence extraction');
    const payload = {
      title,
      author,
      description,
      transcript,
      thumbnail,
      videoId,
      sourceUsed: transcript ? 'transcript' : description ? 'description' : 'metadata',
      sourceQuality: availableLength >= 500 ? 'good' : availableLength >= 120 ? 'partial' : 'low',
      warnings: [...new Set(warnings)],
    };
    if (debug) {
      payload.debug = {
        ...debugInfo,
        title,
        descriptionLength: description.length,
        transcriptLength: transcript.length,
        sourceQuality: payload.sourceQuality,
        warnings: payload.warnings,
      };
    }
    res.json(payload);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ai-usage', async function(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'sign in required' });
    res.json(await readAiUsage(user.user_id));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me/entitlements', requireAuth, async function(req, res) {
  try {
    const entitlements = await readEntitlements(req.user);
    res.json({
      plan: entitlements.plan,
      subscriptionStatus: entitlements.subscriptionStatus,
      unlimited: !!entitlements.unlimited,
      limits: {
        aiMonthly: entitlements.aiMonthlyLimit,
        aiDaily: entitlements.aiDailyLimit,
        importDaily: entitlements.importDailyLimit,
        adjustDaily: entitlements.adjustDailyLimit,
        pantryDaily: entitlements.pantryDailyLimit,
      },
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// User-facing AI Assist ledger. Shows fair outcomes only: the AI Assists each
// completed action cost, internal repair/cleanup passes hidden, failed attempts
// marked "no charge". Provider cost and token counts are NEVER returned here —
// those live in the admin-only views.
const AI_LEDGER_LABELS = { import: 'Recipe import', adjust: 'Recipe adjustment', pantry: 'Pantry Chef', 'chat-editor': 'Recipe editor', 'meal-plan': 'Meal plan', nutrition: 'Nutrition estimate', 'shopping-optimize': 'Shopping list optimize', 'general-ai': 'AI request' };
app.get('/api/me/ai-ledger', requireAuth, async function(req, res) {
  try {
    const usage = await readAiUsage(req.user.user_id);
    const db = await getPool();
    if (!db) return res.json({ usage, entries: [] });
    const result = await db.query(
      `SELECT feature, success, created_at
         FROM ai_usage_events
        WHERE user_id=$1 AND feature <> 'repair'
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.user.user_id]
    );
    const entries = result.rows.map((row) => ({
      at: row.created_at,
      label: AI_LEDGER_LABELS[row.feature] || 'AI request',
      assists: row.success ? aiAssistCost(row.feature) : 0,
      status: row.success ? 'charged' : 'no_charge',
    }));
    res.json({ usage, entries });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Server-authoritative AI Assist status for the signed-in user (monthly + bonus +
// purchased). Read-only; the client never sets these values.
app.get('/api/me/credits', requireAuth, async function(req, res) {
  try {
    res.json(await readCreditStatus(req.user));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Read-only display config (tier names, prices, packs, flags). Safe to expose;
// never used for enforcement, which always uses the server-side entitlement.
app.get('/api/config/entitlements', function(req, res) {
  // Public view only — beta-only Founder tiers are stripped so the general
  // public can never see or select Founder pricing.
  res.json(publicEntitlementConfig());
});

// The Founders thank-you offer for a beta tester: Free (applies now) or reserve
// a locked Founder / Founder Family price (claimed when billing launches). Only
// visible to beta-eligible users.
app.get('/api/me/founder-offer', requireAuth, async function(req, res) {
  try {
    const entitlement = await readEntitlements(req.user);
    const metadata = await readEntitlementMetadata(req.user.user_id);
    const eligible = isFounderEligible(entitlement.plan, metadata);
    res.json({
      eligible,
      currentPlan: entitlement.plan,
      choice: metadata.founderChoice || null,
      choiceAt: metadata.founderChoiceAt || null,
      billingLive: false,
      freeTier: { id: 'free', ...ENTITLEMENT_CONFIG.tiers.free },
      options: eligible ? founderOfferTiers() : [],
      policy: FOUNDER_OFFER_CONFIG,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Beta conversion choice. Server-gated to beta-eligible users; the client can
// never self-assign a paid tier. 'free' applies immediately; 'founder'/
// 'founder_family' reserve the locked price (no charge — billing isn't live).
app.post('/api/me/convert', requireAuth, async function(req, res) {
  try {
    const choice = String(req.body?.choice || '');
    if (!['free', 'founder', 'founder_family'].includes(choice)) return res.status(400).json({ error: 'Pick Free, Founder, or Founder Family.' });
    if (isMasterAdminUser(req.user)) return res.status(400).json({ error: 'The master admin account cannot convert.' });
    const entitlement = await readEntitlements(req.user);
    const metadata = await readEntitlementMetadata(req.user.user_id);
    if (!isFounderEligible(entitlement.plan, metadata)) return res.status(403).json({ error: 'The Founders offer is for beta testers only.' });
    // Capture founder eligibility permanently + record the choice.
    const newMeta = { ...metadata, founderEligible: true, founderChoice: choice, founderChoiceAt: new Date().toISOString() };
    if (choice === 'free') {
      await setUserPlan(req.user.user_id, 'free', newMeta);
    } else {
      // Reserve the locked founder price; keep the current (beta) plan until billing.
      newMeta.founderReserved = choice;
      await reserveFounderChoice(req.user.user_id, entitlement.plan, entitlement.subscriptionStatus, newMeta);
    }
    res.json({ ok: true, choice, applied: choice === 'free', reserved: choice !== 'free', credits: await readCreditStatus(req.user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Family / household sharing (M1 foundation) ----
// Membership, roles, and invites. Server-authoritative: roles and membership can
// never be set by the client. Shared library/plan + the shared AI Assist pool
// arrive in M2; this only establishes the household primitive.
async function readHouseholdForUser(userId) {
  const db = await getPool();
  if (!db || !userId) return null;
  const mem = await db.query('SELECT household_id, role FROM household_members WHERE user_id=$1', [userId]);
  if (!mem.rows[0]) return null;
  const householdId = mem.rows[0].household_id;
  const h = await db.query('SELECT id, name, owner_user_id, created_at FROM households WHERE id=$1', [householdId]);
  if (!h.rows[0]) return null;
  const members = await db.query(
    `SELECT m.user_id, m.role, m.joined_at, p.display_name, p.email
       FROM household_members m JOIN profiles p ON p.user_id = m.user_id
      WHERE m.household_id=$1 ORDER BY (m.role='owner') DESC, m.joined_at ASC`,
    [householdId]
  );
  return {
    household: { id: h.rows[0].id, name: h.rows[0].name, ownerUserId: h.rows[0].owner_user_id, createdAt: h.rows[0].created_at },
    role: mem.rows[0].role,
    memberCap: FAMILY_MEMBER_CAP,
    members: members.rows.map((r) => ({ userId: r.user_id, role: r.role, displayName: r.display_name || '', email: r.email || '', joinedAt: r.joined_at, isYou: r.user_id === userId })),
  };
}

app.get('/api/household', requireAuth, async (req, res) => {
  try { res.json((await readHouseholdForUser(req.user.user_id)) || { household: null }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/household/create', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const existing = await db.query('SELECT 1 FROM household_members WHERE user_id=$1', [req.user.user_id]);
    if (existing.rows[0]) return res.status(409).json({ error: 'You are already in a household. Leave it first to create a new one.' });
    const name = String(req.body?.name || '').trim().slice(0, 60) || 'My Household';
    const h = await db.query('INSERT INTO households(name, owner_user_id) VALUES($1,$2) RETURNING id', [name, req.user.user_id]);
    await db.query('INSERT INTO household_members(household_id, user_id, role) VALUES($1,$2,$3)', [h.rows[0].id, req.user.user_id, 'owner']);
    res.json(await readHouseholdForUser(req.user.user_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/household/invite', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const data = await readHouseholdForUser(req.user.user_id);
    if (!data) return res.status(404).json({ error: 'You are not in a household.' });
    if (!canInviteToHousehold(data.role)) return res.status(403).json({ error: 'Only the owner or an adult can invite members.' });
    if (!canAddHouseholdMember(data.members.length)) return res.status(409).json({ error: `A household can have at most ${FAMILY_MEMBER_CAP} members.` });
    const role = req.body?.role === 'adult' ? 'adult' : 'member';
    let code = generateInviteCode();
    for (let i = 0; i < 5; i++) { const dup = await db.query('SELECT 1 FROM household_invites WHERE code=$1', [code]); if (!dup.rows[0]) break; code = generateInviteCode(); }
    const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400000);
    await db.query('INSERT INTO household_invites(household_id, code, role, created_by, expires_at) VALUES($1,$2,$3,$4,$5)', [data.household.id, code, role, req.user.user_id, expires]);
    res.json({ code, role, expiresAt: expires.toISOString(), expiresInDays: INVITE_TTL_DAYS });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/household/join', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const existing = await db.query('SELECT 1 FROM household_members WHERE user_id=$1', [req.user.user_id]);
    if (existing.rows[0]) return res.status(409).json({ error: 'You are already in a household. Leave it first to join another.' });
    const code = String(req.body?.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!code) return res.status(400).json({ error: 'Enter an invite code.' });
    const inv = await db.query('SELECT * FROM household_invites WHERE code=$1', [code]);
    const invite = inv.rows[0];
    if (!inviteIsUsable(invite)) return res.status(400).json({ error: 'That invite code is invalid, already used, or expired.' });
    const count = await db.query('SELECT count(*)::int AS n FROM household_members WHERE household_id=$1', [invite.household_id]);
    if (!canAddHouseholdMember(count.rows[0].n)) return res.status(409).json({ error: `That household is full (max ${FAMILY_MEMBER_CAP}).` });
    await db.query('INSERT INTO household_members(household_id, user_id, role) VALUES($1,$2,$3)', [invite.household_id, req.user.user_id, normalizeHouseholdRole(invite.role)]);
    await db.query('UPDATE household_invites SET accepted_by=$1, accepted_at=now() WHERE id=$2', [req.user.user_id, invite.id]);
    res.json(await readHouseholdForUser(req.user.user_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/household/leave', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const data = await readHouseholdForUser(req.user.user_id);
    if (!data) return res.status(404).json({ error: 'You are not in a household.' });
    if (isHouseholdOwner(data.role)) return res.status(400).json({ error: 'As the owner, disband the household instead (or transfer ownership in a future update).' });
    await db.query('DELETE FROM household_members WHERE household_id=$1 AND user_id=$2', [data.household.id, req.user.user_id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/household/remove', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const data = await readHouseholdForUser(req.user.user_id);
    if (!data) return res.status(404).json({ error: 'You are not in a household.' });
    if (!isHouseholdOwner(data.role)) return res.status(403).json({ error: 'Only the owner can remove members.' });
    const targetId = String(req.body?.userId || '');
    if (!targetId || targetId === req.user.user_id) return res.status(400).json({ error: 'Pick a member to remove.' });
    await db.query('DELETE FROM household_members WHERE household_id=$1 AND user_id=$2 AND role<>$3', [data.household.id, targetId, 'owner']);
    res.json(await readHouseholdForUser(req.user.user_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/household/rename', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const data = await readHouseholdForUser(req.user.user_id);
    if (!data) return res.status(404).json({ error: 'You are not in a household.' });
    if (!isHouseholdOwner(data.role)) return res.status(403).json({ error: 'Only the owner can rename the household.' });
    const name = String(req.body?.name || '').trim().slice(0, 60) || 'My Household';
    await db.query('UPDATE households SET name=$1 WHERE id=$2', [name, data.household.id]);
    res.json(await readHouseholdForUser(req.user.user_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/household/disband', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const data = await readHouseholdForUser(req.user.user_id);
    if (!data) return res.status(404).json({ error: 'You are not in a household.' });
    if (!isHouseholdOwner(data.role)) return res.status(403).json({ error: 'Only the owner can disband the household.' });
    await db.query('DELETE FROM households WHERE id=$1', [data.household.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Household-scoped shared surfaces (M2 slice 2): meal plan, shopping list,
//      pantry. Member-gated, server-authoritative, one row per household. Table/
//      column names below are fixed server constants (never user input). ----
async function householdIdForUser(userId) {
  const db = await getPool();
  if (!db || !userId) return null;
  const r = await db.query('SELECT household_id FROM household_members WHERE user_id=$1', [userId]);
  return r.rows[0]?.household_id || null;
}
async function readHouseholdStore(householdId, table, column, fallback) {
  const db = await getPool();
  if (!db || !householdId) return fallback;
  const r = await db.query(`SELECT ${column} AS v FROM ${table} WHERE household_id=$1`, [householdId]);
  return r.rows[0]?.v ?? fallback;
}
async function writeHouseholdStore(householdId, table, column, userId, value) {
  const db = await getPool();
  if (!db || !householdId) return false;
  await db.query(
    `INSERT INTO ${table}(household_id, ${column}, updated_at, updated_by) VALUES($1, $2::jsonb, now(), $3)
     ON CONFLICT(household_id) DO UPDATE SET ${column}=EXCLUDED.${column}, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [householdId, JSON.stringify(value), userId]
  );
  return true;
}
// Recipe ids the user may plan into the shared meal plan: their own + anything
// shared to the household.
async function householdPlannableRecipeIds(userId) {
  const own = await readUserRecipes(userId);
  const shared = await readHouseholdSharedRecipes(userId);
  return new Set([...own, ...shared].map((r) => r && r.id).filter(Boolean));
}

app.get('/api/household/meal-plan', requireAuth, async (req, res) => {
  try {
    const hid = await householdIdForUser(req.user.user_id);
    if (!hid) return res.status(404).json({ error: 'You are not in a household.' });
    res.json(await readHouseholdStore(hid, 'household_meal_plans', 'meal_plan_json', {}));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/household/meal-plan', requireAuth, async (req, res) => {
  try {
    const hid = await householdIdForUser(req.user.user_id);
    if (!hid) return res.status(404).json({ error: 'You are not in a household.' });
    const allowed = await householdPlannableRecipeIds(req.user.user_id);
    const clean = sanitizeMealPlan(req.body.mealPlan, allowed);
    await writeHouseholdStore(hid, 'household_meal_plans', 'meal_plan_json', req.user.user_id, clean);
    res.json({ ok: true, mealPlan: clean });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/household/shopping-list', requireAuth, async (req, res) => {
  try {
    const hid = await householdIdForUser(req.user.user_id);
    if (!hid) return res.status(404).json({ error: 'You are not in a household.' });
    const raw = await readHouseholdStore(hid, 'household_shopping_lists', 'shopping_list_json', null);
    res.json(RecipeBoxShopping.sanitizeShoppingList(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/household/shopping-list', requireAuth, async (req, res) => {
  try {
    const hid = await householdIdForUser(req.user.user_id);
    if (!hid) return res.status(404).json({ error: 'You are not in a household.' });
    const clean = RecipeBoxShopping.sanitizeShoppingList(req.body.shoppingList);
    await writeHouseholdStore(hid, 'household_shopping_lists', 'shopping_list_json', req.user.user_id, clean);
    res.json({ ok: true, shoppingList: clean });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/household/pantry', requireAuth, async (req, res) => {
  try {
    const hid = await householdIdForUser(req.user.user_id);
    if (!hid) return res.status(404).json({ error: 'You are not in a household.' });
    const raw = await readHouseholdStore(hid, 'household_pantries', 'pantry_json', []);
    res.json(RecipeBoxShopping.sanitizePantry(raw));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/household/pantry', requireAuth, async (req, res) => {
  try {
    const hid = await householdIdForUser(req.user.user_id);
    if (!hid) return res.status(404).json({ error: 'You are not in a household.' });
    const clean = RecipeBoxShopping.sanitizePantry(req.body.pantry);
    await writeHouseholdStore(hid, 'household_pantries', 'pantry_json', req.user.user_id, clean);
    res.json({ ok: true, pantry: clean });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai', async function(req, res) {
  const requestId = crypto.randomUUID();
  let user = null;
  let feature = 'general-ai';
  let model = '';
  let tier = 'unknown';
  let charged = false;        // set once AI Assists are actually debited
  let entitlement = null;
  try {
    user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to use RecipeBox AI.' });
    feature = detectAiFeature(req.body);
    model = String(req.body?.model || '');
    const assistCost = aiAssistCost(feature);
    entitlement = await readEntitlements(user);
    tier = entitlement.plan;
    const isMaster = isMasterAdminUser(user);
    // Identical-request fingerprint (used only to guard against accidental
    // double-submits of an expensive import; see the post-success marker below).
    const dupHash = crypto.createHash('sha256').update(JSON.stringify(req.body?.messages || req.body || {})).digest('hex').slice(0, 32);
    if (!entitlement.unlimited) {
      const ipLimit = await checkRateLimit(`ip:${clientIp(req)}`, `ai:${feature}`, 80, 'day');
      if (!ipLimit.allowed) return res.status(429).json({ error: 'Slow down a bit before using more RecipeBox AI.' });
      const perUserLimit = await checkRateLimit(`user:${user.user_id}`, `ai:${feature}`, entitlement.aiDailyLimit || 60, 'day');
      if (!perUserLimit.allowed) return res.status(429).json({ error: 'Daily AI limit reached for your account.', limit: perUserLimit.limit, resetAt: perUserLimit.resetAt });
      // Burst guard: even a high-balance user can't script the AI endpoints.
      const burst = await checkRateLimit(`user:${user.user_id}`, 'ai:burst', AI_BURST_MAX, AI_BURST_SCOPE);
      if (!burst.allowed) return res.status(429).json({ error: 'Too many AI actions in a short time. Give it a few minutes and try again.', limit: burst.limit, resetAt: burst.resetAt });
      if (feature === 'import' && String(process.env.AI_IMPORTS_ENABLED || 'true').toLowerCase() === 'false') return res.status(503).json({ error: 'Recipe imports are temporarily paused.' });
      if (feature === 'adjust' && String(process.env.AI_ADJUST_ENABLED || 'true').toLowerCase() === 'false') return res.status(503).json({ error: 'Recipe adjustments are temporarily paused.' });
    } else if (!isMaster) {
      // Beta = unlimited AI Assists, but still abuse / rate-limit protected.
      const ipLimit = await checkRateLimit(`ip:${clientIp(req)}`, `ai:${feature}`, 120, 'day');
      if (!ipLimit.allowed) return res.status(429).json({ error: 'Slow down a bit before using more RecipeBox AI.' });
      const betaCap = Number(process.env.AI_BETA_DAILY_ABUSE_CAP || 200);
      const perUserLimit = await checkRateLimit(`user:${user.user_id}`, `ai:${feature}`, betaCap, 'day');
      if (!perUserLimit.allowed) return res.status(429).json({ error: 'Daily AI limit reached for your account.', limit: perUserLimit.limit, resetAt: perUserLimit.resetAt });
    }
    // Duplicate-import guard: block an identical import only if an identical one
    // *succeeded* in the last couple of minutes (a failed import leaves no marker,
    // so retries after a failure are always allowed).
    if (feature === 'import' && !isMaster) {
      const db = await getPool();
      if (db) {
        const seen = await db.query(
          `SELECT 1 FROM rate_limit_counters WHERE key=$1 AND bucket LIKE 'ai:dup:%' AND reset_at > now() LIMIT 1`,
          [`dup:${user.user_id}:${dupHash}`]
        );
        if (seen.rows[0]) return res.status(429).json({ error: "Looks like you just imported this — check your library. Give it a moment before re-importing." });
      }
    }
    // Global safety controls (emergency off, daily global cap, monthly cost cap)
    // apply to everyone except the master admin — including beta/unlimited users,
    // so the wallet circuit breaker actually protects during the unlimited beta.
    const globalControls = await checkGlobalAiControls();
    if (!isMaster && !globalControls.allowed) return res.status(503).json({ error: globalControls.error });
    const billable = isBillableAiFeature(feature);
    const credits = await readCreditStatus(user);
    // Block a billable action when the user can't cover its AI Assist cost
    // (monthly + bonus + purchased). Helper passes (repair) and unlimited
    // accounts pass through. Cost varies by action (see AI_ACTION_COSTS).
    if (billable && !credits.unlimited && credits.totalRemaining < assistCost) {
      return res.status(429).json({
        error: `You don't have enough AI Assists for this (needs ${assistCost}). Your monthly AI Assists reset ${new Date(credits.monthly.resetsAt).toLocaleDateString()}, or add a pack that never expires.`,
        assistCost,
        credits,
        aiUsage: await readAiUsage(user.user_id),
      });
    }
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(500).json({ error: 'no key' });
    let r;
    try {
      // Hard timeout under the function's maxDuration so a stuck generation
      // returns a clean error (and, being a failure, costs the user no credit).
      r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(sanitizeAiBody(req.body)),
      }, 55000);
    } catch (err) {
      await logAiUsageEvent({ requestId, user, feature, model, tier, success: false, errorMessage: isAbortError(err) ? 'anthropic timeout' : err.message });
      if (isAbortError(err)) return res.status(504).json({ error: 'That took longer than expected. Please try again — you were not charged any AI Assists.' });
      throw err;
    }
    const d = await r.json();
    if (!r.ok) {
      await logAiUsageEvent({ requestId, user, feature, model, tier, success: false, errorMessage: d.error?.message || d.error || 'Anthropic request failed' });
      return res.status(r.status).json(d);
    }
    // Spend AI Assists only for billable user actions, only after a successful
    // generation. Spend order (monthly -> bonus -> purchased) + the audit row
    // live in debitAiAssists. Beta tracks usage for stats only.
    if (billable) {
      if (!entitlement.unlimited) { await debitAiAssists(user.user_id, { requestId, cost: assistCost, actionType: feature }); charged = true; }
      else if (!isMaster) await incrementAiUsage(user.user_id, assistCost);
      // Mark this exact import as recently completed so an accidental re-submit
      // within ~2 min is caught before burning another expensive call.
      if (feature === 'import' && !isMaster) { try { await checkRateLimit(`dup:${user.user_id}:${dupHash}`, 'ai:dup', 1, 'twominutes'); } catch {} }
    }
    await logAiUsageEvent({
      requestId,
      user,
      feature,
      model,
      tier,
      inputTokens: d.usage?.input_tokens,
      outputTokens: d.usage?.output_tokens,
      success: true,
    });
    res.status(r.status).json({ ...d, aiUsage: await readAiUsage(user.user_id), credits: await readCreditStatus(user), requestId, assistCost });
  } catch(err) {
    try { await logAiUsageEvent({ requestId, user, feature, model, tier, success: false, errorMessage: err.message }); } catch {}
    // If we already debited AI Assists before failing, refund them — a post-charge
    // error must never cost the user.
    if (charged && entitlement && !entitlement.unlimited) { try { await refundAiAssists(user.user_id, requestId, err.message); } catch {} }
    res.status(500).json({ error: err.message });
  }
});

app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// Clean error responses (esp. oversized request bodies) instead of a default dump.
app.use(function(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'That request is too large.' });
  }
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  res.status(500).json({ error: 'Server error.' });
});

module.exports = app;
module.exports.extractYouTubeVideoId = extractYouTubeVideoId;
module.exports._test = {
  extractHelpfulLinks, detectAiFeature, isBillableAiFeature,
  ENTITLEMENT_CONFIG, PLAN_ENTITLEMENTS, REFERRAL_CONFIG, LAUNCH_PHASE,
  chooseSpendBucket, planMonthlyCredits, referralBonusAllowed,
  AI_ACTION_COSTS, aiAssistCost, splitAssistCharge, FREE_WELCOME_ASSISTS, AI_BURST_MAX,
  FAMILY_MEMBER_CAP, HOUSEHOLD_ROLES, normalizeHouseholdRole, generateInviteCode,
  canAddHouseholdMember, canInviteToHousehold, isHouseholdOwner, inviteIsUsable,
  publicEntitlementConfig, founderOfferTiers, isFounderEligible, FOUNDER_TIERS,
  normalizeRecipeForDb, sanitizeMealPlan,
  fetchWithTimeout, readBodyCapped, isAbortError,
  isPrivateIp, assertPublicHost, looksBlockedPage, buildPageResult, scraperRequestUrl, jinaRequestUrl,
  periodKey, resetAfter,
  resolveMonthlyCostCap,
  hashToken, publicUser, VERIFY_TOKEN_MINUTES,
  trustedAppOrigin, sanitizeAiBody, ALLOWED_AI_MODELS, DEFAULT_AI_MODEL, MAX_AI_OUTPUT_TOKENS,
};

if (require.main === module) {
  app.listen(process.env.PORT || 3000, function() { console.log('RecipeBox running'); });
}
