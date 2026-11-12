#!/usr/bin/env node
"use strict";
// M1 recipe-model evaluation. $0: makes no network or AI calls.
//
//   node scripts/recipe-model/eval.js               compare with the committed baseline (exit 1 on any change)
//   node scripts/recipe-model/eval.js --write-baseline   record a new baseline (review the diff before committing)
//   node scripts/recipe-model/eval.js --json        print the full report
//
// Subjects:
//   extractor  — today's deterministic JSON-LD/microdata path (packages/recipe-core/src/recipe-extract.js),
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
const Extract = require(path.join(ROOT, "packages", "recipe-core", "src", "recipe-extract.js"));
const Normalize = require(path.join(ROOT, "packages", "recipe-core", "src", "recipe-normalize.js"));
const { score, referenceOutput } = require("./scorer");
const { validate } = require("./validate");

const args = new Set(process.argv.slice(2));

function loadCases(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".case.json")).sort()
    .map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), _dir: dir }));
}

function runExtractor(c) {
  if (c.input.kind === "video") return { skipped: "video metadata comes from the server import path, which this $0 harness does not call" };
  if (c.input.kind !== "html") return { skipped: "not an HTML source; needs the AI path" };
  const html = fs.readFileSync(path.join(c._dir, c.input.file), "utf8");
  const r = Extract.extractFromHtml(html, { url: c.input.url });
  if (!r || !r.recipe) return { output: null };
  return { output: { ...r.recipe, sourceUrl: c.input.url } }; // mirrors src/app.jsx: parsed.sourceUrl = pageData.finalUrl || url
}

// The app's own post-processing of every import (src/app.jsx sanitizeImportedRecipe, stage 2):
// normalizeRecipe then quantityAwareDirections. Stage 1 there (an equipment-word filter) lives
// inline in the web app and is not reproduced here.
function runAppDeterministic(c) {
  const ex = runExtractor(c);
  if (ex.skipped || !ex.output) return ex;
  const copy = JSON.parse(JSON.stringify(ex.output));
  return { output: Normalize.quantityAwareDirections(Normalize.normalizeRecipe(copy)) };
}

function summarise(results) {
  const agg = {};
  const bump = (k, n, d) => { agg[k] = agg[k] || { n: 0, d: 0 }; agg[k].n += n; agg[k].d += d; };
  const detection = {}, modification = {};
  for (const r of results) {
    const m = r.metrics; if (!m) continue;
    bump("ingredients found", m.ingredients.found, m.ingredients.total);
    bump("quantities correct", m.quantities.correct, m.quantities.checked);
    bump("quantities written as the source wrote them", m.quantities.faithful, m.quantities.checked);
    if (m.quantities.unreadable) bump("unreadable quantities flagged", m.quantities.unreadableFlagged, m.quantities.unreadable);
    if (m.sections) bump("ingredients in the right section", m.sections.correct, m.sections.checked);
    if (m.links) { bump("step links recall", m.links.correct, m.links.truthPairs); bump("step links precision", m.links.correct, m.links.outputPairs); }
    if (m.portions) bump("step portions correct", m.portions.correct, m.portions.total);
    if (m.preparations) bump("preparations not listed as ingredients", m.preparations.ok, m.preparations.total);
    if (m.contradictions) bump("contradictions surfaced", m.contradictions.surfaced, m.contradictions.total);
    if (m.suppression) bump("unknown fields left blank", m.suppression.ok, m.suppression.total);
    if (m.source) bump("source fields captured", m.source.ok, m.source.total);
    if (m.steps && m.steps.keepPhrases) bump("step wording preserved", m.steps.keepPhrases - m.steps.wordingChanged, m.steps.keepPhrases);
    for (const [k, v] of Object.entries(m.classes.detection)) detection[k] = (detection[k] || 0) + v;
    for (const [k, v] of Object.entries(m.classes.modification)) modification[k] = (modification[k] || 0) + v;
  }
  const metrics = {};
  for (const [k, { n, d }] of Object.entries(agg)) metrics[k] = { score: n, of: d, pct: d ? Math.round((n / d) * 1000) / 10 : null };
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort());
  return { metrics, detection: sortObj(detection), modification: sortObj(modification) };
}

function evalCases(cases) {
  const subjects = { extractor: [], appDeterministic: [], reference: [] };
  const pending = [], notApplicable = [];
  for (const c of cases) {
    const ex = runExtractor(c);
    subjects.extractor.push(ex.skipped ? { id: c.id, skipped: ex.skipped } : { id: c.id, metrics: score(c.truth, ex.output) });
    const ap = runAppDeterministic(c);
    subjects.appDeterministic.push(ap.skipped ? { id: c.id, skipped: ap.skipped } : { id: c.id, metrics: score(c.truth, ap.output) });
    subjects.reference.push({ id: c.id, metrics: score(c.truth, referenceOutput(c.truth)) });
    if (c.input.kind === "text") pending.push(c.id);
    if (c.input.kind === "video") notApplicable.push(c.id);
  }
  return { subjects, summary: { extractor: summarise(subjects.extractor), appDeterministic: summarise(subjects.appDeterministic), reference: summarise(subjects.reference) },
    pendingPaid: pending, pendingServerPath: notApplicable };
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

// Structural audit of recorded production-pipeline outputs. The facts are read
// from tests/recipe-model/recorded-structure.json: per-case counts only, never
// recipe text, so the audit doesn't depend on third-party recipe content being
// in the repository. `--refresh-recorded` regenerates that file from the raw
// outputs in tests/results/imports/nightmare-debug when they are present locally.
const RECORDED_SNAPSHOT = path.join(DIR, "recorded-structure.json");
const RECORDED_RAW = path.join(ROOT, "tests", "results", "imports", "nightmare-debug");

function recordedFacts(id, r) {
  const f = { id, sections: (r.sections || []).length, steps: 0, stepsWithRefs: 0, ingredients: 0, ingredientsReferenced: 0, unresolvedRefs: 0,
    divided: 0, preparationLike: 0, optionalOnlyInName: 0, floatArtefacts: 0, decimalAmounts: 0 };
  const ids = new Set(), refd = new Set();
  for (const s of r.sections || []) for (const g of s.ingredients || []) {
    f.ingredients++; ids.add(g.id);
    const name = String(g.name || "");
    if (/\bdivided\b/i.test(name + " " + (g.raw || ""))) f.divided++;
    if (/\b(mixture|batter|dough|crumble|reserved|prepared)\b/i.test(name)) f.preparationLike++;
    if (/\boptional\b/i.test(name) && g.optional === undefined) f.optionalOnlyInName++;
    if (/\.\d{3,}/.test(String(g.amount || ""))) f.floatArtefacts++;
    if (/^\d*\.\d+$/.test(String(g.amount || ""))) f.decimalAmounts++;
  }
  for (const s of r.sections || []) for (const st of s.steps || []) {
    f.steps++;
    const refs = st.ingredientRefs || [];
    if (refs.length) f.stepsWithRefs++;
    for (const x of refs) { const k = typeof x === "string" ? x : x && x.id; if (ids.has(k)) refd.add(k); else f.unresolvedRefs++; }
  }
  f.ingredientsReferenced = refd.size;
  return f;
}

function refreshRecordedSnapshot() {
  if (!fs.existsSync(RECORDED_RAW)) throw new Error("no raw recorded outputs at " + path.relative(ROOT, RECORDED_RAW));
  const facts = [];
  for (const id of fs.readdirSync(RECORDED_RAW).sort()) {
    const p = path.join(RECORDED_RAW, id, "normalized.json");
    if (fs.existsSync(p)) facts.push(recordedFacts(id, JSON.parse(fs.readFileSync(p, "utf8"))));
  }
  fs.writeFileSync(RECORDED_SNAPSHOT, JSON.stringify({ source: "tests/results/imports/nightmare-debug/*/normalized.json (structure only; no recipe text)", recipes: facts }, null, 1) + "\n");
  return facts.length;
}

function auditRecorded() {
  if (!fs.existsSync(RECORDED_SNAPSHOT)) return null;
  const facts = JSON.parse(fs.readFileSync(RECORDED_SNAPSHOT, "utf8")).recipes;
  const a = { recipes: 0, multiSection: 0, steps: 0, stepsWithRefs: 0, ingredients: 0, ingredientsReferenced: 0, unresolvedRefs: 0,
    dividedWithoutPortions: 0, preparationLikeIngredients: 0, optionalOnlyInName: 0, floatArtefacts: 0, decimalAmounts: 0, examples: {} };
  const ex = (k, id) => { (a.examples[k] = a.examples[k] || []).length < 8 && !a.examples[k].includes(id) && a.examples[k].push(id); };
  const MAP = { dividedWithoutPortions: "divided", preparationLikeIngredients: "preparationLike", optionalOnlyInName: "optionalOnlyInName", floatArtefacts: "floatArtefacts", decimalAmounts: "decimalAmounts" };
  for (const f of facts) {
    a.recipes++;
    if (f.sections > 1) a.multiSection++;
    for (const k of ["steps", "stepsWithRefs", "ingredients", "ingredientsReferenced", "unresolvedRefs"]) a[k] += f[k];
    for (const [k, src] of Object.entries(MAP)) { a[k] += f[src]; if (f[src]) ex(k, f.id); }
  }
  a.examples = Object.fromEntries(Object.entries(a.examples).sort());
  return a;
}

if (args.has("--refresh-recorded")) console.log(`recorded-structure.json refreshed from ${refreshRecordedSnapshot()} raw outputs`);

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
for (const [k, v] of Object.entries(report.summary.reference.metrics)) if (v.pct !== null && v.pct !== 100) problems.push(`reference output scores ${v.pct}% on "${k}" (scorer bug)`);
for (const cls of ["detection", "modification"]) if (Object.keys(report.summary.reference[cls]).length) problems.push(`reference output has ${cls} findings (scorer bug)`);
// Determinism: a second, independent run must produce byte-identical results.
if (JSON.stringify(stable({ ...evalCases(loadCases(path.join(DIR, "cases"))), adjustments: evalAdjustments(), recordedAudit: auditRecorded() })) !==
    JSON.stringify({ subjects: report.subjects, summary: report.summary, pendingPaid: report.pendingPaid, pendingServerPath: report.pendingServerPath, adjustments: report.adjustments, recordedAudit: report.recordedAudit }))
  problems.push("two runs in the same process produced different results (non-deterministic)");
if (report.adjustments.agrees !== report.adjustments.total) problems.push(`validator disagrees with ${report.adjustments.total - report.adjustments.agrees} adjustment expectation(s)`);

const baselinePath = path.join(DIR, "baseline.json");
function printSubject(title, sx) {
  console.log(title);
  for (const [k, v] of Object.entries(sx.metrics)) console.log(`  ${k.padEnd(46)} ${String(v.score).padStart(3)} / ${String(v.of).padEnd(3)} ${v.pct === null ? "  n/a" : (v.pct + "%").padStart(6)}`);
  const line = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  console.log(`  Detection failures (recipe intact, problem not noticed or expressed): ${line(sx.detection)}`);
  console.log(`  Modifications (the recipe itself was changed): ${line(sx.modification)}\n`);
}
function printSummary() {
  const sx = report.summary.extractor;
  console.log(`recipe-model eval: ${publicCases.length} public case(s), ${privateCases.length} private case(s)\n`);
  printSubject("Deterministic extractor alone (structured-data HTML cases):", sx);
  printSubject("Extractor + the app's normalisation stage (what a user gets for a free structured import):", report.summary.appDeterministic);
  console.log(`Validator on adjustment candidates: ${report.adjustments.agrees}/${report.adjustments.total} as expected`);
  const ra = report.recordedAudit;
  if (ra) console.log(`Recorded outputs audited: ${ra.recipes} recipes, ${ra.stepsWithRefs}/${ra.steps} steps carry ingredient links, ${ra.unresolvedRefs} invalid references, ${ra.dividedWithoutPortions} "divided" ingredients with no portions, ${ra.floatArtefacts} float artefacts`);
  console.log(`Pending, not run: ${report.pendingPaid.length} paid AI-path case(s); ${report.pendingServerPath.length} server-path case(s)`);
  console.log("Determinism: second run identical");
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
