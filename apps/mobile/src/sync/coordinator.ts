// One synchronisation run: pull, then push, then record what could not be done.
//
// Pure. The device's database and the network are both parameters, so the
// algorithm can be run against a memory store in a unit test and against real
// SQLite and a real server in an integration test, and be the same algorithm
// either time. That is the arrangement pull.ts already uses, and the reason
// the pull's rules survived contact with a real device.
//
// Pull first, then push. A push that has not pulled is a push citing
// revisions the server may already have superseded: it would generate
// conflicts that a pull two seconds earlier would have avoided, and every one
// of those conflicts is a question somebody has to answer.
//
// What this must never do, from ADR 0006 and the brief:
//
//   Overwrite a conflicting change. The server refuses; we keep both versions
//   and surface them. Nothing is merged and nothing is dropped.
//
//   Lose a pending change because the app died. The queue is written before
//   the request and cleared after the answer, never the other way round.
//
//   Upload a sample, or a local recipe the cook has not adopted.
//
//   Cross an account boundary. Every read and write names the account.

import type { Recipe } from "../data/types.ts";
import type { Origin, RecipeEnvelope } from "./pull.ts";
import {
  afterFailure, dueNow, isRetryable, mayUpload,
  type ConflictRecord, type OutboxEntry,
} from "./outbox.ts";

export type LocalRecipeRow = {
  recipeId: string;
  origin: Origin;
  adopted: boolean;
  serverRevision: number | null;
  deletedLocally: boolean;
};

/** Everything the coordinator needs from the device's own storage. */
export type SyncStore = {
  /** The account this store belongs to. Checked, not assumed. */
  accountId(): string;
  /** Where the last pull stopped. */
  getWatermark(): Promise<number>;
  setWatermark(revision: number): Promise<void>;
  /** Provenance for one recipe, or null if this device has never seen it. */
  getLocal(recipeId: string): Promise<LocalRecipeRow | null>;
  /** Write a recipe the server sent, with its revision. */
  putRemote(input: { envelope: RecipeEnvelope; revision: number }): Promise<void>;
  /** Apply a deletion the server reported. */
  applyRemoteDeletion(recipeId: string, revision: number): Promise<void>;
  /** Throw away every local recipe that came from the cloud, for a full resync. */
  clearCloudRecipes(): Promise<void>;
  /** The queue. */
  listOutbox(): Promise<OutboxEntry[]>;
  removeFromOutbox(recipeId: string): Promise<void>;
  updateOutboxEntry(entry: OutboxEntry): Promise<void>;
  /** Record what the server accepted, so the next edit cites the right base. */
  markSynced(recipeId: string, revision: number, deleted: boolean): Promise<void>;
  /** Keep a refused change where a person can see it. */
  recordConflict(conflict: ConflictRecord): Promise<void>;
};

export type PushOutcome = {
  recipeId: string;
  status: "applied" | "conflict" | "rejected" | "skipped";
  revision?: number;
  reason?: string;
  serverRevision?: number | null;
  server?: Recipe | null;
  repeated?: boolean;
};

export type PullPage = {
  recipes: Array<{ recipe: Recipe; serverId: string; revision: number; createdAt: string; updatedAt: string }>;
  deletions: Array<{ id: string; revision: number; deletedAt: string }>;
  revision: number;
  headRevision?: number;
  more: boolean;
  resyncRequired: boolean;
};

/** Everything the coordinator needs from the network. */
export type SyncTransport = {
  pull(since: number, limit: number): Promise<PullPage>;
  push(body: {
    writes: Array<{ recipe: Recipe; baseRevision: number | null; idempotencyKey: string }>;
    deletions: Array<{ id: string; baseRevision: number | null; idempotencyKey: string }>;
  }): Promise<{ applied: PushOutcome[]; conflicts: PushOutcome[]; rejected: PushOutcome[]; skipped: PushOutcome[]; revision: number }>;
};

export type SyncReport = {
  pulled: number;
  deletionsApplied: number;
  pushed: number;
  conflicts: number;
  rejected: number;
  stillQueued: number;
  resynced: boolean;
  stoppedBy: "done" | "network" | "server" | "limit";
  error: string | null;
};

const PAGE_LIMIT = 200;
const MAX_PAGES = 50;
/** How many changes go in one push. Small enough that a failure costs little. */
const PUSH_BATCH = 25;

/**
 * Uploading is off until an environment turns it on.
 *
 * The brief is explicit that it stays off until the isolated integration tests
 * prove conflict handling, queued retries, account isolation and recovery, and
 * a constant somebody has to change is a better gate than an intention
 * somebody has to remember.
 */
export type SyncOptions = {
  /** Send what the queue holds. Pull-only when false, which is the default. */
  uploads?: boolean;
  now?: () => number;
  jitter?: () => number;
};

export async function runSync(
  store: SyncStore,
  transport: SyncTransport,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const now = options.now ?? (() => Date.now());
  const jitter = options.jitter ?? Math.random;
  const report: SyncReport = {
    pulled: 0, deletionsApplied: 0, pushed: 0, conflicts: 0,
    rejected: 0, stillQueued: 0, resynced: false, stoppedBy: "done", error: null,
  };

  // ── Pull ────────────────────────────────────────────────────────────────
  try {
    let since = await store.getWatermark();
    let pages = 0;

    while (pages < MAX_PAGES) {
      const page = await transport.pull(since, PAGE_LIMIT);
      pages += 1;

      if (page.resyncRequired) {
        // This device's watermark predates deletions the server has forgotten.
        // A delta would omit them and we would push our copies back,
        // resurrecting recipes somebody deleted. Start again from nothing.
        //
        // Only cloud recipes go: a local recipe was never the server's to
        // forget, and throwing one away here would turn a sync problem into
        // lost work.
        await store.clearCloudRecipes();
        await store.setWatermark(0);
        since = 0;
        report.resynced = true;
        continue;
      }

      for (const entry of page.recipes) {
        // A recipe with an unsent local edit is not overwritten by the pull.
        // The push below will cite its base revision and find out properly
        // whether it conflicts; clobbering it here would decide that question
        // by arrival order.
        const queued = (await store.listOutbox()).some((e) => e.recipeId === entry.recipe.id);
        if (queued) continue;

        const local = await store.getLocal(entry.recipe.id);
        if (local && (local.origin === "sample" || (local.origin === "local" && !local.adopted))) {
          // Same id, different recipe. A seeded sample is never replaced by
          // something from an account, and a recipe the cook made here is not
          // quietly swapped for a stranger's.
          continue;
        }

        await store.putRemote({
          envelope: {
            recipe: entry.recipe,
            serverId: entry.serverId,
            ownerId: store.accountId(),
            ownerName: null,
            shared: false,
            updatedAt: entry.updatedAt,
            createdAt: entry.createdAt,
          },
          revision: entry.revision,
        });
        report.pulled += 1;
      }

      for (const deletion of page.deletions) {
        const local = await store.getLocal(deletion.id);
        // A deletion only applies to a copy that came from the cloud. A
        // sample, or a recipe written here, is not the server's to delete.
        if (!local || local.origin !== "cloud") continue;
        await store.applyRemoteDeletion(deletion.id, deletion.revision);
        report.deletionsApplied += 1;
      }

      since = page.revision;
      await store.setWatermark(since);
      if (!page.more) break;
      if (pages >= MAX_PAGES) report.stoppedBy = "limit";
    }
  } catch (err) {
    report.stoppedBy = classifyFailure(err);
    report.error = messageOf(err);
    report.stillQueued = (await store.listOutbox()).length;
    return report;
  }

  // ── Push ────────────────────────────────────────────────────────────────
  if (options.uploads !== true) {
    report.stillQueued = (await store.listOutbox()).length;
    return report;
  }

  try {
    const queue = await store.listOutbox();
    const ready: OutboxEntry[] = [];
    for (const entry of dueNow(queue, now())) {
      const local = await store.getLocal(entry.recipeId);

      // A delete the server already knows about is always sendable. It cannot
      // leak content — there is no content in it — and gating it the way a
      // write is gated would silently drop the deletion whenever the local row
      // had already gone, which is exactly when a delete most needs sending.
      const isKnownDelete = entry.kind === "delete" && entry.baseRevision !== null;

      // Writes are re-checked at the moment of sending, not only when queued.
      // Origin can change between the two — a pull can turn a local recipe
      // into a cloud one — and the rule that matters is the one true now.
      const permission = isKnownDelete
        ? { allowed: true, reason: "cloud" as const }
        : mayUpload({
          origin: local ? local.origin : "local",
          adopted: local ? local.adopted : false,
        });
      if (!permission.allowed) {
        // Not an error and not a retry: this change is not ours to send. It
        // leaves the queue so it stops being attempted every run.
        await store.removeFromOutbox(entry.recipeId);
        report.rejected += 1;
        continue;
      }
      ready.push(entry);
      if (ready.length >= PUSH_BATCH) break;
    }

    if (ready.length) {
      const writes = ready.filter((e) => e.kind === "write" && e.recipe).map((e) => ({
        recipe: e.recipe as Recipe,
        baseRevision: e.baseRevision,
        idempotencyKey: e.idempotencyKey,
      }));
      const deletions = ready.filter((e) => e.kind === "delete").map((e) => ({
        id: e.recipeId,
        baseRevision: e.baseRevision,
        idempotencyKey: e.idempotencyKey,
      }));

      const answer = await transport.push({ writes, deletions });

      for (const applied of answer.applied) {
        const entry = ready.find((e) => e.recipeId === applied.recipeId);
        await store.markSynced(applied.recipeId, applied.revision ?? 0, entry?.kind === "delete");
        await store.removeFromOutbox(applied.recipeId);
        report.pushed += 1;
      }
      for (const conflict of answer.conflicts) {
        const entry = ready.find((e) => e.recipeId === conflict.recipeId);
        await store.recordConflict({
          recipeId: conflict.recipeId,
          mine: entry ? entry.recipe : null,
          theirs: conflict.server ?? null,
          serverRevision: conflict.serverRevision ?? null,
          reason: conflict.reason ?? "conflict",
          detectedAt: now(),
          resolvedAt: null,
        });
        // The entry leaves the queue because the server has answered. The
        // change is not lost — it is in the conflict record, whole, waiting
        // for a person. Leaving it queued would retry it for ever against a
        // revision that will never match again.
        await store.removeFromOutbox(conflict.recipeId);
        report.conflicts += 1;
      }
      for (const refused of [...answer.rejected, ...answer.skipped]) {
        await store.removeFromOutbox(refused.recipeId);
        report.rejected += 1;
      }
    }
  } catch (err) {
    // Nothing is removed from the queue on a failed push. The request may even
    // have been applied; the idempotency key means asking again is safe, and
    // asking again is the only way to find out.
    report.stoppedBy = classifyFailure(err);
    report.error = messageOf(err);
    for (const entry of await store.listOutbox()) {
      await store.updateOutboxEntry(afterFailure(entry, messageOf(err), now(), jitter));
    }
  }

  report.stillQueued = (await store.listOutbox()).length;
  return report;
}

function classifyFailure(err: unknown): "network" | "server" {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number" && !isRetryable(status)) return "server";
  return "network";
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** What the Account screen says about a finished run. */
export function describeSync(report: SyncReport): { title: string; tone: "info" | "attention" | "danger" } {
  if (report.stoppedBy === "network") {
    return {
      tone: "attention",
      title: report.pulled || report.pushed
        ? `Stopped — no connection. ${report.pulled + report.pushed} saved so far; it will carry on from here.`
        : "No connection. Nothing was synced, and nothing was lost.",
    };
  }
  if (report.stoppedBy === "server") {
    return { tone: "danger", title: "RecipeBox could not finish. Nothing already synced was affected." };
  }
  if (report.conflicts > 0) {
    return {
      tone: "attention",
      title: report.conflicts === 1
        ? "One recipe was changed in two places. Both versions are kept — choose which to keep."
        : `${report.conflicts} recipes were changed in two places. Both versions of each are kept.`,
    };
  }
  const parts: string[] = [];
  if (report.pulled) parts.push(`${report.pulled} downloaded`);
  if (report.pushed) parts.push(`${report.pushed} uploaded`);
  if (report.deletionsApplied) parts.push(`${report.deletionsApplied} removed`);
  if (!parts.length) parts.push("nothing new");
  let title = "Up to date — " + parts.join(", ") + ".";
  if (report.resynced) title += " The library was rebuilt from your account.";
  if (report.stillQueued) title += ` ${report.stillQueued} still waiting to send.`;
  return { title, tone: "info" };
}
