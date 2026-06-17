const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { fetchTranscript } = require('youtube-transcript');

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
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_COOKIE = 'rb_session';
const SESSION_DAYS = 3650;
const PASSWORD_MIN_LENGTH = 6;
const AUTH_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LIMIT_MAX = 20;
const RESET_TOKEN_MINUTES = 60;
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
const PLAN_ENTITLEMENTS = {
  free: { aiMonthlyLimit: 10, aiDailyLimit: 8, importDailyLimit: 6, adjustDailyLimit: 8, pantryDailyLimit: 12 },
  beta: { aiMonthlyLimit: AI_MONTHLY_LIMIT, aiDailyLimit: 60, importDailyLimit: 35, adjustDailyLimit: 40, pantryDailyLimit: 50 },
  plus: { aiMonthlyLimit: 300, aiDailyLimit: 150, importDailyLimit: 100, adjustDailyLimit: 100, pantryDailyLimit: 120 },
  master_admin: { aiMonthlyLimit: null, aiDailyLimit: null, importDailyLimit: null, adjustDailyLimit: null, pantryDailyLimit: null, unlimited: true },
};
const AI_FEATURE_PATTERNS = [
  { feature: 'import', patterns: ['extract the recipe', 'recipe extraction', 'repair malformed recipe'] },
  { feature: 'adjust', patterns: ['adjust this recipe', 'request:'] },
  { feature: 'pantry', patterns: ['pantry chef', 'what i have', 'ingredients i have'] },
  { feature: 'chat-editor', patterns: ['recipe editor', 'chat editor'] },
];

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
    await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens (user_id)');
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

function checkAuthLimit(req, res) {
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
  return { id: row.user_id, email: row.email, displayName: row.display_name || '', role, isMasterAdmin: role === 'master_admin' };
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
  return now.toISOString().slice(0, 10);
}

function resetAfter(scope = 'day') {
  const now = new Date();
  if (scope === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
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

async function checkGlobalAiControls() {
  if (String(process.env.AI_FEATURES_ENABLED || 'true').toLowerCase() === 'false') {
    return { allowed: false, error: process.env.AI_EMERGENCY_DISABLE_REASON || 'RecipeBox AI is temporarily unavailable.' };
  }
  const dailyMax = Number(process.env.AI_DAILY_GLOBAL_MAX_REQUESTS || 0);
  if (dailyMax > 0) {
    const daily = await checkRateLimit('global', 'ai-requests', dailyMax, 'day');
    if (!daily.allowed) return { allowed: false, error: 'RecipeBox AI is busy today. Please try again tomorrow.' };
  }
  const monthlyCostCap = Number(process.env.AI_MONTHLY_GLOBAL_MAX_COST_USD || 0);
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

async function currentUser(req) {
  const db = await getPool();
  if (!db) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await db.query(
    `SELECT p.user_id, p.email, p.display_name, p.role
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
  return {
    title: String(r.title || 'Untitled Recipe').slice(0, 240),
    category: r.category || null,
    heroImage: r.heroImage || null,
    favorite: !!r.favorite,
    rating: Number.isFinite(Number(r.rating)) ? Number(r.rating) : 0,
    json: r,
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

async function incrementAiUsage(userId) {
  const db = await getPool();
  const period = currentAiPeriod();
  const profile = await db.query('SELECT role FROM profiles WHERE user_id=$1', [userId]);
  if (profile.rows[0]?.role === 'master_admin') return readAiUsage(userId);
  await db.query(
    `INSERT INTO ai_usage_monthly(user_id, period, request_count, updated_at)
     VALUES($1, $2, 1, now())
     ON CONFLICT(user_id, period)
     DO UPDATE SET request_count=ai_usage_monthly.request_count + 1, updated_at=now()`,
    [userId, period]
  );
  return readAiUsage(userId);
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
  const r = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await r.text();
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
  const r = await fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(videoUrl) + '&format=json');
  if (!r.ok) throw new Error('YouTube oEmbed failed with status ' + r.status);
  const data = await r.json();
  return {
    title: data.title || '',
    thumbnail: data.thumbnail_url || '',
  };
}
async function youtubeDataApiMetadata(videoId) {
  if (!process.env.YOUTUBE_API_KEY) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  const r = await fetch(url);
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
    if (!checkAuthLimit(req, res)) return;
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
    await db.query(
      `INSERT INTO profiles(user_id, email, display_name, role, password_hash)
       VALUES($1, $2, $3, $4, $5)`,
      [userId, email, displayName, role, hashPassword(password)]
    );
    if (Array.isArray(req.body.recipes) && req.body.recipes.length) await replaceUserRecipes(userId, req.body.recipes);
    if (req.body.mealPlan && typeof req.body.mealPlan === 'object') await replaceUserMealPlan(userId, req.body.mealPlan);
    await createSession(req, res, userId);
    clearAuthLimit(req);
    res.json({ ok: true, user: { id: userId, email, displayName, role, isMasterAdmin: role === 'master_admin' } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    if (!checkAuthLimit(req, res)) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    await ensureConfiguredMasterAdmin(db);
    const email = normalizeEmail(req.body.email);
    const result = await db.query('SELECT user_id, email, display_name, role, password_hash FROM profiles WHERE email=$1', [email]);
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
    if (!checkAuthLimit(req, res)) return;
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
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
      const resetUrl = `${requestOrigin(req)}/?reset=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }
    clearAuthLimit(req);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    if (!checkAuthLimit(req, res)) return;
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

app.post('/api/auth/change-password', async (req, res) => {
  try {
    if (!checkAuthLimit(req, res)) return;
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
    if (!checkAuthLimit(req, res)) return;
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
    if (user) return res.json(await readUserRecipes(user.user_id));
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
      const saved = await replaceUserRecipes(user.user_id, req.body.recipes);
      await logUserActivity(user, 'recipes_saved', { count: req.body.recipes.length });
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
         coalesce(act.activity_count, 0)::int AS activity_count
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
                count(*) FILTER (WHERE feature='import') AS import_count
         FROM ai_usage_events
         GROUP BY user_id
       ) ai ON ai.user_id = p.user_id
       LEFT JOIN (
         SELECT user_id, count(*) AS activity_count
         FROM user_activity
         GROUP BY user_id
       ) act ON act.user_id = p.user_id
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
        feedbackCount: 0,
        activityCount: row.activity_count,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/users/:id/entitlement', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const db = await getPool();
    const plan = String(req.body?.plan || '').trim().toLowerCase();
    if (!['free', 'beta', 'plus'].includes(plan)) return res.status(400).json({ error: 'Plan must be free, beta, or plus.' });
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

app.get('/api/admin/app-control/meta', requireAuth, requireMasterAdmin, async (req, res) => {
  res.json({
    user: publicUser(req.user),
    sections: ADMIN_SECTION_NAMES,
    categories: ADMIN_KB_CATEGORIES,
    features: ADMIN_FEATURES,
    scopeTypes: ADMIN_SCOPE_TYPES,
    whatsNextSync: { configured: false, status: 'not_configured' },
  });
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

app.get('/api/fetch-url', async (req, res) => {
  const target = req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) return res.status(400).json({ error: 'bad url' });
  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    const html = await r.text();
    const jsonLd = parseJsonLd(html);
    const title = matchAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
      .replace(/\s+/g, ' ')
      .trim();
    const image = bestImage(target, html, jsonLd);
    const text = cleanText(html).slice(0, 18000);
    res.json({ url: target, finalUrl: r.url, title, image, jsonLd, text, htmlHash: crypto.createHash('sha256').update(html).digest('hex') });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        const o = await fetch(oembedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json,text/plain,*/*',
          },
        });
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
    const yt = await fetch('https://www.youtube.com/watch?v=' + videoId, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'en-US' } });
    const html = await yt.text();
    let title = matchAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(' - YouTube', '').trim() || 'YouTube Recipe';
    let description = '';
    const descMatch = html.match(/"shortDescription":"([\s\S]*?)"/);
    if (descMatch) description = descMatch[1].replace(/\\n/g, ' ').slice(0, 2000);
    let transcript = '';
    let thumbnail = 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg';
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
        const cr = await fetch(cu);
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
        if (metadata.thumbnail) thumbnail = metadata.thumbnail;
      } catch (err) {
        debugInfo.oembedErrorName = err?.name || '';
        debugInfo.oembedErrorMessage = err?.message || String(err);
      }
    }
    if (!transcript && description) warnings.push('description used instead');
    const availableLength = Math.max(transcript.length, description.length);
    if (availableLength < 120) warnings.push('low confidence extraction');
    const payload = {
      title,
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

app.post('/api/ai', async function(req, res) {
  const requestId = crypto.randomUUID();
  let user = null;
  let feature = 'general-ai';
  let model = '';
  let tier = 'unknown';
  try {
    user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to use RecipeBox AI.' });
    feature = detectAiFeature(req.body);
    model = String(req.body?.model || '');
    const entitlement = await readEntitlements(user);
    tier = entitlement.plan;
    if (!entitlement.unlimited) {
      const ipLimit = await checkRateLimit(`ip:${clientIp(req)}`, `ai:${feature}`, 80, 'day');
      if (!ipLimit.allowed) return res.status(429).json({ error: 'Slow down a bit before using more RecipeBox AI.' });
      const perUserLimit = await checkRateLimit(`user:${user.user_id}`, `ai:${feature}`, entitlement.aiDailyLimit || 60, 'day');
      if (!perUserLimit.allowed) return res.status(429).json({ error: 'Daily AI limit reached for your account.', limit: perUserLimit.limit, resetAt: perUserLimit.resetAt });
      if (feature === 'import' && String(process.env.AI_IMPORTS_ENABLED || 'true').toLowerCase() === 'false') return res.status(503).json({ error: 'Recipe imports are temporarily paused.' });
      if (feature === 'adjust' && String(process.env.AI_ADJUST_ENABLED || 'true').toLowerCase() === 'false') return res.status(503).json({ error: 'Recipe adjustments are temporarily paused.' });
    }
    const globalControls = await checkGlobalAiControls();
    if (!entitlement.unlimited && !globalControls.allowed) return res.status(503).json({ error: globalControls.error });
    const usage = await readAiUsage(user.user_id);
    if (!usage.unlimited && usage.remaining <= 0) {
      return res.status(429).json({
        error: `Monthly AI beta limit reached (${usage.count}/${usage.limit}).`,
        aiUsage: usage,
      });
    }
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(500).json({ error: 'no key' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body),
    });
    const d = await r.json();
    if (!r.ok) {
      await logAiUsageEvent({ requestId, user, feature, model, tier, success: false, errorMessage: d.error?.message || d.error || 'Anthropic request failed' });
      return res.status(r.status).json(d);
    }
    const nextUsage = await incrementAiUsage(user.user_id);
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
    res.status(r.status).json({ ...d, aiUsage: nextUsage, requestId });
  } catch(err) {
    try { await logAiUsageEvent({ requestId, user, feature, model, tier, success: false, errorMessage: err.message }); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

module.exports = app;
module.exports.extractYouTubeVideoId = extractYouTubeVideoId;

if (require.main === module) {
  app.listen(process.env.PORT || 3000, function() { console.log('RecipeBox running'); });
}
