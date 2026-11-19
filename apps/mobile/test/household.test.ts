// Recipes somebody else in the household shared.

import assert from "node:assert/strict";
import test from "node:test";
import { copyForMyself, mayEdit, planHouseholdRead, type HeldRecipe } from "../src/sync/household.ts";
import type { RecipeEnvelope } from "../src/sync/pull.ts";
import type { Recipe } from "../src/data/types.ts";

function recipe(id: string, title = "Soda bread", over: Partial<Recipe> = {}): Recipe {
  return {
    id, title, createdAt: 1_000, updatedAt: 2_000,
    sections: [{
      name: "Dough",
      ingredients: [
        { id: "i1", name: "plain flour", amount: "250", unit: "g" },
        { id: "i2", name: "buttermilk", amount: "300", unit: "ml" },
      ],
      steps: [{ id: "s1", text: "Mix.", ingredientRefs: ["i1", "i2"] }],
    }],
    ...over,
  } as Recipe;
}

const envelope = (r: Recipe, shared: boolean, ownerId = "bob"): RecipeEnvelope => ({
  recipe: r, serverId: "srv-" + r.id, ownerId, ownerName: shared ? "Bob" : null, shared,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
});

const held = (recipeId: string, origin: HeldRecipe["origin"], shared = false): HeldRecipe =>
  ({ recipeId, origin, shared });

// ---------------------------------------------------------------------------
// What a household read means
// ---------------------------------------------------------------------------

test("only shared recipes are written from the library view", () => {
  // This account's own cloud recipes belong to the delta feed, which knows
  // about revisions and deletions. Writing them from a view that knows about
  // neither would clobber an unsent edit with no idea one existed.
  const plan = planHouseholdRead(
    [envelope(recipe("mine"), false, "alice"), envelope(recipe("theirs"), true)],
    [],
  );
  assert.deepEqual(plan.store.map((e) => e.recipe.id), ["theirs"]);
});

test("a shared recipe that stops appearing is one this account may no longer see", () => {
  const plan = planHouseholdRead(
    [envelope(recipe("still-shared"), true)],
    [held("still-shared", "cloud", true), held("withdrawn", "cloud", true)],
  );
  assert.deepEqual(plan.revoke, ["withdrawn"]);
});

test("losing access takes nothing of this cook's own", () => {
  // The case that matters when somebody leaves a household: everything they
  // wrote, every copy they saved, and the samples all stay exactly where
  // they are. Only the cached view of somebody else's recipe goes.
  const plan = planHouseholdRead([], [
    held("written-here", "local"),
    held("my-copy", "local"),
    held("sample-1", "sample"),
    held("my-cloud-recipe", "cloud", false),
    held("theirs", "cloud", true),
  ]);
  assert.deepEqual(plan.revoke, ["theirs"]);
});

test("an empty household read withdraws every shared recipe, and only those", () => {
  // Deliberate: a member removed from a household sees nothing shared, and
  // the phone must not be the one place that did not notice. The caller is
  // responsible for only asking when the read actually succeeded.
  const plan = planHouseholdRead([], [held("a", "cloud", true), held("b", "cloud", true), held("c", "local")]);
  assert.deepEqual(plan.revoke, ["a", "b"]);
  assert.deepEqual(plan.store, []);
});

test("what may be edited", () => {
  assert.equal(mayEdit(null), true, "a recipe nothing is known about is a new one");
  assert.equal(mayEdit(held("mine", "local")), true);
  assert.equal(mayEdit(held("mine", "cloud", false)), true);
  assert.equal(mayEdit(held("theirs", "cloud", true)), false);
});

// ---------------------------------------------------------------------------
// Save my own copy
// ---------------------------------------------------------------------------

test("a copy is the same recipe with a different identity", () => {
  const original = recipe("theirs", "Bob's soda bread", {
    servings: 6, category: "Baked Goods", tags: ["Quick"], notes: "Hot oven.",
  });
  const copy = copyForMyself(original, { ownerName: "Bob" }, "mine-1", 9_000);

  assert.equal(copy.id, "mine-1");
  assert.equal(copy.createdAt, 9_000);
  assert.equal(copy.updatedAt, 9_000);

  // Everything that IS the recipe survives, unconverted: quantities as
  // written, the sections, the steps and the ids they reference.
  assert.equal(copy.title, "Bob's soda bread");
  assert.equal(copy.servings, 6);
  assert.equal(copy.category, "Baked Goods");
  assert.deepEqual(copy.tags, ["Quick"]);
  assert.equal(copy.notes, "Hot oven.");
  assert.deepEqual(copy.sections, original.sections);
  assert.equal(copy.sections[0].ingredients[0].amount, "250");
  assert.equal(copy.sections[0].ingredients[0].unit, "g", "a copy is not a conversion");
  assert.deepEqual(copy.sections[0].steps[0].ingredientRefs, ["i1", "i2"]);
});

test("a copy keeps the recipe's own attribution and adds where it came from", () => {
  // The household member did not write the recipe either. Overwriting the
  // source would credit them with somebody else's, which is the opposite of
  // what attribution is for (ADR 0020).
  const original = recipe("theirs", "Soda bread", {
    source: { kind: "website", method: "link", siteName: "A Baking Blog", url: "https://example.test/x" },
  });
  const copy = copyForMyself(original, { ownerName: "Bob" }, "mine-1", 9_000);

  assert.equal(copy.source?.siteName, "A Baking Blog", "the real source is untouched");
  assert.equal(copy.source?.url, "https://example.test/x");
  assert.match(copy.source?.reference ?? "", /Copied from Bob’s recipe/);

  // With no source at all, "from Bob" is better attribution than none.
  const bare = copyForMyself(recipe("theirs"), { ownerName: "Bob" }, "mine-2", 9_000);
  assert.equal(bare.source?.kind, "family");
  assert.match(bare.source?.reference ?? "", /Copied from Bob’s recipe/);

  // And an unnamed sharer is described rather than left blank.
  const anon = copyForMyself(recipe("theirs"), { ownerName: null }, "mine-3", 9_000);
  assert.match(anon.source?.reference ?? "", /someone in your household/);
});

test("copying does not touch the original", () => {
  const original = recipe("theirs", "Soda bread", { tags: ["Quick"] });
  const before = JSON.stringify(original);
  copyForMyself(original, { ownerName: "Bob" }, "mine-1", 9_000);
  assert.equal(JSON.stringify(original), before);
});

test("a copy is private, however the recipe it came from was shared", () => {
  // `shared` is a field on the recipe body, and it is the field the SERVER
  // reads to decide who may see it. Copying the body wholesale carried it
  // across, so a copy saved from a household recipe would have published
  // itself to the household the moment it was uploaded — something the cook
  // never asked for and had no reason to expect.
  const original = { ...recipe("theirs", "Bob's bread"), shared: true } as Recipe & { shared: boolean };
  const copy = copyForMyself(original, { ownerName: "Bob" }, "mine-1", 9_000) as Recipe & { shared?: boolean };

  assert.ok(!copy.shared, "a copy starts private; sharing it is a decision of its own");
  assert.equal(original.shared, true, "and the original is untouched");

  // Everything that is actually the recipe still comes across.
  assert.equal(copy.title, "Bob's bread");
  assert.deepEqual(copy.sections, original.sections);
});
