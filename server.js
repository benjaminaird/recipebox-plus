const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { fetchTranscript } = require('youtube-transcript');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_COOKIE = 'rb_session';
const SESSION_DAYS = 3650;

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
      password_hash text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash text');
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

function publicUser(row) {
  if (!row) return null;
  return { id: row.user_id, email: row.email, displayName: row.display_name || '' };
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

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!(process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https'),
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

async function currentUser(req) {
  const db = await getPool();
  if (!db) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await db.query(
    `SELECT p.user_id, p.email, p.display_name
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
  return result.rows[0];
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

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: !!process.env.DATABASE_URL }));

app.get('/api/auth/session', async (req, res) => {
  try {
    const user = await currentUser(req);
    res.json({ user: publicUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const email = normalizeEmail(req.body.email);
    const displayName = String(req.body.displayName || '').trim().slice(0, 120);
    const password = String(req.body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
    const exists = await db.query('SELECT user_id FROM profiles WHERE email=$1', [email]);
    if (exists.rows[0]) return res.status(409).json({ error: 'An account already exists for that email. Sign in with your password.' });
    const userId = crypto.randomUUID();
    await db.query(
      `INSERT INTO profiles(user_id, email, display_name, password_hash)
       VALUES($1, $2, $3, $4)`,
      [userId, email, displayName, hashPassword(password)]
    );
    if (Array.isArray(req.body.recipes) && req.body.recipes.length) await replaceUserRecipes(userId, req.body.recipes);
    if (req.body.mealPlan && typeof req.body.mealPlan === 'object') await replaceUserMealPlan(userId, req.body.mealPlan);
    await createSession(req, res, userId);
    res.json({ ok: true, user: { id: userId, email, displayName } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const db = await getPool();
    if (!db) return res.status(500).json({ error: 'database not configured' });
    const email = normalizeEmail(req.body.email);
    const result = await db.query('SELECT user_id, email, display_name, password_hash FROM profiles WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Email or password did not match.' });
    await createSession(req, res, user.user_id);
    res.json({ ok: true, user: publicUser(user) });
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
      return res.json({ ok: true, savedToDatabase: saved, account: true });
    }
    if (process.env.ALLOW_SHARED_GUEST_STORE === '1') {
      const saved = await writeStore('mealplan', req.body.mealPlan || {});
      return res.json({ ok: true, savedToDatabase: saved, account: false });
    }
    res.json({ ok: true, savedToDatabase: false, guest: true });
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
    let videoId = '';
    if (videoUrl.includes('v=')) videoId = videoUrl.split('v=')[1].split('&')[0].slice(0, 11);
    else if (videoUrl.includes('youtu.be/')) videoId = videoUrl.split('youtu.be/')[1].split('?')[0].slice(0, 11);
    if (videoId.length < 5) return res.status(400).json({ error: 'bad url' });
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
    const payload = { title, description, transcript, thumbnail };
    if (debug) {
      payload.debug = {
        ...debugInfo,
        title,
        descriptionLength: description.length,
        transcriptLength: transcript.length,
      };
    }
    res.json(payload);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai', async function(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'no key' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body),
    });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

module.exports = app;

if (require.main === module) {
  app.listen(process.env.PORT || 3000, function() { console.log('RecipeBox running'); });
}
