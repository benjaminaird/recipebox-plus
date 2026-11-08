"use strict";
// M1 recipe-model scorer (ADR 0012, 0014, 0020). Pure: scores one recipe output
// against one case's truth. Accepts today's RecipeBox shape and the target
// model's extensions (portion refs, preparation kind, flags, source object), so
// the same scorer measures the current pipeline and the future one.
//
// Output shape understood:
//   { title, servings, macros, sourceUrl, source:{url,siteName,originalTitle,author},
//     flags:[{kind, ingredientId|ingredient}],
//     sections:[{ name, ingredients:[{id,amount,unit,name,optional,kind,flag}],
//                 steps:[{id,text, ingredientRefs:[ "i1" | {id,amount,unit} ]}] }] }

const { sameQuantity, writtenFaithfully } = require("./quantity");

const lc = (s) => String(s == null ? "" : s).toLowerCase();
const hasAny = (text, list) => (list || []).some((m) => m !== "" && lc(text).includes(lc(m)));

function flattenOutput(out) {
  const ings = [], steps = [];
  for (const sec of (out && out.sections) || []) {
    for (const g of sec.ingredients || []) ings.push({ ...g, _section: sec.name || "" });
    for (const s of sec.steps || []) steps.push({ ...s, _section: sec.name || "" });
  }
  return { ings, steps };
}
function flattenTruth(truth) {
  const ings = [], steps = [];
  for (const sec of truth.sections || []) {
    for (const g of sec.ingredients || []) ings.push({ ...g, _sec: sec });
    for (const s of sec.steps || []) steps.push({ ...s, _sec: sec });
  }
  return { ings, steps };
}
function refId(r) { return typeof r === "string" ? r : r && (r.id || r.ref); }

function ratio(n, d) { return d ? n / d : null; }

function score(truth, out) {
  const T = flattenTruth(truth), O = flattenOutput(out || {});
  const m = {};

  // ── preparations listed as things to buy ──
  const prepHits = new Set();
  let prepMis = 0;
  for (const p of truth.preparations || []) {
    const hit = O.ings.find((g) => hasAny(g.name, p.match) && g.kind !== "preparation");
    if (hit) { prepMis++; prepHits.add(hit); }
  }
  if ((truth.preparations || []).length) m.preparations = { total: truth.preparations.length, listedAsIngredient: prepMis, ok: truth.preparations.length - prepMis };

  // ── ingredient matching ──
  const map = new Map(); // truth key -> output ingredient
  const taken = new Set(prepHits);
  for (const g of O.ings) if (g.kind === "preparation") taken.add(g);
  for (const t of T.ings) {
    const cands = O.ings.filter((g) => !taken.has(g) && hasAny(g.name, t.match));
    const inSec = cands.find((g) => t._sec.anySection || hasAny(g._section, t._sec.match));
    const pick = inSec || cands[0];
    if (pick) { map.set(t.key, pick); taken.add(pick); }
  }
  m.ingredients = { total: T.ings.length, found: map.size };

  // ── quantities ──
  const q = { checked: 0, correct: 0, faithful: 0, invented: 0, dropped: 0, unreadableFlagged: 0, unreadable: 0 };
  for (const t of T.ings) {
    const g = map.get(t.key); if (!g) continue;
    if (t.unreadable) {
      q.unreadable++;
      const flagged = !String(g.amount || "").trim() && (g.flag || g.uncertain || flagsFor(out, g, t).length);
      if (flagged) q.unreadableFlagged++;
      else if (String(g.amount || "").trim()) q.invented++;
      continue;
    }
    const tAmt = String(t.amount || "").trim(), oAmt = String(g.amount || "").trim();
    if (!tAmt) { if (oAmt) q.invented++; continue; }
    q.checked++;
    if (!oAmt) { q.dropped++; continue; }
    if (sameQuantity(oAmt, g.unit, tAmt, t.unit)) { q.correct++; if (writtenFaithfully(oAmt, tAmt)) q.faithful++; }
  }
  m.quantities = q;

  // ── sections ──
  const secT = T.ings.filter((t) => !t._sec.anySection && map.get(t.key));
  if (secT.length) m.sections = { checked: secT.length, correct: secT.filter((t) => hasAny(map.get(t.key)._section, t._sec.match)).length };

  // ── step matching and links ──
  const idToKey = new Map();
  for (const [k, g] of map) if (g.id) idToKey.set(g.id, k);
  const stepMap = new Map();
  const usedSteps = new Set();
  for (const ts of T.steps) {
    const os = O.steps.find((s) => !usedSteps.has(s) && lc(s.text).includes(lc(ts.cue)));
    if (os) { stepMap.set(ts.key, os); usedSteps.add(os); }
  }
  let truthPairs = 0, tp = 0, outPairs = 0, portionsTotal = 0, portionsOk = 0;
  for (const ts of T.steps) {
    const os = stepMap.get(ts.key);
    const uses = ts.uses || [];
    truthPairs += uses.length;
    for (const u of uses) if (u.amount) portionsTotal++;
    if (!os) continue;
    const refs = os.ingredientRefs || os.refs || [];
    outPairs += refs.length;
    for (const r of refs) {
      const key = idToKey.get(refId(r));
      const u = key && uses.find((x) => x.ing === key);
      if (u) {
        tp++;
        if (u.amount && typeof r === "object" && sameQuantity(r.amount, r.unit, u.amount, u.unit)) portionsOk++;
      }
    }
  }
  if (T.steps.length) {
    m.steps = { total: T.steps.length, matched: stepMap.size };
    m.links = { truthPairs, outputPairs: outPairs, correct: tp, precision: ratio(tp, outPairs), recall: ratio(tp, truthPairs) };
    if (portionsTotal) m.portions = { total: portionsTotal, correct: portionsOk };
  }

  // ── contradictions ──
  if ((truth.contradictions || []).length) {
    let surfaced = 0;
    for (const c of truth.contradictions) {
      const t = T.ings.find((x) => x.key === c.ing), g = map.get(c.ing);
      if (g && (g.conflict || g.flag || flagsFor(out, g, t).length)) surfaced++;
    }
    m.contradictions = { total: truth.contradictions.length, surfaced, silentlyResolved: truth.contradictions.length - surfaced };
  }

  // ── fields that must stay blank (ADR 0014: suppress, don't guess) ──
  if ((truth.blank || []).length) {
    let invented = 0;
    for (const f of truth.blank) if (!isBlank(out && out[f])) invented++;
    m.suppression = { total: truth.blank.length, invented, ok: truth.blank.length - invented };
  }

  // ── source attribution (ADR 0020) ──
  if (truth.source) {
    const src = (out && out.source) || {};
    const fields = {};
    for (const [k, v] of Object.entries(truth.source)) {
      const got = k === "url" ? (src.url || (out && out.sourceUrl) || "") : (src[k] || "");
      fields[k] = { expected: v, got, ok: lc(got).replace(/\/$/, "") === lc(v).replace(/\/$/, "") };
    }
    m.source = { total: Object.keys(fields).length, ok: Object.values(fields).filter((f) => f.ok).length, fields };
  }
  return m;
}

function flagsFor(out, g, t) {
  return ((out && out.flags) || []).filter((f) =>
    (g && g.id && f.ingredientId === g.id) || (t && hasAny(f.ingredient || "", t.match)));
}
function isBlank(v) {
  if (v == null || v === "" || v === 0 || v === "0") return true;
  if (typeof v === "object") return Object.values(v).every(isBlank);
  return false;
}

/** The ideal output for a case, in the target model. The scorer must give it full marks. */
function referenceOutput(truth) {
  const out = { title: "", servings: truth.servings || "", sections: [], flags: [], source: truth.source ? { ...truth.source } : undefined };
  let i = 0, s = 0;
  const idOf = {};
  for (const sec of truth.sections || []) {
    const o = { name: (sec.match && sec.match[0]) || sec.key, ingredients: [], steps: [] };
    for (const g of sec.ingredients || []) {
      idOf[g.key] = "i" + ++i;
      o.ingredients.push({ id: idOf[g.key], name: g.match[0], amount: g.unreadable ? "" : g.amount || "", unit: g.unit || "", optional: !!g.optional, flag: g.unreadable ? "unreadable" : undefined });
      if (g.unreadable) out.flags.push({ kind: "unreadable", ingredientId: idOf[g.key] });
    }
    out.sections.push(o);
  }
  for (const c of truth.contradictions || []) out.flags.push({ kind: "quantity-conflict", ingredientId: idOf[c.ing] });
  for (const p of truth.preparations || []) out.sections[0].ingredients.push({ id: "p" + ++i, name: p.match[0], kind: "preparation" });
  truth.sections.forEach((sec, si) => {
    for (const st of sec.steps || []) out.sections[si].steps.push({ id: "s" + ++s, text: st.cue, ingredientRefs: (st.uses || []).map((u) => u.amount ? { id: idOf[u.ing], amount: u.amount, unit: u.unit } : idOf[u.ing]) });
  });
  return out;
}

module.exports = { score, referenceOutput, flattenOutput };
