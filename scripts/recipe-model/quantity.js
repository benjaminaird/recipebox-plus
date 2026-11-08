"use strict";
// Quantity helpers shared by the M1 scorer and validator. Pure, no dependencies.

const UNICODE_FRACTIONS = { "¼": "1/4", "½": "1/2", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8" };

const UNIT_ALIASES = {
  cup: ["cup", "cups", "c", "c."],
  tbsp: ["tbsp", "tbsp.", "tablespoon", "tablespoons", "tbs", "tbl", "t"],
  tsp: ["tsp", "tsp.", "teaspoon", "teaspoons"],
  oz: ["oz", "oz.", "ounce", "ounces"],
  lb: ["lb", "lbs", "pound", "pounds"],
  g: ["g", "gram", "grams"],
  kg: ["kg", "kilogram", "kilograms"],
  ml: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
  can: ["can", "cans"],
  clove: ["clove", "cloves"],
  box: ["box", "boxes"],
  pinch: ["pinch", "pinches"],
};
const UNIT_LOOKUP = {};
for (const [canon, list] of Object.entries(UNIT_ALIASES)) for (const a of list) UNIT_LOOKUP[a] = canon;

function normUnit(u) {
  const s = String(u || "").trim().toLowerCase();
  if (!s) return "";
  return UNIT_LOOKUP[s] || s;
}

/** Parse "1 1/2", "1/2", "0.5", "½", "1½" → number. Returns null for words, ranges and blanks. */
function parseAmount(a) {
  let s = String(a == null ? "" : a).trim();
  if (!s) return null;
  for (const [k, v] of Object.entries(UNICODE_FRACTIONS)) s = s.replace(new RegExp("(\\d)" + k), "$1 " + v).replace(k, v);
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return +m[1] + +m[2] / +m[3];
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[1] / +m[2];
  m = s.match(/^\d+(?:\.\d+)?$/);
  if (m) return +s;
  return null;
}

/** True when two written quantities mean the same amount in the same unit. */
function sameQuantity(aAmt, aUnit, bAmt, bUnit) {
  const ua = normUnit(aUnit), ub = normUnit(bUnit);
  if (ua !== ub) return false;
  const na = parseAmount(aAmt), nb = parseAmount(bAmt);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.011;
  return String(aAmt || "").trim().toLowerCase() === String(bAmt || "").trim().toLowerCase();
}

/** "As written" check: same numeric meaning AND no float artefacts (e.g. 2.3333332538605 for 2 1/3). */
function writtenFaithfully(outAmt, truthAmt) {
  const s = String(outAmt || "");
  if (/\.\d{3,}/.test(s)) return false;
  const t = String(truthAmt || "");
  if (/\//.test(t) && /^\d*\.\d+$/.test(s)) return false; // source wrote a fraction, output wrote a decimal
  return true;
}

module.exports = { parseAmount, normUnit, sameQuantity, writtenFaithfully };
