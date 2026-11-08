"use strict";
// Recipe-model validator (ADR 0012, ADR 0016 step 6, ADR 0020). Checks that a
// proposed recipe, usually a Recipe Helper adjustment of `base`, is internally
// consistent before it may be offered to the user. Pure; returns violations.
//
// Model: { source, preparations:[{id,name,producedBy}],
//          sections:[{ingredients:[{id,name,amount,unit}], steps:[{id,text,ingredientRefs:[id|{id,amount,unit}]}]}] }
// change: { kind:"scale", factor } | { kind:"substitute", added:[name], removed:[name] } | { kind:"edit", added, removed }

const { parseAmount, normUnit } = require("./quantity");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const refId = (r) => (typeof r === "string" ? r : r && r.id);
const allIngs = (r) => (r.sections || []).flatMap((s) => s.ingredients || []);
const allSteps = (r) => (r.sections || []).flatMap((s) => s.steps || []);
const INVARIANT = /\d+\s*°\s*[FC]\b|\d+(?:\s*[–-]\s*\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\b|\d+(?:\s*x\s*\d+)?[- ]inch\b/gi;

function validate(base, cand, change = {}) {
  const v = [];
  const add = (code, detail) => v.push({ code, detail });
  const ings = allIngs(cand), steps = allSteps(cand);
  const ids = new Set(ings.map((g) => g.id).concat((cand.preparations || []).map((p) => p.id)));

  // references resolve
  for (const s of steps) for (const r of s.ingredientRefs || []) if (!ids.has(refId(r))) add("REF_UNRESOLVED", `${s.id} → ${refId(r)}`);

  // nothing invented, nothing silently removed
  const baseNames = new Set(allIngs(base).map((g) => norm(g.name)));
  const candNames = new Set(ings.map((g) => norm(g.name)));
  const added = new Set((change.added || []).map(norm)), removed = new Set((change.removed || []).map(norm));
  for (const n of candNames) if (!baseNames.has(n) && !added.has(n)) add("INVENTED_INGREDIENT", n);
  for (const n of baseNames) if (!candNames.has(n) && !removed.has(n)) add("SILENT_REMOVAL", n);

  // portions reconcile against the listed total
  for (const g of ings) {
    const total = parseAmount(g.amount);
    if (total === null) continue;
    let sum = 0, any = false;
    for (const s of steps) for (const r of s.ingredientRefs || []) {
      if (typeof r === "object" && r.id === g.id && r.amount != null) {
        const n = parseAmount(r.amount);
        if (n !== null && normUnit(r.unit) === normUnit(g.unit)) { sum += n; any = true; }
      }
    }
    if (any && sum > total + 0.011) add("PORTIONS_EXCEED_TOTAL", `${g.name}: ${sum} > ${total}`);
  }

  // a portion written into the step's wording must agree with the portion on its reference
  const QTY = /(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(cups?|tablespoons?|tbsp|teaspoons?|tsp|oz|ounces?|lb|g|ml)\b/gi;
  for (const s of steps) {
    const written = [...String(s.text || "").matchAll(QTY)].map((x) => ({ amount: x[1], unit: normUnit(x[2]) }));
    for (const r of s.ingredientRefs || []) {
      if (typeof r !== "object" || r.amount == null) continue;
      const sameUnit = written.filter((w) => w.unit === normUnit(r.unit));
      const n = parseAmount(r.amount);
      if (sameUnit.length && !sameUnit.some((w) => Math.abs(parseAmount(w.amount) - n) < 0.011)) add("STEP_TEXT_DISAGREES_WITH_PORTION", `${s.id}: text says ${sameUnit.map((w) => w.amount + " " + w.unit).join(", ")}, reference says ${r.amount} ${r.unit}`);
    }
  }

  // a preparation is consumed only after the step that makes it
  const order = new Map(steps.map((s, i) => [s.id, i]));
  for (const p of cand.preparations || []) {
    const made = order.get(p.producedBy);
    steps.forEach((s, i) => {
      if ((s.ingredientRefs || []).some((r) => refId(r) === p.id) && (made === undefined || i <= made)) add("PREPARATION_USED_BEFORE_MADE", `${p.name} in ${s.id}`);
    });
  }

  // scaling: amounts scale, times / temperatures / pan sizes do not
  if (change.kind === "scale" && change.factor) {
    const baseById = new Map(allIngs(base).map((g) => [g.id, g]));
    for (const g of ings) {
      const b = baseById.get(g.id), bn = b && parseAmount(b.amount), cn = parseAmount(g.amount);
      if (bn !== null && bn !== undefined && cn !== null && Math.abs(cn - bn * change.factor) > 0.011) add("SCALE_MISMATCH", `${g.name}: ${g.amount} ≠ ${b.amount} × ${change.factor}`);
    }
    const baseSteps = new Map(allSteps(base).map((s) => [s.id, s]));
    for (const s of steps) {
      const b = baseSteps.get(s.id); if (!b) continue;
      const bi = (b.text.match(INVARIANT) || []).join("|"), ci = (s.text.match(INVARIANT) || []).join("|");
      if (bi !== ci) add("SCALED_TIME_TEMPERATURE_OR_PAN", `${s.id}: "${bi}" → "${ci}"`);
    }
  }

  // attribution is never edited by an adjustment (ADR 0020 rule 3)
  if (JSON.stringify(base.source || null) !== JSON.stringify(cand.source || null)) add("SOURCE_CHANGED", "source must be carried forward unchanged");
  return v;
}

module.exports = { validate };
