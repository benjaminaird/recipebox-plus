// Amounts: reading them, scaling them, and writing them back the way a cook
// expects to see them.
//
// Pure. No React Native, no DOM.
//
// The shape matters more than the arithmetic. `public/shopping-list.js` reads
// an amount as `number | null`, which collapses two very different cases into
// one: "1-2 lemons" and "a pinch" both come back null. Scaling has to tell
// them apart -- a range doubles to "2-4", a pinch stays a pinch -- so an
// amount is modelled as one of three things and never as a bare number.

/** A quantity as the source wrote it. */
export type Quantity =
  /** A single number: "2", "1 1/2", "0.5". */
  | { kind: "exact"; value: number }
  /** A span the source offered: "1-2", "2 to 3". Both ends scale. */
  | { kind: "range"; min: number; max: number }
  /** Words, not arithmetic: "a pinch", "to taste". Never scaled. */
  | { kind: "opaque"; text: string }
  /** The source gave no amount at all. */
  | { kind: "none" };

const VULGAR: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4",
  "⅓": "1/3", "⅔": "2/3",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅙": "1/6", "⅚": "5/6", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
};

/** "1 ½" -> "1 1/2". A vulgar fraction directly after a digit is a mixed
 *  number and needs the space the glyph implied. */
export function normalizeFractions(input: string): string {
  let out = String(input ?? "");
  for (const [glyph, ascii] of Object.entries(VULGAR)) {
    out = out.replace(new RegExp(glyph, "g"), (_m, offset: number) => {
      const prev = out[offset - 1];
      return prev && /\d/.test(prev) ? ` ${ascii}` : ascii;
    });
  }
  return out.replace(/\s+/g, " ").trim();
}

function readNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const d = Number(mixed[3]);
    return d === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / d;
  }
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }
  return /^\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(",", ".")) : null;
}

/** Read an amount string. Anything that is not a number or a span of numbers
 *  is kept verbatim rather than guessed at. */
export function parseQuantity(amount: string | number | undefined | null): Quantity {
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? { kind: "exact", value: amount } : { kind: "none" };
  }
  const text = normalizeFractions(String(amount ?? ""));
  if (!text) return { kind: "none" };

  // "1-2", "1 - 2", "2 to 3". The separator must sit between two numbers, so
  // a hyphen inside "half-and-half" is not mistaken for a range.
  const range = text.match(/^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i);
  if (range) {
    const min = readNumber(range[1]);
    const max = readNumber(range[2]);
    if (min !== null && max !== null) {
      return min <= max ? { kind: "range", min, max } : { kind: "range", min: max, max: min };
    }
  }

  const single = readNumber(text);
  if (single !== null) return { kind: "exact", value: single };
  return { kind: "opaque", text };
}

/**
 * Multiply a quantity.
 *
 * An opaque amount is returned untouched: "a pinch" times three is not "three
 * pinches" in any reliable sense, and inventing one would be the kind of
 * confident nonsense this milestone is meant to avoid.
 */
export function scaleQuantity(q: Quantity, factor: number): Quantity {
  if (!Number.isFinite(factor) || factor <= 0) return q;
  switch (q.kind) {
    case "exact": return { kind: "exact", value: q.value * factor };
    case "range": return { kind: "range", min: q.min * factor, max: q.max * factor };
    default: return q;
  }
}

const FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0, ""], [1 / 8, "1/8"], [1 / 4, "1/4"], [1 / 3, "1/3"], [3 / 8, "3/8"],
  [1 / 2, "1/2"], [5 / 8, "5/8"], [2 / 3, "2/3"], [3 / 4, "3/4"], [7 / 8, "7/8"], [1, ""],
];

/**
 * Write a number the way a recipe does.
 *
 * Snapped to the fractions a measuring spoon actually has, which is also what
 * keeps floating point out of the interface: 0.1+0.2 arithmetic must never
 * surface as "0.30000000000000004". Anything that lands far from a kitchen
 * fraction falls back to at most two decimals with trailing zeros removed.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  // Large amounts do not want eighths.
  if (abs >= 10) {
    const r = Math.round(abs * 10) / 10;
    return sign + String(Number(r.toFixed(1)));
  }

  const whole = Math.floor(abs);
  const rest = abs - whole;
  let best: string | null = null;
  let bestGap = Infinity;
  for (const [value, label] of FRACTIONS) {
    const gap = Math.abs(rest - value);
    if (gap < bestGap) { bestGap = gap; best = label; }
  }
  // Only snap when genuinely close; 0.4 is not a third.
  if (bestGap <= 0.021) {
    const carried = bestGap === Math.abs(rest - 1) && best === "" && rest > 0.5 ? whole + 1 : whole;
    if (!best) return sign + String(carried);
    return sign + (whole > 0 ? `${whole} ${best}` : best);
  }
  const rounded = Math.round(abs * 100) / 100;
  return sign + String(Number(rounded.toFixed(2)));
}

/** Render a quantity. Ranges keep both ends; opaque text is passed through. */
export function formatQuantity(q: Quantity): string {
  switch (q.kind) {
    case "exact": return formatNumber(q.value);
    case "range": return `${formatNumber(q.min)}-${formatNumber(q.max)}`;
    case "opaque": return q.text;
    case "none": return "";
  }
}

/**
 * Round a quantity of discrete things to whole items.
 *
 * Half an egg is not an instruction. Rounding is away from zero at the
 * midpoint and never down to nothing, because a recipe that calls for an
 * ingredient at all needs at least one of it.
 */
export function roundDiscrete(q: Quantity): Quantity {
  const whole = (v: number) => Math.max(1, Math.round(v));
  switch (q.kind) {
    case "exact": return { kind: "exact", value: whole(q.value) };
    case "range": return { kind: "range", min: whole(q.min), max: whole(q.max) };
    default: return q;
  }
}
