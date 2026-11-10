// The recipe shape, mirroring what the product already stores.
//
// These types are a TypeScript statement of `public/recipe-schema.js` — the
// same field names, the same nesting, the same stable ingredient ids that
// steps point at (ADR 0012). The native client must not invent a parallel
// format: a recipe written here has to round-trip through the existing
// domain modules and, later, through sync.
//
// `source` follows ADR 0020. Only the fields the sample data actually uses are
// modelled; the rest of that ADR's fields are additive and can be filled in
// without changing what is here.

export type Ingredient = {
  /** Stable id (`i1`, `i2`) that steps reference. Never renumber on edit. */
  id: string;
  /** Quantity as written: "2", "1 1/2", "1-2". Empty when the line has none. */
  amount?: string;
  /** Unit as written: "cup", "tbsp", "clove". */
  unit?: string;
  /** Clean name only, with no parenthetical metric quantity. */
  name: string;
  /** Source-provided metric alternate, e.g. "222" from "1 cup (222g) butter". */
  weightAmount?: string;
  weightUnit?: string;
  /** The original line, kept for audit and source preservation. */
  raw?: string;
  /** Marked optional by the source. */
  optional?: boolean;
};

export type Step = {
  /** Stable id (`s1`, `s2`). */
  id: string;
  /** One instruction. May reference ingredients inline as {i1}. */
  text: string;
  /** Ingredient ids this step uses. The step stores no quantity of its own. */
  ingredientRefs?: string[];
};

export type Section = {
  /** Component name: "Shortbread base", "Caramel". Absent for a single-part recipe. */
  name?: string;
  ingredients: Ingredient[];
  steps: Step[];
};

export type Macros = {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
};

export type SourceKind =
  | "website" | "video" | "social" | "cookbook" | "magazine" | "family" | "other" | "unknown";

export type SourceMethod =
  | "link" | "video" | "social" | "photo" | "pdf" | "pasted-text" | "manual";

/** Attribution (ADR 0020). Part of what a recipe is, and always displayable. */
export type Source = {
  kind: SourceKind;
  url?: string;
  siteName?: string;
  /** Host of `url`, stored so it renders offline without parsing. */
  domain?: string;
  /** The title as the source published it, independent of the user's title. */
  originalTitle?: string;
  author?: string;
  platform?: string;
  /** Free text for things with no link: "Salt Fat Acid Heat, p. 212". */
  reference?: string;
  method: SourceMethod;
  /** Epoch ms. */
  capturedAt?: number;
};

export type Recipe = {
  id: string;
  title: string;
  description?: string;
  servings?: number;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  heroImage?: string;
  /** A real food type: "Desserts", "Entrées". Never "Copycat" — that is a tag. */
  category?: string;
  notes?: string;
  tags?: string[];
  macros?: Macros;
  sections: Section[];
  source?: Source;
  /** Epoch ms. Drives "recently added first". */
  createdAt: number;
  updatedAt: number;
};

/** Where a cook had got to. One row per recipe. */
export type CookProgress = {
  recipeId: string;
  /** Flat index across all sections' steps, 0-based. */
  stepIndex: number;
  updatedAt: number;
};

/** Every step in a recipe, flattened, with the section it belongs to. */
export type FlatStep = Step & { sectionIndex: number; sectionName?: string };

/** Flatten a recipe's steps in cooking order. */
export function flattenSteps(recipe: Recipe): FlatStep[] {
  const out: FlatStep[] = [];
  recipe.sections.forEach((section, sectionIndex) => {
    section.steps.forEach((step) => {
      out.push({ ...step, sectionIndex, sectionName: section.name });
    });
  });
  return out;
}

/** Look up an ingredient by id anywhere in the recipe. */
export function findIngredient(recipe: Recipe, id: string): Ingredient | undefined {
  for (const section of recipe.sections) {
    const hit = section.ingredients.find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The ingredients a step uses, resolved from its refs.
 *
 * This is the whole point of ADR 0012: a step holds pointers, never its own
 * copy of a quantity, so a step cannot contradict the ingredient list. Refs
 * that match nothing are dropped rather than rendered as a broken row.
 */
export function stepIngredients(recipe: Recipe, step: Step): Ingredient[] {
  return (step.ingredientRefs ?? [])
    .map((id) => findIngredient(recipe, id))
    .filter((i): i is Ingredient => Boolean(i));
}

/** "2 cup flour", skipping parts the source did not give. */
export function formatQuantity(ingredient: Ingredient): string {
  return [ingredient.amount, ingredient.unit].filter(Boolean).join(" ").trim();
}

/** Every distinct tag across a set of recipes, in first-seen order. */
export function collectTags(recipes: Recipe[]): string[] {
  const seen: string[] = [];
  for (const r of recipes) for (const tag of r.tags ?? []) if (!seen.includes(tag)) seen.push(tag);
  return seen;
}

/** Every distinct category, in first-seen order. */
export function collectCategories(recipes: Recipe[]): string[] {
  const seen: string[] = [];
  for (const r of recipes) if (r.category && !seen.includes(r.category)) seen.push(r.category);
  return seen;
}
