"use strict";
// M1 recipe-model scorer (ADR 0012, 0014, 0020). Pure: scores one recipe output
// against one case's truth. Accepts today's RecipeBox shape and the target
// model's extensions (portion refs, preparation kind, flags, source object), so
// the same scorer measures the current pipeline and the future one.
//
// Every finding is classed as one of:
//   detection    — the output failed to *notice or express* something (no link, no
//                  portion, no flag, wrong section, missing attribution). The recipe a
//                  cook reads is still what the source said.
//   modification — the output *changed the recipe* (a quantity altered, invented,
//                  dropped or rounded into a float; an ingredient added or lost; step
//                  wording rewritten; a contradiction silently settled; a reference
//                  that points at nothing). These are the dangerous ones.
//
// Output shape understood:
//   { title, servings, macros, sourceUrl, source:{url,siteName,originalTitle,author},
//     flags:[{kind, ingredientId|ingredient}],
//     sections:[{ name, ingredients:[{id,amount,unit,name,optional,kind,flag}],
//                 steps:[{id,text, ingredientRefs:[ "i1" | {id,amount,unit} ]}] }] }

const { sameQuantity, writtenFaithfully } = require("./quantity");

const lc = (s) => String(s == null ? "" : s).toLowerCase();
const hasAny = (text, list) => (list || []).some((m) => m !== "" && lc(text).includes(lc(m)));
const refId = (r) => (typeof r === "string" ? r : r && (r.id || r.ref));
const ratio = (n, d) => (d ? n / d : null);

// The web app stores inline ingredient tokens in step text ("Stir in {i6}") and
// renders each as a chip showing the ingredient. The scorer reads steps the way a
// cook sees them: tokens rendered back to names, and each token counted as a link.
function flattenOutput(out) {
  const ings = [], steps = [];
  for (const sec of (out && out.sections) || []) for (const g of sec.ingredients || []) ings.push({ ...g, _section: sec.name || "" });
  const byId = new Map(ings.filter((g) => g.id).map((g) => [g.id, g]));
  for (const sec of (out && out.sections) || []) for (const s of sec.steps || []) {
    const tokenIds = [];
    const text = String(s.text || "").replace(/\{([A-Za-z0-9_-]+)\}/g, (all, id) => { tokenIds.push(id); const g = byId.get(id); return g ? g.name : all; });
    const refs = [...(s.ingredientRefs || s.refs || [])];
    for (const id of tokenIds) if (!refs.some((r) => refId(r) === id)) refs.push(id);
    steps.push({ ...s, text, ingredientRefs: refs, _section: sec.name || "" });
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
function flagsFor(out, g, t) {
  return ((out && out.flags) || []).filter((f) =>
    (g && g.id && f.ingredientId === g.id) || (t && hasAny(f.ingredient || "", t.match)));
}
// Fallback step matching: the cue's content words all appear in the step, so a
// normaliser dropping "the" before an ingredient chip doesn't hide the step.
const STOP = new Set(["the", "a", "an", "of", "and", "to", "into", "in"]);
function words(t) { return new Set(lc(t).replace(/[^a-z0-9/ ]+/g, " ").split(/\s+/).filter(Boolean)); }
function cueWords(cue) { return [...words(cue)].filter((w) => !STOP.has(w)); }
function isBlank(v) {
  if (v == null || v === "" || v === 0 || v === "0") return true;
  if (typeof v === "object") return Object.values(v).every(isBlank);
  return false;
}
function isFlagged(out, g, t) { return !!(g && (g.conflict || g.flag || g.uncertain)) || flagsFor(out, g, t).length > 0; }
function splitQty(s) { const m = String(s).trim().match(/^(\S+(?:\s+\d+\/\d+)?)\s*(.*)$/); return m ? [m[1], m[2]] : [s, ""]; }

function score(truth, out) {
  out = out || {};
  const T = flattenTruth(truth), O = flattenOutput(out);
  const m = {};

  // ── preparations listed as things to buy (detection: misclassified, recipe text intact) ──
  const prepHits = new Set();
  let prepMis = 0;
  for (const p of truth.preparations || []) {
    const hit = O.ings.find((g) => hasAny(g.name, p.match) && g.kind !== "preparation");
    if (hit) { prepMis++; prepHits.add(hit); }
  }
  if ((truth.preparations || []).length) m.preparations = { total: truth.preparations.length, listedAsIngredient: prepMis, ok: truth.preparations.length - prepMis };

  // ── ingredient matching ──
  const map = new Map();
  const taken = new Set(prepHits);
  for (const g of O.ings) if (g.kind === "preparation") taken.add(g);
  for (const t of T.ings) {
    const cands = O.ings.filter((g) => !taken.has(g) && hasAny(g.name, t.match));
    const inSec = cands.find((g) => t._sec.anySection || hasAny(g._section, t._sec.match));
    const pick = inSec || cands[0];
    if (pick) { map.set(t.key, pick); taken.add(pick); }
  }
  const extras = O.ings.filter((g) => !taken.has(g) && !hasAny(g.name, truth.allowedExtras || []));
  m.ingredients = { total: T.ings.length, found: map.size, dropped: T.ings.length - map.size, invented: extras.length };

  // ── quantities ──
  const contradictionKeys = new Set((truth.contradictions || []).map((c) => c.ing));
  const q = { checked: 0, correct: 0, faithful: 0, modified: 0, dropped: 0, invented: 0, floatArtefacts: 0, unreadable: 0, unreadableFlagged: 0, unreadableUnflagged: 0 };
  for (const t of T.ings) {
    const g = map.get(t.key); if (!g) continue;
    const oAmt = String(g.amount || "").trim(), tAmt = String(t.amount || "").trim();
    if (/\.\d{3,}/.test(oAmt)) q.floatArtefacts++;
    if (t.unreadable) {
      q.unreadable++;
      if (oAmt) q.invented++;
      else if (isFlagged(out, g, t)) q.unreadableFlagged++;
      else q.unreadableUnflagged++;
      continue;
    }
    if (!tAmt) { if (oAmt) q.invented++; continue; }
    if (contradictionKeys.has(t.key)) continue; // judged under contradictions
    q.checked++;
    if (!oAmt) { q.dropped++; continue; }
    if (sameQuantity(oAmt, g.unit, tAmt, t.unit)) { q.correct++; if (writtenFaithfully(oAmt, tAmt)) q.faithful++; }
    else q.modified++;
  }
  m.quantities = q;

  // ── sections (detection) ──
  const secT = T.ings.filter((t) => !t._sec.anySection && map.get(t.key));
  if (secT.length) m.sections = { checked: secT.length, correct: secT.filter((t) => hasAny(map.get(t.key)._section, t._sec.match)).length };

  // ── references that point at nothing (modification: corrupts the recipe) ──
  const outIds = new Set(O.ings.map((g) => g.id).filter(Boolean));
  let invalidRefs = 0, totalRefs = 0;
  for (const s of O.steps) for (const r of s.ingredientRefs || s.refs || []) { totalRefs++; if (!outIds.has(refId(r))) invalidRefs++; }
  m.references = { total: totalRefs, invalid: invalidRefs };

  // ── step matching, links, portions, wording ──
  const idToKey = new Map();
  for (const [k, g] of map) if (g.id) idToKey.set(g.id, k);
  const stepMap = new Map(), usedSteps = new Set();
  for (const ts of T.steps) {
    const os = O.steps.find((s) => !usedSteps.has(s) && lc(s.text).includes(lc(ts.cue)))
      || O.steps.find((s) => !usedSteps.has(s) && cueWords(ts.cue).every((w) => words(s.text).has(w)));
    if (os) { stepMap.set(ts.key, os); usedSteps.add(os); }
  }
  let truthPairs = 0, tp = 0, outPairs = 0, wrong = 0, portionsTotal = 0, portionsOk = 0, keepTotal = 0, keepLost = 0;
  for (const ts of T.steps) {
    const os = stepMap.get(ts.key);
    const uses = ts.uses || [];
    truthPairs += uses.length;
    for (const u of uses) if (u.amount) portionsTotal++;
    keepTotal += (ts.keep || []).length;
    if (!os) { keepLost += (ts.keep || []).length; continue; }
    for (const phrase of ts.keep || []) if (!lc(os.text).includes(lc(phrase))) keepLost++;
    const refs = os.ingredientRefs || os.refs || [];
    for (const r of refs) {
      if (!outIds.has(refId(r))) continue; // already counted as invalid
      outPairs++;
      const key = idToKey.get(refId(r));
      const u = key && uses.find((x) => x.ing === key);
      if (u) {
        tp++;
        if (u.amount && typeof r === "object" && sameQuantity(r.amount, r.unit, u.amount, u.unit)) portionsOk++;
      } else wrong++;
    }
  }
  if (T.steps.length) {
    m.steps = { total: T.steps.length, matched: stepMap.size, keepPhrases: keepTotal, wordingChanged: keepLost };
    m.links = { truthPairs, outputPairs: outPairs, correct: tp, wrong, precision: ratio(tp, outPairs), recall: ratio(tp, truthPairs) };
    if (portionsTotal) m.portions = { total: portionsTotal, correct: portionsOk };
  }

  // ── contradictions: surfaced / kept but unflagged (detection) / changed silently (modification) ──
  if ((truth.contradictions || []).length) {
    const c0 = { total: truth.contradictions.length, surfaced: 0, keptUnflagged: 0, changedSilently: 0 };
    for (const c of truth.contradictions) {
      const t = T.ings.find((x) => x.key === c.ing), g = map.get(c.ing);
      if (g && isFlagged(out, g, t)) { c0.surfaced++; continue; }
      const listed = splitQty(c.values[0]);
      if (g && sameQuantity(g.amount, g.unit, listed[0], listed[1])) c0.keptUnflagged++;
      else c0.changedSilently++;
    }
    m.contradictions = c0;
  }

  // ── fields that must stay blank (modification if filled: ADR 0014) ──
  if ((truth.blank || []).length) {
    let invented = 0;
    for (const f of truth.blank) if (!isBlank(out[f])) invented++;
    m.suppression = { total: truth.blank.length, invented, ok: truth.blank.length - invented };
  }

  // ── source attribution (detection: ADR 0020) ──
  if (truth.source) {
    const src = out.source || {};
    const fields = {};
    for (const [k, v] of Object.entries(truth.source)) {
      const got = k === "url" ? (src.url || out.sourceUrl || "") : (src[k] || "");
      fields[k] = { expected: v, got, ok: lc(got).replace(/\/$/, "") === lc(v).replace(/\/$/, "") };
    }
    m.source = { total: Object.keys(fields).length, ok: Object.values(fields).filter((f) => f.ok).length, fields };
  }

  m.classes = classify(m);
  return m;
}

/** Roll a case's metrics into the two failure classes. */
function classify(m) {
  const detection = {}, modification = {};
  const put = (o, k, v) => { if (v) o[k] = v; };
  put(detection, "linksMissing", m.links ? m.links.truthPairs - m.links.correct : 0);
  put(detection, "linksWrong", m.links ? m.links.wrong : 0);
  put(detection, "portionsMissing", m.portions ? m.portions.total - m.portions.correct : 0);
  put(detection, "sectionsWrong", m.sections ? m.sections.checked - m.sections.correct : 0);
  put(detection, "preparationsListedAsIngredients", m.preparations ? m.preparations.listedAsIngredient : 0);
  put(detection, "contradictionsNotFlagged", m.contradictions ? m.contradictions.keptUnflagged : 0);
  put(detection, "unreadableNotFlagged", m.quantities.unreadableUnflagged);
  put(detection, "sourceFieldsMissing", m.source ? m.source.total - m.source.ok : 0);
  put(modification, "quantitiesChanged", m.quantities.modified);
  put(modification, "quantitiesDropped", m.quantities.dropped);
  put(modification, "quantitiesInvented", m.quantities.invented);
  put(modification, "floatArtefacts", m.quantities.floatArtefacts);
  put(modification, "ingredientsDropped", m.ingredients.dropped);
  put(modification, "ingredientsInvented", m.ingredients.invented);
  put(modification, "contradictionsSettledSilently", m.contradictions ? m.contradictions.changedSilently : 0);
  put(modification, "fieldsInvented", m.suppression ? m.suppression.invented : 0);
  put(modification, "stepWordingChanged", m.steps ? m.steps.wordingChanged : 0);
  put(modification, "invalidReferences", m.references.invalid);
  return { detection, modification };
}

/** The ideal output for a case, in the target model. The scorer must give it zero findings. */
function referenceOutput(truth) {
  const out = { title: "", servings: truth.servings || "", sections: [], flags: [], source: truth.source ? { ...truth.source } : undefined };
  let i = 0, s = 0;
  const idOf = {};
  for (const sec of truth.sections || []) {
    const o = { name: (sec.match && sec.match[0]) || sec.key, ingredients: [], steps: [] };
    for (const g of sec.ingredients || []) {
      idOf[g.key] = "i" + ++i;
      const listed = (truth.contradictions || []).find((c) => c.ing === g.key);
      const [amt, unit] = listed ? splitQty(listed.values[0]) : [g.unreadable ? "" : g.amount || "", g.unit || ""];
      o.ingredients.push({ id: idOf[g.key], name: g.match[0], amount: amt, unit: listed ? unit : g.unit || "", optional: !!g.optional, flag: g.unreadable ? "unreadable" : undefined });
      if (g.unreadable) out.flags.push({ kind: "unreadable", ingredientId: idOf[g.key] });
    }
    out.sections.push(o);
  }
  for (const c of truth.contradictions || []) out.flags.push({ kind: "quantity-conflict", ingredientId: idOf[c.ing] });
  for (const p of truth.preparations || []) out.sections[0].ingredients.push({ id: "p" + ++i, name: p.match[0], kind: "preparation" });
  truth.sections.forEach((sec, si) => {
    for (const st of sec.steps || []) out.sections[si].steps.push({
      id: "s" + ++s, text: [st.cue].concat(st.keep || []).join(" "),
      ingredientRefs: (st.uses || []).map((u) => (u.amount ? { id: idOf[u.ing], amount: u.amount, unit: u.unit } : idOf[u.ing])),
    });
  });
  return out;
}

module.exports = { score, referenceOutput, flattenOutput, classify };
