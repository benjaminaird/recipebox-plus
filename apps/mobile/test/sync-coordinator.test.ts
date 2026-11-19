// Bidirectional sync, as rules rather than as plumbing.
//
// No SQLite and no network: the store and the transport are both parameters,
// so what runs here is the shipped algorithm rather than a restatement of it.
// The SQLite store and the real server are exercised separately, by
// scripts/native-bidirectional-test.mjs.
//
// The six things this has to get right are the six the brief names, and each
// has a section below.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  backoffMs, dueNow, enqueue, mayUpload, resolve, stalled, unresolved,
  afterFailure, isRetryable, MAX_AUTOMATIC_ATTEMPTS,
  type ConflictRecord, type OutboxEntry,
} from "../src/sync/outbox.ts";
import {
  describeSync, runSync,
  type LocalRecipeRow, type PullPage, type PushOutcome, type SyncStore, type SyncTransport,
} from "../src/sync/coordinator.ts";
import type { Recipe } from "../src/data/types.ts";
import type { Origin } from "../src/sync/pull.ts";

function recipe(id: string, title = "A Recipe"): Recipe {
  return {
    id, title,
    sections: [{ name: "", ingredients: [{ id: "i1", name: "flour", amount: "200", unit: "g" }], steps: [{ id: "s1", text: "Mix." }] }],
  } as unknown as Recipe;
}

/**
 * A store of the same shape as the real one.
 *
 * Deliberately a plain object: the point is that the coordinator cannot tell
 * the difference, so the rules it follows here are the rules it follows on a
 * phone.
 */
function memoryStore(accountId = "acct-1") {
  const local = new Map<string, LocalRecipeRow>();
  const recipes = new Map<string, Recipe>();
  let outbox: OutboxEntry[] = [];
  const conflicts: ConflictRecord[] = [];
  let watermark = 0;
  const deletionsApplied: string[] = [];
  let cloudCleared = 0;

  const store: SyncStore & {
    _local: typeof local; _recipes: typeof recipes; _conflicts: typeof conflicts;
    _outbox: () => OutboxEntry[]; _setOutbox: (q: OutboxEntry[]) => void;
    _deletions: string[]; _cloudCleared: () => number; _watermark: () => number;
  } = {
    accountId: () => accountId,
    getWatermark: async () => watermark,
    setWatermark: async (r) => { watermark = r; },
    getLocal: async (id) => local.get(id) ?? null,
    putRemote: async ({ envelope, revision }) => {
      recipes.set(envelope.recipe.id, envelope.recipe);
      local.set(envelope.recipe.id, {
        recipeId: envelope.recipe.id, origin: "cloud", adopted: true,
        serverRevision: revision, deletedLocally: false,
      });
    },
    applyRemoteDeletion: async (id, revision) => {
      deletionsApplied.push(id);
      const row = local.get(id);
      if (row) local.set(id, { ...row, deletedLocally: true, serverRevision: revision });
    },
    clearCloudRecipes: async () => {
      cloudCleared += 1;
      for (const [id, row] of local) if (row.origin === "cloud") { local.delete(id); recipes.delete(id); }
    },
    listOutbox: async () => outbox.slice(),
    removeFromOutbox: async (id) => { outbox = outbox.filter((e) => e.recipeId !== id); },
    updateOutboxEntry: async (entry) => {
      outbox = outbox.map((e) => (e.recipeId === entry.recipeId ? entry : e));
    },
    markSynced: async (id, revision, deleted) => {
      const row = local.get(id);
      if (row) local.set(id, { ...row, serverRevision: revision, deletedLocally: deleted });
    },
    recordConflict: async (c) => { conflicts.push(c); },
    _local: local, _recipes: recipes, _conflicts: conflicts,
    _outbox: () => outbox, _setOutbox: (q) => { outbox = q; },
    _deletions: deletionsApplied, _cloudCleared: () => cloudCleared, _watermark: () => watermark,
  };
  return store;
}

function entry(over: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    recipeId: "r1", kind: "write", baseRevision: 1, idempotencyKey: "k1",
    recipe: recipe("r1"), attempts: 0, nextAttemptAt: 0, queuedAt: 100, lastError: null,
    ...over,
  };
}

function transport(over: Partial<SyncTransport> = {}): SyncTransport {
  return {
    pull: async () => ({ recipes: [], deletions: [], revision: 0, more: false, resyncRequired: false }),
    push: async () => ({ applied: [], conflicts: [], rejected: [], skipped: [], revision: 0 }),
    ...over,
  };
}

const page = (over: Partial<PullPage> = {}): PullPage => ({
  recipes: [], deletions: [], revision: 0, more: false, resyncRequired: false, ...over,
});

// ---------------------------------------------------------------------------
// 1. A conflict is never an overwrite, and both versions survive
// ---------------------------------------------------------------------------

test("a refused change is kept whole, with the version that beat it", async () => {
  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  store._setOutbox([entry({ recipe: recipe("r1", "Mine") })]);

  const report = await runSync(store, transport({
    push: async () => ({
      applied: [], rejected: [], skipped: [], revision: 4,
      conflicts: [{
        recipeId: "r1", status: "conflict", reason: "server-moved",
        serverRevision: 4, server: recipe("r1", "Theirs"),
      } as PushOutcome],
    }),
  }), { uploads: true });

  assert.equal(report.conflicts, 1);
  assert.equal(store._conflicts.length, 1);
  assert.equal(store._conflicts[0].mine?.title, "Mine", "what this phone wanted is kept");
  assert.equal(store._conflicts[0].theirs?.title, "Theirs", "and so is what the account holds");
  assert.equal(store._conflicts[0].serverRevision, 4);
  assert.equal(store._conflicts[0].resolvedAt, null, "waiting on a person");
});

test("a conflict leaves the queue, so it is not retried against a revision that can never match", async () => {
  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  store._setOutbox([entry()]);
  await runSync(store, transport({
    push: async () => ({
      applied: [], rejected: [], skipped: [], revision: 4,
      conflicts: [{ recipeId: "r1", status: "conflict", serverRevision: 4, server: recipe("r1", "Theirs") } as PushOutcome],
    }),
  }), { uploads: true });
  assert.equal(store._outbox().length, 0, "out of the queue");
  assert.equal(store._conflicts.length, 1, "but not out of existence");
});

test("keeping my version re-sends it against the revision that beat it", () => {
  const conflict: ConflictRecord = {
    recipeId: "r1", kind: "write", mine: recipe("r1", "Mine"), theirs: recipe("r1", "Theirs"),
    serverRevision: 7, reason: "server-moved", detectedAt: 1, resolvedAt: null,
  };
  const kept = resolve(conflict, "keep-mine", 2);
  assert.equal(kept.conflict.resolvedAt, 2);
  assert.equal(kept.enqueue?.baseRevision, 7, "cited against what the server actually holds, not forced");
  assert.equal(kept.enqueue?.recipe.title, "Mine");

  const theirs = resolve(conflict, "keep-theirs", 3);
  assert.equal(theirs.enqueue, null, "keeping theirs sends nothing");
  assert.equal(theirs.conflict.mine?.title, "Mine", "and still does not throw mine away");
});

test("keeping both makes a recipe of its own, and asks for an id to do it", () => {
  const conflict: ConflictRecord = {
    recipeId: "r1", kind: "write", mine: recipe("r1", "Mine"), theirs: recipe("r1", "Theirs"),
    serverRevision: 7, reason: "server-moved", detectedAt: 1, resolvedAt: null,
  };

  const both = resolve(conflict, "keep-both", 2, "r1-copy");
  assert.equal(both.create?.id, "r1-copy");
  assert.equal(both.create?.title, "Mine (my version)", "nameable on a shelf beside the other");
  // A create, not a write over the account's copy: the whole point of the
  // choice is that the account's version is left exactly as it is.
  assert.equal(both.enqueue?.recipeId, "r1-copy");
  assert.equal(both.enqueue?.baseRevision, null);
  assert.equal(both.conflict.theirs?.title, "Theirs", "and theirs is untouched");

  // Inventing identity silently is how two taps become two recipes. It is the
  // caller's to supply, and refusing is better than guessing.
  assert.throws(() => resolve(conflict, "keep-both", 2), /needs an id/);
});

test("a conflict with nothing of mine in it resolves to nothing, whatever is chosen", () => {
  // A delete that conflicted carries no recipe body. Every choice has to be
  // harmless, and in particular "keep both" must not try to make a copy of
  // something that is not there.
  const empty: ConflictRecord = {
    recipeId: "r1", kind: "write", mine: null, theirs: recipe("r1", "Theirs"),
    serverRevision: 3, reason: "x", detectedAt: 1, resolvedAt: null,
  };
  for (const choice of ["keep-mine", "keep-theirs", "keep-both"] as const) {
    const out = resolve(empty, choice, 9, "r1-copy");
    assert.equal(out.enqueue, null, choice);
    assert.equal(out.create, null, choice);
    assert.equal(out.conflict.resolvedAt, 9, choice);
  }
});

test("unresolved conflicts are the ones a person still has to answer", () => {
  const base: ConflictRecord = {
    recipeId: "r1", kind: "write", mine: null, theirs: null, serverRevision: 1,
    reason: "x", detectedAt: 1, resolvedAt: null,
  };
  const list = [base, { ...base, recipeId: "r2", resolvedAt: 5 }];
  assert.deepEqual(unresolved(list).map((c) => c.recipeId), ["r1"]);
});

test("a pull does not overwrite a recipe with an unsent local edit", async () => {
  // Arrival order must not decide a conflict. The push finds out properly.
  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  store._recipes.set("r1", recipe("r1", "My unsent edit"));
  store._setOutbox([entry({ recipe: recipe("r1", "My unsent edit") })]);

  await runSync(store, transport({
    pull: async () => page({
      recipes: [{ recipe: recipe("r1", "Server version"), serverId: "s1", revision: 9, createdAt: "", updatedAt: "" }],
      revision: 9,
    }),
  }));

  assert.equal(store._recipes.get("r1")?.title, "My unsent edit", "the local edit stands until the push decides");
});

// ---------------------------------------------------------------------------
// 2. Pending changes survive termination, restart, network loss and failure
// ---------------------------------------------------------------------------

test("a network failure keeps every queued change", async () => {
  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  store._setOutbox([entry()]);

  const report = await runSync(store, transport({
    push: async () => { throw new Error("network down"); },
  }), { uploads: true, now: () => 1000, jitter: () => 0.5 });

  assert.equal(report.stoppedBy, "network");
  assert.equal(report.stillQueued, 1, "the change is still owed");
  assert.equal(store._outbox()[0].attempts, 1, "and knows it has failed once");
  assert.ok(store._outbox()[0].nextAttemptAt > 1000, "and when to try again");
  assert.equal(store._outbox()[0].recipe?.title, "A Recipe", "with the edit intact");
});

test("a failed pull leaves the queue completely untouched", async () => {
  const store = memoryStore();
  store._setOutbox([entry()]);
  const report = await runSync(store, transport({
    pull: async () => { throw new Error("offline"); },
  }), { uploads: true });
  assert.equal(report.stillQueued, 1);
  assert.equal(store._outbox()[0].attempts, 0, "a pull failure is not a push failure");
});

test("the queue survives a restart, because it is only state", async () => {
  // "Survives termination" means the queue is data, not something held in a
  // closure. Round-tripping it through JSON is what a restart does to it.
  const before = [entry({ attempts: 2, lastError: "timeout", nextAttemptAt: 5000 })];
  const after: OutboxEntry[] = JSON.parse(JSON.stringify(before));
  assert.deepEqual(after, before, "nothing in an entry is unserialisable");

  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  store._setOutbox(after);
  const report = await runSync(store, transport({
    push: async (body) => {
      assert.equal(body.writes[0].idempotencyKey, "k1", "the retry carries the original key");
      assert.equal(body.writes[0].baseRevision, 1, "and the original base revision");
      return { applied: [{ recipeId: "r1", status: "applied", revision: 2 }], conflicts: [], rejected: [], skipped: [], revision: 2 };
    },
  }), { uploads: true, now: () => 9999 });
  assert.equal(report.pushed, 1);
  assert.equal(store._outbox().length, 0, "and clears once the server has answered");
});

test("five edits to one recipe are one upload, against the base the server agreed with", () => {
  let queue: OutboxEntry[] = [];
  queue = enqueue(queue, { recipeId: "r1", kind: "write", recipe: recipe("r1", "v1"), baseRevision: 3, idempotencyKey: "a", now: 1 });
  for (const [i, title] of ["v2", "v3", "v4", "v5"].entries()) {
    queue = enqueue(queue, {
      recipeId: "r1", kind: "write", recipe: recipe("r1", title),
      baseRevision: 3, idempotencyKey: "k" + i, now: 10 + i,
    });
  }
  assert.equal(queue.length, 1, "one recipe owed, not five");
  assert.equal(queue[0].recipe?.title, "v5", "the latest content");
  assert.equal(queue[0].baseRevision, 3, "against the revision the server last agreed with");
  assert.equal(queue[0].queuedAt, 1, "and ordered by when the cook first changed it");
});

test("deleting something that was never sent simply removes it from the queue", () => {
  let queue = enqueue([], { recipeId: "r1", kind: "write", recipe: recipe("r1"), baseRevision: null, idempotencyKey: "a", now: 1 });
  queue = enqueue(queue, { recipeId: "r1", kind: "delete", recipe: null, baseRevision: null, idempotencyKey: "b", now: 2 });
  assert.equal(queue.length, 0, "the server never heard of it, so there is nothing to tell it");
});

test("a delete replaces a pending write rather than following it", () => {
  let queue = enqueue([], { recipeId: "r1", kind: "write", recipe: recipe("r1"), baseRevision: 4, idempotencyKey: "a", now: 1 });
  queue = enqueue(queue, { recipeId: "r1", kind: "delete", recipe: null, baseRevision: 4, idempotencyKey: "b", now: 2 });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, "delete", "sending the write first would resurrect what was thrown away");
});

test("sending order is creates, then updates, then deletes, oldest first", () => {
  const q = [
    entry({ recipeId: "d1", kind: "delete", baseRevision: 2, queuedAt: 1 }),
    entry({ recipeId: "u1", kind: "write", baseRevision: 5, queuedAt: 2 }),
    entry({ recipeId: "c1", kind: "write", baseRevision: null, queuedAt: 3 }),
    entry({ recipeId: "c2", kind: "write", baseRevision: null, queuedAt: 1 }),
  ];
  assert.deepEqual(dueNow(q, 100).map((e) => e.recipeId), ["c2", "c1", "u1", "d1"]);
});

test("backoff grows, is capped, and is jittered", () => {
  assert.equal(backoffMs(1, () => 0.5), 1000);
  assert.equal(backoffMs(2, () => 0.5), 2000);
  assert.equal(backoffMs(3, () => 0.5), 4000);
  assert.equal(backoffMs(99, () => 0.5), 5 * 60 * 1000, "capped");
  assert.notEqual(backoffMs(3, () => 0), backoffMs(3, () => 1), "and jittered, so phones do not arrive in lockstep");
});

test("a change that keeps failing stops being retried but is never discarded", () => {
  let e = entry();
  for (let i = 0; i < MAX_AUTOMATIC_ATTEMPTS; i += 1) e = afterFailure(e, "boom", 0, () => 0.5);
  assert.equal(dueNow([e], Number.MAX_SAFE_INTEGER).length, 0, "no longer retried on a timer");
  assert.equal(stalled([e]).length, 1, "but surfaced for a person");
  assert.equal(e.recipe?.title, "A Recipe", "with the edit still in it");
});

test("a server rejection is not retryable; an outage is", () => {
  assert.equal(isRetryable(null), true, "no response at all");
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(408), true);
  assert.equal(isRetryable(409), false, "a decision, not an outage");
  assert.equal(isRetryable(400), false);
});

// ---------------------------------------------------------------------------
// 3. Deletion and restoration
// ---------------------------------------------------------------------------

test("a deletion the server reports is applied to a cloud copy", async () => {
  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  const report = await runSync(store, transport({
    pull: async () => page({ deletions: [{ id: "r1", revision: 6, deletedAt: "" }], revision: 6 }),
  }));
  assert.equal(report.deletionsApplied, 1);
  assert.equal(store._local.get("r1")?.deletedLocally, true);
});

test("a deletion never reaches a sample or a recipe written on this phone", async () => {
  const store = memoryStore();
  store._local.set("s1", { recipeId: "s1", origin: "sample", adopted: false, serverRevision: null, deletedLocally: false });
  store._local.set("l1", { recipeId: "l1", origin: "local", adopted: false, serverRevision: null, deletedLocally: false });
  const report = await runSync(store, transport({
    pull: async () => page({
      deletions: [{ id: "s1", revision: 2, deletedAt: "" }, { id: "l1", revision: 3, deletedAt: "" }],
      revision: 3,
    }),
  }));
  assert.equal(report.deletionsApplied, 0, "neither was the server's to delete");
  assert.equal(store._local.get("s1")?.deletedLocally, false);
  assert.equal(store._local.get("l1")?.deletedLocally, false);
});

test("an accepted delete clears the queue and records the revision", async () => {
  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 2, deletedLocally: false });
  store._setOutbox([entry({ kind: "delete", recipe: null, baseRevision: 2 })]);
  const report = await runSync(store, transport({
    push: async () => ({
      applied: [{ recipeId: "r1", status: "applied", revision: 3 }], conflicts: [], rejected: [], skipped: [], revision: 3,
    }),
  }), { uploads: true });
  assert.equal(report.pushed, 1);
  assert.equal(store._local.get("r1")?.deletedLocally, true);
  assert.equal(store._local.get("r1")?.serverRevision, 3);
  assert.equal(store._outbox().length, 0);
});

// ---------------------------------------------------------------------------
// 4. Samples and un-adopted local recipes are never uploaded
// ---------------------------------------------------------------------------

test("a sample is never uploadable, adopted or not", () => {
  assert.equal(mayUpload({ origin: "sample" }).allowed, false);
  assert.equal(mayUpload({ origin: "sample", adopted: true }).allowed, false,
    "not even if something claims the cook adopted it: every install has these ids");
});

test("a recipe made on this phone uploads only once the cook has said so", () => {
  assert.equal(mayUpload({ origin: "local" }).allowed, false);
  assert.equal(mayUpload({ origin: "local", adopted: false }).allowed, false);
  assert.equal(mayUpload({ origin: "local", adopted: true }).allowed, true);
  assert.equal(mayUpload({ origin: "cloud" }).allowed, true, "something pulled from the account goes back to it");
});

test("the rule is enforced when sending, not only when queueing", async () => {
  // Origin can change between the two, and the rule that matters is the one
  // true at the moment of sending.
  const store = memoryStore();
  store._local.set("s1", { recipeId: "s1", origin: "sample", adopted: false, serverRevision: null, deletedLocally: false });
  store._setOutbox([entry({ recipeId: "s1", recipe: recipe("s1", "A sample somebody queued") })]);

  let pushed = false;
  const report = await runSync(store, transport({
    push: async () => { pushed = true; return { applied: [], conflicts: [], rejected: [], skipped: [], revision: 0 }; },
  }), { uploads: true });

  assert.equal(pushed, false, "nothing was sent at all");
  assert.equal(report.rejected, 1);
  assert.equal(store._outbox().length, 0, "and it stops being attempted every run");
});

test("a pull never replaces a sample or an un-adopted local recipe", async () => {
  const store = memoryStore();
  store._local.set("s1", { recipeId: "s1", origin: "sample", adopted: false, serverRevision: null, deletedLocally: false });
  store._recipes.set("s1", recipe("s1", "The seeded one"));
  const report = await runSync(store, transport({
    pull: async () => page({
      recipes: [{ recipe: recipe("s1", "A stranger's recipe with the same id"), serverId: "x", revision: 2, createdAt: "", updatedAt: "" }],
      revision: 2,
    }),
  }));
  assert.equal(report.pulled, 0);
  assert.equal(store._recipes.get("s1")?.title, "The seeded one");
});

// ---------------------------------------------------------------------------
// 5. Uploads are off unless asked for
// ---------------------------------------------------------------------------

test("by default a run pulls and sends nothing", async () => {
  const store = memoryStore();
  store._local.set("r1", { recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  store._setOutbox([entry()]);
  let pushed = false;
  const report = await runSync(store, transport({
    push: async () => { pushed = true; return { applied: [], conflicts: [], rejected: [], skipped: [], revision: 0 }; },
  }));
  assert.equal(pushed, false, "uploads are opt-in");
  assert.equal(report.stillQueued, 1, "and the queue is not touched by a pull-only run");
});

// ---------------------------------------------------------------------------
// 6. Recovery from an interrupted or impossible sync
// ---------------------------------------------------------------------------

test("a watermark the server can no longer serve rebuilds the library", async () => {
  const store = memoryStore();
  store._local.set("c1", { recipeId: "c1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false });
  store._recipes.set("c1", recipe("c1"));
  store._local.set("l1", { recipeId: "l1", origin: "local", adopted: false, serverRevision: null, deletedLocally: false });
  store._recipes.set("l1", recipe("l1", "Written here"));
  await store.setWatermark(5);

  let call = 0;
  const report = await runSync(store, transport({
    pull: async () => {
      call += 1;
      if (call === 1) return page({ resyncRequired: true });
      return page({
        recipes: [{ recipe: recipe("c1", "From the account"), serverId: "s", revision: 2, createdAt: "", updatedAt: "" }],
        revision: 2,
      });
    },
  }));

  assert.equal(report.resynced, true);
  assert.equal(store._cloudCleared(), 1);
  assert.equal(store._recipes.get("l1")?.title, "Written here",
    "a recipe written here was never the server's to forget, and is not thrown away");
  assert.equal(store._recipes.get("c1")?.title, "From the account", "and the cloud half is rebuilt");
});

test("a pull resumes from where it stopped rather than starting again", async () => {
  const store = memoryStore();
  const seen: number[] = [];
  await runSync(store, transport({
    pull: async (since) => {
      seen.push(since);
      if (since === 0) {
        return page({
          recipes: [{ recipe: recipe("a"), serverId: "1", revision: 3, createdAt: "", updatedAt: "" }],
          revision: 3, more: true,
        });
      }
      return page({
        recipes: [{ recipe: recipe("b"), serverId: "2", revision: 7, createdAt: "", updatedAt: "" }],
        revision: 7,
      });
    },
  }));
  assert.deepEqual(seen, [0, 3], "the second page asks for what follows the first");
  assert.equal(store._watermark(), 7);
});

test("an interrupted pull keeps the ground it covered", async () => {
  const store = memoryStore();
  let call = 0;
  const report = await runSync(store, transport({
    pull: async () => {
      call += 1;
      if (call === 1) {
        return page({
          recipes: [{ recipe: recipe("a"), serverId: "1", revision: 4, createdAt: "", updatedAt: "" }],
          revision: 4, more: true,
        });
      }
      throw new Error("connection lost");
    },
  }));
  assert.equal(report.stoppedBy, "network");
  assert.equal(report.pulled, 1, "the first page is kept");
  assert.equal(store._watermark(), 4, "and the next run carries on from it");
});

// ---------------------------------------------------------------------------
// What the cook is told
// ---------------------------------------------------------------------------

test("a conflict is reported as a choice, not as a failure", () => {
  const one = describeSync({
    pulled: 0, deletionsApplied: 0, pushed: 0, conflicts: 1, rejected: 0,
    stillQueued: 0, resynced: false, stoppedBy: "done", error: null,
  });
  assert.equal(one.tone, "attention");
  assert.match(one.title, /both versions are kept/i);
  assert.match(one.title, /choose/i);
});

test("a lost connection says nothing was lost, in the tone of a warning", () => {
  const out = describeSync({
    pulled: 0, deletionsApplied: 0, pushed: 0, conflicts: 0, rejected: 0,
    stillQueued: 2, resynced: false, stoppedBy: "network", error: "down",
  });
  assert.equal(out.tone, "attention");
  assert.match(out.title, /nothing was synced, and nothing was lost/i);
});

test("a successful run says what it did, and what is still waiting", () => {
  const out = describeSync({
    pulled: 3, deletionsApplied: 1, pushed: 2, conflicts: 0, rejected: 0,
    stillQueued: 1, resynced: false, stoppedBy: "done", error: null,
  });
  assert.equal(out.tone, "info");
  assert.match(out.title, /3 downloaded/);
  assert.match(out.title, /2 uploaded/);
  assert.match(out.title, /1 removed/);
  assert.match(out.title, /1 still waiting to send/);
});

test("a recipe held back during a pull is not lost once the queue clears", async () => {
  // The defect this protects against was found by running the app, not the
  // tests. A recipe with a queued change is skipped by the pull — correctly,
  // because the push decides whether it conflicts — but the watermark used to
  // advance past it anyway. The next pull then asked for changes AFTER a
  // revision it had never applied, so the server never mentioned that recipe
  // again: the phone kept its own version for ever, silently diverged from
  // the account, and no amount of syncing put it right.
  const store = memoryStore("alice");
  store._local.set("r1", {
    recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false,
  });
  store._recipes.set("r1", recipe("r1", "Mine, unsent"));
  store._setOutbox([entry({ recipeId: "r1", baseRevision: 1 })]);

  const held = {
    recipes: [{
      recipe: recipe("r1", "Theirs"), serverId: "s1", revision: 5,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }],
    deletions: [], revision: 5, more: false, resyncRequired: false,
  };

  // First run: the recipe is held back, and so is the watermark.
  let report = await runSync(store, transport({ pull: async () => held }));
  assert.equal(report.pulled, 0, "not overwritten while this device owes a change");
  assert.equal(store._watermark(), 4, "and the watermark stops short of it");
  assert.equal(store._recipes.get("r1")?.title, "Mine, unsent");

  // The queue clears — the change was sent, or resolved as a conflict.
  store._setOutbox([]);

  // Second run: the server offers it again, because the watermark never
  // claimed to have seen it, and now it is applied.
  report = await runSync(store, transport({ pull: async () => held }));
  assert.equal(report.pulled, 1);
  assert.equal(store._recipes.get("r1")?.title, "Theirs");
  assert.equal(store._watermark(), 5);
});

test("holding the watermark back ends the pull rather than asking for ever", async () => {
  // Holding the watermark and carrying on would re-fetch the same page, which
  // the watermark no longer moves past: the loop would run to its page limit
  // every single sync. Stopping is right -- the push is what clears the queue
  // that caused the hold.
  const store = memoryStore("alice");
  store._local.set("r1", {
    recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 1, deletedLocally: false,
  });
  store._setOutbox([entry({ recipeId: "r1", baseRevision: 1 })]);

  let calls = 0;
  await runSync(store, transport({
    pull: async () => {
      calls += 1;
      return {
        recipes: [{
          recipe: recipe("r1", "Theirs"), serverId: "s1", revision: 5,
          createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
        }],
        deletions: [], revision: 5, more: true, resyncRequired: false,
      };
    },
  }));
  assert.equal(calls, 1, "one page, then stop");
});

test("a refused deletion is a question a cook can actually answer", () => {
  // Found by deleting a recipe on a simulator. A deletion carries no recipe
  // body, so the conflict record's `mine` is null -- and resolve() used to
  // return early on that, making every choice a no-op. The cook was told the
  // conflict was settled and the recipe stayed exactly where it was.
  const deletion: ConflictRecord = {
    recipeId: "r1", kind: "delete", mine: null, theirs: recipe("r1", "Changed since"),
    serverRevision: 9, reason: "revision_mismatch", detectedAt: 1, resolvedAt: null,
  };

  // "Delete it anyway" re-issues the deletion against the revision the
  // account actually holds -- an answer to "somebody changed this since you
  // deleted it", not a forced removal.
  const anyway = resolve(deletion, "keep-mine", 2);
  assert.equal(anyway.enqueue?.kind, "delete");
  assert.equal(anyway.enqueue?.baseRevision, 9);
  assert.equal(anyway.enqueue?.recipe, null, "there is no body in a deletion");
  assert.equal(anyway.conflict.resolvedAt, 2);

  // "Keep it after all" sends nothing; the caller takes it out of the Trash.
  const kept = resolve(deletion, "keep-theirs", 2);
  assert.equal(kept.enqueue, null);
  assert.equal(kept.create, null);

  // And there is no second version of a deleted recipe to keep.
  assert.throws(() => resolve(deletion, "keep-both", 2, "r1-copy"), /no second version/);
});

test("the conflict record says what this device was trying to do", async () => {
  // Without the kind, a refused deletion is indistinguishable from a write
  // whose body happens to be missing, and the screen asks the wrong question.
  const store = memoryStore("alice");
  store._setOutbox([entry({ recipeId: "r1", kind: "delete", recipe: null, baseRevision: 2 })]);

  await runSync(store, transport({
    push: async () => ({
      applied: [], rejected: [], skipped: [], revision: 9,
      conflicts: [{
        recipeId: "r1", status: "conflict", serverRevision: 9,
        server: recipe("r1", "Changed since"),
      } as PushOutcome],
    }),
  }), { uploads: true });

  assert.equal(store._conflicts.length, 1);
  assert.equal(store._conflicts[0].kind, "delete");
  assert.equal(store._conflicts[0].mine, null);
  assert.equal(store._conflicts[0].theirs?.title, "Changed since");
});
