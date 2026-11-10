// Time, and why it does not scale with the batch.
//
// Pure. No React Native, no DOM.
//
// Doubling a recipe does not double its cooking time, and a feature that
// quietly multiplies "bake 25 minutes" into "bake 50 minutes" will burn
// someone's dinner. The useful answer is almost always structural -- two trays
// instead of one, a wider pan, cooking in batches -- and that depends on the
// method, not on arithmetic.
//
// So nothing here invents a new duration. Times are classified, preserved, and
// accompanied by a deterministic advisory where the method gives a reason to
// expect the conditions to change. Where no rule fires, the original time
// stands with nothing added, which is also an answer.

export type TimeKind =
  /** Hands-on work: chopping, assembling. Grows with the batch, roughly. */
  | "prep"
  /** Heat applied: baking, frying, simmering. Does not grow with the batch. */
  | "cook"
  /** Waiting: chilling, proving, resting, marinating. Independent of batch. */
  | "passive";

export type Duration = { minutes: number; text: string };

const UNITS: ReadonlyArray<readonly [RegExp, number]> = [
  [/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/gi, 60],
  [/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/gi, 1],
  [/(\d+(?:\.\d+)?)\s*(?:days?|d)\b/gi, 60 * 24],
];

/** Read "1 hr 40 min", "90 minutes", "overnight". Returns null when the text
 *  carries no measurable duration. */
export function parseDuration(text: string | undefined | null): number | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (/overnight/i.test(raw)) return 60 * 8;

  let total = 0;
  let found = false;
  for (const [pattern, factor] of UNITS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(raw)) !== null) {
      total += Number(m[1]) * factor;
      found = true;
    }
  }
  if (found) return Math.round(total);
  // A bare number is read as minutes: "25".
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** Write minutes the way a recipe does. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (m >= 60 * 24) {
    const days = Math.floor(m / (60 * 24));
    const leftover = Math.round((m % (60 * 24)) / 60);
    return leftover ? `${days} d ${leftover} hr` : `${days} d`;
  }
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

const PASSIVE_CUES = /\b(chill|chilled|chilling|refrigerat|fridge|rest|resting|rise|rising|prove|proving|proof|marinat|soak|soaking|set|setting|cool|cooling|freeze|freezing|overnight|stand|standing)\b/i;
const COOK_CUES = /\b(bake|baking|roast|roasting|fry|frying|sear|simmer|simmering|boil|boiling|cook|cooking|grill|grilling|steam|steaming|saute|sauté|braise|braising|toast|toasting|heat|heating)\b/i;
const PREP_CUES = /\b(chop|chopping|slice|slicing|dice|dicing|mince|mincing|whisk|whisking|mix|mixing|stir|stirring|fold|folding|knead|kneading|assemble|prepare|prep|peel|peeling|grate|grating|measure|scoop|scooping|roll|rolling)\b/i;

/** What kind of time a label or instruction describes. */
export function classifyTime(text: string | undefined | null): TimeKind {
  const raw = String(text ?? "");
  if (PASSIVE_CUES.test(raw)) return "passive";
  if (COOK_CUES.test(raw)) return "cook";
  if (PREP_CUES.test(raw)) return "prep";
  return "cook"; // the cautious default: never scaled
}

/** Does a kind of time grow with the batch? */
export function scalesWithBatch(kind: TimeKind): boolean {
  return kind === "prep";
}

export type Advisory = {
  /** A short heading. */
  title: string;
  /** What to actually do about it. */
  detail: string;
};

const BATCH_RULES: ReadonlyArray<{
  cue: RegExp;
  title: string;
  detail: string;
}> = [
  {
    cue: /\b(tray|trays|baking sheet|sheet|tin|tins|dish|ramekin|ramekins|mould|moulds|mold|molds)\b/i,
    title: "You will need more tins than time",
    detail:
      "This bakes in a tin or on a tray, so a larger batch needs more of them rather than a longer bake. Keep the original time and check for doneness as written.",
  },
  {
    cue: /\b(pan|skillet|frying pan|wok)\b/i,
    title: "Cook in batches rather than crowding the pan",
    detail:
      "A crowded pan steams instead of browning. Cook in batches at the original timing rather than adding time to a full pan.",
  },
  {
    cue: /\b(oven|bake|baking|roast|roasting)\b/i,
    title: "A fuller oven runs cooler",
    detail:
      "Two trays in one oven may need rotating and a few minutes more, judged by the doneness cues in the recipe rather than by multiplying the time.",
  },
  {
    cue: /\b(pot|saucepan|simmer|simmering|reduce|reducing|stock|liquid)\b/i,
    title: "A deeper pot reduces more slowly",
    detail:
      "A larger volume in the same pot takes longer to come up to heat and longer to reduce. Judge by consistency, not by the clock.",
  },
];

/**
 * What a cook should know about timing at a given batch size.
 *
 * Returns nothing at 1x, and nothing when no rule matches, rather than filling
 * the screen with generalities. Rules are keyed on the method words the recipe
 * itself uses, so the advice is about this recipe and not about cooking.
 */
export function batchAdvisories(stepTexts: ReadonlyArray<string>, scale: number): Advisory[] {
  if (!Number.isFinite(scale) || scale === 1) return [];
  const haystack = stepTexts.join(" ");
  const out: Advisory[] = [];
  for (const rule of BATCH_RULES) {
    if (rule.cue.test(haystack) && !out.some((a) => a.title === rule.title)) {
      out.push({ title: rule.title, detail: rule.detail });
    }
  }
  if (out.length === 0) return [];

  out.unshift({
    title: scale < 1 ? "Times are unchanged for a smaller batch" : "Times are unchanged for a larger batch",
    detail:
      "Ingredient quantities have been scaled. Cooking and resting times have not, because they do not scale with quantity.",
  });
  return out;
}

export type RecipeTiming = {
  kind: TimeKind;
  label: string;
  /** The original duration, always preserved. */
  minutes: number;
  text: string;
  /** Whether this one grows with the batch. */
  scales: boolean;
};

/** Classify a recipe's stated times, preserving every original value. */
export function recipeTimings(recipe: {
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
}): RecipeTiming[] {
  const out: RecipeTiming[] = [];
  const add = (label: string, text: string | undefined, kind: TimeKind) => {
    const minutes = parseDuration(text);
    if (minutes === null) return;
    out.push({ kind, label, minutes, text: text as string, scales: scalesWithBatch(kind) });
  };
  add("Prep", recipe.prepTime, "prep");
  add("Cook", recipe.cookTime, "cook");
  add("Total", recipe.totalTime, "cook");
  return out;
}
