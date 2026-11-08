#!/usr/bin/env node
"use strict";
// M1 recipe-model evaluation. $0: makes no network or AI calls.
//
//   node scripts/recipe-model/eval.js               compare with the committed baseline (exit 1 on any change)
//   node scripts/recipe-model/eval.js --write-baseline   record a new baseline (review the diff before committing)
//   node scripts/recipe-model/eval.js --json        print the full report
//
// Subjects:
//   extractor  — today's deterministic JSON-LD/microdata path (public/recipe-extract.js),
//                plus the one line the app adds after it (sourceUrl = final URL).
//   reference  — the ideal target-model output built from each case's truth; must score 100%.
//   ai-*       — the paid AI paths. Never run here; listed as pending until a
//                budget is agreed (ADR 0017). Recorded responses will be scored from cache.
// Also: the recipe-model validator over adjustment candidates, and a structural
// audit of the 91 recorded production-pipeline outputs already in tests/results.
// Private cases (tests/recipe-model/private/cases) are scored to private/out/ only.

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const DIR = path.join(ROOT, "tests", "recipe-model");
const Extract = require(path.join(ROOT, "public", "recipe-extract.js"));
const { score, referenceOutput } = require("./scorer");
const { validate } = require("./validate");

const args = new Set(process.argv.slice(2));

function loadCases(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".case.json")).sort()
    .map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), _dir: dir }));
}

function runExtractor(c) {
  if (c.input.kind !== "html") return { skipped: "not an HTML source; needs the AI path" };
  const html = fs.readFileSync(path.join(c._dir, c.input.file), "utf8");
  const r = Extract.extractFromHtml(html, { url: c.input.url });
  if (!r || !r.recipe) return { output: null };
  return { output: { ...r.recipe, sourceUrl: c.input.url } }; // mirrors src/app.jsx: parsed.sourceUrl = pageData.finalUrl || url
}

function summarise(results) {
  const agg = {};
  const bump = (k, n, d) => { agg[k] = agg[k] || { n: 0, d: 0 }; agg[k].n += n; agg[k].d += d; };
  for (const r of results) {
    const m = r.metrics; if (!m) continue;
    bump("ingredients found", m.ingredients.found, m.ingredients.total);
    bump("quantities correct", m.quantities.correct, m.quantities.checked);
    bump("quantities written as the source wrote them", m.quantities.faithful, m.quantities.checked);
    bump("quantities not invented", (m.quantities.checked + m.quantities.unreadable) - m.quantities.invented, m.quantities.checked + m.quantities.unreadable);
    if (m.quantities.unreadable) bump("unreadable quantities flagged", m.quantities.unreadableFlagged, m.quantities.unreadable);
    if (m.sections) bump("ingredients in the right section", m.sections.correct, m.sections.checked);
    if (m.links) { bump("step links recall", m.links.correct, m.links.truthPairs); bump("step links precision", m.links.correct, m.links.outputPairs); }
    if (m.portions) bump("step portions correct", m.portions.correct, m.portions.total);
    if (m.preparations) bump("preparations not listed as ingredients", m.preparations.ok, m.preparations.total);
    if (m.contradictions) bump("contradictions surfaced", m.contradictions.surfaced, m.contradictions.total);
    if (m.suppression) bump("unknown fields left blank", m.suppression.ok, m.suppression.total);
    if (m.source) bump("source fields captured", m.source.ok, m.source.total);
  }
  const out = {};
  for (const [k, { n, d }] of Object.entries(agg)) out[k] = { score: n, of: d, pct: d ? Math.round((n / d) * 1000) / 10 : null };
  return out;
}

function evalCases(cases) {
  const subjects = { extractor: [], reference: [] };
  const pending = [];
  for (const c of cases) {
    const ex = runExtractor(c);
    subjects.extractor.push(ex.skipped ? { id: c.id, skipped: ex.skipped } : { id: c.id, metrics: score(c.truth, ex.output) });
    subjects.reference.push({ id: c.id, metrics: score(c.truth, referenceOutput(c.truth)) });
    if (c.input.kind !== "html") pending.push(c.id);
  }
  return { subjects, summary: { extractor: summarise(subjects.extractor), reference: summarise(subjects.reference) }, pendingPaid: pending };
}

function evalAdjustments() {
  const dir = path.join(DIR, "adjustments");
  const res = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".adjust.json")).sort()) {
    const a = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const c of a.candidates) {
      const got = [...new Set(validate(a.base, c.recipe, c.change).map((v) => v.code))].sort();
      const want = [...c.expect].sort();
      res.push({ fixture: a.id, candidate: c.label, expected: want, got, agrees: JSON.stringify(got) === JSON.stringify(want) });
    }
  }
  return { total: res.length, agrees: res.filter((r) => r.agrees).length, results: res };
}

// Structural audit of recorded outputs. Reports counts and case ids only, never recipe text.
function auditRecorded() {
  const dir = path.join(ROOT, "tests", "results", "imports", "nightmare-debug");
  if (!fs.existsSync(dir)) return null;
  const a = { recipes: 0, multiSection: 0, steps: 0, stepsWithRefs: 0, ingredients: 0, ingredientsReferenced: 0, unresolvedRefs: 0,
    dividedWithoutPortions: 0, preparationLikeIngredients: 0, optionalOnlyInName: 0, floatArtefacts: 0, decimalAmounts: 0, examples: {} };
  const ex = (k, id) => { (a.examples[k] = a.examples[k] || []).length < 8 && !a.examples[k].includes(id) && a.examples[k].push(id); };
  for (const id of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, id, "normalized.json");
    if (!fs.existsSync(p)) continue;
    const r = JSON.parse(fs.readFileSync(p, "utf8"));
    a.recipes++;
    if ((r.sections || []).length > 1) a.multiSection++;
    const ids = new Set(), refd = new Set();
    for (const s of r.sections || []) for (const g of s.ingredients || []) {
      a.ingredients++; ids.add(g.id);
      const name = String(g.name || "");
      if (/\bdivided\b/i.test(name + " " + (g.raw || ""))) { a.dividedWithoutPortions++; ex("dividedWithoutPortions", id); }
      if (/\b(mixture|batter|dough|crumble|reserved|prepared)\b/i.test(name)) { a.preparationLikeIngredients++; ex("preparationLikeIngredients", id); }
      if (/\boptional\b/i.test(name) && g.optional === undefined) { a.optionalOnlyInName++; ex("optionalOnlyInName", id); }
      if (/\.\d{3,}/.test(String(g.amount || ""))) { a.floatArtefacts++; ex("floatArtefacts", id); }
      if (/^\d*\.\d+$/.test(String(g.amount || ""))) { a.decimalAmounts++; ex("decimalAmounts", id); }
    }
    for (const s of r.sections || []) for (const st of s.steps || []) {
      a.steps++;
      const refs = st.ingredientRefs || [];
      if (refs.length) a.stepsWithRefs++;
      for (const x of refs) { const k = typeof x === "string" ? x : x && x.id; if (ids.has(k)) refd.add(k); else a.unresolvedRefs++; }
    }
    a.ingredientsReferenced += refd.size;
  }
  return a;
}

function stable(o) { return JSON.parse(JSON.stringify(o)); }

const publicCases = loadCases(path.join(DIR, "cases"));
const report = stable({
  harness: "recipe-model M1",
  cases: publicCases.map((c) => ({ id: c.id, categories: c.categories, input: c.input.kind, synthetic: /synthetic/i.test(c.provenance) })),
  ...evalCases(publicCases),
  adjustments: evalAdjustments(),
  recordedAudit: auditRecorded(),
});

// Private cases: scored, written only to the gitignored private/out folder.
const privateCases = loadCases(path.join(DIR, "private", "cases"));
if (privateCases.length) {
  const outDir = path.join(DIR, "private", "out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(evalCases(privateCases), null, 1));
}

// Self-checks that make the baseline trustworthy.
const problems = [];
for (const [k, v] of Object.entries(report.summary.reference)) if (v.pct !== null && v.pct !== 100) problems.push(`reference output scores ${v.pct}% on "${k}" (scorer bug)`);
if (report.adjustments.agrees !== report.adjustments.total) problems.push(`validator disagrees with ${report.adjustments.total - report.adjustments.agrees} adjustment expectation(s)`);

const baselinePath = path.join(DIR, "baseline.json");
function printSummary() {
  console.log(`recipe-model eval: ${publicCases.length} public case(s), ${privateCases.length} private case(s)\n`);
  console.log("Current deterministic extractor (HTML cases only):");
  for (const [k, v] of Object.entries(report.summary.extractor)) console.log(`  ${k.padEnd(46)} ${String(v.score).padStart(3)} / ${String(v.of).padEnd(3)} ${v.pct === null ? "  n/a" : (v.pct + "%").padStart(6)}`);
  console.log(`\nValidator on adjustment candidates: ${report.adjustments.agrees}/${report.adjustments.total} as expected`);
  const ra = report.recordedAudit;
  if (ra) console.log(`Recorded outputs audited: ${ra.recipes} recipes, ${ra.stepsWithRefs}/${ra.steps} steps carry ingredient links, ${ra.dividedWithoutPortions} "divided" ingredients with no portions, ${ra.floatArtefacts} float artefacts`);
  console.log(`Paid AI subjects pending (not run): ${report.pendingPaid.length} case(s)`);
}

if (args.has("--json")) { console.log(JSON.stringify(report, null, 1)); process.exit(problems.length ? 1 : 0); }
printSummary();
if (problems.length) { console.error("\nSELF-CHECK FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
if (args.has("--write-baseline")) {
  fs.writeFileSync(baselinePath, JSON.stringify(report, null, 1) + "\n");
  console.log(`\nbaseline written: ${path.relative(ROOT, baselinePath)}`);
  process.exit(0);
}
if (!fs.existsSync(baselinePath)) { console.error("\nno baseline yet; run with --write-baseline"); process.exit(1); }
const base = fs.readFileSync(baselinePath, "utf8").trim();
if (base !== JSON.stringify(report, null, 1)) {
  console.error("\nRESULT DIFFERS FROM BASELINE. If the change is an intended improvement, review it and re-record with --write-baseline.");
  process.exit(1);
}
console.log("\nrecipe-model eval: matches baseline");
