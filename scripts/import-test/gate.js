#!/usr/bin/env node
/*
 * Regression gate for import accuracy. Compares a fresh results.<tag>.json run
 * against scripts/import-test/baseline.json and fails (exit 1) if accuracy
 * regressed — so a future prompt/pipeline change can't silently make imports
 * worse. Also runs analyze.js's hard-violation gate (refs / empty names /
 * substitutions) over the same run.
 *
 *   node gate.js <tag>            check a results run against the baseline
 *   node gate.js --save <tag>     (re)write baseline.json from a results run
 *
 * The gate needs a fresh run to check (a real, paid extraction pass); the
 * comparison itself is free. Typical use after a prompt change:
 *   node run.js --run --out=check --only=url,pdf,text   (then)   node gate.js check
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const BASELINE = path.join(ROOT, 'baseline.json');
const manifestPath = fs.existsSync(path.join(ROOT, 'manifest.local.json')) ? path.join(ROOT, 'manifest.local.json') : path.join(ROOT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const flagById = {};
for (const t of manifest.tests) flagById[t.id] = { expectFallback: !!(t.expectedBlocked || t.expectedMultipleRecipes) };

const recallOf = (x) => (x && x.expectation && x.expectation.knownIngredients) ? x.expectation.foundIngredients / x.expectation.knownIngredients : null;
const ingCount = (x) => (x && x.recipe && (x.recipe.sections || []).reduce((n, s) => n + (s.ingredients || []).length, 0)) || (x && x.parsed && x.parsed.ingredients ? x.parsed.ingredients.length : 0);

function resultsFor(tag) {
  const p = path.join(ROOT, 'out', `results.${tag}.json`);
  if (!fs.existsSync(p)) { console.error('No results file: ' + p); process.exit(2); }
  const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Object.fromEntries(arr.map((x) => [x.id, x]));
}

// ── --save: (re)write baseline ──
if (process.argv.includes('--save')) {
  const tag = process.argv[process.argv.indexOf('--save') + 1];
  const fresh = resultsFor(tag);
  const tests = {};
  for (const [id, x] of Object.entries(fresh)) {
    const rc = recallOf(x);
    tests[id] = {
      category: x.category,
      expectFallback: !!(flagById[id] && flagById[id].expectFallback),
      parsed: !!x.ok,
      recall: rc == null ? null : +rc.toFixed(3),
      titleMatch: x.expectation ? !!x.expectation.titleMatch : null,
    };
  }
  fs.writeFileSync(BASELINE, JSON.stringify({ generated: new Date().toISOString(), model: 'claude-sonnet-5', tolerance: 0.10, note: 'Per-test accuracy floor for the import pipeline. Regenerate with: node gate.js --save <tag>', tests }, null, 2));
  console.log('baseline.json written from ' + tag + ' (' + Object.keys(tests).length + ' tests)');
  process.exit(0);
}

// ── default: check a run against baseline ──
const tag = process.argv[2];
if (!tag) { console.error('usage: node gate.js <tag>   |   node gate.js --save <tag>'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const TOL = base.tolerance != null ? base.tolerance : 0.10;
const fresh = resultsFor(tag);

const fails = [], warns = [], skipped = [];
for (const [id, b] of Object.entries(base.tests)) {
  const f = fresh[id];
  if (!f) { skipped.push(id + ' (not in run)'); continue; }
  if (/budget/.test(f.status || '')) { skipped.push(id + ' (budget-skipped)'); continue; }

  // "Should fail" fixtures: must NOT start producing a populated recipe.
  if (b.expectFallback) {
    if (f.ok && ingCount(f) >= 3) fails.push(`${id}: should have honestly failed but produced a ${ingCount(f)}-ingredient recipe (hallucination regression)`);
    continue;
  }
  // Parsed-in-baseline must still parse.
  if (b.parsed && !f.ok) { fails.push(`${id}: regressed to JSON/parse failure (${f.status})`); continue; }
  // Recall floor.
  if (b.recall != null) {
    const rc = recallOf(f);
    if (rc == null) warns.push(`${id}: lost ground-truth scoring`);
    else if (rc < b.recall - TOL) fails.push(`${id}: ingredient recall ${(rc * 100).toFixed(0)}% < baseline ${(b.recall * 100).toFixed(0)}% - ${TOL * 100}%`);
  }
  // Title match must not be lost.
  if (b.titleMatch && f.expectation && f.expectation.titleMatch === false) warns.push(`${id}: title match lost (baseline matched)`);
}

console.log(`\n=== Import accuracy gate: ${tag} vs baseline (${Object.keys(base.tests).length} tests, tol ${TOL * 100}%) ===`);
if (warns.length) { console.log('\nWARN:'); warns.forEach((w) => console.log('  ⚠ ' + w)); }
if (skipped.length) console.log(`\nskipped: ${skipped.length} (not run / budget)`);

// Hard structural/substitution violations over the same run.
let analyzeFail = false;
try { execFileSync('node', [path.join(ROOT, 'analyze.js'), tag, '--gate'], { stdio: 'inherit' }); }
catch { analyzeFail = true; }

if (fails.length || analyzeFail) {
  console.log('\nFAIL:');
  fails.forEach((x) => console.log('  ✗ ' + x));
  if (analyzeFail) console.log('  ✗ analyze.js hard-violation gate failed (see above)');
  console.log(`\nGATE FAILED: ${fails.length} accuracy regression(s).`);
  process.exit(1);
}
console.log(`\nGATE PASSED: no regressions vs baseline (${warns.length} warning(s)).`);
