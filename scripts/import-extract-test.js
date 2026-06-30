/*
 * Offline deterministic-extraction benchmark + regression gate (Phase 0).
 *
 * No network, no API key, no AI: runs RecipeBoxExtract over labeled HTML fixtures
 * (scripts/import-test/fixtures/<id>.html + <id>.truth.json) and scores the
 * structured-data path field-by-field. This is the gate that lets the
 * deterministic-first import pipeline target ~100% on structured pages and
 * proves it can't silently regress. Run: `npm run import-extract-test`.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Extract = require("../public/recipe-extract");

const FIX_DIR = path.join(__dirname, "import-test", "fixtures");
// Hard thresholds for the deterministic path — structured data should be near-perfect.
const MIN_ING_RECALL = 0.95;
const MIN_ING_PRECISION = 0.95;

const andFraction = Extract.parseIngredientLine("1 and 1/2 cups (345g) mashed bananas");
assert.strictEqual(andFraction.amount, "1 1/2", "\"1 and 1/2\" parses as a mixed fraction amount");
assert.strictEqual(andFraction.unit, "cups");
assert.strictEqual(andFraction.name, "(345g) mashed bananas");

function normName(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9, ]/g, " ").replace(/\s+/g, " ").trim();
}
function ingMatch(truth, extractedNames) {
  const t = normName(truth);
  if (!t) return false;
  return extractedNames.some((e) => {
    const n = normName(e);
    return n === t || n.includes(t) || t.includes(n);
  });
}
function extractedIngredientNames(recipe) {
  const out = [];
  (recipe.sections || []).forEach((sec) => (sec.ingredients || []).forEach((i) => out.push(i.name || i.raw || "")));
  return out.filter(Boolean);
}
function countSteps(recipe) {
  return (recipe.sections || []).reduce((a, s) => a + ((s.steps || []).length), 0);
}

function loadFixtures() {
  if (!fs.existsSync(FIX_DIR)) throw new Error("fixtures dir missing: " + FIX_DIR);
  return fs.readdirSync(FIX_DIR)
    .filter((f) => f.endsWith(".truth.json"))
    .map((f) => {
      const id = f.replace(/\.truth\.json$/, "");
      const truth = JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), "utf8"));
      const html = fs.readFileSync(path.join(FIX_DIR, id + ".html"), "utf8");
      return { id, truth, html };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

let failures = 0;
const rows = [];
const fixtures = loadFixtures();

for (const { id, truth, html } of fixtures) {
  const res = Extract.extractFromHtml(html, {});
  const fail = [];

  if (truth.expectNull) {
    // The extractor MUST decline on unstructured pages (so the caller uses AI)
    // and never fabricate a recipe.
    if (res.recipe !== null) fail.push("expected null (no structured data) but got a recipe");
    rows.push({ id, ing: "—", steps: "—", ok: fail.length === 0 });
    if (fail.length) { failures++; console.error("FAIL " + id + ": " + fail.join("; ")); }
    continue;
  }

  if (!res.recipe) { failures++; rows.push({ id, ing: "0%", steps: "0", ok: false }); console.error("FAIL " + id + ": expected a recipe, extractor returned null"); continue; }
  const recipe = res.recipe;
  const names = extractedIngredientNames(recipe);

  if (truth.source && res.source !== truth.source) fail.push("source " + res.source + " != " + truth.source);
  if (typeof truth.complete === "boolean" && res.complete !== truth.complete) fail.push("complete " + res.complete + " != " + truth.complete);
  if (truth.title && normName(recipe.title) !== normName(truth.title)) fail.push("title '" + recipe.title + "' != '" + truth.title + "'");
  if (truth.servings != null && recipe.servings !== truth.servings) fail.push("servings " + recipe.servings + " != " + truth.servings);
  if (truth.hasTimes && !(recipe.prepTime || recipe.cookTime || recipe.totalTime)) fail.push("expected times, got none");
  if (truth.hasNutrition && !recipe.macros) fail.push("expected nutrition, got none");
  if (truth.stepCount != null && countSteps(recipe) !== truth.stepCount) fail.push("steps " + countSteps(recipe) + " != " + truth.stepCount);
  if (Array.isArray(truth.sectionNames)) {
    const got = (recipe.sections || []).map((s) => s.name).filter(Boolean);
    truth.sectionNames.forEach((n) => { if (!got.some((g) => normName(g) === normName(n))) fail.push("missing section '" + n + "'"); });
  }

  let recall = 1, precision = 1;
  if (Array.isArray(truth.ingredientNames) && truth.ingredientNames.length) {
    const matchedTruth = truth.ingredientNames.filter((t) => ingMatch(t, names)).length;
    recall = matchedTruth / truth.ingredientNames.length;
    const matchedExtracted = names.filter((e) => truth.ingredientNames.some((t) => ingMatch(t, [e]))).length;
    precision = names.length ? matchedExtracted / names.length : 0;
    if (recall < MIN_ING_RECALL) fail.push("ingredient recall " + recall.toFixed(2) + " < " + MIN_ING_RECALL);
    if (precision < MIN_ING_PRECISION) fail.push("ingredient precision " + precision.toFixed(2) + " < " + MIN_ING_PRECISION);
  }

  const ok = fail.length === 0;
  if (!ok) { failures++; console.error("FAIL " + id + ": " + fail.join("; ")); }
  rows.push({ id, ing: Math.round(recall * 100) + "/" + Math.round(precision * 100) + "%", steps: String(countSteps(recipe)), ok });
}

console.log("\nDeterministic extraction scorecard (recall/precision):");
rows.forEach((r) => console.log("  " + (r.ok ? "ok  " : "FAIL") + "  " + r.id.padEnd(24) + "  ing " + String(r.ing).padEnd(10) + "  steps " + r.steps));

assert.strictEqual(failures, 0, failures + " fixture(s) failed the deterministic extraction gate");

// ── Pure-helper unit checks (edge cases the fixtures don't all hit) ──
assert.strictEqual(Extract.parseISODuration("PT1H30M").display, "1 hr 30 min");
assert.strictEqual(Extract.parseISODuration("PT45M").display, "45 min");
assert.strictEqual(Extract.parseISODuration("PT2H").display, "2 hr");
assert.strictEqual(Extract.parseISODuration("PT0M"), null, "zero duration -> null");
assert.strictEqual(Extract.parseISODuration("garbage"), null);
assert.strictEqual(Extract.parseYield(6), 6);
assert.strictEqual(Extract.parseYield("Serves 8"), 8);
assert.strictEqual(Extract.parseYield(["12", "12 cookies"]), 12);
assert.strictEqual(Extract.parseYield("a lot"), null);
// Real-world yields (from live Sally's Baking Addiction / Budget Bytes probes).
assert.strictEqual(Extract.parseYield("1 loaf (12 slices)"), 12, "prefer the explicit slice count over '1 loaf'");
assert.strictEqual(Extract.parseYield("2 dozen cookies"), 24, "'2 dozen' expands to 24");
assert.strictEqual(Extract.parseYield("dozen"), 12, "bare 'dozen' is 12");
assert.strictEqual(Extract.parseYield("1 loaf"), null, "a bare '1 loaf' is not '1 serving' -> decline");
assert.strictEqual(Extract.parseYield("Makes 1 9x5-inch loaf"), null, "decline a misleading whole-item yield of 1");
assert.strictEqual(Extract.parseYield(["1 loaf", "12 servings"]), 12, "use the real serving count from the array");
assert.strictEqual(Extract.parseYield(["1", "1 loaf"]), null, "['1','1 loaf'] (Sally's) is one loaf, not 1 serving");
assert.strictEqual(Extract.parseYield(["1", "1 cake"]), null, "['1','1 cake'] declines too");
assert.strictEqual(Extract.parseYield(["1", "1 loaf, 12 slices"]), 12, "but a real slice count still wins");
assert.strictEqual(Extract.decodeEntities("salt &amp; pepper, you&#39;ll love it"), "salt & pepper, you'll love it");
// Ingredient splitting: quantity + known unit + name; unknown "unit" stays in name.
assert.deepStrictEqual(
  (function () { var p = Extract.parseIngredientLine("2 1/2 cups all-purpose flour"); return { amount: p.amount, unit: p.unit, name: p.name }; })(),
  { amount: "2 1/2", unit: "cups", name: "all-purpose flour" },
);
assert.deepStrictEqual(
  (function () { var p = Extract.parseIngredientLine("3 cloves garlic, minced"); return { amount: p.amount, unit: p.unit, name: p.name }; })(),
  { amount: "3", unit: "cloves", name: "garlic, minced" },
);
assert.deepStrictEqual(
  (function () { var p = Extract.parseIngredientLine("2 large eggs"); return { amount: p.amount, unit: p.unit, name: p.name }; })(),
  { amount: "2", unit: "", name: "large eggs" }, "non-unit word ('large') stays in the name",
);
assert.deepStrictEqual(
  (function () { var p = Extract.parseIngredientLine("Salt to taste"); return { amount: p.amount, unit: p.unit, name: p.name }; })(),
  { amount: "", unit: "", name: "Salt to taste" }, "no leading quantity -> whole line is the name",
);
// A bare schema.org Recipe (no @graph) is still found.
const bare = Extract.findRecipeNode({ "@type": "Recipe", name: "X", recipeIngredient: ["1 cup water"] });
assert.ok(bare && bare.name === "X", "bare Recipe node found");

console.log("\nimport-extract-test: ok (" + fixtures.length + " fixtures + helper units)");
