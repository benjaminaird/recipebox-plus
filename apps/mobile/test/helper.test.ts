// The Recipe Helper on the device: reading an answer, holding a conversation,
// and what accepting actually does to a recipe.
//
// No network and no screen. The answers here are fixtures standing in for what
// the server returns, which proves the device half of the pipeline and nothing
// about any model's quality.

import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptProposal, alternativeMessage, dropConversation, emptyConversation, heldConversation,
  helperPath, helperRequest, historyNote, holdConversation, readAnswer, withAnswer,
  withQuestion, withRejection, type HelperAnswer,
} from "../src/ai/helper.ts";
import type { Recipe } from "../src/data/types.ts";

const recipe = (): Recipe => ({
  id: "r1",
  title: "Brown Butter Crumble Bars",
  servings: 16,
  heroImage: "media-abc",
  macros: { calories: 310 },
  createdAt: 1000,
  updatedAt: 1000,
  source: { kind: "website", url: "https://testkitchen.example/bars", method: "link" },
  sections: [{
    ingredients: [
      { id: "i1", name: "unsalted butter", amount: "1", unit: "cup" },
      { id: "i2", name: "all-purpose flour", amount: "2", unit: "cup" },
      { id: "i3", name: "granulated sugar", amount: "1/2", unit: "cup" },
    ],
    steps: [
      { id: "s1", text: "Brown 1/2 cup butter in a pan.", ingredientRefs: ["i1"], ingredientUses: [{ id: "i1", amount: "1/2", unit: "cup" }] },
      { id: "s2", text: "Rub the remaining 1/2 cup butter into the flour and sugar.", ingredientRefs: ["i1", "i2", "i3"], ingredientUses: [{ id: "i1", amount: "1/2", unit: "cup" }] },
    ],
  }],
});

const proposal = (over: Partial<HelperAnswer> = {}): HelperAnswer => ({
  kind: "proposal",
  summary: "I would take the sugar to a quarter cup.",
  question: "",
  tradeoffs: ["Less chew."],
  uncertainties: ["Taste it before baking."],
  alternatives: [],
  operations: [{ kind: "set-ingredient-amount", id: "i3", amount: "1/4" }],
  rows: [],
  assistCost: 2,
  ...over,
});

test("an answer that cannot be rendered is rejected rather than crashing a screen", () => {
  for (const junk of [null, undefined, 42, "hello", [], {}, { summary: "" }, { rows: [] }]) {
    assert.equal(readAnswer(junk), null, `rejected: ${JSON.stringify(junk)}`);
  }
});

test("missing fields become empty, because a screen maps over them", () => {
  const answer = readAnswer({ summary: "Here is a thought." });
  assert.ok(answer);
  assert.deepEqual([answer.tradeoffs, answer.uncertainties, answer.alternatives, answer.rows, answer.operations], [[], [], [], [], []]);
  assert.equal(answer.kind, "question", "nothing to change is conversation");
  assert.equal(answer.assistCost, 0);
});

test("rows and alternatives that are the wrong shape are dropped, not rendered", () => {
  const answer = readAnswer({
    summary: "x",
    operations: [{ kind: "set-ingredient-amount", id: "i3", amount: "1/4" }],
    rows: [null, "nope", { label: "Sugar", before: "1/2 cup", after: "1/4 cup" }, 7],
    alternatives: [{ label: "Only a label" }, { summary: "only a summary" }, { label: "Both", summary: "Here" }],
    tradeoffs: ["kept", "", 12, null],
  });
  assert.ok(answer);
  assert.equal(answer.rows.length, 1);
  assert.deepEqual(answer.rows[0], { kind: "change", label: "Sugar", before: "1/2 cup", after: "1/4 cup", why: "" });
  assert.deepEqual(answer.alternatives, [{ label: "Both", summary: "Here" }]);
  assert.deepEqual(answer.tradeoffs, ["kept"]);
});

test("a question is conversation; an answer carrying changes is not", () => {
  const asked = readAnswer({ summary: "Two ways to go.", question: "Chewier or cakier?" });
  assert.equal(asked?.kind, "question");
  // A server that forgot to say which: read it from what it carries, because
  // showing changes with no way to accept them is the worse failure.
  const carrying = readAnswer({ summary: "x", operations: [{ kind: "remove-ingredient", id: "i3" }] });
  assert.equal(carrying?.kind, "proposal");
});

test("the path names the recipe, escaped", () => {
  assert.equal(helperPath("r1"), "/api/v1/recipes/r1/helper");
  assert.equal(helperPath("a/../b"), "/api/v1/recipes/a%2F..%2Fb/helper");
});

test("a request carries the turns so far, with the new message beside them", () => {
  let conversation = emptyConversation("r1");
  conversation = withQuestion(conversation, "lower the sugar");
  conversation = withAnswer(conversation, proposal());

  const body = helperRequest(conversation, recipe(), "  actually make it gluten-free  ");
  assert.equal(body.message, "actually make it gluten-free", "trimmed");
  assert.deepEqual(body.turns.map((t) => t.role), ["user", "helper"]);
  assert.equal(body.turns[1].text, "I would take the sugar to a quarter cup.", "what the Helper said, not its operations");
  assert.equal(body.recipe.id, "r1", "the device's copy is the one with everything in it");
});

test("asking again clears the proposal that was waiting", () => {
  let conversation = withAnswer(withQuestion(emptyConversation("r1"), "lower the sugar"), proposal());
  assert.ok(conversation.pending, "a proposal waits on the cook");
  conversation = withQuestion(conversation, "and gluten-free");
  assert.equal(conversation.pending, null, "a new question is not an answer to the old proposal");
  assert.equal(conversation.turns.length, 3);
});

test("a question from the Helper leaves nothing to accept", () => {
  const conversation = withAnswer(withQuestion(emptyConversation("r1"), "more moist"), proposal({
    kind: "question", question: "Chewier or cakier?", operations: [],
  }));
  assert.equal(conversation.pending, null);
  assert.match(conversation.turns[1].text, /Chewier or cakier\?/, "the question is part of what it said");
});

test("saying no is recorded, so the same thing is not proposed again", () => {
  const conversation = withRejection(withAnswer(withQuestion(emptyConversation("r1"), "lower the sugar"), proposal()));
  assert.equal(conversation.pending, null);
  assert.equal(conversation.turns.length, 3);
  assert.equal(conversation.turns[2].role, "user");
  assert.match(conversation.turns[2].text, /something else/i);
});

test("asking for an alternative names it", () => {
  assert.equal(
    alternativeMessage({ label: "Keep the sugar, cut the jam", summary: "..." }),
    "Propose that instead: Keep the sugar, cut the jam.",
  );
});

test("the history note is the first sentence, shortened if it has to be", () => {
  assert.equal(historyNote(proposal()), "I would take the sugar to a quarter cup.");
  const long = historyNote(proposal({ summary: "a".repeat(400) }));
  assert.ok(long.length <= 120 && long.endsWith("…"), `shortened: ${long.length}`);
});

test("accepting applies the change and leaves everything else alone", () => {
  const before = recipe();
  const applied = acceptProposal(before, proposal());
  assert.ok(applied.ok, applied.ok ? "" : applied.reason);
  const after = applied.recipe;

  assert.equal(after.sections[0].ingredients[2].amount, "1/4", "the change is applied");
  assert.deepEqual(after.source, before.source, "attribution carried forward");
  assert.equal(after.heroImage, before.heroImage, "the photograph is untouched");
  assert.equal(after.id, "r1");
  assert.equal(after.createdAt, 1000, "created when it was created");
  assert.ok(after.updatedAt > 1000, "changed now");
  assert.equal(after.macros, undefined, "an estimate from the old ingredients is not kept beside the new ones");
});

test("a question cannot be accepted", () => {
  const applied = acceptProposal(recipe(), proposal({ kind: "question", operations: [] }));
  assert.equal(applied.ok, false);
});

test("a proposal whose ids no longer exist is refused at the point of writing", () => {
  // The recipe was edited between the proposal arriving and the cook tapping
  // accept. The server validated against what it was sent; this is the check
  // that cannot be skipped, because it is the one next to the write.
  const edited = recipe();
  edited.sections[0].ingredients = edited.sections[0].ingredients.filter((g) => g.id !== "i3");
  const applied = acceptProposal(edited, proposal());
  assert.equal(applied.ok, false);
  assert.match(applied.ok ? "" : applied.reason, /no longer fits/);
});

test("a proposal that would leave the recipe contradicting itself is refused", () => {
  // Halving the butter total while both steps still claim half a cup each.
  const applied = acceptProposal(recipe(), proposal({
    summary: "Halve the butter.",
    operations: [{ kind: "set-ingredient-amount", id: "i1", amount: "1/2" }],
  }));
  assert.equal(applied.ok, false);
  assert.match(applied.ok ? "" : applied.reason, /contradicting itself/);
});

test("an operation the allowlist does not have is refused here too", () => {
  const applied = acceptProposal(recipe(), proposal({
    operations: [{ kind: "set-field", field: "source", value: "https://evil.example" }],
  }));
  assert.equal(applied.ok, false, "attribution is unreachable on the device as well as on the server");
});

test("an unfinished conversation survives leaving the screen, and not accepting it", () => {
  dropConversation("r1");
  assert.deepEqual(heldConversation("r1"), { recipeId: "r1", turns: [], pending: null });

  const conversation = withAnswer(withQuestion(emptyConversation("r1"), "lower the sugar"), proposal());
  holdConversation(conversation);
  assert.equal(heldConversation("r1").turns.length, 2, "coming back finds the negotiation where it was");
  assert.ok(heldConversation("r1").pending, "including the proposal waiting on a decision");
  assert.equal(heldConversation("r2").turns.length, 0, "and it is this recipe's, not every recipe's");

  dropConversation("r1");
  assert.equal(heldConversation("r1").turns.length, 0, "accepting or leaving for good clears it");

  // An empty conversation is not worth holding, so holding one forgets it.
  holdConversation(emptyConversation("r3"));
  assert.equal(heldConversation("r3").turns.length, 0);
});
