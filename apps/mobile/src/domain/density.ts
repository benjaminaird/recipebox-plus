// What a cup of something actually weighs.
//
// Pure. No React Native, no DOM.
//
// Volume and weight do not convert without knowing the ingredient: a cup of
// flour is about 125 g, a cup of honey about 340 g, and a cup of cocoa about
// 85 g. Treating them as interchangeable is the single most damaging thing a
// conversion feature can do to a recipe, so this module answers "how heavy"
// only for ingredients it actually knows, and returns null otherwise. The
// interface then keeps the original unit and says why, rather than inventing
// a number that looks authoritative.
//
// Figures are per US cup, because that is how published references state them
// and how they can be checked. They are conventional kitchen values, not
// laboratory ones; recipes disagree with each other by a few per cent and a
// cook cannot measure finer than that anyway.
//
// Where a convention is contested the common recipe reading is used and said
// out loud: brown sugar is packed, flour is spooned and levelled rather than
// scooped (a scooped cup can reach 150 g, which is why weighing wins).

import { VOLUME_ML } from "./units.ts";

export type Density = {
  /** Grams per millilitre. */
  gPerMl: number;
  /** The table key that matched, so the interface can show its working. */
  matched: string;
  /** A note where the figure depends on a convention worth stating. */
  note?: string;
  /**
   * True for the things a metric recipe pours rather than weighs.
   *
   * Metric recipes weigh dry goods and measure liquids, which is why "250 g
   * flour, 500 ml stock" is an ordinary line and "505 g stock" is not one
   * anybody writes. Both directions of that conversion are arithmetically
   * sound; only one of them is a recipe. The flag is on the ingredient rather
   * than inferred from its density, because density does not separate them:
   * stock is 0.98 and double cream 1.01, while honey at 1.44 and yogurt at
   * 1.04 are both normally weighed. Cream is poured, yogurt is spooned, and no
   * number in this table knows the difference.
   *
   * It does not affect the other direction: a US recipe asks for a cup of
   * stock, so grams still become cups going that way.
   */
  pourable?: boolean;
};

type Entry = { gPerCup: number; note?: string; pourable?: boolean };

/**
 * Grams per US cup.
 *
 * Keys are matched as whole words against a normalised ingredient name, most
 * specific first, so "bread flour" beats "flour".
 */
const PER_CUP: Readonly<Record<string, Entry>> = {
  // Flours and dry baking
  "cake flour": { gPerCup: 114 },
  "bread flour": { gPerCup: 127 },
  "wholemeal flour": { gPerCup: 120 },
  "whole wheat flour": { gPerCup: 120 },
  "plain flour": { gPerCup: 125, note: "spooned and levelled" },
  "all-purpose flour": { gPerCup: 125, note: "spooned and levelled" },
  "all purpose flour": { gPerCup: 125, note: "spooned and levelled" },
  "self-raising flour": { gPerCup: 125, note: "spooned and levelled" },
  flour: { gPerCup: 125, note: "spooned and levelled" },
  cornflour: { gPerCup: 128 },
  cornstarch: { gPerCup: 128 },
  "cocoa powder": { gPerCup: 85 },
  "ground almonds": { gPerCup: 96 },
  "almond flour": { gPerCup: 96 },
  "rolled oats": { gPerCup: 90 },
  oats: { gPerCup: 90 },
  breadcrumbs: { gPerCup: 108, note: "dry" },
  "desiccated coconut": { gPerCup: 93 },

  // Sugars and syrups
  "icing sugar": { gPerCup: 120 },
  "powdered sugar": { gPerCup: 120 },
  "confectioners sugar": { gPerCup: 120 },
  "light brown sugar": { gPerCup: 213, note: "packed" },
  "dark brown sugar": { gPerCup: 213, note: "packed" },
  "brown sugar": { gPerCup: 213, note: "packed" },
  "caster sugar": { gPerCup: 200 },
  "granulated sugar": { gPerCup: 200 },
  sugar: { gPerCup: 200 },
  honey: { gPerCup: 340 },
  "maple syrup": { gPerCup: 322 },
  "golden syrup": { gPerCup: 340 },
  treacle: { gPerCup: 340 },
  molasses: { gPerCup: 337 },

  // Fats
  butter: { gPerCup: 227 },
  "olive oil": { gPerCup: 216, pourable: true },
  "vegetable oil": { gPerCup: 218, pourable: true },
  "sunflower oil": { gPerCup: 218, pourable: true },
  oil: { gPerCup: 218, pourable: true },
  "peanut butter": { gPerCup: 258 },

  // Dairy and liquids
  water: { gPerCup: 236.6, pourable: true },
  milk: { gPerCup: 244, pourable: true },
  buttermilk: { gPerCup: 245, pourable: true },
  "double cream": { gPerCup: 238, pourable: true },
  "heavy cream": { gPerCup: 238, pourable: true },
  "single cream": { gPerCup: 240, pourable: true },
  cream: { gPerCup: 238, pourable: true },
  yoghurt: { gPerCup: 245 },
  yogurt: { gPerCup: 245 },
  "sour cream": { gPerCup: 230 },
  "creme fraiche": { gPerCup: 230 },
  stock: { gPerCup: 240, pourable: true },
  broth: { gPerCup: 240, pourable: true },
  wine: { gPerCup: 236, pourable: true },

  // Grains, pulses, other
  "long grain rice": { gPerCup: 185, note: "uncooked" },
  rice: { gPerCup: 185, note: "uncooked" },
  "red lentils": { gPerCup: 192, note: "uncooked" },
  lentils: { gPerCup: 192, note: "uncooked" },
  "chocolate chips": { gPerCup: 170 },
  "dark chocolate": { gPerCup: 170, note: "chopped" },
  chocolate: { gPerCup: 170, note: "chopped" },
  "grated parmesan": { gPerCup: 90 },
  parmesan: { gPerCup: 90, note: "grated" },
  "chopped nuts": { gPerCup: 120 },
  walnuts: { gPerCup: 117, note: "chopped" },
  almonds: { gPerCup: 143, note: "whole" },
  raisins: { gPerCup: 145 },

  // Seasonings, where the form matters enormously
  "table salt": { gPerCup: 273 },
  "kosher salt": { gPerCup: 142, note: "Diamond Crystal; Morton is heavier" },
  "flaky sea salt": { gPerCup: 120, note: "flakes vary widely by brand" },
  salt: { gPerCup: 273, note: "table salt" },
};

/** Words that describe handling rather than identity, so they are ignored
 *  when matching: "finely chopped dark chocolate" is dark chocolate. */
const PREP_WORDS = new Set([
  "finely", "roughly", "coarsely", "freshly", "thinly", "lightly",
  "chopped", "minced", "diced", "sliced", "grated", "shredded", "crushed",
  "melted", "softened", "cubed", "beaten", "sifted", "packed", "divided",
  "toasted", "ground", "whole", "large", "medium", "small", "plus", "extra",
  "room", "temperature", "cold", "warm", "hot", "fresh", "dried", "unsalted",
  "salted", "good", "quality", "ripe", "optional", "to", "serve", "taste",
  "for", "the", "a", "an", "of", "and", "or",
]);

/** Lower case, punctuation stripped, handling words removed. */
export function normalizeIngredientName(name: string | undefined | null): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")       // parenthetical asides
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !PREP_WORDS.has(w))
    .join(" ")
    .trim();
}

/**
 * Keys, normalised the same way names are, longest first.
 *
 * Both sides have to be compared in the same space. Normalising only the name
 * made two keys permanently unreachable: "whole wheat flour" was compared
 * against a name already reduced to "wheat flour" and silently fell through to
 * plain "flour" (125 g rather than 120 g), and "chopped nuts" could never
 * match anything at all. The original key is kept for display.
 */
const KEY_INDEX: ReadonlyArray<{ normalized: string; original: string }> =
  Object.keys(PER_CUP)
    .map((original) => ({ original, normalized: normalizeIngredientName(original) }))
    .filter((k) => k.normalized.length > 0)
    .sort((a, b) => b.normalized.length - a.normalized.length);

/**
 * The density of a named ingredient, or null when it is not known.
 *
 * Null is a real answer and the common one. An unknown ingredient keeps its
 * original unit rather than being converted on a guessed density.
 */
export function densityFor(name: string | undefined | null): Density | null {
  const normalized = normalizeIngredientName(name);
  if (!normalized) return null;

  // Most specific key first, matched on whole words so "flour" does not match
  // inside "cauliflower".
  for (const key of KEY_INDEX) {
    const pattern = new RegExp(`(^|\\s)${key.normalized.replace(/-/g, "[- ]")}(\\s|$)`);
    if (pattern.test(normalized)) {
      const entry = PER_CUP[key.original];
      return {
        gPerMl: entry.gPerCup / VOLUME_ML.cup,
        matched: key.original,
        ...(entry.note ? { note: entry.note } : {}),
        ...(entry.pourable ? { pourable: true } : {}),
      };
    }
  }
  return null;
}

/** Every ingredient this module can convert by weight. Exposed so the
 *  interface and tests can state the coverage honestly. */
export function knownIngredients(): string[] {
  return Object.keys(PER_CUP).sort();
}
