// What a cook is told when two versions of one recipe disagree.
//
// The screen shows both versions in full underneath; this is the part that
// says where to look. Getting it wrong is not cosmetic — a summary that says
// "the tags differ" when the flour changed sends somebody to the wrong part of
// the page and, worse, makes the choice look unimportant.

import assert from "node:assert/strict";
import test from "node:test";
import { differences, summarise } from "../src/sync/difference.ts";
import type { Recipe } from "../src/data/types.ts";

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1", title: "Soda bread", createdAt: 1, updatedAt: 2,
    sections: [{
      name: "",
      ingredients: [
        { id: "i1", name: "plain flour", amount: "250", unit: "g" },
        { id: "i2", name: "buttermilk", amount: "300", unit: "ml" },
      ],
      steps: [{ id: "s1", text: "Mix." }, { id: "s2", text: "Bake." }],
    }],
    ...overrides,
  } as Recipe;
}

const ingredients = (lines: Array<[string, string, string]>) => [{
  name: "",
  ingredients: lines.map(([amount, unit, name], i) => ({ id: "i" + (i + 1), name, amount, unit })),
  steps: [{ id: "s1", text: "Mix." }, { id: "s2", text: "Bake." }],
}];

test("two identical versions have nothing to say", () => {
  assert.deepEqual(differences(recipe(), recipe()), []);
  // And it says so plainly, rather than leaving a cook to compare by eye and
  // work out for themselves that there is nothing in it. The server refuses a
  // stale base revision whether or not the content moved, so this is real.
  assert.equal(summarise(recipe(), recipe()), "The two versions read the same.");
});

test("a changed quantity is an ingredient difference, not a word difference", () => {
  const mine = recipe({ sections: ingredients([["200", "g", "plain flour"], ["300", "ml", "buttermilk"]]) });
  const theirs = recipe({ sections: ingredients([["250", "g", "plain flour"], ["300", "ml", "buttermilk"]]) });

  const list = differences(mine, theirs);
  assert.equal(list.length, 1);
  assert.equal(list[0].weight, "major", "a quarter of the flour is not a minor difference");
  assert.match(list[0].text, /1 ingredient line only in your version/);
  assert.match(list[0].text, /1 line only in the account's/);
});

test("an added ingredient is counted once, in the right direction", () => {
  const mine = recipe({
    sections: ingredients([["250", "g", "plain flour"], ["300", "ml", "buttermilk"], ["1", "tsp", "salt"]]),
  });
  const list = differences(mine, recipe());
  assert.equal(list.length, 1);
  assert.match(list[0].text, /1 ingredient line only in your version/);
  assert.doesNotMatch(list[0].text, /only in the account's/);
});

test("a rewritten step is reported, and so is a missing one", () => {
  const rewritten = recipe({
    sections: [{ name: "", ingredients: recipe().sections[0].ingredients, steps: [
      { id: "s1", text: "Mix gently." }, { id: "s2", text: "Bake." },
    ] }],
  });
  assert.equal(summarise(rewritten, recipe()), "Method: 1 step reads differently.");

  const shorter = recipe({
    sections: [{ name: "", ingredients: recipe().sections[0].ingredients, steps: [{ id: "s1", text: "Mix." }] }],
  });
  assert.match(summarise(shorter, recipe()), /1 step in yours, 2 steps in the account's/);
});

test("the summary leads with what matters, not with what came first", () => {
  const mine = recipe({
    title: "Irish soda bread",
    tags: ["Baking"],
    sections: ingredients([["200", "g", "plain flour"], ["300", "ml", "buttermilk"]]),
  });
  const theirs = recipe({ title: "Soda bread", tags: [] });

  const list = differences(mine, theirs);
  assert.ok(list.length >= 3, "the name, the tags and the flour all moved");
  // The name differs and is listed first, but the flour is what a cook needs
  // to see in one line.
  assert.match(summarise(mine, theirs), /^Ingredients:/);
});

test("servings, tags, category and notes are differences too, quietly", () => {
  for (const [field, value] of [
    ["servings", 8], ["tags", ["Quick"]], ["category", "Baking"], ["notes", "Use a hot oven."],
  ] as const) {
    const mine = recipe({ [field]: value } as Partial<Recipe>);
    const list = differences(mine, recipe());
    assert.equal(list.length, 1, field);
    assert.equal(list[0].weight, "minor", field);
  }
});

test("a version that is not on the phone is not described", () => {
  // Nothing to compare is not the same as nothing different, and claiming
  // otherwise would tell a cook the two agree when one of them is absent.
  assert.deepEqual(differences(null, recipe()), []);
  assert.deepEqual(differences(recipe(), null), []);
});
