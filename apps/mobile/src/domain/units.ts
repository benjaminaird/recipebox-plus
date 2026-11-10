// Units, and what can honestly be converted into what.
//
// Pure: no React Native, no DOM, no network. It runs under `node --test` and is
// shaped to move into packages/recipe-core (ADR 0003) unchanged.
//
// This overlaps `public/shopping-list.js`, which the production web app loads
// directly and which must not change behaviour. Rather than edit it, the shared
// primitives are restated here and a parity test asserts the two agree, so a
// divergence fails a test instead of reaching a cook.
//
// Two things that module cannot do, and this one must:
//
//   - Metric volume. `ml` and `L` exist there only as display abbreviations;
//     VOLUME_TO_TSP has no metric entries, so millilitres can be shown but not
//     converted. Here both systems share one base.
//   - Volume <-> weight. That is not arithmetic: it needs a density per
//     ingredient, and lives in density.ts. Nothing in this file pretends a cup
//     and a gram are interchangeable.

/** What kind of measurement a unit expresses. */
export type UnitKind = "volume" | "weight" | "count" | "descriptive" | "unknown";

/** Which measurement system a unit belongs to. `count` and `descriptive`
 *  belong to neither and are never converted. */
export type System = "us" | "metric" | "neutral";

/** Volume in millilitres. One base for both systems, so US <-> metric volume
 *  is ordinary arithmetic rather than a special case. */
/** The US customary teaspoon, exactly. Every other US volume is derived from
 *  it rather than rounded independently, so US-to-US ratios stay exact: a
 *  table of separately-rounded constants made 3 tsp come to 0.999997 tbsp. */
const TSP_ML = 4.92892159375;

export const VOLUME_ML: Readonly<Record<string, number>> = {
  // US, as exact multiples of the teaspoon
  tsp: TSP_ML,
  tbsp: TSP_ML * 3,
  "fl oz": TSP_ML * 6,
  cup: TSP_ML * 48,
  pint: TSP_ML * 96,
  quart: TSP_ML * 192,
  gallon: TSP_ML * 768,
  // Metric
  ml: 1,
  cl: 10,
  dl: 100,
  L: 1000,
};

/** Weight in grams. */
/** The international avoirdupois ounce, exactly; the pound is 16 of them. */
const OZ_G = 28.349523125;

export const WEIGHT_G: Readonly<Record<string, number>> = {
  // US
  oz: OZ_G,
  lb: OZ_G * 16,
  // Metric
  g: 1,
  kg: 1000,
};

/** Units that count discrete things. Scaling these must land on whole items:
 *  half an egg is not an instruction. */
export const COUNT_UNITS: ReadonlySet<string> = new Set([
  "egg", "lemon", "lime", "orange", "onion", "package", "can", "clove",
  "stick", "sprig", "slice", "sheet", "head", "stalk", "rib", "ear", "fillet",
]);

/** Units that are gestures, not measurements. Never scaled, never converted. */
export const DESCRIPTIVE_UNITS: ReadonlySet<string> = new Set([
  "pinch", "dash", "splash", "handful", "drizzle", "to taste",
]);

const US_VOLUME = new Set(["tsp", "tbsp", "fl oz", "cup", "pint", "quart", "gallon"]);
const US_WEIGHT = new Set(["oz", "lb"]);

/** Singular, lower case, no full stops: "Tablespoons." -> "tbsp".
 *  Deliberately matches cleanUnit() in shopping-list.js for the units both
 *  know; the parity test holds them together. */
export function canonicalUnit(unit: string | undefined | null): string {
  const raw = String(unit ?? "").toLowerCase().replace(/\./g, "").trim();
  if (!raw) return "";

  const aliases: Record<string, string> = {
    t: "tsp", tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
    tbl: "tbsp", tbls: "tbsp", tbs: "tbsp", tbsp: "tbsp", tbsps: "tbsp",
    tablespoon: "tbsp", tablespoons: "tbsp",
    "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
    cup: "cup", cups: "cup",
    pint: "pint", pints: "pint", pt: "pint",
    quart: "quart", quarts: "quart", qt: "quart",
    gallon: "gallon", gallons: "gallon", gal: "gallon",
    ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
    cl: "cl", centiliter: "cl", centilitre: "cl",
    dl: "dl", deciliter: "dl", decilitre: "dl",
    l: "L", liter: "L", liters: "L", litre: "L", litres: "L",
    oz: "oz", ounce: "oz", ounces: "oz",
    lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
    g: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
    kg: "kg", kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  };
  if (aliases[raw]) return aliases[raw];

  // Plain English plurals for counted things: "cloves" -> "clove".
  const singular = raw.endsWith("es") && COUNT_UNITS.has(raw.slice(0, -2))
    ? raw.slice(0, -2)
    : raw.endsWith("s") && COUNT_UNITS.has(raw.slice(0, -1))
      ? raw.slice(0, -1)
      : raw;
  if (COUNT_UNITS.has(singular)) return singular;

  const descriptive = raw.endsWith("es") ? raw.slice(0, -2) : raw.endsWith("s") ? raw.slice(0, -1) : raw;
  if (DESCRIPTIVE_UNITS.has(descriptive)) return descriptive;
  if (DESCRIPTIVE_UNITS.has(raw)) return raw;

  return raw;
}

export function unitKind(unit: string | undefined | null): UnitKind {
  const u = canonicalUnit(unit);
  if (!u) return "unknown";
  if (u in VOLUME_ML) return "volume";
  if (u in WEIGHT_G) return "weight";
  if (COUNT_UNITS.has(u)) return "count";
  if (DESCRIPTIVE_UNITS.has(u)) return "descriptive";
  return "unknown";
}

export function unitSystem(unit: string | undefined | null): System {
  const u = canonicalUnit(unit);
  if (US_VOLUME.has(u) || US_WEIGHT.has(u)) return "us";
  if (u in VOLUME_ML || u in WEIGHT_G) return "metric";
  return "neutral";
}

/** Convert within one kind. Returns null when the two units are not the same
 *  kind -- a volume and a weight do not convert without an ingredient, and
 *  saying so is the caller's job (see density.ts). */
export function convert(value: number, from: string, to: string): number | null {
  if (!Number.isFinite(value)) return null;
  const f = canonicalUnit(from);
  const t = canonicalUnit(to);
  if (!f || !t) return null;
  if (f === t) return value;
  if (f in VOLUME_ML && t in VOLUME_ML) return (value * VOLUME_ML[f]) / VOLUME_ML[t];
  if (f in WEIGHT_G && t in WEIGHT_G) return (value * WEIGHT_G[f]) / WEIGHT_G[t];
  return null;
}

/** How a unit should be written next to an amount. Mirrors abbreviateUnit()
 *  in shopping-list.js, including its capital "Tbsp". */
export function displayUnit(unit: string | undefined | null, amount: number | null = null): string {
  const u = canonicalUnit(unit);
  if (!u) return "";
  const fixed: Record<string, string> = {
    tsp: "tsp", tbsp: "Tbsp", "fl oz": "fl oz",
    ml: "ml", cl: "cl", dl: "dl", L: "L",
    g: "g", kg: "kg", oz: "oz", lb: "lb",
  };
  if (fixed[u]) return fixed[u];
  // Counted and descriptive units take an English plural.
  if (COUNT_UNITS.has(u) || DESCRIPTIVE_UNITS.has(u)) {
    const plural = amount !== null && Math.abs(amount) !== 1;
    if (!plural) return u;
    return /(?:ch|sh|s|x|z)$/.test(u) ? `${u}es` : `${u}s`;
  }
  return u;
}
