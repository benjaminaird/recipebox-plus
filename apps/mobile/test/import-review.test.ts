// Import review, over the REAL production extractor.
//
// These tests load `packages/recipe-core/src/recipe-extract.js` and `packages/recipe-core/src/recipe-grounding.js`
// themselves and run them on stored HTML fixtures. That is the point: if the
// native app ever drifted onto a second importer, or the production one
// changed its output shape, these fail rather than the two surfaces quietly
// disagreeing about what a page says.
//
// The fixtures are hand-written stand-ins, clearly marked as such in their own
// comments, and nothing was fetched to make them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  missingFields, reviewFromHtml, sentenceList, sourceExplanation,
} from "../src/domain/importReview.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

test("a well-marked-up page comes through complete, from the publisher's own data", () => {
  const review = reviewFromHtml(fixture("complete-jsonld.html"), "https://example.com/roast");
  assert.ok(review.recipe, "expected a recipe");
  assert.equal(review.source, "jsonld");
  assert.equal(review.recipe!.title, "Lemon and Thyme Roast Chicken");
  assert.equal(review.fields.ingredients, 6);
  assert.equal(review.fields.steps, 4);
  assert.equal(review.fields.servings, true);
  assert.equal(review.fields.times, true);
  assert.deepEqual(missingFields(review.fields), []);
  // Nothing to flag: every line has an amount.
  assert.deepEqual(review.concerns, []);
});

test("original measurements survive the import exactly as written", () => {
  // The whole premise of scaling and conversion is that the stored recipe
  // keeps what the source said. An importer that helpfully tidied "1.8 kg" to
  // "1800 g" would break that at the point of entry.
  const review = reviewFromHtml(fixture("complete-jsonld.html"), "https://example.com/roast");
  const ingredients = review.recipe!.sections.flatMap((s) => s.ingredients);
  const chicken = ingredients.find((i) => i.name.includes("chicken"))!;
  assert.equal(chicken.amount, "1.8");
  assert.equal(chicken.unit, "kg");
  const salt = ingredients.find((i) => i.name.includes("salt"))!;
  assert.equal(salt.amount, "1");
  assert.equal(salt.unit, "tbsp");
  // And the raw line is kept, so the original wording is never lost.
  assert.equal(chicken.raw, "1.8 kg whole chicken");
});

test("a poorly marked-up page reports what is missing instead of inventing it", () => {
  const review = reviewFromHtml(fixture("partial-microdata.html"), "https://example.com/soup");
  assert.ok(review.recipe);
  assert.equal(review.source, "microdata");

  // Nothing fabricated: no servings, no times.
  assert.equal(review.recipe!.servings, undefined);
  assert.equal(review.recipe!.totalTime, undefined);
  assert.equal(review.fields.servings, false);
  assert.equal(review.fields.times, false);

  // And the screen is told, in words, what to say.
  const missing = missingFields(review.fields);
  assert.ok(missing.includes("how many it serves"), JSON.stringify(missing));
  assert.ok(missing.includes("timings"), JSON.stringify(missing));
});

test("vague amounts are preserved, not guessed at", () => {
  const review = reviewFromHtml(fixture("partial-microdata.html"), "https://example.com/soup");
  const ingredients = review.recipe!.sections.flatMap((s) => s.ingredients);

  const tomatoes = ingredients.find((i) => i.name.includes("tomato"))!;
  // "a tin of plum tomatoes" has no number in it. It must stay that way --
  // deciding a tin is 400 g would be inventing the recipe.
  assert.equal((tomatoes.amount ?? "").trim(), "");
  assert.match(tomatoes.raw ?? tomatoes.name, /tin/);

  const stock = ingredients.find((i) => i.name.includes("stock"))!;
  assert.equal((stock.amount ?? "").trim(), "");
});

test("lines with no amount are raised as something to look at", () => {
  const review = reviewFromHtml(fixture("partial-microdata.html"), "https://example.com/soup");
  const noAmount = review.concerns.filter((c) => c.reason === "no-amount");
  // Three of the four lines carry no number.
  assert.equal(noAmount.length, 3, JSON.stringify(review.concerns));
  assert.ok(noAmount.every((c) => c.ingredientId && c.name));
});

test("a page with no recipe says so rather than returning an empty one", () => {
  const review = reviewFromHtml("<html><body><p>Just a blog post.</p></body></html>", "https://example.com/blog");
  assert.equal(review.recipe, null);
  assert.equal(review.needsReview, true);
  assert.ok(review.warnings.length > 0);
  // An empty recipe here would look like a successful import of a recipe with
  // no ingredients, which is a very different and much worse thing to show.
  assert.deepEqual(missingFields(review.fields).includes("ingredients"), true);
});

test("malformed input does not throw", () => {
  for (const junk of ["", "<html", "<<<>>>", "<html><head><script type=\"application/ld+json\">{ broken</script></head></html>"]) {
    const review = reviewFromHtml(junk, "https://example.com/x");
    assert.ok(review, `threw or returned nothing for: ${junk.slice(0, 20)}`);
  }
});

test("how the recipe was found is explained, differently for each route", () => {
  const jsonld = sourceExplanation("jsonld");
  const heuristic = sourceExplanation("heuristic");
  assert.notEqual(jsonld, heuristic);
  // Scraped prose must be presented as less certain than the publisher's own
  // structured data, because it is.
  assert.match(heuristic, /check/i);
});

test("a list of missing fields reads as a sentence", () => {
  assert.equal(sentenceList([]), "");
  assert.equal(sentenceList(["timings"]), "timings");
  assert.equal(sentenceList(["how many it serves", "timings"]), "how many it serves and timings");
  assert.equal(
    sentenceList(["a", "b", "c"]),
    "a, b and c",
  );
});
