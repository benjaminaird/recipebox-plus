(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecipeBoxLibrary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_PAGE_SIZE = 50;
  const EMBEDDED_IMAGE_PREFIX = /^data:image\//i;
  const CATEGORY_ALIASES = new Map([["bakery","Baked Goods"],["baking","Baked Goods"],["baked good","Baked Goods"]]);

  function canonicalRecipeCategory(value) {
    if (value == null || value === "") return value || null;
    const text = String(value).trim();
    return CATEGORY_ALIASES.get(text.toLowerCase()) || text;
  }

  function canonicalizeRecipe(recipe) {
    if (!recipe || typeof recipe !== "object") return recipe;
    const category = canonicalRecipeCategory(recipe.category);
    return category === recipe.category ? recipe : { ...recipe, category };
  }

  function compactRecipeForLocal(recipe) {
    if (!recipe || typeof recipe !== "object") return recipe;
    const { originalSource, householdShared, ownerId, ownerName, ...compact } = canonicalizeRecipe(recipe);
    // Embedded photos can consume several megabytes each and make localStorage
    // fail after only a handful of recipes. The database remains authoritative
    // for images; the offline mirror keeps every recipe's searchable/cookable text.
    if (typeof compact.heroImage === "string" && EMBEDDED_IMAGE_PREFIX.test(compact.heroImage)) {
      compact.heroImage = "";
    }
    return compact;
  }

  function compactRecipesForLocal(recipes) {
    return (Array.isArray(recipes) ? recipes : [])
      .filter((recipe) => recipe && !recipe.householdShared)
      .map(compactRecipeForLocal);
  }

  async function fetchAllPages(fetchPage) {
    if (typeof fetchPage !== "function") throw new Error("A page loader is required.");
    const recipes = [];
    const seenCursors = new Set();
    let cursor = null;

    while (true) {
      const page = await fetchPage(cursor);
      // Backward compatibility for a server deployed before pagination support.
      if (Array.isArray(page)) return page.map(canonicalizeRecipe);
      if (!page || !Array.isArray(page.recipes)) throw new Error("Recipe library response was incomplete.");
      recipes.push(...page.recipes.map(canonicalizeRecipe));
      const nextCursor = page.nextCursor == null ? null : String(page.nextCursor);
      if (!nextCursor) return recipes;
      if (seenCursors.has(nextCursor)) throw new Error("Recipe library pagination repeated a page.");
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
  }

  return { DEFAULT_PAGE_SIZE, canonicalRecipeCategory, canonicalizeRecipe, compactRecipeForLocal, compactRecipesForLocal, fetchAllPages };
});
