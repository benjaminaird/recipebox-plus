#!/usr/bin/env node
/*
 * Deeper import-accuracy analysis over a results.<tag>.json run.
 * Goes beyond ingredient recall + title to catch the accuracy bugs that
 * "did it list the right ingredients?" misses:
 *
 *   - over-extraction / hallucination  (text modes): extracted ingredients whose
 *       key nouns don't appear in the source text at all.
 *   - amount grounding                 (text modes): distinctive quantities
 *       (fractions, multi-digit, ranges) the model wrote that aren't in source.
 *   - substitution audit               (text modes): high-signal ingredients
 *       present in source but missing from the extraction (likely swapped).
 *   - structural integrity             (all modes): ingredientRefs resolve, no
 *       empty ingredient names, unique ids, at least one ingredient + step.
 *   - servings / macros sanity         (all modes): positive integer servings,
 *       non-zero per-serving macros (the prompt promises both).
 *
 * Usage: node analyze.js sonnet3 [--gate]   (--gate exits 1 on hard violations)
 */
const fs = require('fs');
const path = require('path');
const tag = process.argv[2];
const GATE = process.argv.includes('--gate');
if (!tag) { console.error('usage: node analyze.js <results-tag> [--gate]'); process.exit(1); }
const results = require(path.join(__dirname, 'out', `results.${tag}.json`));

// High-signal ingredients ported verbatim from src/app.jsx (findSourceIngredientMismatches).
const HIGH_SIGNAL = [
  'half and half', 'heavy cream', 'heavy whipping cream', 'whipping cream', 'light cream',
  'buttermilk', 'evaporated milk', 'sweetened condensed milk', 'condensed milk',
  'creme fraiche', 'sour cream', 'mascarpone', 'ricotta', 'cream cheese',
  'coconut milk', 'coconut cream', 'almond milk', 'oat milk', 'soy milk',
  'cake flour', 'bread flour', 'self rising flour', 'almond flour', 'whole wheat flour',
  'powdered sugar', 'confectioners sugar', 'brown sugar', 'cornstarch', 'corn starch', 'cream of tartar',
];
// Normalize unicode vulgar fractions to "n/m" so source ¾/½/¼ match the model's
// prompted "3/4" form, and collapse punctuation/whitespace.
const UNICODE_FRAC = { '½':'1/2','⅓':'1/3','⅔':'2/3','¼':'1/4','¾':'3/4','⅕':'1/5','⅖':'2/5','⅗':'3/5','⅘':'4/5','⅙':'1/6','⅚':'5/6','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8' };
const unfrac = (s) => String(s || '').replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (c) => ' ' + UNICODE_FRAC[c]);
const norm = (s) => unfrac(s).toLowerCase().replace(/[-–—]+/g, ' ').replace(/&/g, 'and').replace(/[’']/g, '').replace(/\s+/g, ' ');
const EQUIV = [['heavy cream','heavy whipping cream','whipping cream'],['powdered sugar','confectioners sugar'],['cornstarch','corn starch']];
const STOP = new Set(['the','and','for','with','into','your','about','until','then','add','plus','from','very','fresh','large','small','medium','room','temperature','softened','melted','chopped','minced','diced','sliced','ground','optional','taste','to','of','or','a','an','cut','finely','thinly','well','more','as','needed','packed','sifted','divided','at','if','you','can','each','about','approximately']);
function keyNouns(name) {
  return norm(name).replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}
function ingredientsOf(r) {
  const secs = (r.recipe && r.recipe.sections) || [];
  return secs.flatMap((s) => (s.ingredients || []));
}
function stepsOf(r) {
  const secs = (r.recipe && r.recipe.sections) || [];
  return secs.flatMap((s) => (s.steps || []));
}
// distinctive amount tokens worth grounding (skip bare 0/1 — too common to be a signal)
function amountTokens(amount) {
  const toks = String(amount || '').toLowerCase().match(/\d+\/\d+|\d+\s+\d+\/\d+|\d{2,}|\d+\s*-\s*\d+/g) || [];
  return toks.map((t) => t.replace(/\s*-\s*/, '-').trim()).filter(Boolean);
}

const agg = {
  text: 0, all: 0,
  overExtract: 0, overExtractIng: 0, totalIngText: 0,
  amountUngrounded: 0, amountChecked: 0,
  subs: 0,
  structBad: 0, refUnresolved: 0, emptyNames: 0,
  servingsBad: 0, macrosBad: 0,
};
const flags = [];

for (const r of results) {
  if (!r.ok || !r.recipe) continue;
  agg.all++;
  const isText = !!(r.sourceText && r.sourceText.trim());
  const src = norm(r.sourceText);
  const ings = ingredientsOf(r);
  const steps = stepsOf(r);
  const local = [];

  // ── structural integrity (all modes) ──
  const ids = new Set();
  let emptyNames = 0, dupIds = 0;
  for (const ing of ings) {
    if (!String(ing.name || '').trim()) emptyNames++;
    if (ing.id) { if (ids.has(ing.id)) dupIds++; else ids.add(ing.id); }
  }
  let refUnresolved = 0;
  for (const st of steps) for (const ref of (st.ingredientRefs || [])) if (!ids.has(ref)) refUnresolved++;
  if (emptyNames) { agg.emptyNames += emptyNames; local.push(`${emptyNames} empty ingredient name(s)`); }
  if (refUnresolved) { agg.refUnresolved += refUnresolved; local.push(`${refUnresolved} unresolved step ref(s)`); }
  if (dupIds) local.push(`${dupIds} duplicate ingredient id(s)`);
  if (!ings.length) local.push('no ingredients');
  if (emptyNames || refUnresolved || dupIds || !ings.length) agg.structBad++;

  // ── servings + macros sanity (all modes) ──
  const sv = r.recipe.servings;
  if (!(Number.isFinite(Number(sv)) && Number(sv) > 0)) { agg.servingsBad++; local.push(`servings invalid (${JSON.stringify(sv)})`); }
  const mac = r.recipe.macros || {};
  const macVals = ['calories','protein','carbs','fat'].map((k) => Number(mac[k]) || 0);
  if (macVals.every((v) => v === 0)) { agg.macrosBad++; local.push('macros all zero'); }

  // ── text-only: grounding, over-extraction, substitution ──
  if (isText) {
    agg.text++;
    // over-extraction: ingredient whose key nouns are entirely absent from source
    let over = [];
    for (const ing of ings) {
      const nouns = keyNouns(ing.name);
      if (!nouns.length) continue;
      agg.totalIngText++;
      const grounded = nouns.some((n) => src.includes(n) || (n.endsWith('s') && src.includes(n.slice(0, -1))) || src.includes(n + 's'));
      if (!grounded) { over.push(ing.name); agg.overExtractIng++; }
    }
    if (over.length) { agg.overExtract++; local.push(`over-extracted (not in source): ${over.slice(0, 6).join(', ')}`); }

    // amount grounding: distinctive amount tokens not present in source
    let badAmts = [];
    for (const ing of ings) {
      const toks = amountTokens(ing.amount);
      for (const t of toks) {
        agg.amountChecked++;
        const found = src.includes(t) || src.includes(t.replace('-', ' to ')) || src.includes(t.replace('-', ' '));
        if (!found) { agg.amountUngrounded++; badAmts.push(`${ing.amount} ${ing.name}`.trim()); }
      }
    }
    if (badAmts.length) local.push(`amount not found in source: ${badAmts.slice(0, 5).join(' | ')}`);

    // substitution audit (mirrors app's findSourceIngredientMismatches, incl.
    // same-product equivalence). Skipped for 'url': blog pages carry reader
    // comments and "this recipe has no X" lines that aren't the recipe — the
    // app only audits youtube/social for the same reason.
    if (r.category !== 'url') {
      const ingNorm = norm(ings.map((i) => i.name).join(' '));
      const equivPresent = (term) => { const g = EQUIV.find((x) => x.includes(term)); return g ? g.some((t) => ingNorm.includes(t)) : false; };
      const subs = [];
      for (const term of HIGH_SIGNAL) if (src.includes(term) && !ingNorm.includes(term) && !equivPresent(term)) subs.push(term === 'half and half' ? 'half-and-half' : term);
      if (subs.length) { agg.subs++; local.push(`SUBSTITUTION? source has but recipe lacks: ${[...new Set(subs)].slice(0, 5).join(', ')}`); }
    }
  }

  if (local.length) flags.push({ id: r.id, mode: r.category, isText, local });
}

// ── report ──
console.log(`\n=== Deeper accuracy analysis: ${tag} ===  (${agg.all} parsed imports, ${agg.text} text-based)\n`);
console.log('--- per-import flags ---');
if (!flags.length) console.log('  (none — clean)');
for (const f of flags) {
  console.log(`\n• ${f.id} [${f.mode}${f.isText ? '' : ', vision'}]`);
  for (const l of f.local) console.log(`    - ${l}`);
}
const pct = (n, d) => d ? (n / d * 100).toFixed(1) + '%' : 'n/a';
console.log('\n--- aggregate ---');
console.log(`over-extraction:     ${agg.overExtract} imports with ungrounded ingredient(s); ${agg.overExtractIng}/${agg.totalIngText} text-ingredients ungrounded (precision ${pct(agg.totalIngText - agg.overExtractIng, agg.totalIngText)})`);
console.log(`amount grounding:    ${agg.amountUngrounded}/${agg.amountChecked} distinctive amounts not found in source (${pct(agg.amountChecked - agg.amountUngrounded, agg.amountChecked)} grounded)`);
console.log(`substitution audit:  ${agg.subs} import(s) flagged (high-signal ingredient in source but missing from recipe)`);
console.log(`structural integrity:${agg.structBad} import(s) with issues (${agg.refUnresolved} unresolved refs, ${agg.emptyNames} empty names)`);
console.log(`servings sanity:     ${agg.servingsBad}/${agg.all} invalid (non-positive / missing)`);
console.log(`macros sanity:       ${agg.macrosBad}/${agg.all} all-zero (prompt promises non-zero)`);

if (GATE) {
  // Hard violations = structural breakage or substitutions (correctness bugs).
  const hard = agg.refUnresolved + agg.emptyNames + agg.subs;
  if (hard > 0) { console.error(`\nGATE FAIL: ${hard} hard violation(s) (refs/empty-names/substitutions).`); process.exit(1); }
  console.log('\nGATE OK: no hard structural or substitution violations.');
}
