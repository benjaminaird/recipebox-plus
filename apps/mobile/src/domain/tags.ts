// Categories and tags, and the rules for editing them.
//
// Pure. No React Native, no DOM.
//
// Two distinct things, deliberately (the brief is explicit, and the storage
// has always had them apart):
//
//   A **category** is where a recipe lives. One per recipe, or none. "Baked
//   Goods", "Weeknight Dinners". It answers "what kind of thing is this".
//
//   A **tag** is something a recipe is. Many per recipe. "Vegetarian",
//   "Make-Ahead", "Copycat". It answers "what is true about this".
//
// Collapsing them would be easy and wrong: a recipe has one place on the shelf
// and any number of properties, and a UI that pretends otherwise forces a cook
// to choose between "Vegetarian" and "Weeknight Dinners" as though those were
// alternatives.
//
// ## Agreement with the web app
//
// `public/recipe-tags.js` already defines what a tag looks like, and the two
// surfaces must agree: a cook who types "copy-cat" on the phone and sees
// "Copycat" on the laptop is looking at one library, and a cook who sees two
// tags that differ only in punctuation is looking at a bug. The rules below
// mirror that module exactly and test/tags.test.ts requires the real file and
// asserts they still agree, so a change there fails here rather than drifting.
//
// This is the same arrangement as units.ts. Extracting one shared copy is the
// accepted direction (ADR 0003) and is proposed as its own milestone in
// docs/plan-and-lists-proposal.md; until then, a parity test is what keeps an
// unavoidable second copy honest.

/** The web module's cap. A library needs tags to narrow a search, and a recipe
 *  wearing twenty of them narrows nothing. */
export const MAX_TAGS = 12;

/** Known spellings that should land on one tag. Mirrors CANONICAL in
 *  public/recipe-tags.js. */
const CANONICAL: Readonly<Record<string, string>> = {
  "copycat": "Copycat",
  "restaurant style": "Copycat",
  "quick": "Quick",
  "weeknight": "Weeknight",
  "kid friendly": "Kid-Friendly",
  "meal prep": "Meal Prep",
  "freezer friendly": "Freezer-Friendly",
  "one pot": "One-Pot",
  "one pan": "One-Pot",
  "sheet pan": "One-Pot",
  "slow cooker": "Slow Cooker",
  "crock pot": "Slow Cooker",
  "instant pot": "Instant Pot",
  "pressure cooker": "Instant Pot",
  "air fryer": "Air Fryer",
  "grill": "Grill",
  "grilled": "Grill",
  "no bake": "No-Bake",
  "make ahead": "Make-Ahead",
  "high protein": "High-Protein",
  "low carb": "Low-Carb",
  "vegetarian": "Vegetarian",
  "vegan": "Vegan",
  "gluten free": "Gluten-Free",
  "dairy free": "Dairy-Free",
  "spicy": "Spicy",
  "comfort food": "Comfort Food",
  "holiday": "Holiday",
  "party": "Party",
  "budget friendly": "Budget-Friendly",
};

/**
 * The key two spellings of one tag share.
 *
 * Case- and punctuation-insensitive, so "CopyCat", "copy-cat" and "copycat"
 * are one tag. Used for de-duplication and for the canonical lookup, never
 * shown.
 */
export function normalizeTagKey(tag: unknown): string {
  return String(tag == null ? "" : tag)
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/-+/g, " ")
    .replace(/[^a-z0-9 &']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(str: string): string {
  return str.split(" ").map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/**
 * How a tag is written on screen.
 *
 * Canonical where we know it, otherwise the cook's own text with light
 * cleanup. Only all-lowercase input is re-cased, so deliberate casing and
 * acronyms survive: "BBQ" stays "BBQ" and does not become "Bbq".
 */
export function displayTag(tag: unknown): string {
  const key = normalizeTagKey(tag);
  if (!key) return "";
  if (CANONICAL[key]) return CANONICAL[key];
  const cleaned = String(tag).replace(/\s+/g, " ").trim();
  if (cleaned && cleaned === cleaned.toLowerCase()) return titleCase(cleaned);
  return cleaned;
}

/** De-duplicate case-insensitively, normalise display, cap the count. Never
 *  throws; always returns an array. */
export function normalizeRecipeTags(tags: unknown, max: number = MAX_TAGS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const list = Array.isArray(tags) ? tags : [];
  for (const raw of list) {
    const key = normalizeTagKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(displayTag(raw));
    if (out.length >= max) break;
  }
  return out;
}

export function hasTag(tags: readonly string[] | undefined, tag: string): boolean {
  const key = normalizeTagKey(tag);
  if (!key) return false;
  return (tags ?? []).some((t) => normalizeTagKey(t) === key);
}

/** Add a tag. A duplicate in any spelling is a no-op, and the cap is honoured
 *  rather than silently exceeded. */
export function addTag(tags: readonly string[] | undefined, tag: string): string[] {
  const current = normalizeRecipeTags(tags);
  const key = normalizeTagKey(tag);
  if (!key || current.length >= MAX_TAGS) return current;
  if (current.some((t) => normalizeTagKey(t) === key)) return current;
  return [...current, displayTag(tag)];
}

/** Remove a tag, matched by key so the cook does not have to reproduce the
 *  exact spelling. */
export function removeTag(tags: readonly string[] | undefined, tag: string): string[] {
  const key = normalizeTagKey(tag);
  return normalizeRecipeTags(tags).filter((t) => normalizeTagKey(t) !== key);
}

export function toggleTag(tags: readonly string[] | undefined, tag: string): string[] {
  return hasTag(tags, tag) ? removeTag(tags, tag) : addTag(tags, tag);
}

/**
 * A category as it should be stored.
 *
 * Shares the tag display rules -- a category is one more piece of library
 * vocabulary, and "baked goods" and "Baked Goods" being two shelves would be
 * the same bug -- but has no canonical table: category names are the cook's
 * own, and we have no business renaming "Puddings" to something we prefer.
 * Empty means no category, which is a real and ordinary state.
 */
export function normalizeCategory(value: unknown): string | undefined {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned === cleaned.toLowerCase() ? titleCase(cleaned) : cleaned;
}

/** True when two category names are the same shelf. */
export function sameCategory(a: unknown, b: unknown): boolean {
  return normalizeTagKey(a) === normalizeTagKey(b);
}
