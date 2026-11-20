"use strict";
/*
 * Adjustment tasks: scoring an answer to "make this lower in sugar" by code
 * rather than by reading it (ADR 0017).
 *
 * The corpus already measures extraction — did the import understand the
 * source. This measures the other thing the production model has to do: given
 * a recipe and a cook's request, does it propose a change that is valid,
 * follows the instruction, and does not quietly wreck something else.
 *
 * Every assertion is deterministic and runs against the APPLIED recipe, not
 * against the model's prose. "Lower the sugar" is scored by the sugar being
 * lower, not by the answer saying it is. The three things a task can check:
 *
 *   validity      the proposal survives readProposal and the recipe model
 *                 (ADR 0016 step 6) — the same code the server runs.
 *   instruction   what the cook asked for actually happened.
 *   collateral    what the cook did not ask about did not change.
 *
 * Culinary plausibility is only partly reachable this way, and the files say
 * so rather than pretending: a task encodes the hard rules a cook would not
 * argue with ("do not take the eggs out of a cake to reduce sugar", "do not
 * move the oven temperature when swapping a flour"). Whether the result tastes
 * good still needs a person, and the plan says which judgements those are.
 *
 * Pure and dependency-free, like everything else the CI domain job runs with
 * no npm install.
 */

const Adjust = require("../../packages/recipe-core/src/recipe-adjust");

const norm = (s) => String(s || "").toLowerCase();
const ingredientsOf = (r) => (r.sections || []).flatMap((s) => s.ingredients || []);
const stepsOf = (r) => (r.sections || []).flatMap((s) => s.steps || []);
const named = (r, needle) => ingredientsOf(r).filter((g) => norm(g.name).includes(norm(needle)));

/**
 * Score one answer against one task.
 *
 * Returns `{ findings, applied }`. A finding is a code with detail, in the
 * same shape the validator uses, so a report can list both together. No
 * findings means the answer was acceptable — not that it was the best one.
 */
function scoreAnswer(task, answer) {
  const findings = [];
  const add = (code, detail) => findings.push({ code, detail });
  const base = task.base;
  const want = task.expect || {};

  const read = Adjust.readProposal(answer, base);
  if (!read.proposal) {
    for (const problem of read.problems) add("UNUSABLE_" + problem.code, problem.detail);
    return { findings, applied: null };
  }

  // Asking is a correct answer to some requests, and the wrong answer to
  // others. A task says which it expects, because a model that asks a question
  // every time is not cautious, it is useless.
  const asked = Adjust.isQuestionOnly(read.proposal);
  if (want.asks && !asked) add("DID_NOT_ASK", "the request needed a clarifying question first");
  if (!want.asks && asked) add("ASKED_INSTEAD_OF_PROPOSING", read.proposal.question || "(no question)");
  // An answer with neither a question nor an operation never gets here:
  // readProposal rejects it as PROPOSAL_EMPTY, which is reported above as
  // UNUSABLE_PROPOSAL_EMPTY. So a question-only proposal always has a question.
  if (asked) return { findings, applied: null };

  const checked = Adjust.checkProposal(base, read.proposal);
  for (const violation of checked.violations) add(violation.code, violation.detail);
  const applied = checked.recipe;

  // --- what the cook asked for -------------------------------------------
  for (const needle of want.removes || []) {
    if (named(applied, needle).length) add("NOT_REMOVED", needle);
  }
  for (const needle of want.keeps || []) {
    if (!named(applied, needle).length) add("REMOVED_WHAT_WAS_NOT_ASKED_ABOUT", needle);
  }
  for (const needle of want.adds || []) {
    if (!named(applied, needle).length) add("NOT_ADDED", needle);
  }
  for (const rule of want.reduces || []) {
    const before = named(base, rule).map((g) => Adjust.parseAmount(g.amount)).filter((n) => n !== null);
    const after = named(applied, rule).map((g) => Adjust.parseAmount(g.amount)).filter((n) => n !== null);
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    if (!(before.length && after.length && sum(after) < sum(before))) add("NOT_REDUCED", rule);
  }
  for (const rule of want.unchangedAmounts || []) {
    const before = named(base, rule).map((g) => [g.amount, g.unit].join(" "));
    const after = named(applied, rule).map((g) => [g.amount, g.unit].join(" "));
    // An ingredient that is GONE is a removal, reported by `keeps`. Reporting
    // it a second time as a changed amount would score one mistake twice and
    // make a report read as worse than it is.
    if (after.length === 0) continue;
    if (before.join("|") !== after.join("|")) add("CHANGED_AN_UNRELATED_AMOUNT", `${rule}: ${before.join(", ")} → ${after.join(", ")}`);
  }

  // --- what the cook did not ask about -----------------------------------
  // Times, temperatures and pan sizes are the classic collateral damage of an
  // ingredient swap: they are physical facts about the bake, not quantities to
  // be adjusted along with it.
  const allText = (r) => stepsOf(r).map((s) => String(s.text || "")).join("\n");
  for (const phrase of want.invariants || []) {
    if (!allText(applied).includes(phrase)) add("LOST_AN_INVARIANT", phrase);
  }
  for (const needle of want.forbids || []) {
    if (named(applied, needle).length && !named(base, needle).length) add("ADDED_SOMETHING_UNASKED", needle);
  }
  if (want.maxAdditions !== undefined) {
    const extra = ingredientsOf(applied).length - ingredientsOf(base).length;
    if (extra > want.maxAdditions) add("TOO_MANY_ADDITIONS", `${extra} new ingredients`);
  }

  // --- what it has to say ------------------------------------------------
  // Not a style rule. ADR 0016 and the brief both forbid implying that an
  // allergen or nutritional requirement is guaranteed, and the only machine-
  // checkable form of that is: when the request is about one, the answer has
  // to carry the caveat in `uncertainties`, where the screen shows it as a
  // caveat rather than as part of the summary.
  if (want.discloses) {
    const said = [...(read.proposal.uncertainties || []), ...(read.proposal.tradeoffs || [])].join("\n");
    if (!new RegExp(want.discloses, "i").test(said)) add("NO_CAVEAT", want.discloses);
  }
  if (want.tradeoffs && (read.proposal.tradeoffs || []).length === 0) {
    add("NO_TRADEOFF_STATED", "the change is not free and the answer did not say so");
  }

  return { findings, applied };
}

/** Codes only, sorted and deduplicated: what a recorded expectation compares. */
function codesOf(findings) {
  return [...new Set(findings.map((f) => f.code))].sort();
}

/**
 * Score every recorded answer in a task file.
 *
 * The recorded answers are fixtures, deliberately including careless ones, and
 * each declares the findings it should produce. They prove the SCORER — that a
 * careless answer is caught and a careful one is not — at no cost and with no
 * network. They prove nothing about any model, which is the whole point of
 * keeping them separate from a live run.
 */
function scoreRecorded(task) {
  const results = [];
  for (const candidate of task.recorded || []) {
    const got = codesOf(scoreAnswer(task, candidate.answer).findings);
    const expected = [...(candidate.expect || [])].sort();
    results.push({
      task: task.id,
      candidate: candidate.label,
      expected,
      got,
      agrees: JSON.stringify(got) === JSON.stringify(expected),
    });
  }
  return results;
}

module.exports = { scoreAnswer, scoreRecorded, codesOf };
