const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: !!process.env.DATABASE_URL }));

app.get('/api/recipes', async (req, res) => {
  try { res.json(await readStore('recipes', [])); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/recipes', async (req, res) => {
  try {
    if (!Array.isArray(req.body.recipes)) return res.status(400).json({ error: 'recipes must be an array' });
    const saved = await writeStore('recipes', req.body.recipes);
    res.json({ ok: true, savedToDatabase: saved });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/mealplan', async (req, res) => {
  try { res.json(await readStore('mealplan', {})); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/mealplan', async (req, res) => {
  try {
    const saved = await writeStore('mealplan', req.body.mealPlan || {});
    res.json({ ok: true, savedToDatabase: saved });
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

app.get('/api/transcript', async function(req, res) {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: 'no url' });
  try {
    let videoId = '';
    if (videoUrl.includes('v=')) videoId = videoUrl.split('v=')[1].split('&')[0].slice(0, 11);
    else if (videoUrl.includes('youtu.be/')) videoId = videoUrl.split('youtu.be/')[1].split('?')[0].slice(0, 11);
    if (videoId.length < 5) return res.status(400).json({ error: 'bad url' });
    const yt = await fetch('https://www.youtube.com/watch?v=' + videoId, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US' } });
    const html = await yt.text();
    let title = matchAttr(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(' - YouTube', '').trim() || 'YouTube Recipe';
    let description = '';
    const descMatch = html.match(/"shortDescription":"([\s\S]*?)"/);
    if (descMatch) description = descMatch[1].replace(/\\n/g, ' ').slice(0, 2000);
    let transcript = '';
    const cap = html.match(/"captionTracks":\[\{"baseUrl":"([^"]+)/);
    if (cap) {
      try {
        const cu = cap[1].replace(/\\u0026/g, '&');
        const cr = await fetch(cu);
        const cx = await cr.text();
        transcript = [...cx.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')).join(' ').slice(0, 6000);
      } catch {}
    }
    res.json({ title, description, transcript, thumbnail: 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg' });
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
app.listen(process.env.PORT || 3000, function() { console.log('RecipeBox+ running'); });
