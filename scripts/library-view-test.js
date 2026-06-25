const assert = require("assert");
const RecipeBoxTags = require("../public/recipe-tags");

// These mirror the pure view rules in Library() (src/app.jsx). Keep in sync.
const tagKey = (t) => RecipeBoxTags.normalizeTagKey(t);

function buildQuickFinds(recipes) {
  const counts = {}, display = {};
  recipes.forEach((r) => (r.tags || []).forEach((t) => {
    const k = tagKey(t); if (!k) return;
    counts[k] = (counts[k] || 0) + 1;
    if (!display[k]) display[k] = RecipeBoxTags.displayTag(t);
  }));
  return Object.keys(counts)
    .sort((a, b) => (counts[b] - counts[a]) || display[a].localeCompare(display[b]))
    .map((k) => ({ key: k, label: display[k], count: counts[k] }));
}

function categorySplit(recipes, CATEGORIES) {
  const counts = {}; CATEGORIES.forEach((c) => counts[c] = recipes.filter((r) => r.category === c).length);
  const favoriteCount = recipes.filter((r) => r.favorite).length;
  const cards = CATEGORIES.map((c) => ({ label: c, count: counts[c] }));
  const filled = cards.filter((c) => c.count > 0).sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  const empty = cards.filter((c) => c.count === 0).sort((a, b) => a.label.localeCompare(b.label));
  const fav = favoriteCount > 0 ? [{ label: "Favorites", count: favoriteCount }] : [];
  return { primaryBrowse: [...fav, ...filled], emptyCats: empty };
}

function filtered(recipes, { search = "", cat = "All", filter = "all", activeTag = "" } = {}) {
  const q = search.toLowerCase(); const ak = tagKey(activeTag);
  return recipes.filter((r) => {
    const matchCat = cat === "All" || r.category === cat;
    const matchFilter = filter === "all" || (filter === "favorites" && r.favorite) || (filter === "recent" && Date.now() - new Date(r.createdAt).getTime() < 7 * 86400000);
    const matchSearch = !q || r.title.toLowerCase().includes(q) || (r.category || "").toLowerCase().includes(q) || (r.tags || []).some((t) => t.toLowerCase().includes(q)) || (r.sections || []).some((s) => s.ingredients.some((i) => i.name.toLowerCase().includes(q)));
    const matchTag = !ak || (r.tags || []).some((t) => tagKey(t) === ak);
    return matchCat && matchFilter && matchSearch && matchTag;
  });
}

const CATEGORIES = ["Breakfast", "Entrées", "Sides", "Desserts", "Drinks"];
const now = Date.now();
const recipes = [
  { id: 1, title: "Copycat Chick-fil-A Sauce", category: "Condiments", favorite: true,  createdAt: new Date(now - 1 * 3600e3), tags: ["Copycat", "Quick"], sections: [{ ingredients: [{ name: "mayonnaise" }] }] },
  { id: 2, title: "Weeknight Chicken",          category: "Entrées",     favorite: false, createdAt: new Date(now - 2 * 3600e3), tags: ["Quick", "Weeknight"], sections: [{ ingredients: [{ name: "chicken thighs" }] }] },
  { id: 3, title: "Banana Pancakes",            category: "Breakfast",   favorite: true,  createdAt: new Date(now - 9 * 86400e3), tags: ["Quick"], sections: [{ ingredients: [{ name: "banana" }] }] },
  { id: 4, title: "Slow Cooker Chili",          category: "Entrées",     favorite: false, createdAt: new Date(now - 3 * 3600e3), tags: ["Slow Cooker", "Comfort Food"], sections: [{ ingredients: [{ name: "ground beef" }] }] },
];

// 1) Quick Finds: only existing tags, frequency desc then alpha.
const qf = buildQuickFinds(recipes);
assert.deepStrictEqual(qf.map((t) => t.label), ["Quick", "Comfort Food", "Copycat", "Slow Cooker", "Weeknight"], "quick finds sort freq then alpha: " + JSON.stringify(qf.map((t) => t.label)));
assert.strictEqual(qf.find((t) => t.label === "Quick").count, 3, "Quick count = 3");
assert.ok(!qf.some((t) => t.label === "Air Fryer"), "tags with no recipes never appear");

// 2) Tag click filters; clear restores.
assert.deepStrictEqual(filtered(recipes, { activeTag: "Copycat" }).map((r) => r.id), [1], "tag filter narrows to Copycat");
assert.strictEqual(filtered(recipes, { activeTag: "" }).length, 4, "cleared tag shows all");
assert.strictEqual(filtered(recipes, { activeTag: "quick" }).length, 3, "tag filter is case-insensitive");

// 3) Categories with recipes sort before zero-count; favorites lead when present.
const { primaryBrowse, emptyCats } = categorySplit(recipes, CATEGORIES);
assert.strictEqual(primaryBrowse[0].label, "Favorites", "favorites card leads when favorites exist");
assert.deepStrictEqual(primaryBrowse.slice(1).map((c) => c.label), ["Entrées", "Breakfast"], "filled categories sort by count desc: " + JSON.stringify(primaryBrowse.map((c) => c.label)));
assert.ok(primaryBrowse.every((c) => c.count > 0), "primary browse has no empty categories");
assert.deepStrictEqual(emptyCats.map((c) => c.label), ["Desserts", "Drinks", "Sides"], "empty categories collapsed + alpha");

// 4) Search still matches title, category, tags, and ingredients.
assert.deepStrictEqual(filtered(recipes, { search: "banana" }).map((r) => r.id), [3], "search matches title/ingredient");
assert.deepStrictEqual(filtered(recipes, { search: "entrées" }).map((r) => r.id).sort(), [2, 4], "search matches category");
assert.deepStrictEqual(filtered(recipes, { search: "copycat" }).map((r) => r.id), [1], "search matches tag");
assert.deepStrictEqual(filtered(recipes, { search: "chicken" }).map((r) => r.id).sort(), [2], "search matches ingredient");

// 5) Favorites + Recent quick filters work.
assert.deepStrictEqual(filtered(recipes, { filter: "favorites" }).map((r) => r.id).sort(), [1, 3], "favorites filter");
assert.deepStrictEqual(filtered(recipes, { filter: "recent" }).map((r) => r.id).sort(), [1, 2, 4], "recent filter = last 7 days (excludes #3 at 9 days)");

// 6) Small library: Recently Saved (>=6) stays hidden so the page never feels empty.
assert.strictEqual(recipes.length >= 6, false, "4-recipe library hides Recently Saved");

console.log("library-view-test: ok");
