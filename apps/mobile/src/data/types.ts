// The recipe shape, mirroring what the product already stores.
//
// These types are a TypeScript statement of `packages/recipe-core/src/recipe-schema.js` — the
// same field names, the same nesting, the same stable ingredient ids that
// steps point at (ADR 0012). The native client must not invent a parallel
// format: a recipe written here has to round-trip through the existing
// domain modules and, later, through sync.
//
// `source` follows ADR 0020. Only the fields the sample data actually uses are
// modelled; the rest of that ADR's fields are additive and can be filled in
// without changing what is here.

import { displayTag, normalizeTagKey } from "../domain/tags.ts";

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

/**
 * How much of an ingredient one step uses.
 *
 * A ref says *which* ingredient a step touches. It does not say *how much*: a
 * recipe that creams half the butter and browns the other half references the
 * same id twice, and printing the full 200 g against both steps is wrong in a
 * way a cook acts on. This carries the share, and the ingredient list keeps
 * the untouched total.
 *
 * Additive and optional. A step that states no use behaves exactly as before.
 */
export type IngredientUse = {
  /** The ingredient's stable id. */
  id: string;
  /** This step's share: "100", "1/2". Absent when only `note` applies. */
  amount?: string;
  /** Unit for `amount`. Falls back to the ingredient's own unit. */
  unit?: string;
  /** For shares that are not a number: "the rest", "a splash". */
  note?: string;
};

export type Step = {
  /** Stable id (`s1`, `s2`). */
  id: string;
  /** One instruction. May reference ingredients inline as {i1}. */
  text: string;
  /** Ingredient ids this step uses. The step stores no quantity of its own. */
  ingredientRefs?: string[];
  /**
   * Per-step shares of a divided ingredient. Only needed where an ingredient
   * is split across steps; everything else is covered by `ingredientRefs`.
   */
  ingredientUses?: IngredientUse[];
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

/**
 * Why the quantity shown against a step is the number it is.
 *
 *   portion      the recipe states this step's share explicitly.
 *   all          the ingredient is used by exactly one step, so the whole
 *                amount is that step's amount. Safe to state.
 *   unspecified  several steps use it and none says how much. The amount is
 *                the recipe's TOTAL, and must be labelled as such rather than
 *                presented as this step's share.
 */
export type UseBasis = "portion" | "all" | "unspecified";

export type ResolvedUse = {
  ingredient: Ingredient;
  basis: UseBasis;
  /** What to print beside the name. May be empty if the source gave nothing. */
  quantity: string;
  /** True when `quantity` is the recipe total, not this step's share. */
  isTotal: boolean;
  /** The raw amount and unit behind `quantity`, so a display layer can scale
   *  or convert this step's share instead of re-parsing a formatted string.
   *  Absent when the share is words rather than a number ("the rest"). */
  amount?: string;
  unit?: string;
};

/** How many of the recipe's steps reference this ingredient id. */
function refCount(recipe: Recipe, id: string): number {
  let n = 0;
  for (const section of recipe.sections) {
    for (const step of section.steps) {
      const ids = new Set([
        ...(step.ingredientRefs ?? []),
        ...(step.ingredientUses ?? []).map((u) => u.id),
      ]);
      if (ids.has(id)) n++;
    }
  }
  return n;
}

/**
 * The ingredients a step uses, each with the quantity that is actually true
 * for that step.
 *
 * The rule that matters: an unqualified ref against an ingredient used by more
 * than one step does NOT license printing the full amount as the step's share.
 * That case is returned as `unspecified` with `isTotal`, so the interface can
 * say "200 g total" instead of silently doubling the recipe.
 */
export function stepIngredientUses(recipe: Recipe, step: Step): ResolvedUse[] {
  const uses = step.ingredientUses ?? [];
  // A stated use implies a reference, so a step need not list the id twice.
  const ids: string[] = [];
  for (const id of [...(step.ingredientRefs ?? []), ...uses.map((u) => u.id)]) {
    if (!ids.includes(id)) ids.push(id);
  }

  const out: ResolvedUse[] = [];
  for (const id of ids) {
    const ingredient = findIngredient(recipe, id);
    if (!ingredient) continue; // a ref that matches nothing is dropped, not drawn broken

    const use = uses.find((u) => u.id === id);
    if (use && (use.note || use.amount)) {
      const unit = use.unit ?? ingredient.unit;
      const quantity = use.note
        ? use.note
        : [use.amount, unit].filter(Boolean).join(" ").trim();
      out.push({
        ingredient,
        basis: "portion",
        quantity,
        isTotal: false,
        // A note is prose, so it carries no scalable amount.
        ...(use.note ? {} : { amount: use.amount, unit }),
      });
      continue;
    }

    const shared = refCount(recipe, id) > 1;
    out.push({
      ingredient,
      basis: shared ? "unspecified" : "all",
      quantity: formatQuantity(ingredient),
      isTotal: shared,
      amount: ingredient.amount,
      unit: ingredient.unit,
    });
  }
  return out;
}

/**
 * Every distinct tag across a set of recipes, in first-seen order.
 *
 * Grouped by meaning, not by spelling, and shown in the canonical form. A
 * library holds recipes from many sources and many dates, so "Gluten free"
 * and "Gluten-Free" will both be in it -- and listing them as two filters that
 * each find half the matching recipes is worse than useless, because nothing
 * on screen says they are the same thing.
 *
 * This normalises what is *displayed and matched*, never what is stored. The
 * recipe keeps the words it was saved with.
 */
export function collectTags(recipes: Recipe[]): string[] {
  const byKey = new Map<string, string>();
  for (const r of recipes) {
    for (const tag of r.tags ?? []) {
      const key = normalizeTagKey(tag);
      if (key && !byKey.has(key)) byKey.set(key, displayTag(tag));
    }
  }
  return [...byKey.values()];
}

/** Every distinct category, in first-seen order, grouped the same way. */
export function collectCategories(recipes: Recipe[]): string[] {
  const byKey = new Map<string, string>();
  for (const r of recipes) {
    if (!r.category) continue;
    const key = normalizeTagKey(r.category);
    if (key && !byKey.has(key)) byKey.set(key, r.category);
  }
  return [...byKey.values()];
}

/**
 * The quantity to print beside a step's ingredient.
 *
 * A total is always said to be a total. Leaving the word off would make an
 * unapportioned amount read as this step's share, which is the exact mistake
 * the use model exists to prevent.
 */
export function useQuantityLabel(use: ResolvedUse): string {
  if (!use.quantity) return "";
  return use.isTotal ? `${use.quantity} total` : use.quantity;
}

/** One-line form for a chip: "115 g unsalted butter", "flaky sea salt · 1 tsp total". */
export function useChipLabel(use: ResolvedUse): string {
  const name = use.ingredient.name;
  if (!use.quantity) return name;
  return use.isTotal ? `${name} · ${use.quantity} total` : `${use.quantity} ${name}`;
}
