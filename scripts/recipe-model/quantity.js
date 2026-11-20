"use strict";
// Quantity helpers for the M1 scorer. Pure, no dependencies.
//
// `parseAmount` and `normUnit` are re-exported from the shared package rather
// than kept here: the validator moved there and took them with it, and two
// copies of "what does this amount mean" is exactly the drift the move was for.
// `sameQuantity` and `writtenFaithfully` are scoring concerns and stay.

const { parseAmount, normUnit } = require("../../packages/recipe-core/src/recipe-adjust");

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
