// Pure regression test for public/recipe-library.js: categories, the offline
// mirror's compaction rules and paginated loading. No server, network or
// dependencies, so it can also run on Hermes later. Locks today's behaviour; it
// does not change it.
const assert = require("assert");
const L = require("../public/recipe-library");

(async () => {
  // ── canonical categories ──
  assert.deepStrictEqual([...L.CANONICAL_CATEGORIES], ["Breakfast", "Appetizers", "Entrées", "Sides", "Condiments & Sauces", "Beverages", "Desserts", "Baked Goods"]);
  assert.ok(Object.isFrozen(L.CANONICAL_CATEGORIES), "category list cannot be mutated by callers");
  assert.strictEqual(L.DEFAULT_PAGE_SIZE, 50);

  // aliases fold into Baked Goods, case-insensitively and trimmed
  for (const v of ["bakery", "Baking", "  baked good  ", "BAKERY"]) assert.strictEqual(L.canonicalRecipeCategory(v), "Baked Goods", v);
  // canonical and unknown values pass through (trimmed), never invented
  assert.strictEqual(L.canonicalRecipeCategory("Desserts"), "Desserts");
  assert.strictEqual(L.canonicalRecipeCategory("  Sides "), "Sides");
  assert.strictEqual(L.canonicalRecipeCategory("Cocktails"), "Cocktails", "unknown categories are left for validation to judge");
  assert.strictEqual(L.canonicalRecipeCategory(""), null);
  assert.strictEqual(L.canonicalRecipeCategory(null), null);
  assert.strictEqual(L.canonicalRecipeCategory(undefined), null);

  // canonicalizeRecipe returns the same object when nothing changes, a copy otherwise
  const same = { id: "r1", category: "Desserts" };
  assert.strictEqual(L.canonicalizeRecipe(same), same);
  const bakery = { id: "r2", category: "bakery", title: "Rolls" };
  const fixed = L.canonicalizeRecipe(bakery);
  assert.notStrictEqual(fixed, bakery);
  assert.strictEqual(fixed.category, "Baked Goods");
  assert.strictEqual(bakery.category, "bakery", "input is not mutated");
  assert.strictEqual(L.canonicalizeRecipe(null), null);

  // ── offline mirror compaction ──
  const full = {
    id: "r3", title: "Card Cake", category: "baking",
    heroImage: "data:image/jpeg;base64,AAAA",
    originalSource: { kind: "image", pages: ["data:image/jpeg;base64,BBBB"] },
    householdShared: false, ownerId: "u1", ownerName: "Sam",
    sourceUrl: "https://example.com/cake",
    source: { url: "https://example.com/cake", siteName: "Example", originalTitle: "Cake" },
    sections: [{ name: "Main", ingredients: [{ id: "i1", name: "flour" }], steps: [] }],
    futureField: { kept: true },
  };
  const compact = L.compactRecipeForLocal(full);
  assert.strictEqual(compact.heroImage, "", "embedded hero photos are not mirrored to local storage");
  assert.ok(!("originalSource" in compact), "original source media is not mirrored");
  for (const k of ["householdShared", "ownerId", "ownerName"]) assert.ok(!(k in compact), `${k} is not mirrored`);
  assert.strictEqual(compact.category, "Baked Goods", "category is canonicalised on the way in");
  assert.deepStrictEqual(compact.sections, full.sections, "the cookable text is kept");
  // Attribution and unknown fields survive the mirror (ADR 0020 round-trip requirement).
  assert.strictEqual(compact.sourceUrl, full.sourceUrl);
  assert.deepStrictEqual(compact.source, full.source);
  assert.deepStrictEqual(compact.futureField, { kept: true }, "fields the web app doesn't know are preserved");
  assert.ok(full.originalSource && full.heroImage.startsWith("data:"), "input is not mutated");

  const remote = L.compactRecipeForLocal({ id: "r4", heroImage: "https://example.com/photo.jpg" });
  assert.strictEqual(remote.heroImage, "https://example.com/photo.jpg", "URL hero images are kept");

  const list = L.compactRecipesForLocal([full, null, { id: "r5", householdShared: true }, { id: "r6", category: "Sides" }]);
  assert.deepStrictEqual(list.map((r) => r.id), ["r3", "r6"], "nulls and other members' shared recipes are not mirrored");
  assert.deepStrictEqual(L.compactRecipesForLocal(undefined), []);

  // ── paginated loading ──
  const pages = { null: { recipes: [{ id: "a", category: "bakery" }], nextCursor: "c1" }, c1: { recipes: [{ id: "b" }], nextCursor: 2 }, 2: { recipes: [{ id: "c" }], nextCursor: null } };
  const seen = [];
  const all = await L.fetchAllPages(async (cursor) => { seen.push(cursor); return pages[cursor]; });
  assert.deepStrictEqual(all.map((r) => r.id), ["a", "b", "c"]);
  assert.strictEqual(all[0].category, "Baked Goods", "pages are canonicalised");
  assert.deepStrictEqual(seen, [null, "c1", "2"], "numeric cursors are passed on as strings");

  const legacy = await L.fetchAllPages(async () => [{ id: "x", category: "baking" }]);
  assert.deepStrictEqual(legacy, [{ id: "x", category: "Baked Goods" }], "pre-pagination array responses still work");

  await assert.rejects(L.fetchAllPages(async (c) => ({ recipes: [], nextCursor: "loop" })), /repeated a page/, "a repeating cursor stops instead of looping forever");
  await assert.rejects(L.fetchAllPages(async () => ({})), /incomplete/);
  await assert.rejects(L.fetchAllPages(async () => null), /incomplete/);
  await assert.rejects(L.fetchAllPages(), /page loader is required/);

  console.log("recipe-library-test: ok");
})().catch((e) => { console.error(e); process.exit(1); });
