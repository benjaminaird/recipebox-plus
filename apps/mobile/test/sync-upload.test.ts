// The upload decisions, tested before anything can make them.
//
// Nothing calls this code yet. The point of testing it now is that these are
// the judgements that lose a cookbook if they are wrong, and they are far
// cheaper to argue with here than against somebody's real recipes.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  UPLOAD_ENABLED, assertUploadEnabled, classifyChange, idempotencyKey,
  orderForUpload, planFirstUpload, planReconciliation, resolveConflict, retryDelayMs,
  type LocalRecipeState, type ServerRecipeState,
} from "../src/sync/upload.ts";

function local(over: Partial<LocalRecipeState> = {}): LocalRecipeState {
  return {
    recipeId: "r1", title: "A Recipe", origin: "cloud",
    dirty: false, deletedLocally: false, baseRevision: 3, ...over,
  };
}
const server = (revision: number, deleted = false): ServerRecipeState => ({ recipeId: "r1", revision, deleted });

// ---------------------------------------------------------------------------
// It is not on
// ---------------------------------------------------------------------------

test("upload is off, and says what is missing rather than quietly doing nothing", () => {
  assert.equal(UPLOAD_ENABLED, false);
  assert.throws(() => assertUploadEnabled(), /not enabled.*revision column.*write endpoint/s);
});

test("nothing in the app imports the upload path", async () => {
  // The strongest statement that it is not enabled: no code path reaches it.
  // When upload is switched on, this test is the thing that has to be
  // deliberately changed, which is the point.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("../src/", import.meta.url).pathname;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      if (full.endsWith("/sync/upload.ts")) continue;
      if (/from\s+"[^"]*upload\.ts"/.test(readFileSync(full, "utf8"))) offenders.push(full.slice(root.length));
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], "these import the upload path: " + offenders.join(", "));
});

// ---------------------------------------------------------------------------
// First contact
// ---------------------------------------------------------------------------

test("a seeded sample is never uploaded, with or without consent", () => {
  assert.deepEqual(planReconciliation(local({ origin: "sample" })), { kind: "never", reason: "sample" });

  const samples = [local({ recipeId: "lemon-posset", origin: "sample" })];
  const chosen = new Set(["lemon-posset"]); // even if somebody ticks it
  const plan = planFirstUpload(samples, chosen);
  assert.deepEqual(plan.upload, [], "consent does not override it");
  assert.deepEqual(plan.refused, ["lemon-posset"]);
  assert.deepEqual(plan.offered, [], "and it is never even offered");
});

test("the first upload sends nothing by default", () => {
  const locals = [local({ recipeId: "a", origin: "local" }), local({ recipeId: "b", origin: "local" })];
  const plan = planFirstUpload(locals, new Set());
  assert.deepEqual(plan.upload, [], "signing in is not a request to publish what is on the phone");
  assert.deepEqual(plan.offered, ["a", "b"], "but the cook is shown what could go");
});

test("only what was chosen is sent", () => {
  const locals = [local({ recipeId: "a", origin: "local" }), local({ recipeId: "b", origin: "local" })];
  assert.deepEqual(planFirstUpload(locals, new Set(["b"])).upload, ["b"]);
});

test("a recipe already pulled from the account is not re-offered", () => {
  const plan = planFirstUpload([local({ recipeId: "c", origin: "cloud" })], new Set(["c"]));
  assert.deepEqual(plan.offered, []);
  assert.deepEqual(plan.upload, []);
});

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

test("an untouched recipe is not sent at all", () => {
  assert.deepEqual(classifyChange(local(), server(3)), { kind: "skip", reason: "not-dirty" });
});

test("an edit on the revision the server still has is a plain send", () => {
  assert.deepEqual(classifyChange(local({ dirty: true, baseRevision: 3 }), server(3)), { kind: "send", reason: "unchanged-base" });
});

test("an edit on a revision the server has moved past is a conflict, not an overwrite", () => {
  const outcome = classifyChange(local({ dirty: true, baseRevision: 3 }), server(4));
  assert.deepEqual(outcome, { kind: "conflict", reason: "server-moved" });
});

test("a recipe this device never synced, edited here, is a conflict rather than a create", () => {
  // Sending it would overwrite a version nobody on this phone has seen.
  const outcome = classifyChange(local({ dirty: true, baseRevision: null }), server(7));
  assert.deepEqual(outcome, { kind: "conflict", reason: "server-moved" });
});

test("a recipe the server has never seen is a create", () => {
  assert.deepEqual(classifyChange(local({ dirty: true, baseRevision: null }), null), { kind: "send", reason: "new" });
});

test("an edit beats a delete, in both directions", () => {
  const editedHere = classifyChange(local({ dirty: true, baseRevision: 3 }), server(3, true));
  assert.deepEqual(editedHere, { kind: "conflict", reason: "edited-here-deleted-there" });
  assert.deepEqual(resolveConflict(editedHere), { winner: "local", preserveLoser: true, notify: true });

  const deletedHere = classifyChange(local({ deletedLocally: true, baseRevision: 3 }), server(5));
  assert.deepEqual(deletedHere, { kind: "conflict", reason: "deleted-here-edited-there" });
  assert.deepEqual(resolveConflict(deletedHere), { winner: "server", preserveLoser: true, notify: true });
});

test("a delete on both sides is simply done", () => {
  assert.deepEqual(
    classifyChange(local({ deletedLocally: true, baseRevision: 3 }), server(3, true)),
    { kind: "skip", reason: "already-deleted-both" },
  );
});

test("no conflict is ever resolved by merging, and none is resolved silently", () => {
  for (const outcome of [
    classifyChange(local({ dirty: true, baseRevision: 3 }), server(9)),
    classifyChange(local({ dirty: true, baseRevision: 3 }), server(3, true)),
    classifyChange(local({ deletedLocally: true, baseRevision: 3 }), server(9)),
  ]) {
    const resolution = resolveConflict(outcome)!;
    assert.ok(resolution, "every conflict has a resolution");
    assert.equal(resolution.preserveLoser, true, "the losing version is always kept");
    assert.equal(resolution.notify, true, "and the cook is always told");
    assert.ok(resolution.winner === "local" || resolution.winner === "server", "one version wins whole; nothing is merged");
  }
});

test("a non-conflict has nothing to resolve", () => {
  assert.equal(resolveConflict({ kind: "send", reason: "new" }), null);
  assert.equal(resolveConflict({ kind: "skip", reason: "not-dirty" }), null);
});

// ---------------------------------------------------------------------------
// Sending it safely
// ---------------------------------------------------------------------------

test("a retry of the same change carries the same key; a new edit does not", () => {
  const base = { deviceId: "d1", recipeId: "r1", baseRevision: 3, contentHash: "abc" };
  assert.equal(idempotencyKey(base), idempotencyKey({ ...base }), "a retry is recognisable");
  assert.notEqual(idempotencyKey(base), idempotencyKey({ ...base, contentHash: "def" }), "a changed recipe is not");
  assert.notEqual(idempotencyKey(base), idempotencyKey({ ...base, baseRevision: 4 }), "nor is the same text on a new base");
  assert.notEqual(idempotencyKey(base), idempotencyKey({ ...base, deviceId: "d2" }), "nor the same edit from another device");
  assert.ok(idempotencyKey({ ...base, baseRevision: null }).includes("new"), "a create is marked as one");
});

test("creates go before updates, and deletes go last", () => {
  const ordered = orderForUpload([
    local({ recipeId: "del", deletedLocally: true, baseRevision: 2 }),
    local({ recipeId: "upd", dirty: true, baseRevision: 2 }),
    local({ recipeId: "new", dirty: true, baseRevision: null }),
  ]);
  assert.deepEqual(ordered.map((c) => c.recipeId), ["new", "upd", "del"]);
});

test("retry backs off and is capped", () => {
  assert.equal(retryDelayMs(0, () => 0), 500);
  assert.equal(retryDelayMs(3, () => 0), 4000);
  assert.equal(retryDelayMs(20, () => 0), 150_000, "capped at five minutes, halved by the lowest jitter");
  assert.ok(retryDelayMs(2, () => 1) > retryDelayMs(2, () => 0), "and jittered");
});
