// The one place the Recipe Helper's proposal model is loaded.
//
// Same arrangement as webImport.ts and webShoppingList.ts: a static import so
// the module works under both Metro and `node --test`, and a declared interface
// stating what this app uses of it.
//
// Loading the shared copy rather than reimplementing it is the point. The
// server applies a proposal with this exact code before it validates it, and
// the phone applies it with this exact code before it saves — so "the change
// the cook approved" means one thing rather than two that can drift. ADR 0016
// step 6 is only worth anything if both sides agree on what valid means.
import adjustApi from "../../../../packages/recipe-core/src/recipe-adjust.js";

export type AdjustProposal = {
  summary: string;
  question: string;
  tradeoffs: string[];
  uncertainties: string[];
  alternatives: Array<{ label: string; summary: string }>;
  operations: unknown[];
};

export type AdjustProblem = { code: string; detail?: string };

export type AdjustRow = {
  kind: string; label: string; before: string; after: string; why: string;
};

export type WebAdjust = {
  OPERATIONS: readonly string[];
  SETTABLE_FIELDS: readonly string[];
  readProposal: (raw: unknown, base: unknown) => {
    proposal: AdjustProposal | null;
    problems: AdjustProblem[];
    draft?: AdjustProposal;
  };
  applyProposal: (base: unknown, proposal: AdjustProposal) => {
    recipe: unknown;
    change: { kind: string; added: string[]; removed: string[] };
  };
  describeProposal: (base: unknown, proposal: AdjustProposal) => AdjustRow[];
  checkProposal: (base: unknown, proposal: AdjustProposal) => {
    recipe: unknown;
    change: { kind: string; added: string[]; removed: string[] };
    violations: AdjustProblem[];
  };
  isQuestionOnly: (proposal: AdjustProposal | null) => boolean;
};

const api = adjustApi as unknown as WebAdjust;

export default api;
