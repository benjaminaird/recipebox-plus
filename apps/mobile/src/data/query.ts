// Library search and filtering, as pure functions.
//
// Kept apart from db.ts on purpose: expo-sqlite cannot be imported by the
// node test runner, so the behaviour worth testing — what matches a search,
// what a filter admits, what order results come back in — lives here where
// tests can reach it, and db.ts only does storage.
import type { Recipe } from "./types";

/**
 * The text a recipe is searchable by: its title, description, category, tags
 * and every ingredient name. Lowercased once at write time and stored, so a
 * keystroke never walks the whole library.
 */
export function buildSearchText(recipe: Recipe): string {
  const parts: string[] = [recipe.title];
  if (recipe.description) parts.push(recipe.description);
  if (recipe.category) parts.push(recipe.category);
  for (const tag of recipe.tags ?? []) parts.push(tag);
  for (const section of recipe.sections) {
    if (section.name) parts.push(section.name);
    for (const ingredient of section.ingredients) parts.push(ingredient.name);
  }
  return parts.join(" ").toLowerCase();
}

export type LibraryFilters = {
  /** Free text. Every whitespace-separated term must appear. */
  query?: string;
  /** Exact category match. */
  category?: string | null;
  /** Every listed tag must be present. */
  tags?: string[];
};

/** Does this recipe satisfy the filters? */
export function matches(recipe: Recipe, filters: LibraryFilters, search?: string): boolean {
  const haystack = search ?? buildSearchText(recipe);

  const q = (filters.query ?? "").trim().toLowerCase();
  if (q) {
    // Every term must appear, so "lemon dessert" narrows rather than widens.
    for (const term of q.split(/\s+/)) if (!haystack.includes(term)) return false;
  }

  if (filters.category && recipe.category !== filters.category) return false;

  for (const tag of filters.tags ?? []) {
    if (!(recipe.tags ?? []).includes(tag)) return false;
  }
  return true;
}

/** Most recently added first; ties broken by title so the order is stable. */
export function byNewest(a: Recipe, b: Recipe): number {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return a.title.localeCompare(b.title);
}

/** Filter and order a library in one step. */
export function queryLibrary(recipes: Recipe[], filters: LibraryFilters = {}): Recipe[] {
  return recipes.filter((r) => matches(r, filters)).sort(byNewest);
}
