// Turning stored recipe data into the numbers on screen.
//
// Pure. No React Native, no DOM.
//
// Nothing here writes to a recipe. Scaling and conversion are display
// transformations over untouched data (the brief's requirement, and the only
// way "Original" can remain available once a cook has pressed 2x). That also
// means divided quantities scale correctly for free: a step's share goes
// through the same function as the ingredient list, so 115 g of 230 g becomes
// 230 g of 460 g and the halves still add up.

import { convertIngredient, type Measurement } from "./convert.ts";
import {
  formatDecimalQuantity, formatQuantity, parseQuantity, roundDiscrete, roundForUnit,
  roundMetricMeasure, scaleQuantity, type Quantity,
} from "./quantity.ts";
import { canonicalUnit, displayUnit, SYSTEM_AMBIGUOUS, unitKind, unitSystem } from "./units.ts";

/** The scales offered. 1 is Original. */
export const SCALES = [0.5, 1, 2, 3, 4] as const;
export type Scale = (typeof SCALES)[number];

export function scaleLabel(s: Scale): string {
  return s === 0.5 ? "½×" : `${s}×`;
}

export type Presented = {
  /** The amount and unit as one string: "250 g", "1 1/2 cups", "a pinch". */
  text: string;
  /** The amount alone, for a column that aligns numbers. */
  amount: string;
  /** The unit alone, already pluralised where that applies. */
  unit: string;
  /** True when this differs from how the source wrote it. */
  converted: boolean;
  /** Shown where the interface needs to justify or qualify the number:
   *  the density convention used, or why no conversion happened. */
  note?: string;
};

export type PresentOptions = {
  scale: Scale;
  measurement: Measurement;
};

/**
 * One measured ingredient, scaled and converted for display.
 *
 * Order matters. Scaling happens first so the converter picks a unit suited
 * to the final magnitude -- four cups of stock should offer a litre, not
 * 946 millilitres. Discrete items round only after scaling, so three eggs
 * halved become two rather than one-and-a-half rounded twice.
 */
export function presentAmount(
  amount: string | number | undefined | null,
  unit: string | undefined | null,
  ingredientName: string | undefined | null,
  { scale, measurement }: PresentOptions,
): Presented {
  const original = canonicalUnit(unit);
  const kind = unitKind(original);
  let q: Quantity = scaleQuantity(parseQuantity(amount), scale);
  const scaled = scale !== 1;

  // Counted things must land on whole items; "1 1/2 eggs" is not an instruction.
  if (kind === "count") q = roundDiscrete(q);

  let finalUnit = original;
  let converted = false;
  let note: string | undefined;

  const wantsConversion =
    measurement !== "original" && (kind === "volume" || kind === "weight");

  if (wantsConversion) {
    const target = measurement as "us" | "metric";
    if (unitSystem(original) === target && kind === "weight") {
      // Already there; leave it rather than shuffling between g and kg.
      note = undefined;
    } else {
      const result = convertIngredient(formatQuantity(q), original, ingredientName, target);
      if (result.ok) {
        // Snap before display. The arithmetic is exact; the kitchen is not,
        // and a converted 56.749999 must not reach the screen as "56.75".
        q = roundMetricMeasure(roundForUnit(result.quantity, result.unit), result.unit);
        finalUnit = result.unit;
        converted = true;
        if (result.via) {
          note = result.via.note
            ? `using ${result.via.matched} (${result.via.note})`
            : `using ${result.via.matched}`;
        }
      } else if (result.reason === "unknown-ingredient") {
        note = "kept as written: this ingredient has no weight conversion";
      }
    }
  }

  // Fractions for the units that are measured with cups and spoons; decimals
  // for the units that are weighed. "1 1/2 kg" is not how anyone writes a kilo
  // and a half.
  const amountText = unitSystem(finalUnit) === "metric"
    ? formatDecimalQuantity(q)
    : formatQuantity(q);
  // Pluralise from the number actually shown, not the one behind it. A
  // conversion landing on 1.013 displays as "1" and must read "1 cup", not
  // "1 cups".
  const shownNumber = (() => {
    if (q.kind === "range") return q.max;
    const reparsed = parseQuantity(amountText);
    return reparsed.kind === "exact" ? reparsed.value : null;
  })();
  const unitText = displayUnit(finalUnit, shownNumber);
  const text = [amountText, unitText].filter(Boolean).join(" ").trim();

  return {
    text,
    amount: amountText,
    unit: unitText,
    converted: converted || (scaled && q.kind !== "opaque" && q.kind !== "none"),
    ...(note ? { note } : {}),
  };
}

/**
 * Whether two rendered measures say the same thing.
 *
 * For deciding whether a second line is worth drawing. A source that writes
 * "175g unsalted butter" and also tags a 175 g weight is repeating itself, and
 * printing both reads as a bug rather than as extra information. Comparison
 * ignores spacing and case only -- "175 g" and "175g" agree; 175 g and 180 g
 * do not, and the cook should see both.
 */
export function measuresAgree(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  return norm(a) === norm(b);
}

/** Which system a recipe was written in, by counting the units it uses. */
export type OriginalSystem = "us" | "metric" | "mixed" | "unknown";

export function detectSystem(units: ReadonlyArray<string | undefined | null>): OriginalSystem {
  let us = 0;
  let metric = 0;
  for (const u of units) {
    // Spoons belong to both traditions, so they get no vote.
    if (SYSTEM_AMBIGUOUS.has(canonicalUnit(u))) continue;
    const system = unitSystem(u);
    if (system === "us") us++;
    else if (system === "metric") metric++;
  }
  if (us === 0 && metric === 0) return "unknown";
  if (us > 0 && metric > 0) {
    // A couple of stragglers do not make a recipe mixed; metric recipes often
    // still say "1 tsp" and US ones still give a gram weight in brackets.
    const total = us + metric;
    if (us / total >= 0.8) return "us";
    if (metric / total >= 0.8) return "metric";
    return "mixed";
  }
  return us > 0 ? "us" : "metric";
}

/** Whether offering a conversion to `target` would tell the cook anything. */
/**
 * Which system a recipe should OPEN in, given the cook's default.
 *
 * A default that is not offered for this recipe must not be applied to it.
 * Setting Metric and then opening a recipe already written in grams asked for
 * a conversion that does not exist, and the measurement selector -- which
 * hides options that would say nothing -- was left with no option selected at
 * all: three pills, none of them lit, and no way to tell what the screen was
 * showing. Fall back to the recipe's own units, which is what it was going to
 * show anyway.
 */
export function openingMeasurement(preferred: Measurement, original: OriginalSystem): Measurement {
  return conversionIsUseful(original, preferred) ? preferred : "original";
}

export function conversionIsUseful(original: OriginalSystem, target: Measurement): boolean {
  if (target === "original") return true;
  if (original === "unknown") return false;
  if (original === "mixed") return true;
  return original !== target;
}
