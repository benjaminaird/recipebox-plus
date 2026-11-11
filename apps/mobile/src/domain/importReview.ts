// Importing a recipe, and showing honestly what was and was not understood.
//
// ## This is the production importer, not a second one
//
// The brief forbids a separate incompatible importer, and there is no need for
// one. `public/recipe-extract.js`, `recipe-normalize.js` and
// `recipe-grounding.js` are all **pure** -- their own headers say "no
// DOM/network/AI" -- and `server.js` already treats the HTML-to-recipe step as
// a pure function for exactly this reason. So the native app runs the same
// code on the same input and gets the same answer.
//
// ## What is NOT reused, and why
//
// Fetching the page. That is the one part of the pipeline that genuinely needs
// the server: sites block unknown clients, `server.js` falls back to a
// scraping proxy with its own key, and the response is then hashed and cached.
// Doing it from the phone would put the cook's IP on every recipe site they
// import from and would quietly skip the fallback, so imports would simply
// fail on the sites that need it most.
//
// A native fetch therefore needs a **new `/api/v1` endpoint** (ADR 0010), which
// is a backend change with production implications. The contract is written up
// in docs/native-import-contract.md and is NOT built here.
//
// Until it exists, this module runs the real pipeline over HTML the app
// already holds. That is enough to build and prove the review screen, because
// the review screen's job starts the moment the HTML arrives.
//
// ## Nothing is invented
//
// Every field either came out of the page or is reported missing. There is no
// default servings, no guessed time, no amount filled in because a line looked
// bare. ADR 0014 then allows the cook to save it anyway, unresolved.
import { web as extract } from "./webImport.ts";
import type { Recipe } from "../data/types.ts";

/** Which fields the extractor found. Counts where a count is meaningful. */
export type ExtractedFields = {
  title: boolean;
  servings: boolean;
  ingredients: number;
  steps: number;
  image: boolean;
  times: boolean;
  nutrition: boolean;
};

/** How the recipe was found in the page. A real confidence signal: structured
 *  data is the publisher's own statement, scraped prose is our reading of it. */
export type ExtractSource = "jsonld" | "microdata" | "heuristic" | "unknown";

export type IngredientConcern = {
  ingredientId: string;
  name: string;
  reason: "no-amount" | "not-in-page";
};

export type ImportReview = {
  recipe: Recipe | null;
  source: ExtractSource;
  fields: ExtractedFields;
  /** 0–1 from the grounding check, or null when it could not be checked. */
  confidence: number | null;
  /** The grounding module's own verdict. */
  needsReview: boolean;
  /** Lines worth a second look before cooking. */
  concerns: IngredientConcern[];
  /** Distinctive things named in the page that did not reach the recipe. */
  dropped: string[];
  warnings: string[];
};

function asSource(value: unknown): ExtractSource {
  return value === "jsonld" || value === "microdata" || value === "heuristic"
    ? value
    : "unknown";
}

function emptyFields(): ExtractedFields {
  return {
    title: false, servings: false, ingredients: 0, steps: 0,
    image: false, times: false, nutrition: false,
  };
}

/**
 * Run the real pipeline over a page's HTML.
 *
 * Returns a review even when nothing could be extracted: `recipe: null` with
 * the reason, rather than an empty recipe that looks like a successful import
 * of a page with no ingredients.
 */
export function reviewFromHtml(html: string, url: string): ImportReview {
  type RawExtraction = {
    recipe?: Recipe;
    source?: unknown;
    complete?: boolean;
    fields?: Partial<ExtractedFields>;
  };
  let raw: RawExtraction | null = null;

  try {
    raw = extract.extractFromHtml(html, { url }) as RawExtraction;
  } catch {
    // Deterministic extraction is best-effort in server.js too. A page that
    // breaks it is a page we could not read, not a crash.
    raw = null;
  }

  if (!raw?.recipe) {
    return {
      recipe: null,
      source: "unknown",
      fields: emptyFields(),
      confidence: null,
      needsReview: true,
      concerns: [],
      dropped: [],
      warnings: ["No recipe could be read from that page."],
    };
  }

  const recipe = raw.recipe;
  const fields: ExtractedFields = { ...emptyFields(), ...(raw.fields ?? {}) };

  let confidence: number | null = null;
  let needsReview = false;
  let dropped: string[] = [];
  let warnings: string[] = [];
  const ungrounded = new Set<string>();

  try {
    const verdict = extract.verifyImport(recipe, html) as {
      confidence?: number;
      checkable?: boolean;
      ungrounded?: string[];
      dropped?: string[];
      warnings?: string[];
      needsReview?: boolean;
    };
    confidence = verdict.checkable === false ? null : (verdict.confidence ?? null);
    needsReview = verdict.needsReview === true;
    dropped = verdict.dropped ?? [];
    warnings = verdict.warnings ?? [];
    for (const name of verdict.ungrounded ?? []) ungrounded.add(name.toLowerCase());
  } catch {
    // A grounding failure costs the confidence number, not the import.
    confidence = null;
  }

  const concerns: IngredientConcern[] = [];
  for (const section of recipe.sections ?? []) {
    for (const ingredient of section.ingredients) {
      // An ingredient with no amount is not an error -- "olive oil" and "salt
      // to taste" are how recipes are written -- but it is the single most
      // common thing a cook needs to fill in, so it is surfaced rather than
      // silently left blank.
      if (!(ingredient.amount ?? "").trim()) {
        concerns.push({ ingredientId: ingredient.id, name: ingredient.name, reason: "no-amount" });
      } else if (ungrounded.has(ingredient.name.toLowerCase())) {
        concerns.push({ ingredientId: ingredient.id, name: ingredient.name, reason: "not-in-page" });
      }
    }
  }

  return { recipe, source: asSource(raw.source), fields, confidence, needsReview, concerns, dropped, warnings };
}

/** A short, honest sentence about where the recipe came from, for the screen. */
export function sourceExplanation(source: ExtractSource): string {
  switch (source) {
    case "jsonld":
      return "Read from the site's own recipe data. This is what the publisher says the recipe is.";
    case "microdata":
      return "Read from the site's own recipe markup. This is what the publisher says the recipe is.";
    case "heuristic":
      return "Read from the page's text, because the site publishes no recipe data. Worth checking carefully.";
    default:
      return "The source of this reading is unknown. Worth checking carefully.";
  }
}

/** "a, b and c". A comma-joined list reads as a fragment rather than a
 *  sentence, and this text is a sentence. */
export function sentenceList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Fields the page did not give us. Named so the screen can say what is
 *  missing rather than showing a blank and letting the cook assume. */
export function missingFields(fields: ExtractedFields): string[] {
  const out: string[] = [];
  if (!fields.title) out.push("name");
  if (!fields.servings) out.push("how many it serves");
  if (!fields.times) out.push("timings");
  if (fields.ingredients === 0) out.push("ingredients");
  if (fields.steps === 0) out.push("method");
  return out;
}
