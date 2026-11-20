// The Recipe Helper, on the device (ADR 0016).
//
// Three things, all pure, all testable without a network or a screen:
//
//   What a Helper answer IS, read out of an HTTP response that is never
//   trusted to be the shape it should be.
//   What a conversation is, as it grows a turn at a time.
//   What accepting a proposal does to a recipe — which is `applyProposal` from
//   the shared package, not a second implementation of it.
//
// There is no model call in here and no prompt. The device holds neither: a
// provider key on a phone is a key in everyone's hands, and a prompt in the
// app bundle is a prompt whoever holds the phone can replace. The server owns
// both, validates what comes back, and answers with a proposal (see
// docs/native-ai-helper-architecture.md).

import RecipeBoxAdjust from "../domain/webAdjust.ts";
import type { Recipe } from "../data/types.ts";

/** One line of the change, as the review list draws it. */
export type ChangeRow = {
  kind: string;
  label: string;
  before: string;
  after: string;
  why: string;
};

export type Alternative = { label: string; summary: string };

/**
 * What the Helper said.
 *
 * `kind` is the difference that matters to the screen: a question is
 * conversation and has nothing to accept, a proposal is a change waiting on
 * the cook. The server decides which, having validated the second kind.
 */
export type HelperAnswer = {
  kind: "proposal" | "question";
  summary: string;
  question: string;
  tradeoffs: string[];
  uncertainties: string[];
  alternatives: Alternative[];
  operations: unknown[];
  rows: ChangeRow[];
  /** AI Assists this exchange spent. A question spends none. */
  assistCost: number;
};

export type Turn = {
  role: "user" | "helper";
  text: string;
};

/** What a cook's Helper session looks like at any moment. */
export type Conversation = {
  recipeId: string;
  turns: Turn[];
  /** The proposal waiting on a decision, or null. */
  pending: HelperAnswer | null;
};

export function emptyConversation(recipeId: string): Conversation {
  return { recipeId, turns: [], pending: null };
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((s) => s.length > 0) : [];

/**
 * Read a Helper answer out of whatever came back.
 *
 * Checked rather than cast. The response crosses a network from a server that
 * may be a different version than this build, and a screen that renders
 * `answer.rows.map` on a field that happens to be absent crashes in the cook's
 * hand. Everything missing becomes empty; a response with no summary at all is
 * the one thing that cannot be rendered, so it is rejected.
 */
export function readAnswer(payload: unknown): HelperAnswer | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const summary = str(p.summary).trim();
  const question = str(p.question).trim();
  if (!summary && !question) return null;

  const rows: ChangeRow[] = Array.isArray(p.rows)
    ? p.rows
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
      .map((r) => ({
        kind: str(r.kind) || "change",
        label: str(r.label),
        before: str(r.before),
        after: str(r.after),
        why: str(r.why),
      }))
    : [];

  const alternatives: Alternative[] = Array.isArray(p.alternatives)
    ? p.alternatives
      .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
      .map((a) => ({ label: str(a.label), summary: str(a.summary) }))
      .filter((a) => a.label && a.summary)
    : [];

  const operations = Array.isArray(p.operations) ? p.operations : [];
  // The server says which it is; a response that forgot to is read from what
  // it carries, because an answer with changes in it is not conversation.
  const kind = p.kind === "question" || (p.kind !== "proposal" && operations.length === 0)
    ? "question" as const
    : "proposal" as const;

  return {
    kind,
    summary,
    question,
    tradeoffs: strings(p.tradeoffs),
    uncertainties: strings(p.uncertainties),
    alternatives,
    operations,
    rows,
    assistCost: typeof p.assistCost === "number" && p.assistCost > 0 ? p.assistCost : 0,
  };
}

/** The path the Helper lives at. */
export function helperPath(recipeId: string): string {
  return `/api/v1/recipes/${encodeURIComponent(recipeId)}/helper`;
}

/**
 * What goes in the request.
 *
 * The turns travel with it because the server keeps no transcript — a cook's
 * recipe talk is not ours to store — so the conversation lives on the phone
 * and is handed over for the length of one call.
 *
 * `recipe` is the recipe as this device holds it, which is the only complete
 * copy for most recipes: uploads are off by default, so the cloud has nothing
 * to read.
 */
export function helperRequest(conversation: Conversation, recipe: Recipe, message: string): {
  recipe: Recipe; message: string; turns: Turn[];
} {
  return { recipe, message: message.trim(), turns: conversation.turns };
}

/** The cook has said something. */
export function withQuestion(conversation: Conversation, message: string): Conversation {
  const text = message.trim();
  if (!text) return conversation;
  return { ...conversation, turns: [...conversation.turns, { role: "user", text }], pending: null };
}

/**
 * The Helper has answered.
 *
 * The turn recorded is the summary, not the operations: that is what the
 * Helper SAID, and it is what a follow-up turn needs for the next call to make
 * sense. A proposal also waits in `pending` until the cook decides.
 */
export function withAnswer(conversation: Conversation, answer: HelperAnswer): Conversation {
  const said = [answer.summary, answer.question].filter(Boolean).join("\n\n");
  return {
    ...conversation,
    turns: [...conversation.turns, { role: "helper", text: said }],
    pending: answer.kind === "proposal" ? answer : null,
  };
}

/**
 * The cook said no.
 *
 * The rejection is recorded as a turn so the next proposal is not the same
 * one. A Helper told only "no" with nothing in the conversation to show it was
 * told has every reason to propose it again.
 */
export function withRejection(conversation: Conversation): Conversation {
  return {
    ...conversation,
    pending: null,
    turns: [...conversation.turns, { role: "user", text: "No, not that. Suggest something else." }],
  };
}

/** The cook asked for one of the alternatives the Helper offered. */
export function alternativeMessage(alternative: Alternative): string {
  return `Propose that instead: ${alternative.label}.`;
}

/** The first line of a proposal, for the version history's note. */
export function historyNote(answer: HelperAnswer): string {
  const line = answer.summary.split(/(?<=[.!?])\s/)[0] || answer.summary;
  return line.length > 120 ? line.slice(0, 117).trimEnd() + "…" : line;
}

export type AcceptOutcome =
  | { ok: true; recipe: Recipe }
  | { ok: false; reason: string };

/**
 * Apply an accepted proposal to the recipe.
 *
 * Validated again here, on the device, after the server already validated it.
 * Not distrust of the server: the device is the system of record, this is the
 * last point before the recipe is written, and a check at the point of writing
 * is the only one that cannot be skipped by a path nobody thought of. It is
 * the same function on both sides, so agreeing costs nothing and disagreeing
 * is a bug worth finding.
 */
export function acceptProposal(recipe: Recipe, answer: HelperAnswer): AcceptOutcome {
  if (answer.kind !== "proposal" || answer.operations.length === 0) {
    return { ok: false, reason: "There is nothing to apply." };
  }
  // Read the operations through the shared package again rather than trusting
  // them: they arrived over a network, and readProposal is what knows that an
  // id has to exist and a quantity has to be written the way a cook writes it.
  const read = RecipeBoxAdjust.readProposal({ summary: answer.summary, operations: answer.operations }, recipe);
  if (!read.proposal) {
    return { ok: false, reason: "This change no longer fits the recipe. Ask the Helper again." };
  }
  const checked = RecipeBoxAdjust.checkProposal(recipe, read.proposal);
  if (checked.violations.length) {
    return { ok: false, reason: "This change would leave the recipe contradicting itself, so it was not saved." };
  }
  return { ok: true, recipe: { ...(checked.recipe as Recipe), updatedAt: Date.now() } };
}

// ---------------------------------------------------------------------------
// Keeping an unfinished conversation
// ---------------------------------------------------------------------------
//
// A cook who opens Recipe Detail to check an ingredient and comes back should
// not find the conversation gone. It lives for the life of the process, keyed
// by recipe: enough to survive navigation, and deliberately not written to the
// database, because a half-finished negotiation is not a thing the app should
// still be holding next week.

const held = new Map<string, Conversation>();

export function heldConversation(recipeId: string): Conversation {
  return held.get(recipeId) ?? emptyConversation(recipeId);
}

export function holdConversation(conversation: Conversation): void {
  if (conversation.turns.length === 0 && !conversation.pending) held.delete(conversation.recipeId);
  else held.set(conversation.recipeId, conversation);
}

export function dropConversation(recipeId: string): void {
  held.delete(recipeId);
}

/** Starting points, for a cook who has not used it before. */
export const HELPER_PROMPTS: ReadonlyArray<string> = [
  "Make this lower in sugar",
  "Make this gluten-free",
  "Substitute an ingredient",
  "Make it less spicy",
  "What could I use instead of butter?",
];
