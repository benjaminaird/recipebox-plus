#!/usr/bin/env node
/*
 * Nightmare Recipe import harness.
 *
 * Runs the curated public URL manifest through the same deterministic import
 * stages RecipeBox uses in production: fetch-url payload -> structured-data
 * extraction -> normalization/quantity-aware directions -> audit/quality score.
 *
 * AI fallback is intentionally opt-in (--ai) because it spends API money and
 * can hit third-party rate limits. The default run still gives a repeatable,
 * machine-readable import reliability report and never stores full article
 * bodies in the repo.
 */
const fs = require("fs");
const path = require("path");

const Extract = require("../public/recipe-extract");
const Normalize = require("../public/recipe-normalize");
const Grounding = require("../public/recipe-grounding");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "tests", "fixtures", "imports", "nightmare-recipes", "manifest.json");
const RESULTS_DIR = path.join(ROOT, "tests", "results", "imports");
const DEBUG_DIR = path.join(RESULTS_DIR, "nightmare-debug");
const REPORT_JSON = path.join(RESULTS_DIR, "nightmare-report.json");
const REPORT_MD = path.join(RESULTS_DIR, "nightmare-report.md");
const SERVER = process.env.RB_SERVER || "http://localhost:3000";
const FIXES_APPLIED_THIS_RUN = [
  "Classify skipped imports into AI, video transcript, social, blocked/inaccessible, bad URL, unsupported source, and ambiguous content buckets.",
  "Report attempted pass rate, true fail rate, and total manifest coverage separately so skipped cases do not inflate pass rate.",
  "Add --with-ai-fallback as the explicit opt-in flag for paid/AI fallback runs.",
  "Add confidence by source type plus top 10 nightmare status to the generated reports.",
];

const args = process.argv.slice(2);
const LIMIT = numberArg("--limit");
const IDS = setArg("--ids");
const CATEGORIES = setArg("--categories");
const PRIORITIES = setArg("--priority");
const ONLY_MUST = args.includes("--must-pass");
const ONLY_NIGHTMARE = args.includes("--nightmare");
const LIVE_AI = args.includes("--ai") || args.includes("--with-ai-fallback") || process.env.RB_NIGHTMARE_AI_FALLBACK === "1";
const AI_KEY_AVAILABLE = !!process.env.ANTHROPIC_API_KEY;
const FETCH_DELAY = numberArg("--delay-ms", 250);
const TIMEOUT_MS = numberArg("--timeout-ms", 15000);

function numberArg(name, fallback) {
  const raw = (args.find((a) => a.startsWith(name + "=")) || "").split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function setArg(name) {
  const raw = (args.find((a) => a.startsWith(name + "=")) || "").split("=")[1];
  return raw ? new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)) : null;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms || 0)); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function cleanId(id) { return String(id || "").replace(/[^a-z0-9_-]/gi, "_"); }
function textify(value) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
function stripHtml(s) { return Extract.stripHtml ? Extract.stripHtml(s) : String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

function orderedEntries(manifest) {
  const entries = manifest.entries.slice();
  const nightmare = new Map((manifest.nightmare_top_10 || []).map((x, i) => [x.id, i]));
  const must = new Map((manifest.must_pass_top_25 || []).map((x, i) => [x.id, i]));
  const rank = { high: 2, medium: 3, low: 4 };
  entries.sort((a, b) => {
    const ar = nightmare.has(a.id) ? 0 : must.has(a.id) ? 1 : (rank[a.priority] || 9);
    const br = nightmare.has(b.id) ? 0 : must.has(b.id) ? 1 : (rank[b.priority] || 9);
    if (ar !== br) return ar - br;
    if (ar === 0) return nightmare.get(a.id) - nightmare.get(b.id);
    if (ar === 1) return must.get(a.id) - must.get(b.id);
    return a.id.localeCompare(b.id);
  });
  let out = entries;
  if (ONLY_NIGHTMARE) out = out.filter((e) => nightmare.has(e.id));
  if (ONLY_MUST) out = out.filter((e) => must.has(e.id));
  if (IDS) out = out.filter((e) => IDS.has(e.id));
  if (CATEGORIES) out = out.filter((e) => CATEGORIES.has(e.difficulty_category));
  if (PRIORITIES) out = out.filter((e) => PRIORITIES.has(e.priority));
  if (LIMIT) out = out.slice(0, LIMIT);
  return out;
}

async function fetchJson(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { "Accept": "application/json,text/plain,*/*" } });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { error: "non-json response", bodySnippet: text.slice(0, 240) }; }
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(t);
  }
}

async function fetchRecipePage(entry) {
  const viaServer = await fetchJson(SERVER + "/api/fetch-url?url=" + encodeURIComponent(entry.url)).catch((err) => ({
    ok: false,
    status: 0,
    data: { error: "server unavailable: " + err.message },
  }));
  if (viaServer.ok || viaServer.status === 422 || viaServer.status === 400 || viaServer.status === 504) {
    return { via: "server:/api/fetch-url", status: viaServer.status, data: viaServer.data };
  }

  // Server not running or inaccessible: safe direct fallback for deterministic
  // structured data only. No proxy, no body persistence.
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(entry.url, {
      redirect: "follow",
      signal: c.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 RecipeBox Nightmare Import Harness",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await r.text();
    const extracted = Extract.extractFromHtml(html, { url: r.url || entry.url });
    return {
      via: "direct-fallback",
      status: r.status,
      data: {
        url: entry.url,
        finalUrl: r.url || entry.url,
        title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "",
        text: stripHtml(html).slice(0, 18000),
        recipe: extracted.recipe,
        extractComplete: !!extracted.complete,
        extractSource: extracted.source,
      },
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchVideo(entry) {
  return fetchJson(SERVER + "/api/transcript?url=" + encodeURIComponent(entry.url))
    .then((r) => ({ via: "server:/api/transcript", status: r.status, data: r.data }))
    .catch((err) => ({ via: "server:/api/transcript", status: 0, data: { error: "server unavailable: " + err.message } }));
}

function sourceCounts(pageData) {
  const out = { ingredients: null, steps: null, title: "", sourceRecipe: null };
  if (pageData && pageData.recipe) {
    out.sourceRecipe = pageData.recipe;
    out.title = pageData.recipe.title || pageData.title || "";
    out.ingredients = allIngredients(pageData.recipe).length;
    out.steps = allSteps(pageData.recipe).length;
    return out;
  }
  const ex = pageData && pageData.jsonLd ? Extract.extractFromJsonLdNodes(pageData.jsonLd, {}) : null;
  if (ex && ex.recipe) {
    out.sourceRecipe = ex.recipe;
    out.title = ex.recipe.title || pageData.title || "";
    out.ingredients = allIngredients(ex.recipe).length;
    out.steps = allSteps(ex.recipe).length;
  }
  return out;
}

function sanitizeImportedRecipe(recipe) {
  const filtered = {
    ...recipe,
    sections: (recipe.sections || []).map((sec) => ({
      ...sec,
      ingredients: (sec.ingredients || []).filter((ingredient) => {
        const text = [ingredient.amount, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
        return !/\b(grater|bowl|cutting board|chef'?s knife|knife|scissors|measuring spoon|measuring cup|oven mitt|spatula|ladle|pan\b|pie plate|microwave-safe bowl|stove-top pan|wire cooling rack|wooden spoon|fork|whisk|parchment|foil)\b/i.test(text);
      }),
    })),
  };
  return Normalize.quantityAwareDirections(Normalize.normalizeRecipe(filtered));
}

function allIngredients(recipe) {
  const out = [];
  ((recipe && recipe.sections) || []).forEach((sec) => {
    ((sec && sec.ingredients) || []).forEach((ing) => {
      if (!ing) return;
      const line = [ing.amount, ing.unit, ing.name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (line || ing.raw) out.push({ ...ing, line: line || ing.raw || "" });
    });
  });
  return out;
}
function allSteps(recipe) {
  const out = [];
  ((recipe && recipe.sections) || []).forEach((sec) => {
    ((sec && sec.steps) || []).forEach((st) => {
      const text = typeof st === "string" ? st : (st && st.text) || "";
      if (text.trim()) out.push(text.trim());
    });
  });
  return out;
}
function recipeSections(recipe) {
  return ((recipe && recipe.sections) || []).map((s) => ({
    name: s.name || "",
    ingredients: ((s.ingredients || [])).length,
    steps: ((s.steps || [])).length,
  }));
}
function nameKey(name) {
  return textify(name).toLowerCase()
    .replace(/\(\s*[\d.,\/ ]+\s*(?:g|gram|grams|kg|ml|milliliter|l|liter|litre)s?\s*\)/gi, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(fresh|large|small|medium|chopped|minced|diced|sliced|softened|melted|divided|optional|to taste)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function ingredientMap(ingredients) {
  const map = new Map();
  ingredients.forEach((ing) => {
    const key = nameKey(ing.name || ing.raw || ing.line);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ing);
  });
  return map;
}
function compareIngredients(sourceRecipe, parsedRecipe) {
  const source = allIngredients(sourceRecipe);
  const parsed = allIngredients(parsedRecipe);
  const srcMap = ingredientMap(source);
  const gotMap = ingredientMap(parsed);
  const missing = [];
  const extra = [];
  const quantityMismatches = [];
  const unitMismatches = [];
  for (const [key, srcRows] of srcMap.entries()) {
    const gotRows = gotMap.get(key) || [];
    if (!gotRows.length) { missing.push(srcRows[0].line); continue; }
    srcRows.forEach((src, idx) => {
      const got = gotRows[Math.min(idx, gotRows.length - 1)];
      if (textify(src.amount) && textify(got.amount) && amountKey(src.amount) !== amountKey(got.amount)) {
        quantityMismatches.push({ ingredient: src.name || key, source: src.amount, parsed: got.amount });
      }
      if (textify(src.unit) && textify(got.unit) && unitKey(src.unit) !== unitKey(got.unit)) {
        unitMismatches.push({ ingredient: src.name || key, source: src.unit, parsed: got.unit });
      }
    });
  }
  for (const [key, gotRows] of gotMap.entries()) {
    if (!srcMap.has(key)) extra.push(gotRows[0].line);
  }
  return { missing, extra, quantityMismatches, unitMismatches, sourceCount: source.length, parsedCount: parsed.length };
}
function amountKey(amount) {
  return Normalize.normalizeFractions(String(amount || ""))
    .replace(/\s+/g, " ")
    .trim();
}
function unitKey(unit) {
  const u = String(unit || "").toLowerCase().replace(/\./g, "").trim();
  const map = {
    tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp", tbs: "tbsp", tbl: "tbsp", tbls: "tbsp",
    teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp",
    cups: "cup", cup: "cup",
    ounces: "oz", ounce: "oz", oz: "oz",
    pounds: "lb", pound: "lb", lbs: "lb", lb: "lb",
    grams: "g", gram: "g", g: "g",
    kilograms: "kg", kilogram: "kg", kg: "kg",
    milliliters: "ml", milliliter: "ml", ml: "ml",
    liters: "l", liter: "l", litres: "l", litre: "l", l: "l",
    gallons: "gal", gallon: "gal", gal: "gal",
    quarts: "qt", quart: "qt", qt: "qt",
    pints: "pt", pint: "pt", pt: "pt",
  };
  return map[u] || u;
}

function hasSourceMetric(recipe) {
  return allIngredients(recipe).some((ing) =>
    (ing.weightAmount && ing.weightUnit) || /\(\s*[\d.,\/ ]+\s*(?:g|gram|grams|kg|ml|milliliter|l|liter|litre)s?\s*\)/i.test(ing.raw || ing.line || ing.name || "")
  );
}
function metricPreserved(recipe) {
  if (!hasSourceMetric(recipe)) return "not applicable";
  const badName = allIngredients(recipe).some((ing) => /\(\s*[\d.,\/ ]+\s*(?:g|gram|grams|kg|ml|milliliter|l|liter|litre)s?\s*\)/i.test(ing.name || ""));
  const anyWeight = allIngredients(recipe).some((ing) => ing.weightAmount && ing.weightUnit);
  return anyWeight && !badName ? "yes" : "no";
}
function directionsQuantityStatus(recipe) {
  const steps = allSteps(recipe);
  if (!steps.length) return "not applicable";
  const refs = steps.filter((s) => /\{i\d+\}/.test(s)).length;
  const missing = Normalize.missingDirectionQuantities(recipe).length;
  if (missing) return refs ? "partial" : "no";
  return refs ? "yes" : "partial";
}
function tempPass(recipe) {
  const text = allSteps(recipe).concat([recipe.notes || ""]).join(" ");
  const us = Normalize.localizeText(text, "us");
  const metric = Normalize.localizeText(text, "metric");
  if (/\d+\s*°F\s*\(\s*\d+\s*°F\s*\)/i.test(us)) return false;
  if (/\d+\s*°C\s*\(\s*\d+\s*°C\s*\)/i.test(metric)) return false;
  if (/\d+\s*°C/i.test(us) && /\d+\s*°F/i.test(us)) return false;
  if (/\d+\s*°F/i.test(metric) && /\d+\s*°C/i.test(metric)) return false;
  return true;
}
function timerPass(recipe) {
  const steps = allSteps(recipe).join(" ");
  const timeMentions = (steps.match(/\b\d+\s*(?:to|-|–)?\s*\d*\s*(?:minutes?|mins?|hours?|hrs?)\b/gi) || []).length;
  return timeMentions > 0 || !!(recipe.cookTime || recipe.prepTime || recipe.totalTime);
}
function sectionPass(sourceRecipe, parsedRecipe) {
  const sourceSections = ((sourceRecipe && sourceRecipe.sections) || []).filter((s) => (s.name || "").trim() && s.name !== "Main").length;
  const parsedSections = ((parsedRecipe && parsedRecipe.sections) || []).filter((s) => (s.name || "").trim() && s.name !== "Main").length;
  if (!sourceSections) return true;
  return parsedSections >= sourceSections;
}
function titleConfidence(entry, recipe) {
  const expected = nameKey(entry.title.replace(/\s+-\s+.*$/, ""));
  const got = nameKey(recipe && recipe.title);
  if (!got) return 0;
  if (got === expected) return 100;
  const a = new Set(expected.split(" ").filter(Boolean));
  const b = new Set(got.split(" ").filter(Boolean));
  let overlap = 0;
  a.forEach((x) => { if (b.has(x)) overlap += 1; });
  return Math.round((overlap / Math.max(1, a.size)) * 100);
}
function suggestedFix(result) {
  if (result.import_status === "pass") return "none";
  if (result.import_status === "skipped") return result.suggested_fix_category || "source coverage";
  if (result.missing_ingredients.length) return "dropped ingredients";
  if (result.extra_hallucinated_ingredients.length) return "hallucinated ingredients";
  if (result.quantity_mismatches.length) return "quantity parsing";
  if (result.unit_mismatches.length) return "unit parsing";
  if (result.source_provided_metric_preserved === "no") return "source metric preservation";
  if (result.section_preservation === "fail") return "section preservation";
  if (result.directions_include_quantities !== "yes") return "direction quantity refs";
  if (result.temperature_handling === "fail") return "temperature conversion/display";
  if (result.timer_extraction === "fail") return "timer extraction";
  return "none";
}

function skipClassification(entry, page, data, fallbackReason) {
  const sourceType = String(entry.source_type || "").toLowerCase();
  const url = String(entry.url || "").toLowerCase();
  const notes = [data && data.error, fallbackReason].concat((data && data.warnings) || []).filter(Boolean).join(" ");
  const status = Number((page && page.status) || 0);
  const isVideo = /youtube|video/.test(sourceType) || /youtube\.com|youtu\.be/.test(url);
  const isSocial = /instagram|tiktok|pinterest|social/.test(sourceType + " " + url);
  const blocked = !!(data && data.blocked) || [401, 403, 429, 451, 503].includes(status) || /blocked|forbidden|rate limit|captcha|cloudflare|access/i.test(notes);
  const badUrl = [404, 410].includes(status) || /not found|gone|invalid url|dns|enotfound/i.test(notes);
  const unsupported = /unsupported|check_access_first/.test(sourceType);
  const hasReadableText = !!(data && data.text && data.text.length > 1200);

  let classification = "ai_fallback_needed";
  if (badUrl) classification = "bad_manifest_url";
  else if (blocked) classification = "blocked_or_inaccessible";
  else if (isVideo) classification = "video_transcript_needed";
  else if (isSocial) classification = "social_fallback_needed";
  else if (unsupported) classification = "unsupported_source_type";
  else if (hasReadableText) classification = "ambiguous_source_content";

  let acceptability = "skipped-and-needs-product-work";
  if (classification === "blocked_or_inaccessible") acceptability = "skipped-but-acceptable";
  if (classification === "bad_manifest_url") acceptability = "skipped-and-needs-manifest-replacement";

  const fixMap = {
    ai_fallback_needed: "AI fallback not run",
    video_transcript_needed: "video transcript/AI fallback not run",
    social_fallback_needed: "social fallback not run",
    blocked_or_inaccessible: "accessibility/source coverage",
    bad_manifest_url: "bad manifest URL",
    unsupported_source_type: "unsupported source type",
    ambiguous_source_content: "ambiguous source content",
  };
  return { classification, acceptability, suggestedFix: fixMap[classification] || "source coverage" };
}

function skippedResult(entry, page, data, overrides = {}) {
  const skip = skipClassification(entry, page, data || {}, overrides.reason || "");
  return {
    id: entry.id,
    title: entry.title,
    url: entry.url,
    source_type: entry.source_type,
    difficulty_category: entry.difficulty_category,
    priority: entry.priority,
    import_status: "skipped",
    skip_classification: skip.classification,
    skip_acceptability: skip.acceptability,
    extraction_method_used: overrides.method || "fallback",
    title_match_confidence: 0,
    ingredient_count_source: null,
    ingredient_count_parsed: 0,
    instruction_step_count_source: null,
    instruction_step_count_parsed: 0,
    missing_ingredients: [],
    extra_hallucinated_ingredients: [],
    quantity_mismatches: [],
    unit_mismatches: [],
    source_provided_metric_preserved: "not applicable",
    directions_include_quantities: "not applicable",
    temperature_handling: overrides.temperature || "fail",
    timer_extraction: "fail",
    section_preservation: "fail",
    overall_confidence_score: 0,
    notes: (overrides.notes || []).concat((data && data.warnings) || []).filter(Boolean).slice(0, 6),
    suggested_fix_category: skip.suggestedFix,
  };
}

function evaluate(entry, method, pageData, parsed) {
  const source = sourceCounts(pageData);
  const ingredientCmp = source.sourceRecipe ? compareIngredients(source.sourceRecipe, parsed) : {
    missing: [], extra: [], quantityMismatches: [], unitMismatches: [], sourceCount: source.ingredients, parsedCount: allIngredients(parsed).length,
  };
  const grounding = pageData && pageData.text ? Grounding.groundRecipe(parsed, pageData.text) : null;
  const quality = Normalize.qualityScore(parsed, { system: "us", grounding });
  const audit = Normalize.auditRecipe(parsed, "us");
  const sectionOk = sectionPass(source.sourceRecipe, parsed);
  const tempOk = tempPass(parsed);
  const timerOk = timerPass(parsed);
  const metricStatus = metricPreserved(parsed);
  const dirStatus = directionsQuantityStatus(parsed);
  let confidence = quality.score;
  if (ingredientCmp.missing.length) confidence -= 25;
  if (ingredientCmp.extra.length) confidence -= 15;
  if (ingredientCmp.quantityMismatches.length) confidence -= 20;
  if (ingredientCmp.unitMismatches.length) confidence -= 12;
  if (metricStatus === "no") confidence -= 15;
  if (dirStatus === "no") confidence -= 8;
  if (!sectionOk) confidence -= 10;
  if (!tempOk) confidence -= 8;
  if (!timerOk) confidence -= 4;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));
  const hardFailures = ingredientCmp.missing.length || ingredientCmp.extra.length || ingredientCmp.quantityMismatches.length || ingredientCmp.unitMismatches.length || metricStatus === "no";
  const import_status = hardFailures ? "fail" : confidence >= 90 ? "pass" : "partial";
  const result = {
    id: entry.id,
    title: entry.title,
    url: entry.url,
    source_type: entry.source_type,
    difficulty_category: entry.difficulty_category,
    priority: entry.priority,
    import_status,
    extraction_method_used: method,
    title_match_confidence: titleConfidence(entry, parsed),
    ingredient_count_source: ingredientCmp.sourceCount,
    ingredient_count_parsed: ingredientCmp.parsedCount,
    instruction_step_count_source: source.steps,
    instruction_step_count_parsed: allSteps(parsed).length,
    missing_ingredients: ingredientCmp.missing.slice(0, 12),
    extra_hallucinated_ingredients: ingredientCmp.extra.slice(0, 12),
    quantity_mismatches: ingredientCmp.quantityMismatches.slice(0, 12),
    unit_mismatches: ingredientCmp.unitMismatches.slice(0, 12),
    source_provided_metric_preserved: metricStatus,
    directions_include_quantities: dirStatus,
    temperature_handling: tempOk ? "pass" : "fail",
    timer_extraction: timerOk ? "pass" : "fail",
    section_preservation: sectionOk ? "pass" : "fail",
    overall_confidence_score: confidence,
    notes: audit.warnings.concat(quality.reasons || []).filter(Boolean).slice(0, 8),
    suggested_fix_category: "",
  };
  result.suggested_fix_category = suggestedFix(result);
  return result;
}

function writeDebug(entry, payload) {
  const dir = path.join(DEBUG_DIR, cleanId(entry.id));
  ensureDir(dir);
  writeJson(path.join(dir, "source-summary.json"), payload.sourceSummary);
  if (payload.rawExtraction) writeJson(path.join(dir, "raw-extraction.json"), payload.rawExtraction);
  if (payload.normalized) writeJson(path.join(dir, "normalized.json"), payload.normalized);
}

async function runEntry(entry) {
  const isVideo = /youtube|video/i.test(entry.source_type) || /youtube\.com|youtu\.be/.test(entry.url);
  const page = isVideo ? await fetchVideo(entry) : await fetchRecipePage(entry);
  const data = page.data || {};
  if (data.error) {
    const skipped = skippedResult(entry, page, data, {
      method: isVideo ? "transcript" : "fallback",
      notes: [data.error],
    });
    writeDebug(entry, { sourceSummary: sourceSummary(entry, page, data), rawExtraction: null, normalized: null });
    return skipped;
  }

  let rawRecipe = null;
  let method = "fallback";
  if (isVideo) {
    method = "transcript";
    if (!LIVE_AI) {
      const skipped = skippedResult(entry, page, data, {
        method,
        temperature: "pass",
        reason: "Transcript/description fetched, but AI extraction is disabled for this run.",
        notes: ["Transcript/description fetched, but AI extraction is disabled for this run."],
      });
      writeDebug(entry, { sourceSummary: sourceSummary(entry, page, data), rawExtraction: { transcriptAvailable: !!data.transcript, descriptionAvailable: !!data.description, sourceQuality: data.sourceQuality, warnings: data.warnings || [] }, normalized: null });
      return skipped;
    }
    const skipped = skippedResult(entry, page, data, {
      method: "transcript + AI fallback requested",
      temperature: "pass",
      reason: AI_KEY_AVAILABLE ? "AI fallback was requested, but nightmare harness extraction wiring is not enabled yet." : "AI fallback was requested, but ANTHROPIC_API_KEY is not set.",
      notes: [AI_KEY_AVAILABLE ? "AI fallback requested but not implemented in this harness yet." : "AI fallback requested but no ANTHROPIC_API_KEY is available; skipped without spend."],
    });
    writeDebug(entry, { sourceSummary: sourceSummary(entry, page, data), rawExtraction: { transcriptAvailable: !!data.transcript, descriptionAvailable: !!data.description, sourceQuality: data.sourceQuality, warnings: data.warnings || [] }, normalized: null });
    return skipped;
  }

  if (data.recipe && data.extractComplete) {
    rawRecipe = { ...data.recipe, sourceUrl: data.finalUrl || data.url || entry.url, importMethod: "structured-data" };
    method = data.extractSource === "microdata" ? "microdata" : "schema.org JSON-LD";
  } else if (data.recipe) {
    rawRecipe = { ...data.recipe, sourceUrl: data.finalUrl || data.url || entry.url, importMethod: "partial-structured-data" };
    method = data.extractSource === "microdata" ? "microdata" : "HTML recipe card";
  } else if (Array.isArray(data.jsonLd) && data.jsonLd.length) {
    const ex = Extract.extractFromJsonLdNodes(data.jsonLd, { url: data.finalUrl || data.url || entry.url });
    if (ex && ex.recipe) {
      rawRecipe = { ...ex.recipe, sourceUrl: data.finalUrl || data.url || entry.url, importMethod: ex.complete ? "structured-data" : "partial-structured-data" };
      method = "schema.org JSON-LD";
    }
  }

  if (!rawRecipe) {
    const aiRequestedNote = LIVE_AI
      ? (AI_KEY_AVAILABLE ? "AI fallback requested but not implemented in this harness yet." : "AI fallback requested but no ANTHROPIC_API_KEY is available; skipped without spend.")
      : "No complete structured recipe found; AI fallback disabled for this run.";
    const skipped = skippedResult(entry, page, data, {
      method: LIVE_AI ? "clean page text + AI fallback requested" : "clean page text",
      temperature: "pass",
      reason: aiRequestedNote,
      notes: [aiRequestedNote],
    });
    writeDebug(entry, { sourceSummary: sourceSummary(entry, page, data), rawExtraction: null, normalized: null });
    return skipped;
  }

  const normalized = sanitizeImportedRecipe(rawRecipe);
  const result = evaluate(entry, method, data, normalized);
  writeDebug(entry, {
    sourceSummary: sourceSummary(entry, page, data),
    rawExtraction: rawRecipe,
    normalized,
  });
  return result;
}

function sourceSummary(entry, page, data) {
  const counts = sourceCounts(data || {});
  return {
    id: entry.id,
    url: entry.url,
    fetchVia: page.via,
    fetchStatus: page.status,
    finalUrl: data.finalUrl || data.url || entry.url,
    sourceTitle: data.title || "",
    extractSource: data.extractSource || "",
    extractComplete: !!data.extractComplete,
    blocked: !!data.blocked,
    textLength: data.text ? data.text.length : 0,
    jsonLdNodes: Array.isArray(data.jsonLd) ? data.jsonLd.length : null,
    sourceIngredientCount: counts.ingredients,
    sourceStepCount: counts.steps,
    warnings: data.warnings || [],
    error: data.error || "",
  };
}

function aggregate(results, manifest) {
  const counts = { pass: 0, partial: 0, fail: 0, skipped: 0 };
  results.forEach((r) => { counts[r.import_status] = (counts[r.import_status] || 0) + 1; });
  const attempted = results.filter((r) => r.import_status !== "skipped");
  const skipped = results.filter((r) => r.import_status === "skipped");
  const avg = results.length ? Math.round(results.reduce((s, r) => s + (r.overall_confidence_score || 0), 0) / results.length) : 0;
  const attemptedAvg = attempted.length ? Math.round(attempted.reduce((s, r) => s + (r.overall_confidence_score || 0), 0) / attempted.length) : 0;
  const clusterCounts = {};
  results.filter((r) => r.import_status !== "pass").forEach((r) => { clusterCounts[r.suggested_fix_category] = (clusterCounts[r.suggested_fix_category] || 0) + 1; });
  const topFailures = Object.entries(clusterCounts)
    .filter(([k]) => k && k !== "none")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));
  const byId = new Map(results.map((r) => [r.id, r]));
  const top25 = (manifest.must_pass_top_25 || []).map((x) => {
    const r = byId.get(x.id);
    return { id: x.id, status: r ? r.import_status : "not run", confidence: r ? r.overall_confidence_score : null, must_preserve: x.must_preserve || x.preserve_notes || "" };
  });
  const top10 = (manifest.nightmare_top_10 || []).map((x) => {
    const r = byId.get(x.id);
    return { id: x.id, status: r ? r.import_status : "not run", confidence: r ? r.overall_confidence_score : null, must_preserve: x.must_preserve || x.preserve_notes || "" };
  });
  const manifestCount = (manifest.entries || []).length;
  const attemptedCount = attempted.length;
  const pct = (num, den) => den ? Number(((num / den) * 100).toFixed(1)) : null;
  const bySourceType = {};
  results.forEach((r) => {
    const key = r.source_type || "unknown";
    if (!bySourceType[key]) bySourceType[key] = { count: 0, attempted: 0, skipped: 0, average_confidence: 0, total_confidence: 0 };
    bySourceType[key].count += 1;
    bySourceType[key].total_confidence += r.overall_confidence_score || 0;
    if (r.import_status === "skipped") bySourceType[key].skipped += 1;
    else bySourceType[key].attempted += 1;
  });
  Object.keys(bySourceType).forEach((key) => {
    bySourceType[key].average_confidence = Math.round(bySourceType[key].total_confidence / bySourceType[key].count);
    delete bySourceType[key].total_confidence;
  });
  const skipClassifications = skipped.reduce((acc, r) => {
    const key = r.skip_classification || "unclassified";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const skippedDetails = skipped.map((r) => ({
    id: r.id,
    title: r.title,
    source_type: r.source_type,
    difficulty_category: r.difficulty_category,
    skip_classification: r.skip_classification || "unclassified",
    skip_acceptability: r.skip_acceptability || "unclassified",
    reason: r.notes,
  }));
  return {
    manifest_count: manifestCount,
    recipes_tested: results.length,
    attempted_count: attemptedCount,
    skipped_count: skipped.length,
    counts,
    pass_rate_among_attempted: pct(counts.pass, attemptedCount),
    deterministic_pass_rate: pct(counts.pass, attemptedCount),
    ai_fallback_pass_rate: LIVE_AI ? pct(results.filter((r) => /AI|transcript|social/i.test(r.extraction_method_used || "") && r.import_status === "pass").length, results.filter((r) => /AI|transcript|social/i.test(r.extraction_method_used || "") && r.import_status !== "skipped").length) : null,
    total_coverage_rate: pct(attemptedCount, manifestCount),
    true_fail_rate_among_attempted: pct(counts.fail, attemptedCount),
    average_confidence_score: avg,
    average_attempted_confidence_score: attemptedAvg,
    confidence_by_source_type: bySourceType,
    top_failure_categories: topFailures,
    failure_clusters: topFailures,
    true_failures: results.filter((r) => r.import_status === "fail"),
    skipped_but_acceptable_cases: skippedDetails.filter((r) => r.skip_acceptability === "skipped-but-acceptable"),
    skipped_and_needs_product_work_cases: skippedDetails.filter((r) => r.skip_acceptability === "skipped-and-needs-product-work"),
    skipped_and_needs_manifest_replacement_cases: skippedDetails.filter((r) => r.skip_acceptability === "skipped-and-needs-manifest-replacement"),
    skipped_classification_counts: skipClassifications,
    ai_fallback_requested: LIVE_AI,
    ai_fallback_implemented: false,
    ai_key_available: AI_KEY_AVAILABLE,
    estimated_ai_fallback_candidates: skipped.filter((r) => ["ai_fallback_needed", "video_transcript_needed", "social_fallback_needed", "ambiguous_source_content"].includes(r.skip_classification)).length,
    estimated_ai_credits_if_run: skipped.filter((r) => ["ai_fallback_needed", "video_transcript_needed", "social_fallback_needed", "ambiguous_source_content"].includes(r.skip_classification)).length,
    top25_must_pass_status: top25,
    top10_nightmare_status: top10,
  };
}

function markdown(report) {
  const lines = [];
  const mdText = (value) => String(value || "").replace(/\|/g, "\\|");
  lines.push("# Nightmare Recipe Import Report");
  lines.push("");
  lines.push("- Generated: " + report.generated_at);
  lines.push("- Manifest: `" + path.relative(ROOT, report.manifest_path) + "`");
  lines.push("- Total manifest count: " + report.summary.manifest_count);
  lines.push("- Recipes tested: " + report.summary.recipes_tested);
  lines.push("- Attempted imports: " + report.summary.attempted_count);
  lines.push("- Skipped: " + report.summary.skipped_count);
  lines.push("- Pass / partial / fail / skipped: " + ["pass", "partial", "fail", "skipped"].map((k) => report.summary.counts[k] || 0).join(" / "));
  lines.push("- Pass rate among attempted imports: " + report.summary.pass_rate_among_attempted + "%");
  lines.push("- True fail rate among attempted imports: " + report.summary.true_fail_rate_among_attempted + "%");
  lines.push("- Total manifest coverage: " + report.summary.total_coverage_rate + "%");
  lines.push("- AI fallback pass rate: " + (report.summary.ai_fallback_pass_rate == null ? "not run" : report.summary.ai_fallback_pass_rate + "%"));
  lines.push("- AI fallback requested: " + (report.summary.ai_fallback_requested ? "yes" : "no"));
  lines.push("- AI fallback implemented in harness: " + (report.summary.ai_fallback_implemented ? "yes" : "no"));
  lines.push("- Estimated AI fallback candidates: " + report.summary.estimated_ai_fallback_candidates);
  lines.push("- Estimated AI credits if fallback run: " + report.summary.estimated_ai_credits_if_run);
  lines.push("- Average confidence: " + report.summary.average_confidence_score);
  lines.push("- Average attempted confidence: " + report.summary.average_attempted_confidence_score);
  lines.push("- AI fallback: " + (report.options.ai_enabled ? "enabled" : "disabled"));
  lines.push("");
  lines.push("## Skip Classification");
  const skipCounts = report.summary.skipped_classification_counts || {};
  Object.keys(skipCounts).sort().forEach((key) => lines.push(`- ${key}: ${skipCounts[key]}`));
  if (!Object.keys(skipCounts).length) lines.push("None.");
  lines.push("");
  lines.push("## Coverage By Source Type");
  lines.push("| source type | count | attempted | skipped | avg confidence |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  Object.entries(report.summary.confidence_by_source_type || {}).forEach(([sourceType, stats]) => {
    lines.push(`| ${sourceType} | ${stats.count} | ${stats.attempted} | ${stats.skipped} | ${stats.average_confidence} |`);
  });
  lines.push("");
  lines.push("## Top Failure Categories");
  report.summary.top_failure_categories.forEach((x, i) => lines.push(`${i + 1}. ${x.category}: ${x.count}`));
  if (!report.summary.top_failure_categories.length) lines.push("None.");
  lines.push("");
  lines.push("## Top 25 Must-Pass Status");
  lines.push("| id | status | confidence | must preserve |");
  lines.push("| --- | --- | ---: | --- |");
  report.summary.top25_must_pass_status.forEach((x) => lines.push(`| ${x.id} | ${x.status} | ${x.confidence == null ? "" : x.confidence} | ${mdText(x.must_preserve)} |`));
  lines.push("");
  lines.push("## Top 10 Nightmare Status");
  lines.push("| id | status | confidence | must preserve |");
  lines.push("| --- | --- | ---: | --- |");
  report.summary.top10_nightmare_status.forEach((x) => lines.push(`| ${x.id} | ${x.status} | ${x.confidence == null ? "" : x.confidence} | ${mdText(x.must_preserve)} |`));
  lines.push("");
  lines.push("## Skipped But Acceptable");
  if (report.summary.skipped_but_acceptable_cases.length) {
    report.summary.skipped_but_acceptable_cases.forEach((x) => lines.push(`- ${x.id}: ${x.skip_classification} (${x.source_type})`));
  } else {
    lines.push("None.");
  }
  lines.push("");
  lines.push("## Skipped And Needs Product Work");
  if (report.summary.skipped_and_needs_product_work_cases.length) {
    report.summary.skipped_and_needs_product_work_cases.forEach((x) => lines.push(`- ${x.id}: ${x.skip_classification} (${x.source_type})`));
  } else {
    lines.push("None.");
  }
  lines.push("");
  lines.push("## True Failures");
  if (report.summary.true_failures.length) {
    report.summary.true_failures.forEach((x) => lines.push(`- ${x.id}: ${x.suggested_fix_category}`));
  } else {
    lines.push("None.");
  }
  lines.push("");
  lines.push("## Fixes Applied This Run");
  (report.summary.top_fixed_failure_categories || []).forEach((x) => lines.push(`- ${x}`));
  if (!report.summary.top_fixed_failure_categories.length) lines.push("None recorded in this run.");
  lines.push("");
  lines.push("## Results");
  lines.push("| id | status | skip class | confidence | method | source/parsed ingredients | fix category | notes |");
  lines.push("| --- | --- | --- | ---: | --- | ---: | --- | --- |");
  report.results.forEach((r) => {
    const notes = (r.notes || []).join("; ").replace(/\|/g, "\\|");
    lines.push(`| ${r.id} | ${r.import_status} | ${r.skip_classification || ""} | ${r.overall_confidence_score} | ${r.extraction_method_used} | ${r.ingredient_count_source ?? ""}/${r.ingredient_count_parsed ?? ""} | ${r.suggested_fix_category} | ${notes} |`);
  });
  lines.push("");
  lines.push("## Debug Outputs");
  lines.push("Per-recipe source summaries, raw structured extraction, and normalized RecipeBox JSON are in `tests/results/imports/nightmare-debug/`.");
  return lines.join("\n") + "\n";
}

(async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) throw new Error("Nightmare manifest not found at " + MANIFEST_PATH);
  ensureDir(DEBUG_DIR);
  const manifest = readJson(MANIFEST_PATH);
  const entries = orderedEntries(manifest);
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    process.stdout.write(`[${i + 1}/${entries.length}] ${entry.id} ${entry.title} ... `);
    try {
      const result = await runEntry(entry);
      results.push(result);
      process.stdout.write(`${result.import_status} (${result.overall_confidence_score})\n`);
    } catch (err) {
      const fail = {
        id: entry.id,
        title: entry.title,
        url: entry.url,
        source_type: entry.source_type,
        difficulty_category: entry.difficulty_category,
        priority: entry.priority,
        import_status: "fail",
        extraction_method_used: "fallback",
        title_match_confidence: 0,
        ingredient_count_source: null,
        ingredient_count_parsed: 0,
        instruction_step_count_source: null,
        instruction_step_count_parsed: 0,
        missing_ingredients: [],
        extra_hallucinated_ingredients: [],
        quantity_mismatches: [],
        unit_mismatches: [],
        source_provided_metric_preserved: "not applicable",
        directions_include_quantities: "not applicable",
        temperature_handling: "fail",
        timer_extraction: "fail",
        section_preservation: "fail",
        overall_confidence_score: 0,
        notes: [err.message],
        suggested_fix_category: "harness/runtime failure",
      };
      results.push(fail);
      process.stdout.write(`fail (${err.message})\n`);
    }
    await sleep(FETCH_DELAY);
  }
  const summary = aggregate(results, manifest);
  const report = {
    generated_at: new Date().toISOString(),
    manifest_path: MANIFEST_PATH,
    options: {
      ai_enabled: LIVE_AI,
      ai_key_available: AI_KEY_AVAILABLE,
      ai_fallback_implemented: false,
      server: SERVER,
      limit: LIMIT || null,
      ids: IDS ? Array.from(IDS) : null,
      categories: CATEGORIES ? Array.from(CATEGORIES) : null,
      priorities: PRIORITIES ? Array.from(PRIORITIES) : null,
    },
    summary: {
      recipes_tested: results.length,
      ...summary,
      top_fixed_failure_categories: FIXES_APPLIED_THIS_RUN,
    },
    results,
  };
  writeJson(REPORT_JSON, report);
  fs.writeFileSync(REPORT_MD, markdown(report));
  console.log("\nWrote " + path.relative(ROOT, REPORT_JSON));
  console.log("Wrote " + path.relative(ROOT, REPORT_MD));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
