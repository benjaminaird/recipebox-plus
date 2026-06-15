const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { fetchTranscript } = require('youtube-transcript');

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
