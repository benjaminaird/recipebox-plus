const assert = require("assert");
const {
  normalizeTagKey,
  displayTag,
  normalizeRecipeTags,
  suggestTags,
  applyTagsOnCreate,
} = require("../public/recipe-tags");

// --- normalization / dedup ---
(function tagNormalizationDeduplicatesCasing() {
  const out = normalizeRecipeTags(["copycat", "CopyCat", "Copycat", "COPYCAT"]);
  assert.deepStrictEqual(out, ["Copycat"], "casing variants collapse to one canonical tag");
})();

(function hyphenAndSpaceTreatedSame() {
  assert.strictEqual(normalizeTagKey("Gluten-Free"), normalizeTagKey("gluten free"));
  assert.strictEqual(displayTag("gluten free"), "Gluten-Free");
  assert.strictEqual(displayTag("GLUTEN-FREE"), "Gluten-Free");
})();

(function preservesIntentionalCasingForUnknownTags() {
  assert.strictEqual(displayTag("bbq"), "Bbq");      // all-lower gets title-cased
  assert.strictEqual(displayTag("BBQ"), "BBQ");      // acronym preserved
  assert.strictEqual(displayTag("Grandma's"), "Grandma's");
})();

(function capsAtMaxTags() {
  const many = Array.from({ length: 20 }, (_, i) => "tag" + i);
  assert.strictEqual(normalizeRecipeTags(many).length, 12);
  assert.strictEqual(normalizeRecipeTags(many, { max: 5 }).length, 5);
})();

(function filterMatchingIsCaseInsensitive() {
  // The library filters by comparing normalized keys.
  const recipeTags = ["CopyCat", "Quick"];
  const selected = "copycat";
  const match = recipeTags.some((t) => normalizeTagKey(t) === normalizeTagKey(selected));
  assert.ok(match, "case-insensitive tag match");
})();

// --- copycat detection ---
(function copycatDetectedFromTitle() {
  const tags = suggestTags({ title: "Copycat Olive Garden Breadsticks", sections: [] });
  assert.ok(tags.includes("Copycat"), "explicit copycat title is tagged Copycat");
})();

(function copycatDetectedFromBrandStyle() {
  const tags = suggestTags({ title: "Starbucks-Style Pumpkin Bread", sections: [] });
  assert.ok(tags.includes("Copycat"), "brand + style is tagged Copycat");
})();

(function copycatDetectionDoesNotChangeCategory() {
  const recipe = { title: "Copycat Chick-fil-A Sandwich", category: "Entrées", tags: [], sections: [] };
  const newTags = applyTagsOnCreate(recipe);
  assert.ok(newTags.includes("Copycat"), "Copycat added as a tag");
  // applyTagsOnCreate only returns tags; the category field is untouched.
  assert.strictEqual(recipe.category, "Entrées", "category is never modified by tagging");
  assert.ok(!newTags.includes("Entrées"), "category is not duplicated into tags");
})();

(function genericRecipeIsNotCopycat() {
  const tags = suggestTags({ title: "Crispy Chicken Sandwich", sections: [
    { steps: [{ text: "Fry the chicken until golden." }] },
  ] });
  assert.ok(!tags.includes("Copycat"), "a generic sandwich is NOT tagged Copycat");
})();

// --- conservative diet / allergy handling ---
(function dietTagsNotInventedWithoutEvidence() {
  const tags = suggestTags({ title: "Garden Veggie Pasta", sections: [
    { ingredients: [{ name: "zucchini" }, { name: "olive oil" }, { name: "pasta" }] },
  ] });
  ["Vegan", "Vegetarian", "Gluten-Free", "Dairy-Free"].forEach((t) => {
    assert.ok(!tags.includes(t), "diet tag " + t + " is not inferred without explicit evidence");
  });
})();

(function dietTagAddedWhenStated() {
  const tags = suggestTags({ title: "Vegan Chocolate Mousse", sections: [] });
  assert.ok(tags.includes("Vegan"), "explicit 'Vegan' in title is tagged");
})();

// --- method / time tags from evidence ---
(function methodTagFromInstructions() {
  const tags = suggestTags({ title: "Crispy Brussels Sprouts", sections: [
    { steps: [{ text: "Add to the air fryer and cook 12 minutes." }] },
  ] });
  assert.ok(tags.includes("Air Fryer"), "air fryer instruction is tagged");
})();

(function quickFromShortTime() {
  const tags = suggestTags({ title: "Weeknight Stir Fry", totalTime: "20 minutes", sections: [] });
  assert.ok(tags.includes("Quick"), "short total time is Quick");
  assert.ok(tags.includes("Weeknight"), "weeknight wording is tagged");
})();

// --- merge keeps user tags first and dedups against suggestions ---
(function mergeKeepsUserTagsAndDedups() {
  const recipe = { title: "Copycat Panera Mac and Cheese", tags: ["Dinner", "copycat"], sections: [] };
  const out = applyTagsOnCreate(recipe);
  assert.strictEqual(out.indexOf("Dinner"), 0, "user tag preserved first");
  assert.strictEqual(out.filter((t) => normalizeTagKey(t) === "copycat").length, 1, "copycat not duplicated");
})();

console.log("recipe-tags-test: ok");
