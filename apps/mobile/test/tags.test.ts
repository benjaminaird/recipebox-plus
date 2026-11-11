// Tags and categories: the editing rules, and agreement with the web app.
//
// The parity block matters more than the rest. Two surfaces write into one
// library, so a cook who types "copy-cat" on the phone and sees "Copycat" on
// the laptop is looking at one tag -- and if the two modules ever disagree,
// they are looking at two, with no error anywhere to say so. These tests load
// the REAL public/recipe-tags.js, not a copy, so a change there fails here.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  MAX_TAGS, addTag, displayTag, hasTag, normalizeCategory, normalizeRecipeTags,
  normalizeTagKey, removeTag, sameCategory, toggleTag,
} from "../src/domain/tags.ts";

const require_ = createRequire(import.meta.url);
const web = require_("../../../public/recipe-tags.js");

// ---------------------------------------------------------------------------
// Parity with the production web module
// ---------------------------------------------------------------------------

const SPELLINGS = [
  "copycat", "CopyCat", "copy-cat", "COPY CAT", "restaurant style",
  "kid friendly", "Kid-Friendly", "one pan", "sheet pan", "crock pot",
  "instant pot", "no bake", "make ahead", "gluten free", "dairy free",
  "BBQ", "bbq", "Mum's Sunday Roast", "  spaced   out  ", "weeknight",
  "high protein", "budget friendly", "", "   ", "!!!", "5 ingredient",
  "air fryer", "Air Fryer", "vegan", "Vegan", "comfort food",
];

test("the tag key matches the web module for every spelling", () => {
  for (const s of SPELLINGS) {
    assert.equal(
      normalizeTagKey(s), web.normalizeTagKey(s),
      `key for ${JSON.stringify(s)}`,
    );
  }
  for (const junk of [null, undefined, 0, {}, []]) {
    assert.equal(normalizeTagKey(junk), web.normalizeTagKey(junk), `key for ${String(junk)}`);
  }
});

test("the displayed tag matches the web module for every spelling", () => {
  for (const s of SPELLINGS) {
    assert.equal(
      displayTag(s), web.displayTag(s),
      `display for ${JSON.stringify(s)}`,
    );
  }
});

test("normalising a whole tag list matches the web module", () => {
  const lists = [
    ["copycat", "Copy-Cat", "quick"],
    ["BBQ", "bbq", "Bbq"],
    ["one pot", "one pan", "sheet pan"],
    [],
    ["", "  ", "!!!"],
    Array.from({ length: 20 }, (_, i) => `tag ${i}`),
  ];
  for (const list of lists) {
    assert.deepEqual(
      normalizeRecipeTags(list), web.normalizeRecipeTags(list),
      `list ${JSON.stringify(list)}`,
    );
  }
});

test("the tag cap matches the web module", () => {
  assert.equal(MAX_TAGS, web.MAX_TAGS);
});

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

test("a tag added twice, in any spelling, is added once", () => {
  let tags = addTag([], "Vegetarian");
  tags = addTag(tags, "vegetarian");
  tags = addTag(tags, "VEGETARIAN");
  assert.deepEqual(tags, ["Vegetarian"]);
});

test("a tag is removed by meaning, not by exact spelling", () => {
  // A cook who tagged something "COPYCAT" and later taps "Copycat" to remove
  // it must not end up with the tag still on the recipe.
  const tags = addTag([], "COPYCAT");
  assert.deepEqual(tags, ["Copycat"]);
  assert.deepEqual(removeTag(tags, "copycat"), []);
  assert.deepEqual(removeTag(tags, "CopyCat"), []);
});

test("a known gap in the shared canonical table, pinned so it cannot move quietly", () => {
  // public/recipe-tags.js says in a comment that "CopyCat", "copy-cat" and
  // "copycat" all become "copycat". The first and third do. The second does
  // NOT: the key regex turns a hyphen into a space, giving "copy cat", which
  // is not in the canonical table. So a library can hold "Copycat" and
  // "Copy-cat" as two separate tags.
  //
  // That is production web behaviour and not ours to change here -- the
  // canonical table is shared, and adding aliases would re-tag existing
  // recipes on a surface this milestone is not allowed to touch. It is
  // reported instead, and pinned here so the day someone does fix it, this
  // fails loudly rather than the two surfaces drifting apart in silence.
  assert.equal(displayTag("copycat"), "Copycat");
  assert.equal(displayTag("copy-cat"), "Copy-cat");
  assert.notEqual(displayTag("copy-cat"), displayTag("copycat"));
  assert.equal(displayTag("copy-cat"), web.displayTag("copy-cat"));
});

test("toggling is add then remove", () => {
  const on = toggleTag([], "Spicy");
  assert.deepEqual(on, ["Spicy"]);
  assert.deepEqual(toggleTag(on, "spicy"), []);
});

test("hasTag ignores spelling", () => {
  const tags = ["Gluten-Free"];
  assert.equal(hasTag(tags, "gluten free"), true);
  assert.equal(hasTag(tags, "GLUTEN-FREE"), true);
  assert.equal(hasTag(tags, "dairy free"), false);
  assert.equal(hasTag(undefined, "anything"), false);
  assert.equal(hasTag(tags, ""), false);
});

test("the cap is honoured rather than silently exceeded", () => {
  let tags: string[] = [];
  for (let i = 0; i < MAX_TAGS + 5; i += 1) tags = addTag(tags, `tag ${i}`);
  assert.equal(tags.length, MAX_TAGS);
  // And the one that would not fit is simply not there -- nothing was dropped
  // from the middle to make room.
  assert.equal(hasTag(tags, "tag 0"), true);
  assert.equal(hasTag(tags, `tag ${MAX_TAGS + 1}`), false);
});

test("empty input never produces an empty tag", () => {
  for (const junk of ["", "   ", "!!!", "---"]) {
    assert.deepEqual(addTag([], junk), [], `junk: ${JSON.stringify(junk)}`);
  }
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

test("a category is tidied but never renamed", () => {
  assert.equal(normalizeCategory("baked goods"), "Baked Goods");
  assert.equal(normalizeCategory("  Weeknight   Dinners "), "Weeknight Dinners");
  // Deliberate casing survives: we have no business re-spelling a cook's own
  // shelf names, and there is no canonical table for categories.
  assert.equal(normalizeCategory("BBQ & Grilling"), "BBQ & Grilling");
  assert.equal(normalizeCategory("copycat"), "Copycat");
  // Not the tag table: a category called "one pan" is not renamed to One-Pot.
  assert.equal(normalizeCategory("one pan"), "One Pan");
});

test("no category is an ordinary state, not an error", () => {
  for (const empty of ["", "   ", null, undefined]) {
    assert.equal(normalizeCategory(empty), undefined, `empty: ${String(empty)}`);
  }
});

test("two spellings of a category are one shelf", () => {
  assert.equal(sameCategory("Baked Goods", "baked goods"), true);
  assert.equal(sameCategory("Baked-Goods", "baked goods"), true);
  assert.equal(sameCategory("Baked Goods", "Desserts"), false);
});
