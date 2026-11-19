// What is different between two versions of one recipe, said plainly.
//
// Pure, and deliberately not a diff. A character-level diff of a recipe is
// unreadable and, worse, misleading: "250" against "200" looks like one digit
// and is a quarter of the flour. What a cook needs in order to choose between
// two versions is the shape of the disagreement — whether the ingredients
// moved, whether the method moved, whether it is only the name — and then the
// two versions themselves, which the screen shows in full underneath.
//
// Nothing here decides anything. It describes, so that a person can.

import type { Ingredient, Recipe, Section, Step } from "../data/types.ts";

export type Difference = {
  /** One short line, in the cook's language, not the model's. */
  text: string;
  /** Ingredients and steps are what matter; a tag is worth less alarm. */
  weight: "major" | "minor";
};

function ingredientsOf(recipe: Recipe): Ingredient[] {
  return (recipe.sections ?? []).flatMap((s: Section) => s.ingredients ?? []);
}

function stepsOf(recipe: Recipe): Step[] {
  return (recipe.sections ?? []).flatMap((s: Section) => s.steps ?? []);
}

/** An ingredient as a cook reads it, for comparing two of them. */
function lineOf(ingredient: Ingredient): string {
  return [ingredient.amount ?? "", ingredient.unit ?? "", ingredient.name ?? ""]
    .join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function countLabel(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * How the two versions disagree.
 *
 * Empty means they do not, which is a real outcome and worth saying: the
 * server refuses a write whose base revision is stale whether or not the
 * content actually changed, so a cook can be asked to choose between two
 * recipes that read identically. Telling them that is kinder than making them
 * compare the two by eye and conclude it themselves.
 */
export function differences(mine: Recipe | null, theirs: Recipe | null): Difference[] {
  if (!mine || !theirs) return [];
  const out: Difference[] = [];

  if ((mine.title ?? "").trim() !== (theirs.title ?? "").trim()) {
    out.push({ text: `The name differs: “${mine.title}” and “${theirs.title}”.`, weight: "minor" });
  }

  const mineIngredients = ingredientsOf(mine);
  const theirIngredients = ingredientsOf(theirs);
  const mineLines = mineIngredients.map(lineOf);
  const theirLines = theirIngredients.map(lineOf);

  const added = mineLines.filter((l) => !theirLines.includes(l)).length;
  const removed = theirLines.filter((l) => !mineLines.includes(l)).length;
  if (added || removed) {
    const parts: string[] = [];
    if (added) parts.push(`${countLabel(added, "ingredient line", "ingredient lines")} only in your version`);
    if (removed) parts.push(`${countLabel(removed, "line", "lines")} only in the account's`);
    out.push({ text: "Ingredients: " + parts.join(", ") + ".", weight: "major" });
  }

  const mineSteps = stepsOf(mine).map((s) => (s.text ?? "").trim());
  const theirSteps = stepsOf(theirs).map((s) => (s.text ?? "").trim());
  if (mineSteps.length !== theirSteps.length) {
    out.push({
      text: `Method: ${countLabel(mineSteps.length, "step", "steps")} in yours, `
        + `${countLabel(theirSteps.length, "step", "steps")} in the account's.`,
      weight: "major",
    });
  } else {
    const changed = mineSteps.filter((text, i) => text !== theirSteps[i]).length;
    if (changed) {
      out.push({ text: `Method: ${countLabel(changed, "step reads", "steps read")} differently.`, weight: "major" });
    }
  }

  const mineServes = mine.servings ?? null;
  const theirServes = theirs.servings ?? null;
  if (mineServes !== theirServes) {
    out.push({
      text: `Serves ${mineServes ?? "unstated"} in yours, ${theirServes ?? "unstated"} in the account's.`,
      weight: "minor",
    });
  }

  const mineTags = [...(mine.tags ?? [])].sort().join("|").toLowerCase();
  const theirTags = [...(theirs.tags ?? [])].sort().join("|").toLowerCase();
  if (mineTags !== theirTags) out.push({ text: "The tags differ.", weight: "minor" });

  if ((mine.category ?? "") !== (theirs.category ?? "")) {
    out.push({ text: "They are filed under different categories.", weight: "minor" });
  }

  if ((mine.notes ?? "").trim() !== (theirs.notes ?? "").trim()) {
    out.push({ text: "The notes differ.", weight: "minor" });
  }

  return out;
}

/** One line for a list, where there is no room for the whole account. */
export function summarise(mine: Recipe | null, theirs: Recipe | null): string {
  const list = differences(mine, theirs);
  if (!list.length) return "The two versions read the same.";
  const major = list.filter((d) => d.weight === "major");
  if (major.length) return major[0].text;
  return list[0].text;
}
