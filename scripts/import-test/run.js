#!/usr/bin/env node
/*
 * RecipeBox import-accuracy test harness.
 *
 * Exercises the REAL import pipeline: same scraper endpoints the app uses
 * (/api/fetch-url, /api/transcript, /api/fetch-social), the same PDF text
 * extraction, the SAME extraction system prompt + model + token limits the
 * front end sends to Claude. /api/ai is a transparent passthrough to Anthropic,
 * so we call Anthropic directly with an identical body (no account/DB needed)
 * and track real cost from the usage the API returns.
 *
 * Modes:
 *   node run.js --estimate     Run everything EXCEPT the paid Claude calls.
 *                              Validates scrapers, parses PDFs, builds the
 *                              report skeleton, prints a cost estimate. $0 spend.
 *   node run.js --run          Do the real extraction. Requires ANTHROPIC_API_KEY.
 *                              HARD STOPS before cost could exceed --budget.
 *   --budget=4.00              Max USD to spend (default 4.00, well under $5).
 *   --only=url,photo           Restrict to certain categories.
 *   --manifest=manifest.json   Override the default manifest selection.
 *
 * Needs the RecipeBox server running locally for the scrapers:
 *   (cd ~/Projects/recipebox-plus && PORT=3000 node server.js)   # env from .env.local
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
// Model + pricing are overridable so we can A/B Haiku vs Sonnet vs Opus on the
// SAME pipeline. Pricing is per-Mtok USD and only affects cost reporting / the
// budget guard; actual spend is whatever Anthropic bills for the usage returned.
const MODEL = (process.argv.find(a => a.startsWith('--model=')) || '').split('=')[1] || 'claude-sonnet-4-5-20250929';
const PRICE_IN = (Number((process.argv.find(a => a.startsWith('--price-in=')) || '').split('=')[1]) || 3) / 1e6;
const PRICE_OUT = (Number((process.argv.find(a => a.startsWith('--price-out=')) || '').split('=')[1]) || 15) / 1e6;
const OUT_TAG = (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || '';
const SERVER = process.env.RB_SERVER || 'http://localhost:3000';
const BUNDLED_BIN = '/Users/benjaminaird/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin';
function readEnvKey(name) {
  if (process.env[name]) return process.env[name];
  const envPath = path.resolve(__dirname, '..', '..', '.env.local');
  try {
    const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((entry) => entry.startsWith(name + '='));
    if (!line) return '';
    return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}
const KEY = readEnvKey('ANTHROPIC_API_KEY');

const args = process.argv.slice(2);
const RUN = args.includes('--run');
const BUDGET = Number((args.find(a => a.startsWith('--budget=')) || '=4').split('=')[1]) || 4;
const ONLY = (args.find(a => a.startsWith('--only=')) || '').split('=')[1];
const ONLY_SET = ONLY ? new Set(ONLY.split(',').map(s => s.trim())) : null;
const IDS = (args.find(a => a.startsWith('--ids=')) || '').split('=')[1];
const ID_SET = IDS ? new Set(IDS.split(',').map(s => s.trim())) : null;
const SKIP_PLACEHOLDERS = !args.includes('--include-placeholders');
const INCLUDE_SKIPPED = args.includes('--include-skipped');
const MANIFEST_ARG = (args.find(a => a.startsWith('--manifest=')) || '').split('=')[1];
const MANIFEST_FILE = MANIFEST_ARG || (fs.existsSync(path.join(ROOT, 'manifest.local.json')) ? 'manifest.local.json' : 'manifest.json');

// ── EXACT system prompt from public/index.html (EXTRACT_PROMPT) ───────────────
const EXTRACT_PROMPT = `You are a recipe extraction assistant. Return ONLY a raw JSON object. No markdown, no backticks, no explanation. Start with { and end with }.

Structure: {"title":"string","cookTime":"string","servings":4,"description":"string","notes":"string","heroImage":"URL or empty string","macros":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0},"sections":[{"name":"Main","ingredients":[{"id":"i1","amount":"1","unit":"cup","name":"flour","weightAmount":"","weightUnit":""}],"steps":[{"id":"s1","text":"Mix {i1} with water.","ingredientRefs":["i1"]}]}],"tags":["tag1"]}

For title:
- Prefer the name of the recipe itself.
- For URL or YouTube imports, if the source/author/channel is clear and useful, title should be "Recipe Name - Source" unless the origin is already part of the recipe name.
- For PDFs, photos, screenshots, and handwritten cards, use only the recipe title unless the source/person/place is explicit in the source material.
- Do not add generic words like "recipe" or "(adjusted)" unless they are truly part of the title.

For notes:
- Use ONLY helpful cooking information explicitly present in the source material, page text, PDF text, image text, caption, transcript, description, or provided source links.
- Include tips, storage/make-ahead guidance, substitution notes, doneness cues, ingredient prep details, or author warnings when they would help someone cook the recipe.
- Do not invent tips or infer advice from general knowledge. If the source does not include useful extra notes, use an empty string.
- If the source provides related recipe/helper links, include only links that are directly useful for this recipe, with the original URL. Example: "Rib rub recipe: https://example.com/rib-rub".
- Do not include ads, unrelated blog story, newsletter links, or generic navigation links.

For sources with multiple recipes or variants:
- Extract one primary recipe card that best matches the title/source.
- Do not merge separate variants into one giant recipe. Mention alternate variants briefly in notes only if source-grounded and useful.
- If an uploaded photo, rendered PDF page, video, article, or transcript clearly contains multiple distinct recipe cards, standalone recipes, or full variants, do not merge them or choose one silently. Return {"error":"multiple_recipes_detected","recipes":["name 1","name 2"]} so RecipeBox can ask the user whether to import one or all.

For heroImage: if you can identify a direct image URL from the source, include it. Otherwise leave as empty string.

For ingredient amounts:
- Preserve the source quantity exactly as a string.
- Use fractions and mixed numbers, not decimals. Use "1/4", "1/2", "3/4", "1 1/4", "1 1/2", etc.
- Preserve compound measures exactly. "1/3 cup + 3 Tablespoons sugar" should become amount "1/3 cup + 3 Tablespoons", unit "", name "sugar".
- Preserve descriptive measures exactly. "1 heaping Tbsp brown sugar" should become amount "1", unit "heaping Tbsp", name "brown sugar". "1 scant cup flour" should become amount "1", unit "scant cup", name "flour".
- Preserve common package/count measures. "1 stick butter" should become amount "1", unit "stick", name "butter".
- Include visible add-ins and optional food items as ingredients, marking optional when the source says optional.
- Never include equipment, tools, bowls, pans, knives, measuring cups/spoons, oven mitts, appliances, or serving utensils as ingredients.
- Never collapse package sizes. "1 (14-ounce) can full-fat coconut milk" must become amount "1", unit "can", name "(14-ounce) full-fat coconut milk".
- If the source includes a parenthetical weight like "1 cup (200g) sugar", store amount "1", unit "cup", name "sugar", weightAmount "200", weightUnit "g".
- If no source weight is listed, leave weightAmount and weightUnit empty.
- Do not normalize compound measures into less readable units. Do not turn "1/3 cup + 3 Tbsp" into "31 Tbsp" or any other collapsed equivalent.
- Do not invent weights.

Embed ingredient IDs like {i1} inside step text, but do not repeat the ingredient name right after the placeholder. Example: use "Mix {i1} with water", not "Mix {i1} flour with water". Macros are per serving. Return ONLY the JSON.`;

// ── helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function estTokens(str) { return Math.ceil((str || '').length / 4); }
function fmtUSD(n) { return '$' + n.toFixed(4); }
function mediaTypeFor(file) {
  const e = file.toLowerCase().split('.').pop();
  return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : e === 'gif' ? 'image/gif' : 'image/jpeg';
}
function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function duplicateIngredientNameLength(text, name) {
  const cleanName = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanName) return 0;
  const match = String(text || '').match(new RegExp('^\\s+' + escapeRegExp(cleanName) + '(?=\\b|\\s|[,.):;])', 'i'));
  return match ? match[0].length : 0;
}
function replaceIngredientRefs(text, ingredientById) {
  const source = String(text || '');
  const regex = /\{([^}]+)\}/g;
  let out = '';
  let last = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    out += source.slice(last, match.index);
    const line = ingredientById[match[1]];
    if (line) {
      out += line;
      const name = ingredientById[match[1] + ':name'] || '';
      const duplicateLen = duplicateIngredientNameLength(source.slice(regex.lastIndex), name);
      if (duplicateLen) regex.lastIndex += duplicateLen;
    } else {
      out += match[0];
    }
    last = regex.lastIndex;
  }
  out += source.slice(last);
  return out.replace(/\s+/g, ' ').trim();
}
const IMPORT_EQUIPMENT_WORDS = /\b(grater|bowl|cutting board|chef'?s knife|knife|scissors|measuring spoon|measuring cup|oven mitt|spatula|ladle|pan\b|pie plate|microwave-safe bowl|stove-top pan|wire cooling rack|wooden spoon|fork|whisk|parchment|foil)\b/i;
function isHeicFile(file) {
  return /\.(heic|heif)$/i.test(file);
}
function imageBytesFor(absFile) {
  if (!isHeicFile(absFile)) return { bytes: fs.readFileSync(absFile), mediaType: mediaTypeFor(absFile), converted: false };
  const out = path.join(os.tmpdir(), `recipebox-import-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    execFileSync('heif-convert', [absFile, out], { stdio: 'ignore' });
    return { bytes: fs.readFileSync(out), mediaType: 'image/jpeg', converted: true };
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
}
function pdfImagesFor(absFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipebox-pdf-pages-'));
  const prefix = path.join(dir, 'page');
  const pdftoppm = process.env.PDFTOPPM || (fs.existsSync(path.join(BUNDLED_BIN, 'pdftoppm')) ? path.join(BUNDLED_BIN, 'pdftoppm') : 'pdftoppm');
  try {
    execFileSync(pdftoppm, ['-jpeg', '-r', '180', '-f', '1', '-l', '4', absFile, prefix], { stdio: 'ignore' });
    const rendered = fs.readdirSync(dir)
      .filter((name) => /\.jpe?g$/i.test(name))
      .sort()
      .map((name) => ({ path: path.join(dir, name), name }));
    const pages = [];
    for (const page of rendered) {
      pages.push({ bytes: fs.readFileSync(page.path), mediaType: 'image/jpeg', file: page.name });
      if (rendered.length <= 2) {
        const rotatedPath = page.path.replace(/\.jpe?g$/i, '-rotated.jpg');
        try {
          execFileSync('/usr/bin/sips', ['-r', '90', page.path, '--out', rotatedPath], { stdio: 'ignore' });
          pages.push({ bytes: fs.readFileSync(rotatedPath), mediaType: 'image/jpeg', file: page.name + ' rotated 90 degrees' });
        } catch {}
      }
    }
    return pages.slice(0, 4);
  } finally {
    try {
      for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
      fs.rmdirSync(dir);
    } catch {}
  }
}
function isPlaceholderTest(test) {
  return /REPLACE/i.test(test.url || test.file || test.id || test.label || '');
}

async function getJson(url) {
  const r = await fetch(url);
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; }
  catch { return { ok: false, status: r.status, data: { error: 'non-JSON response (' + r.status + ')' } }; }
}

// PDF -> text, mirroring the app's pdf.js extraction (first 10 pages, sliced to 24k).
async function pdfToText(absFile) {
  const previousWarn = console.warn;
  console.warn = (...args) => {
    const msg = args.map((arg) => String(arg || '')).join(' ');
    if (/Cannot polyfill `(DOMMatrix|Path2D)`|fetchStandardFontData: failed to fetch file|Warning: TT: undefined function/.test(msg)) return;
    previousWarn(...args);
  };
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  try {
    const data = new Uint8Array(fs.readFileSync(absFile));
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
    let text = '';
    const n = Math.min(doc.numPages, 10);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const c = await page.getTextContent();
      text += c.items.map(x => x.str).join(' ') + ' ';
    }
    return text.trim().slice(0, 24000);
  } finally {
    console.warn = previousWarn;
  }
}

// ── Anthropic call (identical body to what /api/ai forwards) ──────────────────
async function callClaude(messages, system, maxTokens, _retried, _accCost) {
  const requested = maxTokens || 2000;
  // temperature 0 mirrors the app's extraction calls (deterministic, higher fidelity).
  // Opus 4.x deprecates the temperature param (returns 400), so omit it there —
  // itself a reason Opus can't drop into the temp-0 extraction path unchanged.
  const body = { model: MODEL, max_tokens: requested, messages, system };
  if (!/opus-4/.test(MODEL)) body.temperature = 0;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + (d.error?.message || JSON.stringify(d)));
  const text = (d.content || []).map(b => b.text || '').join('');
  const usage = d.usage || {};
  const cost = (_accCost || 0) + (usage.input_tokens || 0) * PRICE_IN + (usage.output_tokens || 0) * PRICE_OUT;
  // Mirror the app: if output was truncated mid-JSON, retry once with more room.
  if (d.stop_reason === 'max_tokens' && !_retried) {
    const bumped = Math.min(Math.max(requested * 2, 4096), 8000);
    if (bumped > requested) return callClaude(messages, system, bumped, true, cost);
  }
  return { text, usage, cost };
}

// ── recipe JSON parsing (tolerant, like the app's parseImportedRecipe) ────────
function parseRecipe(raw) {
  let s = (raw || '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  let obj;
  try { obj = JSON.parse(s); } catch { return { error: 'unparseable JSON', ingredients: [], steps: [] }; }
  if (obj.error) return { error: obj.error, ingredients: [], steps: [] };
  const ingredients = [], steps = [];
  const ingredientById = {};
  for (const sec of obj.sections || []) {
    for (const ing of sec.ingredients || []) {
      const line = [ing.amount, ing.unit, ing.name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (IMPORT_EQUIPMENT_WORDS.test(line)) continue;
      if (line) ingredients.push(line);
      if (ing.id && line) ingredientById[ing.id] = line;
      if (ing.id && ing.name) ingredientById[ing.id + ':name'] = ing.name;
    }
    for (const st of sec.steps || []) {
      const txt = replaceIngredientRefs(st.text || '', ingredientById);
      if (txt) steps.push(txt);
    }
  }
  return { title: obj.title || '', servings: obj.servings, cookTime: obj.cookTime || '', notes: obj.notes || '', ingredients, steps };
}

// ── ground truth from JSON-LD Recipe (for URL imports) ────────────────────────
function gtFromJsonLd(jsonLd) {
  const nodes = [];
  (function walk(x) {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === 'object') {
      if (x['@graph']) walk(x['@graph']);
      const t = x['@type'];
      if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) nodes.push(x);
    }
  })(jsonLd);
  const r = nodes[0];
  if (!r) return null;
  const ingredients = (r.recipeIngredient || r.ingredients || []).map(String);
  const flat = [];
  (function inst(x) {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(inst);
    if (typeof x === 'string') { flat.push(x); return; }
    if (typeof x === 'object') {
      if (x['@type'] === 'HowToSection' && x.itemListElement) return inst(x.itemListElement);
      if (x.text) flat.push(x.text);
    }
  })(r.recipeInstructions);
  return { title: r.name || '', ingredients, steps: flat };
}

// ── lightweight local accuracy score (no AI) ──────────────────────────────────
function tokenize(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2); }
const STOP = new Set(['the','and','for','with','into','your','about','until','then','add','cup','cups','tablespoon','tablespoons','teaspoon','teaspoons','tbsp','tsp','ounce','ounces','oz','gram','grams','pound','pounds','lb']);
function keyNouns(line) { return tokenize(line).filter(w => !STOP.has(w)); }
function nounVariants(noun) {
  const variants = [noun];
  if (noun.endsWith('ies')) variants.push(noun.slice(0, -3) + 'y');
  else if (noun.endsWith('es')) variants.push(noun.slice(0, -2));
  else if (noun.endsWith('s')) variants.push(noun.slice(0, -1));
  return variants;
}
function titleKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/howtobbqright/g, 'how to barbecue right')
    .replace(/\bcorn\s+bread\b/g, 'cornbread')
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/bar\s*b\s*-?\s*q/g, 'barbecue')
    .replace(/\bbq\b/g, 'barbecue')
    .replace(/\brecipe\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function titleMatchesExpected(expected, got) {
  if (!expected) return null;
  if (!got) return false;
  if (got === expected || got.includes(expected) || expected.includes(got)) return true;
  const gotTokens = new Set(got.split(/\s+/).filter(Boolean));
  const expectedTokens = expected.split(/\s+/).filter((token) => token.length > 2 && !['the','and','with','from'].includes(token));
  return expectedTokens.length > 0 && expectedTokens.every((token) => gotTokens.has(token));
}
function score(gt, got) {
  if (!gt) return null;
  let hit = 0;
  for (const gi of gt.ingredients) {
    const nouns = keyNouns(gi);
    if (!nouns.length) { hit++; continue; }
    const hay = got.ingredients.join(' ').toLowerCase();
    const found = nouns.filter(n => hay.includes(n)).length;
    if (found / nouns.length >= 0.5) hit++;
  }
  const recall = gt.ingredients.length ? hit / gt.ingredients.length : null;
  return {
    ingredientRecall: recall,
    gtIngredients: gt.ingredients.length,
    gotIngredients: got.ingredients.length,
    gtSteps: gt.steps.length,
    gotSteps: got.steps.length,
  };
}
function expectationScore(test, got) {
  if (!got) return null;
  const known = test.knownIngredients || [];
  const hay = got.ingredients.join(' ').toLowerCase();
  const foundIngredients = known.filter((item) => keyNouns(item).some((noun) => nounVariants(noun).some((variant) => hay.includes(variant))));
  const expectedTitle = titleKey(test.expectedTitle);
  const gotTitle = titleKey(got.title);
  return {
    titleMatch: titleMatchesExpected(expectedTitle, gotTitle),
    expectedTitle: test.expectedTitle || '',
    gotTitle: got.title || '',
    knownIngredients: known.length,
    foundIngredients: foundIngredients.length,
    missingIngredients: known.filter((item) => !foundIngredients.includes(item)),
    notesPresent: !!String(got.notes || '').trim(),
  };
}

// ── per-source message builders (faithful to public/index.html) ───────────────
async function prepare(test) {
  const out = { test, mode: test.category, sourceView: '', groundTruth: null, messages: null, system: EXTRACT_PROMPT, maxTokens: 2000, prepError: null, images: 0 };
  try {
    if (test.category === 'url') {
      const { ok, data } = await getJson(`${SERVER}/api/fetch-url?url=${encodeURIComponent(test.url)}`);
      if (!ok || data.error) throw new Error('fetch-url: ' + (data.error || 'failed'));
      out.groundTruth = gtFromJsonLd(data.jsonLd);
      const prompt =
        "Extract the recipe ONLY from the source material below. Do not use memory. Do not invent missing quantities, ingredients, steps, times, servings, or notes. If something is missing, leave it blank. Put source-grounded cooking tips, make-ahead/storage/substitution guidance, and directly useful helper links in notes only when they appear in the source. Return only valid JSON.\n\n" +
        "Source URL: " + (data.finalUrl || data.url || test.url) + "\n" +
        "Page title: " + (data.title || "") + "\n" +
        "Detected hero image: " + (data.image || "") + "\n\n" +
        "JSON-LD / structured data:\n" + JSON.stringify(data.jsonLd || []) + "\n\n" +
        "Potentially useful source links:\n" + JSON.stringify(data.helpfulLinks || []) + "\n\n" +
        "Visible page text:\n" + (data.text || "");
      out.messages = [{ role: 'user', content: prompt }];
      out.maxTokens = 4096;
      out.sourceView = `<a href="${test.url}">${test.url}</a><div class="meta">page title: ${esc(data.title || '')}</div>`;
    } else if (test.category === 'youtube') {
      const { ok, data } = await getJson(`${SERVER}/api/transcript?url=${encodeURIComponent(test.url)}`);
      if (!ok || data.error) throw new Error('transcript: ' + (data.error || 'failed'));
      if (data.sourceQuality === 'low') throw new Error('low source quality (not enough recipe detail in video)');
      let content = "Video title: " + (data.title || '') + "\n";
      if (data.author) content += "Video channel/source: " + data.author + "\n";
      content += "\n";
      if (data.transcript) content += "Transcript:\n" + data.transcript;
      else if (data.description) content += "Description:\n" + data.description;
      else throw new Error('no transcript or description');
      if (data.thumbnail) content += "\n\nVideo thumbnail URL: " + data.thumbnail;
      if (data.warnings?.length) content += "\n\nImporter warnings: " + data.warnings.join('; ');
      out.messages = [{ role: 'user', content: "Extract the recipe from this YouTube video content. Use only the transcript, description, and metadata below. Put helpful source-grounded tips or warnings in notes; do not invent notes from general cooking knowledge. If the video contains multiple full recipe variants, return {\"error\":\"multiple_recipes_detected\",\"recipes\":[\"name 1\",\"name 2\"]} instead of merging them or choosing one silently.\n\n" + content }];
      out.maxTokens = 6000;
      out.groundTruth = { title: data.title || '', ingredients: [], steps: [], raw: (data.transcript || data.description || '') };
      out.sourceView = `<a href="${test.url}">${test.url}</a><div class="meta">title: ${esc(data.title || '')}${data.author ? ' · channel: ' + esc(data.author) : ''} · source: ${data.transcript ? 'transcript' : 'description'}</div>`;
    } else if (test.category === 'social') {
      const { ok, data } = await getJson(`${SERVER}/api/fetch-social?url=${encodeURIComponent(test.url)}`);
      if (!ok || data.error) throw new Error('fetch-social: ' + (data.error || 'failed'));
      const availableText = [data.caption, data.description, data.text, data.title].filter(Boolean).join('\n\n').trim();
      if (availableText.length < 120 || data.sourceQuality === 'low') throw new Error('not enough caption/recipe text (social posts often block scrapers)');
      const prompt =
        "Extract a recipe ONLY from the public social source data below. Do not use memory. Do not infer a recipe from the title, thumbnail, author, or platform. Do not invent missing ingredients, quantities, steps, times, servings, or notes. Put helpful source-grounded tips in notes only when they appear in the caption or page text. If the source data does not include enough recipe details, return {\"error\":\"not_enough_recipe_text\"}.\n\n" +
        "Platform: " + (data.platform || "") + "\nSource URL: " + (data.finalUrl || data.url || test.url) + "\nTitle: " + (data.title || "") + "\nAuthor: " + (data.author || "") + "\nCaption/description:\n" + (data.caption || data.description || "") + "\n\nPublic page text:\n" + (data.text || "");
      out.messages = [{ role: 'user', content: prompt }];
      out.maxTokens = 4096;
      out.groundTruth = { title: data.title || '', ingredients: [], steps: [], raw: availableText };
      out.sourceView = `<a href="${test.url}">${test.url}</a><div class="meta">platform: ${esc(data.platform || '?')}</div>`;
    } else if (test.category === 'pdf') {
      const abs = path.resolve(ROOT, test.file);
      const text = await pdfToText(abs);
      if (text.trim()) {
        out.messages = [{ role: 'user', content: "Extract the recipe ONLY from the PDF text below. Do not invent missing details or notes. Put helpful source-grounded tips in notes only when present in the PDF text. Return valid JSON only.\n\n" + text }];
        out.maxTokens = 6000;
        out.groundTruth = loadTruth(test) || { title: '', ingredients: [], steps: [], raw: text };
        out.sourceView = `<div class="meta">file: ${esc(test.file)}</div><pre class="src">${esc(text.slice(0, 1800))}${text.length > 1800 ? '\n…(truncated)' : ''}</pre>`;
      } else {
        const pages = pdfImagesFor(abs);
        if (!pages.length) throw new Error('no extractable text and could not render PDF pages');
        const content = pages.map((page) => ({
          type: 'image',
          source: { type: 'base64', media_type: page.mediaType, data: page.bytes.toString('base64') }
        }));
        content.push({ type: 'text', text: 'Extract the recipe from these rendered PDF page image(s). The PDF may be sideways, scanned, illustrated, handwritten, or a photo of a recipe card. Some images may be rotated duplicates of the same page; use the clearest orientation and do not duplicate recipe content. Carefully transcribe the visible recipe text first, preserve uncertain quantities as written, and do not invent missing details or notes. Include all visible ingredient-list items and visible add-ins mentioned in directions, such as garnishes, green onions, sauces, peppers, cheese, or variations, unless clearly optional; optional items should be marked optional. Do not include equipment/tools as ingredients. If the PDF page image(s) clearly show multiple distinct recipe cards or standalone recipes, return {"error":"multiple_recipes_detected","recipes":["name 1","name 2"]} instead of merging them. If the pages are parts of the same recipe, extract one recipe. Put helpful notes only when they are visible in the PDF image text.' });
        out.messages = [{ role: 'user', content }];
        out.maxTokens = 6000;
        out.images = pages.length;
        out.groundTruth = loadTruth(test);
        out.sourceView = `<div class="meta">file: ${esc(test.file)} · rendered ${pages.length} page image(s)</div>` + pages.map((page, idx) => `<img class="srcimg" src="data:${page.mediaType};base64,${page.bytes.toString('base64')}" alt="pdf page ${idx + 1}"/>`).join('');
      }
    } else if (test.category === 'photo') {
      const files = (test.files || [test.file]).filter(Boolean);
      const content = [];
      const previews = [];
      let convertedCount = 0;
      for (const file of files) {
        const abs = path.resolve(ROOT, file);
        const image = imageBytesFor(abs);
        if (image.converted) convertedCount++;
        const b64 = image.bytes.toString('base64');
        content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: b64 } });
        previews.push({ mediaType: image.mediaType, b64, file, converted: image.converted });
      }
      content.push({ type: 'text', text: "Extract the recipe from these " + files.length + " image(s). These may be handwritten recipe cards or cookbook pages. Carefully transcribe the visible text first, preserve uncertain quantities as written, and do not invent missing details or notes. Include all visible ingredient-list items and visible add-ins mentioned in directions, such as garnishes, green onions, sauces, peppers, cheese, or variations, unless clearly optional; optional items should be marked optional. Do not include equipment/tools as ingredients. If the image(s) clearly show multiple distinct recipe cards or standalone recipes, return {\"error\":\"multiple_recipes_detected\",\"recipes\":[\"name 1\",\"name 2\"]} instead of merging them. If the images are front/back or separate pages of the same recipe, extract one recipe. Put helpful notes only when they are visible in the image text." });
      out.messages = [{ role: 'user', content }];
      out.maxTokens = 6000;
      out.images = files.length;
      out.groundTruth = loadTruth(test);
      out.sourceView = previews.map((img, idx) => `<div class="meta">file ${idx + 1}: ${esc(img.file)}${img.converted ? ' · HEIC converted to JPEG' : ''}</div><img class="srcimg" src="data:${img.mediaType};base64,${img.b64}" alt="source"/>`).join('');
    } else {
      throw new Error('unknown category ' + test.category);
    }
  } catch (e) { out.prepError = e.message; }
  return out;
}

function loadTruth(test) {
  if (!test.groundTruthFile) return null;
  try { return JSON.parse(fs.readFileSync(path.resolve(ROOT, test.groundTruthFile), 'utf8')); }
  catch { return null; }
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── report ───────────────────────────────────────────────────────────────────
function renderReport(results, totals) {
  const rows = results.map((r, i) => {
    const t = r.test;
    const got = r.parsed;
    const sc = r.scoreObj;
    const ex = r.expectation;
    const imported = got
      ? `<div class="cols2"><div><b>Ingredients (${got.ingredients.length})</b><ul>${got.ingredients.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></div>`
        + `<div><b>Directions (${got.steps.length})</b><ol>${got.steps.map(x => '<li>' + esc(x) + '</li>').join('')}</ol></div></div>`
      : `<div class="${r.ok ? 'meta' : 'warn'}">${esc(r.status)}</div>`;
    const gt = r.prep.groundTruth;
    const gtBlock = gt && gt.ingredients && gt.ingredients.length
      ? `<details><summary>Ground truth (from source structured data: ${gt.ingredients.length} ingredients, ${gt.steps.length} steps)</summary>`
        + `<div class="cols2"><div><ul>${gt.ingredients.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></div>`
        + `<div><ol>${gt.steps.map(x => '<li>' + esc(x) + '</li>').join('')}</ol></div></div></details>`
      : (gt && gt.raw ? `<details><summary>Raw source text (for eyeballing)</summary><pre class="src">${esc(gt.raw.slice(0, 2500))}</pre></details>` : '');
    const expectedBlock = (t.expectedTitle || t.knownIngredients?.length || t.reviewNotes)
      ? `<details open><summary>Test expectations</summary>`
        + `${t.expectedTitle ? `<div><b>Expected title:</b> ${esc(t.expectedTitle)}</div>` : ''}`
        + `${t.knownIngredients?.length ? `<div><b>Known ingredients:</b> ${esc(t.knownIngredients.join(', '))}</div>` : ''}`
        + `${t.referenceUrl ? `<div><b>Reference:</b> <a href="${esc(t.referenceUrl)}">${esc(t.referenceUrl)}</a></div>` : ''}`
        + `${t.reviewNotes ? `<div><b>Notes to watch:</b> ${esc(t.reviewNotes)}</div>` : ''}`
        + `</details>`
      : '';
    const scoreBadge = sc && sc.ingredientRecall != null
      ? `<span class="badge ${sc.ingredientRecall >= 0.9 ? 'g' : sc.ingredientRecall >= 0.7 ? 'a' : 'r'}">ingredient recall ${(sc.ingredientRecall * 100).toFixed(0)}%</span>`
        + ` <span class="badge ${Math.abs(sc.gotIngredients - sc.gtIngredients) <= 1 ? 'g' : 'a'}">count ${sc.gotIngredients}/${sc.gtIngredients}</span>`
        + ` <span class="badge ${sc.gotSteps >= sc.gtSteps ? 'g' : 'a'}">steps ${sc.gotSteps}/${sc.gtSteps}</span>`
      : `<span class="badge ${r.ok ? 'g' : 'n'}">${RUN ? 'visual check' : (r.ok ? 'prepared' : 'not prepared')}</span>`;
    const expectationBadges = ex
      ? ` <span class="badge ${ex.titleMatch === null ? 'n' : ex.titleMatch ? 'g' : 'r'}">title ${ex.titleMatch === null ? 'n/a' : ex.titleMatch ? 'ok' : 'check'}</span>`
        + ` <span class="badge ${ex.knownIngredients ? (ex.foundIngredients / ex.knownIngredients >= 0.85 ? 'g' : ex.foundIngredients / ex.knownIngredients >= 0.65 ? 'a' : 'r') : 'n'}">known ingredients ${ex.foundIngredients}/${ex.knownIngredients}</span>`
        + ` <span class="badge ${ex.notesPresent ? 'g' : 'n'}">notes ${ex.notesPresent ? 'present' : 'blank'}</span>`
      : '';
    const expectationDetails = ex
      ? `<details><summary>Expectation check</summary>`
        + `<div><b>Got title:</b> ${esc(ex.gotTitle || '')}</div>`
        + `${ex.missingIngredients?.length ? `<div><b>Missing known ingredients:</b> ${esc(ex.missingIngredients.join(', '))}</div>` : '<div><b>Missing known ingredients:</b> none flagged</div>'}`
        + `${got?.notes ? `<div><b>Imported notes:</b><pre class="src">${esc(got.notes)}</pre></div>` : ''}`
        + `</details>`
      : '';
    return `<section class="test ${r.ok ? '' : 'failrow'}">
      <h3>${i + 1}. [${t.category.toUpperCase()}] ${esc(t.label || t.id)}</h3>
      <div class="status">${scoreBadge}${expectationBadges} <span class="cost">${r.cost != null ? fmtUSD(r.cost) : (r.status === 'skipped (budget)' ? 'skipped — budget' : r.status || 'not run')}</span></div>
      <div class="grid">
        <div class="cell"><div class="hd">SOURCE (what went in)</div>${expectedBlock}${r.prep.sourceView || '<i>not prepared</i>'}${gtBlock}</div>
        <div class="cell"><div class="hd">IMPORTED (what RecipeBox produced)</div>${imported}${expectationDetails}</div>
      </div>
      <div class="verdict">Your verdict: <span class="blank">____ accurate / ____ issues: ___________________________________________</span></div>
    </section>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><title>RecipeBox Import Accuracy Report</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2a22;margin:24px;line-height:1.45;}
  h1{color:#234B32;margin:0 0 2px;} .sub{color:#777;margin:0 0 14px;font-size:13px;}
  .summary{background:#f4f1e8;border-left:4px solid #cdab5a;padding:10px 14px;margin:14px 0;border-radius:6px;font-size:14px;}
  .test{border:1px solid #e2ddd0;border-radius:10px;padding:14px;margin:16px 0;page-break-inside:avoid;}
  .test.failrow{background:#fdf3f3;border-color:#e7b7b7;}
  h3{margin:0 0 6px;font-size:15px;color:#2f5a3c;}
  .status{margin-bottom:10px;} .cost{color:#888;font-size:12px;margin-left:8px;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .cell{border:1px solid #eee;border-radius:8px;padding:10px;background:#fafafa;min-width:0;}
  .hd{font-size:11px;letter-spacing:.5px;color:#777;font-weight:700;margin-bottom:6px;}
  .cols2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  ul,ol{margin:4px 0;padding-left:18px;} li{margin:2px 0;font-size:12.5px;}
  .srcimg{max-width:100%;border:1px solid #ddd;border-radius:6px;}
  pre.src{white-space:pre-wrap;font-size:10.5px;background:#fff;border:1px solid #eee;border-radius:6px;padding:8px;max-height:320px;overflow:auto;}
  .badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;color:#fff;margin-right:4px;}
  .badge.g{background:#2e7d46;} .badge.a{background:#c08a2d;} .badge.r{background:#b23b3b;} .badge.n{background:#6b7a8c;}
  .warn{color:#b23b3b;font-size:13px;} details{margin-top:8px;font-size:12px;} summary{cursor:pointer;color:#555;}
  .verdict{margin-top:10px;font-size:12px;color:#444;} .blank{color:#aaa;}
  .meta{color:#888;font-size:11px;margin-top:3px;}
</style></head><body>
  <h1>RecipeBox — Import Accuracy Report</h1>
  <div class="sub">Generated ${new Date().toLocaleString()} · model ${MODEL} · faithful to the app's real import pipeline</div>
  <div class="summary">
    <b>Spend:</b> ${fmtUSD(totals.cost)} of ${fmtUSD(BUDGET)} budget (hard cap). &nbsp;
    <b>Tests:</b> ${totals.ran} live AI run, ${totals.prepared} prepared, ${totals.failed} failed/skipped, ${results.length} total. &nbsp;
    <b>How to read this:</b> the left cell is exactly what was fed to the AI (the real photo, the PDF text, or the scraped page); the right cell is what RecipeBox extracted. For URL imports the badges auto-score ingredient recall and counts against the page's structured data. For photos / PDFs / YouTube / social, compare the source against the import by eye and mark your verdict.
  </div>
  ${rows}
</body></html>`;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_FILE), 'utf8'));
  let tests = manifest.tests.filter(t =>
    (!ONLY_SET || ONLY_SET.has(t.category)) &&
    (!ID_SET || ID_SET.has(t.id)) &&
    (!SKIP_PLACEHOLDERS || !isPlaceholderTest(t)) &&
    (INCLUDE_SKIPPED || !t.skipByDefault)
  );
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });

  console.log(`\nRecipeBox import test — ${RUN ? 'LIVE RUN (will spend up to ' + fmtUSD(BUDGET) + ')' : 'ESTIMATE ONLY ($0 spend)'}`);
  console.log(`Server: ${SERVER}  ·  Tests: ${tests.length}  ·  Model: ${MODEL}  ·  Manifest: ${MANIFEST_FILE}\n`);
  if (SKIP_PLACEHOLDERS) console.log('Placeholder sources are skipped by default. Use --include-placeholders to exercise them.\n');
  if (!INCLUDE_SKIPPED) console.log('Sources marked skipByDefault are skipped. Use --include-skipped to exercise them.\n');
  if (RUN && !KEY) { console.error('ERROR: --run needs ANTHROPIC_API_KEY in the environment. Aborting (no spend).'); process.exit(1); }

  const results = [];
  let spend = 0;
  for (const test of tests) {
    process.stdout.write(`• [${test.category}] ${test.id} … `);
    const prep = await prepare(test);
    const rec = { test, prep, ok: false, status: '', parsed: null, scoreObj: null, cost: null };

    if (prep.prepError) {
      rec.status = 'prep failed: ' + prep.prepError;
      if (test.expectedBlocked) {
        rec.ok = true;
        rec.status = 'expected blocked source fallback: ' + prep.prepError;
        console.log('EXPECTED BLOCKED FALLBACK');
      } else {
        console.log('PREP FAILED (' + prep.prepError + ')');
      }
      results.push(rec); continue;
    }

    // worst-case cost of this call; refuse if it could break the budget.
    // Images are billed by resized dimensions (~1600 tokens max each), NOT by
    // base64 length — so don't stringify the image data into the estimate.
    const inEst = prep.images
      ? 1700 * prep.images + 250
      : estTokens(JSON.stringify(prep.messages));
    const worst = inEst * PRICE_IN + prep.maxTokens * PRICE_OUT;

    if (!RUN) {
      rec.ok = true;
      rec.status = 'prepared for live extraction (est ≤ ' + fmtUSD(worst) + ')';
      console.log('prepared, est ≤ ' + fmtUSD(worst));
      results.push(rec); continue;
    }
    if (spend + worst > BUDGET) {
      rec.status = 'skipped (budget)';
      console.log('SKIPPED — would exceed budget (' + fmtUSD(spend) + ' + ' + fmtUSD(worst) + ' > ' + fmtUSD(BUDGET) + ')');
      results.push(rec); continue;
    }

    try {
      const { text, cost } = await callClaude(prep.messages, prep.system, prep.maxTokens);
      spend += cost;
      rec.cost = cost;
      rec.rawText = text;
      const parsed = parseRecipe(text);
      if (parsed.error) {
        rec.status = 'extracted but ' + parsed.error;
        rec.parsed = parsed;
        if ((test.expectedBlocked && /not_enough_recipe_text|unknown_recipe/i.test(parsed.error)) ||
            (test.expectedMultipleRecipes && /multiple_recipes_detected/i.test(parsed.error))) {
          rec.ok = true;
          rec.status = 'expected honest fallback: ' + parsed.error;
          rec.expectation = expectationScore(test, parsed);
        }
      }
      else { rec.parsed = parsed; rec.ok = true; rec.status = 'ok'; rec.scoreObj = score(prep.groundTruth, parsed); rec.expectation = expectationScore(test, parsed); }
      console.log(`${rec.ok ? 'OK' : rec.status}  (${fmtUSD(cost)}, total ${fmtUSD(spend)})`);
    } catch (e) {
      rec.status = 'API error: ' + e.message;
      console.log('API ERROR: ' + e.message);
    }
    results.push(rec);
    await sleep(400);
  }

  const totals = {
    cost: spend,
    ran: results.filter(r => r.cost != null).length,
    prepared: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length
  };
  const html = renderReport(results, totals);
  const outHtml = path.join(ROOT, 'out', 'report.html');
  fs.writeFileSync(outHtml, html);
  fs.writeFileSync(path.join(ROOT, 'out', OUT_TAG ? `results.${OUT_TAG}.json` : 'results.json'), JSON.stringify(results.map(r => ({
    model: MODEL, id: r.test.id, category: r.test.category, ok: r.ok, status: r.status, cost: r.cost,
    score: r.scoreObj,
    expectation: r.expectation,
    importedTitle: r.parsed?.title,
    importedIngredients: r.parsed?.ingredients?.length,
    importedSteps: r.parsed?.steps?.length,
    rawText: r.ok ? undefined : r.rawText,
    parsed: r.parsed ? { title:r.parsed.title, ingredients:r.parsed.ingredients, steps:r.parsed.steps, notes:r.parsed.notes } : null,
  })), null, 2));

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Total spend: ${fmtUSD(spend)} of ${fmtUSD(BUDGET)} budget`);
  console.log(`Report:  ${outHtml}`);
  if (!RUN) console.log(`\nThis was an ESTIMATE ($0 spent). To run for real:\n  export ANTHROPIC_API_KEY=sk-...\n  node ${path.relative(process.cwd(), __filename)} --run --budget=4`);
})();
