// Converting a measured ingredient between systems.
//
// Pure. No React Native, no DOM.
//
// Every conversion here either succeeds with a value or fails with a reason
// the interface can show. There is no third option where a plausible-looking
// number is returned on a guess, because a cook cannot tell those apart.

import { densityFor, type Density } from "./density.ts";
import { parseQuantity, type Quantity } from "./quantity.ts";
import {
  canonicalUnit, convert as convertUnits, SYSTEM_AMBIGUOUS, unitKind, VOLUME_ML, WEIGHT_G,
} from "./units.ts";

/** Which way the cook asked to see the recipe. */
export type Measurement = "original" | "us" | "metric";

export type ConversionFailure =
  /** The ingredient's density is unknown, so volume cannot become weight. */
  | "unknown-ingredient"
  /** Counted or descriptive: "2 eggs", "a pinch" belong to no system. */
  | "not-measurable"
  /** Already in the requested system. */
  | "already"
  /** Measured in a unit both systems use, so there is nothing to translate. */
  | "shared-unit";

export type Converted =
  | {
      ok: true;
      quantity: Quantity;
      unit: string;
      via?: Density;
      /**
       * True when the answer rests on an ingredient's density rather than on
       * unit arithmetic.
       *
       * `1 cup → 16 tbsp` is exact and always will be. `500 g of flour →
       * 4 cups` is an estimate about flour: it depends on how the flour is
       * packed, and a different flour or a heavier hand gives a different
       * number. The two should not look alike on screen, so the caller is told
       * which it got.
       */
      approximate: boolean;
    }
  | { ok: false; reason: ConversionFailure };

/**
 * Above this, a volume stops being something a cook measures and becomes a
 * number they would have to read twice.
 *
 * Eight US cups is two quarts. A big bake still reads in cups — four cups of
 * flour for a loaf, eight for a double batch — and past that a US recipe
 * weighs it or writes it in pounds. Converting 2.4 kg of flour to "19.3 cups"
 * is arithmetically right and useless, which is the same objection this module
 * already makes to "14.1 oz" of brown sugar, applied at the other end of the
 * scale.
 */
const PRACTICAL_VOLUME_CEILING_ML = VOLUME_ML.cup * 8;

/** The unit a system prefers for a given magnitude. */
function targetVolume(system: "us" | "metric", ml: number): string {
  if (system === "metric") return ml >= 1000 ? "L" : "ml";
  // US: climb only when the amount is a clean handful of the larger unit.
  // Quarts and gallons start late on purpose — recipes say "5 cups of stock",
  // not "1 1/4 quarts" — but a gallon of stock is a gallon, and sixteen cups
  // is not how anybody writes it.
  if (ml >= VOLUME_ML.gallon) return "gallon";
  if (ml >= VOLUME_ML.quart * 2) return "quart";
  if (ml >= VOLUME_ML.cup * 0.75) return "cup";
  if (ml >= VOLUME_ML.tbsp) return "tbsp";
  return "tsp";
}

function targetWeight(system: "us" | "metric", g: number): string {
  if (system === "metric") return g >= 1000 ? "kg" : "g";
  return g >= WEIGHT_G.lb ? "lb" : "oz";
}

/**
 * Express one measured ingredient in the requested system.
 *
 * Volume stays volume and weight stays weight wherever the system allows it,
 * because that is what the cook's equipment measures. The one case that
 * crosses kinds is a US volume asked for in metric: metric recipes weigh dry
 * goods, so a cup of flour becomes 125 g rather than 237 ml -- but only when
 * the ingredient's density is known. Otherwise this fails with
 * `unknown-ingredient` and the caller keeps the original.
 */
export function convertIngredient(
  amount: string | number | undefined | null,
  unit: string | undefined | null,
  ingredientName: string | undefined | null,
  system: "us" | "metric",
): Converted {
  const q = parseQuantity(amount);
  if (q.kind === "opaque" || q.kind === "none") return { ok: false, reason: "not-measurable" };

  const from = canonicalUnit(unit);
  const kind = unitKind(from);
  if (kind === "count" || kind === "descriptive" || kind === "unknown") {
    return { ok: false, reason: "not-measurable" };
  }

  const scaleBy = (q2: Quantity, f: number): Quantity =>
    q2.kind === "range"
      ? { kind: "range", min: q2.min * f, max: q2.max * f }
      : { kind: "exact", value: (q2 as { value: number }).value * f };

  const representative = q.kind === "range" ? q.max : q.value;

  if (kind === "weight") {
    const grams = representative * WEIGHT_G[from];

    // US recipes measure dry goods by volume, so grams become cups where the
    // ingredient is known. Converting 400 g of brown sugar to "14.1 oz" is
    // arithmetically correct and useless: no US kitchen has a scale out for
    // sugar, and nobody writes a recipe that way. This is the mirror of the
    // metric rule below -- each system gets its own idiom.
    if (system === "us") {
      const density = densityFor(ingredientName);
      if (density) {
        const ml = grams / density.gPerMl;
        // ...but only while the result is something a cook would measure.
        // Past the ceiling the weight is the more useful answer, and it is
        // also the exact one, so a big quantity falls through to pounds.
        if (ml <= PRACTICAL_VOLUME_CEILING_ML) {
          const to = targetVolume("us", ml);
          const factor = WEIGHT_G[from] / (density.gPerMl * VOLUME_ML[to]);
          return { ok: true, quantity: scaleBy(q, factor), unit: to, via: density, approximate: true };
        }
      }
    }

    const to = targetWeight(system, grams);
    if (to === from) return { ok: false, reason: "already" };
    const factor = WEIGHT_G[from] / WEIGHT_G[to];
    return { ok: true, quantity: scaleBy(q, factor), unit: to, approximate: false };
  }

  // Volume.
  //
  // Spoons first: a teaspoon belongs to no one system. A metric recipe writes
  // "1/4 tsp fine sea salt" exactly as a US one does, so converting it is not
  // a translation, it is noise -- and the noise is loud, because a quarter
  // teaspoon of salt becomes "1.42 g", a number no kitchen scale will resolve
  // and no cook would ever write. Leaving spoons alone is the same judgement
  // detectSystem() already makes with SYSTEM_AMBIGUOUS, applied here.
  if (SYSTEM_AMBIGUOUS.has(from)) return { ok: false, reason: "shared-unit" };

  const ml = representative * VOLUME_ML[from];

  if (system === "us") {
    const to = targetVolume("us", ml);
    if (to === from) return { ok: false, reason: "already" };
    const factor = VOLUME_ML[from] / VOLUME_ML[to];
    return { ok: true, quantity: scaleBy(q, factor), unit: to, approximate: false };
  }

  // Metric: weigh it if we can, since that is how metric recipes are written.
  const density = densityFor(ingredientName);
  if (density) {
    const grams = ml * density.gPerMl;
    const to = targetWeight("metric", grams);
    const factor = (VOLUME_ML[from] * density.gPerMl) / WEIGHT_G[to];
    return { ok: true, quantity: scaleBy(q, factor), unit: to, via: density, approximate: true };
  }

  // No density. A metric volume is still an honest answer for a liquid-ish
  // amount, but only because volume-to-volume needs no ingredient knowledge.
  const to = targetVolume("metric", ml);
  if (to === from) return { ok: false, reason: "already" };
  const factor = VOLUME_ML[from] / VOLUME_ML[to];
  return { ok: true, quantity: scaleBy(q, factor), unit: to, approximate: false };
}

/** Re-exported so callers need one import for the conversion surface. */
export { convertUnits };
