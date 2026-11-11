// Editing a recipe.
//
// Most of these guard one property: a step's reference to an ingredient must
// always point at an ingredient that exists, and must always point at the same
// one it did before the edit. Nothing about a broken reference is visible — the
// recipe still lists, still opens, and goes wrong in Cook Mode where the
// quantity beside a step silently disappears or, worse, is somebody else's.
import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateIngredientId, canSave, danglingRefs, draftFromRecipe, emptyDraft,
  nextIngredientId, nextStepId,
  recipeFromDraft, removeIngredient, removeStep, validateDraft, type Draft,
} from "../src/domain/recipeDraft.ts";
import type { Recipe } from "../src/data/types.ts";

const draftWith = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft("r1", 1000), ...over });

const filled = (): Draft =>
  draftWith({
    title: "Shortbread",
    sections: [
      {
        name: "Base",
        ingredients: [
          { id: "i1", name: "plain flour", amount: "250", unit: "g" },
          { id: "i2", name: "caster sugar", amount: "75", unit: "g" },
          { id: "i3", name: "butter", amount: "175", unit: "g" },
        ],
        steps: [
          { id: "s1", text: "Rub the butter into the flour.", ingredientRefs: ["i1", "i3"] },
          { id: "s2", text: "Stir in the sugar.", ingredientRefs: ["i2"] },
        ],
      },
    ],
  });

// ---------------------------------------------------------------------------
// Stable ids
// ---------------------------------------------------------------------------

test("a new ingredient never takes an id that has been used", () => {
  const d = draftFromRecipe(recipeFromDraft(filled(), 2000));
  assert.equal(nextIngredientId(d), "i4");

  // Delete the last one and add another: the new one must NOT be i3 again.
  // Nothing inside this recipe would break -- removing an ingredient removes
  // its references -- but ADR 0015 keeps every prior version, and a restored
  // version referencing the old i3 would bind to a different ingredient.
  const { id, draft: issued } = allocateIngredientId(removeIngredient(d, "i3"));
  assert.equal(id, "i4");
  // And the one after that moves on again.
  assert.equal(nextIngredientId(issued), "i5");
});

test("an id is not handed out twice in one session", () => {
  let d = emptyDraft("r1", 1000);
  const seen = new Set<string>();
  for (let i = 0; i < 5; i += 1) {
    const next = allocateIngredientId(d);
    assert.equal(seen.has(next.id), false, `${next.id} issued twice`);
    seen.add(next.id);
    d = {
      ...next.draft,
      sections: [{
        ...next.draft.sections[0],
        ingredients: [...next.draft.sections[0].ingredients, { id: next.id, name: `thing ${i}` }],
      }],
    };
  }
  assert.equal(seen.size, 5);
});

test("ids are unique across sections, not within one", () => {
  // A step resolves an id against the whole recipe, so two sections each
  // numbering from i1 would give one reference two possible meanings.
  const d = draftWith({
    sections: [
      { name: "A", ingredients: [{ id: "i1", name: "flour" }], steps: [] },
      { name: "B", ingredients: [{ id: "i2", name: "sugar" }], steps: [] },
    ],
  });
  assert.equal(nextIngredientId(d), "i3");
  assert.equal(nextStepId(draftWith({
    sections: [
      { name: "A", ingredients: [], steps: [{ id: "s1", text: "one" }] },
      { name: "B", ingredients: [], steps: [{ id: "s4", text: "two" }] },
    ],
  })), "s5");
});

test("editing a recipe does not renumber its ingredients", () => {
  const recipe = recipeFromDraft(filled(), 2000);
  const back = draftFromRecipe(recipe);
  assert.deepEqual(
    back.sections[0].ingredients.map((i) => i.id),
    ["i1", "i2", "i3"],
  );
  // And the steps still point where they did.
  assert.deepEqual(back.sections[0].steps[0].ingredientRefs, ["i1", "i3"]);
  assert.deepEqual(back.sections[0].steps[1].ingredientRefs, ["i2"]);
});

test("a round trip through recipe and back changes nothing", () => {
  const before = filled();
  const after = draftFromRecipe(recipeFromDraft(before, 2000));
  assert.equal(after.title, before.title);
  assert.deepEqual(
    after.sections[0].ingredients.map((i) => `${i.id}:${i.amount} ${i.unit} ${i.name}`),
    before.sections[0].ingredients.map((i) => `${i.id}:${i.amount} ${i.unit} ${i.name}`),
  );
  assert.deepEqual(
    after.sections[0].steps.map((s) => `${s.id}:${s.text}`),
    before.sections[0].steps.map((s) => `${s.id}:${s.text}`),
  );
});

// ---------------------------------------------------------------------------
// References never dangle
// ---------------------------------------------------------------------------

test("removing an ingredient removes every reference to it", () => {
  const d = removeIngredient(filled(), "i3");
  assert.deepEqual(danglingRefs(d), []);
  // The step that used it keeps its other ingredient.
  assert.deepEqual(d.sections[0].steps[0].ingredientRefs, ["i1"]);
  // And the other step is untouched.
  assert.deepEqual(d.sections[0].steps[1].ingredientRefs, ["i2"]);
});

test("removing the only ingredient a step used leaves the step, not a ghost ref", () => {
  const d = removeIngredient(filled(), "i2");
  assert.deepEqual(danglingRefs(d), []);
  assert.equal(d.sections[0].steps.length, 2);
  assert.deepEqual(d.sections[0].steps[1].ingredientRefs, []);
});

test("saving drops blank rows and any reference to them", () => {
  // An editor always has an empty row to type into. Saving those as nameless
  // ingredients would fill a library with them, and a step pointing at one
  // would render a quantity that is not there.
  const d = draftWith({
    title: "Toast",
    sections: [
      {
        name: "",
        ingredients: [
          { id: "i1", name: "bread", amount: "2", unit: "slices" },
          { id: "i2", name: "   ", amount: "", unit: "" },
        ],
        steps: [
          { id: "s1", text: "Toast it.", ingredientRefs: ["i1", "i2"] },
          { id: "s2", text: "   " },
        ],
      },
    ],
  });
  const recipe = recipeFromDraft(d, 2000);
  assert.equal(recipe.sections[0].ingredients.length, 1);
  assert.deepEqual(recipe.sections[0].steps.map((s) => s.text), ["Toast it."]);
  assert.deepEqual(recipe.sections[0].steps[0].ingredientRefs, ["i1"]);
  assert.deepEqual(danglingRefs(draftFromRecipe(recipe)), []);
});

test("removing a step leaves the ingredients alone", () => {
  const d = removeStep(filled(), "s1");
  assert.equal(d.sections[0].steps.length, 1);
  assert.equal(d.sections[0].ingredients.length, 3);
  assert.deepEqual(danglingRefs(d), []);
});

test("an empty section is not saved as a part of the recipe", () => {
  const d = draftWith({
    title: "Soup",
    sections: [
      { name: "", ingredients: [{ id: "i1", name: "stock" }], steps: [{ id: "s1", text: "Heat." }] },
      { name: "Garnish", ingredients: [], steps: [] },
    ],
  });
  assert.equal(recipeFromDraft(d, 2000).sections.length, 1);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("only a missing name stops a save", () => {
  // A half-typed recipe is a legitimate thing to save -- ADR 0014 already
  // decided an unresolved import can be saved, and a cook copying off a card
  // should not lose their work to a tidiness rule.
  const blank = emptyDraft("r1");
  assert.equal(canSave(blank), false);
  assert.ok(validateDraft(blank).some((p) => p.field === "title" && p.blocking));

  const titleOnly = draftWith({ title: "Something" });
  assert.equal(canSave(titleOnly), true);
  // It still says what is missing.
  const cautions = validateDraft(titleOnly);
  assert.ok(cautions.some((p) => p.field === "ingredients" && !p.blocking));
  assert.ok(cautions.some((p) => p.field === "steps" && !p.blocking));
});

test("a title of only spaces is not a title", () => {
  assert.equal(canSave(draftWith({ title: "   " })), false);
});

test("a malformed source link is refused, and a good one is not", () => {
  assert.equal(canSave(draftWith({ title: "A", sourceUrl: "not a url" })), false);
  assert.equal(canSave(draftWith({ title: "A", sourceUrl: "https://example.com/r" })), true);
  // No link at all is perfectly normal.
  assert.equal(canSave(draftWith({ title: "A", sourceUrl: "" })), true);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test("attribution follows ADR 0020, with the domain stored for offline", () => {
  const recipe = recipeFromDraft(
    draftWith({ title: "A", sourceReference: "Granny's card", sourceUrl: "https://www.example.com/x" }),
    2000,
  );
  assert.equal(recipe.source?.method, "manual");
  assert.equal(recipe.source?.kind, "website");
  assert.equal(recipe.source?.reference, "Granny's card");
  assert.equal(recipe.source?.domain, "example.com");
});

test("a source with no link is still a source", () => {
  const recipe = recipeFromDraft(draftWith({ title: "A", sourceReference: "Salt Fat Acid Heat, p. 212" }), 2000);
  assert.equal(recipe.source?.kind, "other");
  assert.equal(recipe.source?.reference, "Salt Fat Acid Heat, p. 212");
  assert.equal(recipe.source?.url, undefined);
});

test("no attribution means no source object at all", () => {
  assert.equal(recipeFromDraft(draftWith({ title: "A" }), 2000).source, undefined);
});

test("tags and category are normalised on save", () => {
  const recipe = recipeFromDraft(
    draftWith({ title: "A", category: "baked goods", tags: ["gluten free", "GLUTEN-FREE", "one pan"] }),
    2000,
  );
  assert.equal(recipe.category, "Baked Goods");
  // Duplicate spellings collapse, and known tags take their canonical form.
  assert.deepEqual(recipe.tags, ["Gluten-Free", "One-Pot"]);
});

test("servings only survives if it is a positive number", () => {
  assert.equal(recipeFromDraft(draftWith({ title: "A", servings: "4" }), 2000).servings, 4);
  for (const junk of ["", "lots", "0", "-2"]) {
    assert.equal(
      recipeFromDraft(draftWith({ title: "A", servings: junk }), 2000).servings,
      undefined,
      `servings: ${junk}`,
    );
  }
});

test("createdAt survives an edit; updatedAt does not", () => {
  const original = recipeFromDraft(draftWith({ title: "A" }), 2000);
  const edited = recipeFromDraft(draftFromRecipe(original), 5000);
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.updatedAt, 5000);
});

test("an existing recipe keeps its id through an edit", () => {
  const recipe = { ...recipeFromDraft(draftWith({ title: "A" }), 2000) } as Recipe;
  const edited = recipeFromDraft({ ...draftFromRecipe(recipe), title: "B" }, 3000);
  assert.equal(edited.id, recipe.id);
  assert.equal(edited.title, "B");
});
