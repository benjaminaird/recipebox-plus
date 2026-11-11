// Editing a recipe, as pure rules.
//
// No React Native, no database. The screen holds one of these in state and
// hands it back; nothing here writes anything.
//
// ## The thing that must not break
//
// ADR 0012 has steps reference ingredients by a stable id. Those ids are
// load-bearing: Recipe Detail shows which ingredients a step uses, Cook Mode
// prints the quantity beside the instruction, and the divided-quantity work
// resolves a step's share through them. An edit that renumbers ingredients
// silently repoints every step at the wrong one -- the recipe still looks
// right in a list, and goes wrong in a kitchen.
//
// So ids are allocated once and never reused, never renumbered, and removing
// an ingredient also removes every reference to it. There is a test for each
// of those, because none of them is visible in a screenshot.
import type { Ingredient, Recipe, Section, Step, Source } from "../data/types.ts";
import { normalizeCategory, normalizeRecipeTags } from "./tags.ts";

export type DraftIngredient = Ingredient & { id: string };

export type DraftSection = {
  name: string;
  ingredients: DraftIngredient[];
  steps: Step[];
};

export type Draft = {
  id: string;
  title: string;
  description: string;
  servings: string;
  totalTime: string;
  category: string;
  tags: string[];
  sourceReference: string;
  sourceUrl: string;
  sections: DraftSection[];
  createdAt: number;
  /** High-water marks. They only ever go up, so an id is never handed out
   *  twice even after the ingredient that held it is deleted. */
  nextIngredient: number;
  nextStep: number;
};

export function emptyDraft(id: string, now = Date.now()): Draft {
  return {
    id,
    title: "",
    description: "",
    servings: "",
    totalTime: "",
    category: "",
    tags: [],
    sourceReference: "",
    sourceUrl: "",
    // One unnamed section. A recipe with parts ("Shortbread base", "Caramel")
    // adds names later; most recipes never need one, and making someone name a
    // section before they can type an ingredient would be a toll on every
    // recipe to serve a minority of them.
    sections: [{ name: "", ingredients: [], steps: [] }],
    createdAt: now,
    nextIngredient: 1,
    nextStep: 1,
  };
}

function highest(values: readonly string[], prefix: string): number {
  let max = 0;
  for (const value of values) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(value);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export function draftFromRecipe(recipe: Recipe): Draft {
  return {
    id: recipe.id,
    title: recipe.title ?? "",
    description: recipe.description ?? "",
    servings: recipe.servings != null ? String(recipe.servings) : "",
    totalTime: recipe.totalTime ?? "",
    category: recipe.category ?? "",
    tags: [...(recipe.tags ?? [])],
    sourceReference: recipe.source?.reference ?? recipe.source?.siteName ?? "",
    sourceUrl: recipe.source?.url ?? "",
    sections: (recipe.sections ?? []).map((s) => ({
      name: s.name ?? "",
      ingredients: s.ingredients.map((i) => ({ ...i })),
      steps: s.steps.map((st) => ({ ...st, ingredientRefs: [...(st.ingredientRefs ?? [])] })),
    })),
    createdAt: recipe.createdAt,
    nextIngredient:
      highest((recipe.sections ?? []).flatMap((s) => s.ingredients.map((i) => i.id)), "i") + 1,
    nextStep:
      highest((recipe.sections ?? []).flatMap((s) => s.steps.map((st) => st.id)), "s") + 1,
  };
}

/**
 * The next ingredient id, and the draft that has issued it.
 *
 * Ids are unique across the WHOLE recipe, not within a section: a step
 * resolves an id against the whole recipe, so two sections each numbering from
 * i1 would give one reference two possible meanings.
 *
 * And the counter only ever goes up. Computing "one more than the highest
 * currently present" looks equivalent and is not: delete the last ingredient
 * and the next one added takes the id just freed. Nothing inside this recipe
 * breaks, because removing an ingredient also removes its references -- but
 * ADR 0015 keeps every prior version of a recipe, and a restored version
 * referencing the old i3 would silently bind to a different ingredient that
 * now holds that id. A monotonic counter costs one integer and closes it.
 */
export function allocateIngredientId(draft: Draft): { id: string; draft: Draft } {
  const n = Math.max(
    draft.nextIngredient,
    highest(draft.sections.flatMap((s) => s.ingredients.map((i) => i.id)), "i") + 1,
  );
  return { id: `i${n}`, draft: { ...draft, nextIngredient: n + 1 } };
}

export function allocateStepId(draft: Draft): { id: string; draft: Draft } {
  const n = Math.max(
    draft.nextStep,
    highest(draft.sections.flatMap((s) => s.steps.map((st) => st.id)), "s") + 1,
  );
  return { id: `s${n}`, draft: { ...draft, nextStep: n + 1 } };
}

/** What the next id WOULD be, without issuing it. For tests and for labels. */
export function nextIngredientId(draft: Draft): string {
  return allocateIngredientId(draft).id;
}

export function nextStepId(draft: Draft): string {
  return allocateStepId(draft).id;
}

/**
 * Remove an ingredient, and every step reference to it.
 *
 * The second half is the important half. A step left pointing at a deleted
 * ingredient renders nothing in Recipe Detail and nothing in Cook Mode, so the
 * cook sees a step with no quantities and no indication that anything is
 * missing.
 */
export function removeIngredient(draft: Draft, ingredientId: string): Draft {
  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      ingredients: section.ingredients.filter((i) => i.id !== ingredientId),
      steps: section.steps.map((step) => ({
        ...step,
        ingredientRefs: (step.ingredientRefs ?? []).filter((ref) => ref !== ingredientId),
        ...(step.ingredientUses
          ? { ingredientUses: step.ingredientUses.filter((u) => u.id !== ingredientId) }
          : {}),
      })),
    })),
  };
}

export function removeStep(draft: Draft, stepId: string): Draft {
  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      steps: section.steps.filter((s) => s.id !== stepId),
    })),
  };
}

/** Every reference in the draft that points at no ingredient. Should always
 *  be empty; the test asserts it stays that way through edits. */
export function danglingRefs(draft: Draft): string[] {
  const ids = new Set(draft.sections.flatMap((s) => s.ingredients.map((i) => i.id)));
  const out: string[] = [];
  for (const section of draft.sections) {
    for (const step of section.steps) {
      for (const ref of step.ingredientRefs ?? []) if (!ids.has(ref)) out.push(ref);
      for (const use of step.ingredientUses ?? []) if (!ids.has(use.id)) out.push(use.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type DraftProblem = {
  field: "title" | "ingredients" | "steps" | "sourceUrl";
  message: string;
  /** A blocker stops the save. A caution is worth saying and worth ignoring. */
  blocking: boolean;
};

/**
 * What is wrong with a draft.
 *
 * Only a missing title blocks. Everything else is a caution, because a cook
 * half-way through typing a recipe off a card has a legitimate half-finished
 * recipe, and refusing to save it would lose their work to protect a tidiness
 * nobody asked for. ADR 0014 already decided this shape for imports: an
 * unresolved recipe can still be saved.
 */
export function validateDraft(draft: Draft): DraftProblem[] {
  const problems: DraftProblem[] = [];

  if (!draft.title.trim()) {
    problems.push({ field: "title", message: "Give the recipe a name before saving.", blocking: true });
  }

  const ingredients = draft.sections.flatMap((s) => s.ingredients);
  const named = ingredients.filter((i) => i.name.trim());
  if (named.length === 0) {
    problems.push({
      field: "ingredients",
      message: "No ingredients yet. You can save and add them later.",
      blocking: false,
    });
  }

  const steps = draft.sections.flatMap((s) => s.steps).filter((s) => s.text.trim());
  if (steps.length === 0) {
    problems.push({
      field: "steps",
      message: "No method yet. You can save and add it later.",
      blocking: false,
    });
  }

  const url = draft.sourceUrl.trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    problems.push({
      field: "sourceUrl",
      message: "That does not look like a web address. It should start with http:// or https://.",
      blocking: true,
    });
  }

  return problems;
}

export function canSave(draft: Draft): boolean {
  return !validateDraft(draft).some((p) => p.blocking);
}

// ---------------------------------------------------------------------------
// Back to a recipe
// ---------------------------------------------------------------------------

/** The host of a URL, or null. Deliberately forgiving: a cook typing a source
 *  by hand is not writing a URI, and a slightly malformed one should cost the
 *  domain line, not the whole attribution. */
function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/?#\s]+)/i.exec(url.trim());
  return m ? m[1].replace(/^www\./i, "") : null;
}

function cleanIngredient(i: DraftIngredient): Ingredient | null {
  const name = i.name.trim();
  if (!name) return null;
  const out: Ingredient = { id: i.id, name };
  const amount = (i.amount ?? "").trim();
  const unit = (i.unit ?? "").trim();
  if (amount) out.amount = amount;
  if (unit) out.unit = unit;
  if (i.optional) out.optional = true;
  // raw is what the source actually said. For a hand-typed recipe that is
  // what was typed, which keeps one shape for hand-written and imported alike.
  out.raw = [amount, unit, name].filter(Boolean).join(" ");
  return out;
}

/**
 * Turn a draft into a recipe ready to store.
 *
 * Blank rows are dropped -- an editor always has an empty row at the bottom to
 * type into, and saving those as nameless ingredients would fill the library
 * with them. Dropping an ingredient here also drops references to it, for the
 * same reason removeIngredient does.
 */
export function recipeFromDraft(draft: Draft, now = Date.now()): Recipe {
  const sections: Section[] = draft.sections.map((section) => {
    const ingredients = section.ingredients
      .map(cleanIngredient)
      .filter((i): i is Ingredient => i !== null);
    const keptIds = new Set(ingredients.map((i) => i.id));
    const steps: Step[] = section.steps
      .filter((s) => s.text.trim())
      .map((s) => {
        const refs = (s.ingredientRefs ?? []).filter((ref) => keptIds.has(ref));
        const step: Step = { id: s.id, text: s.text.trim() };
        if (refs.length) step.ingredientRefs = refs;
        const uses = (s.ingredientUses ?? []).filter((u) => keptIds.has(u.id));
        if (uses.length) step.ingredientUses = uses;
        return step;
      });
    return { ...(section.name.trim() ? { name: section.name.trim() } : {}), ingredients, steps };
  })
  // A section with nothing in it is not a part of the recipe.
  .filter((s) => s.ingredients.length > 0 || s.steps.length > 0);

  // Attribution per ADR 0020. `method` is "manual" because that is how this
  // recipe arrived, whatever it was copied from; `kind` describes the thing it
  // came from. The domain is stored rather than parsed on render, so a source
  // still shows its origin with no network.
  const reference = draft.sourceReference.trim();
  const url = draft.sourceUrl.trim();
  const source: Source | undefined =
    reference || url
      ? {
          kind: url ? "website" : "other",
          method: "manual",
          ...(reference ? { reference } : {}),
          ...(url ? { url } : {}),
          ...(url && hostOf(url) ? { domain: hostOf(url) as string } : {}),
        }
      : undefined;

  const servings = Number(draft.servings.trim());

  return {
    id: draft.id,
    title: draft.title.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(Number.isFinite(servings) && servings > 0 ? { servings } : {}),
    ...(draft.totalTime.trim() ? { totalTime: draft.totalTime.trim() } : {}),
    ...(normalizeCategory(draft.category) ? { category: normalizeCategory(draft.category) } : {}),
    tags: normalizeRecipeTags(draft.tags),
    ...(source ? { source } : {}),
    sections: sections.length > 0 ? sections : [{ ingredients: [], steps: [] }],
    createdAt: draft.createdAt,
    updatedAt: now,
  } as Recipe;
}
