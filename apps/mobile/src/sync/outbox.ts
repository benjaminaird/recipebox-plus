// The queue of changes this phone owes the server.
//
// Pure. No SQLite, no network, no React Native.
//
// The queue exists because the alternative is "try to upload when you save,
// and if it fails, shrug". A cook edits a recipe on a train, the app is killed
// by the OS to reclaim memory, and the edit has to still be there — and still
// be *owed* — when the phone next has signal. Anything less makes local-first
// a slogan.
//
// Three properties shape the design:
//
//   An entry is a promise to send something, not a record that something was
//   sent. It survives termination because it is written before the request is
//   made, and removed only when the server has said what happened.
//
//   One entry per recipe. A cook who edits the same recipe five times offline
//   owes the server one recipe, not five; replaying intermediate states would
//   generate four conflicts nobody caused and show them a history of edits
//   they made to themselves.
//
//   A retry carries the same idempotency key. A push that timed out may well
//   have been applied, and the only way to find out without guessing is to ask
//   again with the same key.

import type { Recipe } from "../data/types.ts";
import type { Origin } from "./pull.ts";

/** What a pending change is. */
export type OutboxEntry = {
  /** The recipe's own id, stable across devices. */
  recipeId: string;
  kind: "write" | "delete";
  /** The server revision this change was made against. Null for a create. */
  baseRevision: number | null;
  /** The same across retries of the same change; different for a new one. */
  idempotencyKey: string;
  /** The recipe as it should become. Null for a delete. */
  recipe: Recipe | null;
  /** How many times sending this has failed. */
  attempts: number;
  /** Earliest time worth trying again, as epoch milliseconds. */
  nextAttemptAt: number;
  /** When the change was made, for ordering. */
  queuedAt: number;
  /** The last thing that went wrong, for a person to read. */
  lastError: string | null;
};

/**
 * How many failures before a change stops being retried automatically.
 *
 * It is not discarded — nothing here ever discards a cook's edit. It stops
 * being retried on a timer and starts being something the interface has to
 * mention, because a change that has failed this many times is failing for a
 * reason no amount of waiting will fix.
 */
export const MAX_AUTOMATIC_ATTEMPTS = 8;

/** 1s, 2s, 4s … capped at five minutes, so a failing push does not hammer. */
export function backoffMs(attempts: number, jitter: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempts - 1), 5 * 60 * 1000);
  // Jitter so a hundred phones coming back onto wifi together do not arrive
  // in lockstep.
  return Math.round(base * (0.75 + jitter() * 0.5));
}

/**
 * Whether a recipe may be sent at all.
 *
 * Samples never, under any circumstances: every install ships them with the
 * same ids, so uploading one means two phones claiming the same recipe. A
 * local recipe only once the cook has said so — signing in is not a request to
 * publish everything on the phone into an account, and the irreversible
 * direction is the one that adds.
 */
export function mayUpload(input: {
  origin: Origin;
  /** The cook explicitly chose to put this local recipe in their account. */
  adopted?: boolean;
}): { allowed: boolean; reason: "sample" | "not-adopted" | "cloud" | "adopted" } {
  if (input.origin === "sample") return { allowed: false, reason: "sample" };
  if (input.origin === "cloud") return { allowed: true, reason: "cloud" };
  if (input.adopted === true) return { allowed: true, reason: "adopted" };
  return { allowed: false, reason: "not-adopted" };
}

/**
 * Fold a new change into the queue.
 *
 * Replacing rather than appending is what keeps "five edits offline" into one
 * upload. The base revision kept is the *earliest* one still pending, because
 * that is the version the server last agreed with — using the latest would
 * claim this device had seen a revision it never pulled.
 *
 * A delete swallows a pending write: sending the write first would resurrect
 * content the cook has already thrown away, and then delete it, which is two
 * revisions and one wrong answer in between.
 */
export function enqueue(queue: readonly OutboxEntry[], change: {
  recipeId: string;
  kind: "write" | "delete";
  recipe: Recipe | null;
  baseRevision: number | null;
  idempotencyKey: string;
  now: number;
}): OutboxEntry[] {
  const existing = queue.find((e) => e.recipeId === change.recipeId);
  const rest = queue.filter((e) => e.recipeId !== change.recipeId);

  // A create that has not been sent, then deleted: the server never heard of
  // it, so there is nothing to tell it. The entry simply goes away.
  if (change.kind === "delete" && existing && existing.baseRevision === null) {
    return rest;
  }

  const entry: OutboxEntry = {
    recipeId: change.recipeId,
    kind: change.kind,
    recipe: change.kind === "delete" ? null : change.recipe,
    baseRevision: existing ? existing.baseRevision : change.baseRevision,
    idempotencyKey: change.idempotencyKey,
    // A new edit is a new change: it has not failed, so it is not waiting.
    attempts: 0,
    nextAttemptAt: 0,
    queuedAt: existing ? existing.queuedAt : change.now,
    lastError: null,
  };
  return [...rest, entry];
}

/**
 * What to send now.
 *
 * Creates before updates before deletes, and oldest first within each. A
 * delete sent before the create it depends on is a delete of nothing; an
 * update before its create is a conflict that did not need to happen.
 */
export function dueNow(queue: readonly OutboxEntry[], now: number): OutboxEntry[] {
  const rank = (e: OutboxEntry): number => {
    if (e.kind === "delete") return 2;
    return e.baseRevision === null ? 0 : 1;
  };
  return queue
    .filter((e) => e.nextAttemptAt <= now && e.attempts < MAX_AUTOMATIC_ATTEMPTS)
    .sort((a, b) => rank(a) - rank(b) || a.queuedAt - b.queuedAt);
}

/** Entries that have stopped retrying and need a person to look. */
export function stalled(queue: readonly OutboxEntry[]): OutboxEntry[] {
  return queue.filter((e) => e.attempts >= MAX_AUTOMATIC_ATTEMPTS);
}

/** A send failed. The change stays; only when to try again changes. */
export function afterFailure(
  entry: OutboxEntry,
  error: string,
  now: number,
  jitter: () => number = Math.random,
): OutboxEntry {
  const attempts = entry.attempts + 1;
  return {
    ...entry,
    attempts,
    lastError: error,
    nextAttemptAt: now + backoffMs(attempts, jitter),
  };
}

/**
 * A network failure is not a rejection.
 *
 * The distinction matters: a server that said "conflict" has made a decision
 * and the entry should leave the queue for the conflict store. A server that
 * could not be reached has decided nothing, and the change is still owed.
 */
export function isRetryable(status: number | null): boolean {
  if (status === null) return true;            // no response at all
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/**
 * A change the server refused, kept whole.
 *
 * Both versions are here on purpose. ADR 0006 forbids merging and forbids
 * silently discarding, which leaves exactly one honest option: keep both and
 * let a person choose. `mine` is what this phone wanted; `theirs` is what the
 * account holds.
 */
export type ConflictRecord = {
  recipeId: string;
  mine: Recipe | null;
  theirs: Recipe | null;
  serverRevision: number | null;
  reason: string;
  detectedAt: number;
  resolvedAt: number | null;
};

export type ConflictChoice = "keep-mine" | "keep-theirs";

/**
 * What resolving a conflict does.
 *
 * Keeping mine is a fresh write against the revision that beat it — not a
 * forced overwrite, just an edit made with current information, which is what
 * the cook would have done had they pulled first. Keeping theirs discards
 * nothing either: the losing version is already in this record, and the server
 * keeps its own history.
 */
export function resolve(conflict: ConflictRecord, choice: ConflictChoice, now: number): {
  conflict: ConflictRecord;
  enqueue: { recipeId: string; kind: "write"; recipe: Recipe; baseRevision: number | null } | null;
} {
  const resolved = { ...conflict, resolvedAt: now };
  if (choice === "keep-theirs" || !conflict.mine) return { conflict: resolved, enqueue: null };
  return {
    conflict: resolved,
    enqueue: {
      recipeId: conflict.recipeId,
      kind: "write",
      recipe: conflict.mine,
      baseRevision: conflict.serverRevision,
    },
  };
}

/** Conflicts still waiting on a person. */
export function unresolved(conflicts: readonly ConflictRecord[]): ConflictRecord[] {
  return conflicts.filter((c) => c.resolvedAt === null);
}
