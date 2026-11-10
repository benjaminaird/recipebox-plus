// Timing. The central assertion is a negative one: times do not scale.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  batchAdvisories, classifyTime, formatDuration, parseDuration,
  recipeTimings, scalesWithBatch,
} from "../src/domain/timing.ts";
import { SAMPLE_RECIPES } from "../src/data/sampleRecipes.ts";
import { flattenSteps } from "../src/data/types.ts";

test("durations are read the way recipes write them", () => {
  assert.equal(parseDuration("25 min"), 25);
  assert.equal(parseDuration("1 hr 40 min"), 100);
  assert.equal(parseDuration("1 hour"), 60);
  assert.equal(parseDuration("90 minutes"), 90);
  assert.equal(parseDuration("4 hr"), 240);
  assert.equal(parseDuration("25"), 25, "a bare number is minutes");
  assert.equal(parseDuration("overnight"), 480);
  assert.equal(parseDuration("to taste"), null);
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration(undefined), null);
});

test("durations round-trip through formatting", () => {
  for (const [minutes, text] of [[25, "25 min"], [60, "1 hr"], [100, "1 hr 40 min"], [240, "4 hr"]] as const) {
    assert.equal(formatDuration(minutes), text);
    assert.equal(parseDuration(text), minutes);
  }
  assert.equal(formatDuration(0), "");
  assert.equal(formatDuration(-5), "");
});

test("a time is classified by what it describes", () => {
  assert.equal(classifyTime("Bake at 180C for 12 minutes"), "cook");
  assert.equal(classifyTime("Chill at least 3 hours, until set"), "passive");
  assert.equal(classifyTime("Chop the onion finely"), "prep");
  assert.equal(classifyTime("Leave to rise until doubled"), "passive");
  assert.equal(classifyTime("something unrecognisable"), "cook", "the cautious default");
});

test("only preparation grows with the batch", () => {
  assert.equal(scalesWithBatch("prep"), true);
  assert.equal(scalesWithBatch("cook"), false);
  assert.equal(scalesWithBatch("passive"), false);
});

test("a recipe's stated times are preserved exactly", () => {
  const cookies = SAMPLE_RECIPES.find((r) => r.id === "brown-butter-chocolate-chip-cookies")!;
  const timings = recipeTimings(cookies);
  const byLabel = Object.fromEntries(timings.map((t) => [t.label, t]));
  assert.equal(byLabel.Prep.minutes, 25);
  assert.equal(byLabel.Cook.minutes, 12);
  assert.equal(byLabel.Total.minutes, 100);
  // The original strings are carried through untouched.
  assert.equal(byLabel.Cook.text, cookies.cookTime);
});

test("a recipe with no stated times yields none, rather than zeroes", () => {
  assert.deepEqual(recipeTimings({}), []);
  assert.deepEqual(recipeTimings({ prepTime: "", cookTime: undefined }), []);
});

// ---------------------------------------------------------------------------
// The requirement, stated as tests.
// ---------------------------------------------------------------------------

test("no advisory is produced at 1x", () => {
  const steps = flattenSteps(SAMPLE_RECIPES[0]).map((s) => s.text);
  assert.deepEqual(batchAdvisories(steps, 1), []);
});

test("doubling a tray bake advises more tins, not more time", () => {
  const cookies = SAMPLE_RECIPES.find((r) => r.id === "brown-butter-chocolate-chip-cookies")!;
  const steps = flattenSteps(cookies).map((s) => s.text);
  const advice = batchAdvisories(steps, 2);

  assert.ok(advice.length > 0, "a tray bake at 2x should say something");
  assert.ok(
    advice[0].detail.includes("have not"),
    "the first thing said is that times were not scaled",
  );
  const text = advice.map((a) => `${a.title} ${a.detail}`).join(" ").toLowerCase();
  assert.ok(text.includes("tray") || text.includes("tin"), "mentions the vessel");
  // Nothing anywhere suggests multiplying the time.
  assert.ok(!/\bdouble the (?:bake|cook|time)\b/.test(text));
});

test("advice is drawn from the recipe's own method, not from cooking in general", () => {
  const panOnly = ["Warm the oil in a deep pan and cook the onion gently."];
  const advice = batchAdvisories(panOnly, 3);
  const text = advice.map((a) => a.title).join(" ").toLowerCase();
  assert.ok(text.includes("batches") || text.includes("pan"), text);
  assert.ok(!text.includes("oven"), "no oven advice for a recipe with no oven");
});

test("a method with no recognised vessel gets no invented advice", () => {
  // Preserve the original timing and say nothing rather than generalise.
  assert.deepEqual(batchAdvisories(["Whisk the dressing and toss through."], 4), []);
});

test("halving is advised too, and says so in its own terms", () => {
  const cookies = SAMPLE_RECIPES.find((r) => r.id === "brown-butter-chocolate-chip-cookies")!;
  const steps = flattenSteps(cookies).map((s) => s.text);
  const advice = batchAdvisories(steps, 0.5);
  assert.ok(advice[0].title.includes("smaller"), advice[0].title);
});

test("every sample recipe survives timing analysis without throwing", () => {
  for (const recipe of SAMPLE_RECIPES) {
    const steps = flattenSteps(recipe).map((s) => s.text);
    for (const scale of [0.5, 1, 2, 3, 4]) {
      const advice = batchAdvisories(steps, scale);
      assert.ok(Array.isArray(advice), recipe.id);
      for (const a of advice) {
        assert.ok(a.title.length > 0 && a.detail.length > 0, `${recipe.id} produced an empty advisory`);
      }
    }
    for (const t of recipeTimings(recipe)) {
      assert.ok(t.minutes > 0, `${recipe.id} ${t.label}`);
      assert.equal(t.scales, t.kind === "prep");
    }
  }
});
