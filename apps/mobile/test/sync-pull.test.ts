// Pulling a cloud library, and the four ways it could lose something.
//
// No network and no SQLite: the store is an in-memory one of the same shape,
// so the rules under test are the shipped ones rather than a restatement.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decideWrite, isStorableRecipe, pullRecipes,
  type PullStore, type RecipeEnvelope, type RecipeOrigin, type RecipePage,
} from "../src/sync/pull.ts";
import type { Recipe } from "../src/data/types.ts";

function recipe(id: string, title = "A Recipe"): Recipe {
  return {
    id, title,
    sections: [{ name: "", ingredients: [{ id: "i1", name: "flour", amount: "200", unit: "g" }], steps: [{ id: "s1", text: "Mix." }] }],
  } as unknown as Recipe;
}

function envelope(id: string, over: Partial<RecipeEnvelope> = {}): RecipeEnvelope {
  return {
    recipe: recipe(id),
    serverId: "row-" + id,
    ownerId: "user-alice",
    ownerName: null,
    shared: false,
    updatedAt: "2026-11-01T10:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

function memoryStore(seed: { seeded?: string[]; origins?: RecipeOrigin[] } = {}) {
  const origins = new Map<string, RecipeOrigin>();
  for (const o of seed.origins ?? []) origins.set(o.recipeId, o);
  const written: { id: string; accountId: string }[] = [];
  const cursors = new Map<string, string | null>();
  const lastSynced = new Map<string, string>();
  const store: PullStore & {
    written: typeof written; origins: typeof origins;
    cursors: typeof cursors; lastSynced: typeof lastSynced;
  } = {
    written, origins, cursors, lastSynced,
    async seededIds() { return seed.seeded ?? []; },
    async getOrigin(id) { return origins.get(id) ?? null; },
    async putCloudRecipe({ envelope: e, accountId }) {
      written.push({ id: e.recipe.id, accountId });
      origins.set(e.recipe.id, {
        recipeId: e.recipe.id, origin: "cloud", accountId,
        ownerId: e.ownerId, shared: e.shared, serverUpdatedAt: e.updatedAt, pulledAt: "now",
      });
    },
    async getCursor(accountId) { return cursors.get(accountId) ?? null; },
    async setCursor(accountId, cursor) { cursors.set(accountId, cursor); },
    async setLastSyncedAt(accountId, syncedAt) { lastSynced.set(accountId, syncedAt); },
  };
  return store;
}

function pager(pages: RecipePage[]) {
  const asked: (string | null)[] = [];
  return {
    asked,
    fetchPage: async (cursor: string | null) => {
      asked.push(cursor);
      const page = pages[asked.length - 1];
      if (!page) throw new Error("asked for a page the test did not script");
      return page;
    },
  };
}

const LOCAL: RecipeOrigin = { recipeId: "mine", origin: "local", accountId: null, ownerId: null, shared: false, serverUpdatedAt: null, pulledAt: null };
const SAMPLE: RecipeOrigin = { recipeId: "lemon-posset", origin: "sample", accountId: null, ownerId: null, shared: false, serverUpdatedAt: null, pulledAt: null };

// ---------------------------------------------------------------------------
// The decision that can lose a recipe
// ---------------------------------------------------------------------------

test("a pull never writes over a recipe the cook made on this phone", () => {
  const d = decideWrite(LOCAL, new Set(), "user-alice");
  assert.equal(d.write, false);
  assert.equal(d.reason, "local-collision");
});

test("a pull never writes over a seeded sample, or turns one into a cloud recipe", () => {
  const d = decideWrite(SAMPLE, new Set(["lemon-posset"]), "user-alice");
  assert.equal(d.write, false);
  assert.equal(d.reason, "sample-collision");
});

test("a recipe already pulled from this account is updated in place", () => {
  const existing: RecipeOrigin = { recipeId: "r1", origin: "cloud", accountId: "user-alice", ownerId: "user-alice", shared: false, serverUpdatedAt: "old", pulledAt: "old" };
  const d = decideWrite(existing, new Set(), "user-alice");
  assert.equal(d.write, true);
  assert.equal(d.update, true, "an update, not a second copy");
});

test("a cloud recipe belonging to another account is refused", () => {
  const existing: RecipeOrigin = { recipeId: "r1", origin: "cloud", accountId: "user-bob", ownerId: "user-bob", shared: false, serverUpdatedAt: null, pulledAt: null };
  const d = decideWrite(existing, new Set(), "user-alice");
  assert.equal(d.write, false);
  assert.equal(d.reason, "other-account");
});

test("an id nothing is using is simply stored", () => {
  assert.deepEqual(decideWrite(null, new Set(), "user-alice"), { write: true, update: false });
});

test("a recipe the server sends in a shape we cannot store is rejected, not guessed at", () => {
  assert.equal(isStorableRecipe(recipe("r1")), true);
  assert.equal(isStorableRecipe({ id: "r1", title: "No sections", sections: [] }), false);
  assert.equal(isStorableRecipe({ id: "", title: "x", sections: [{}] }), false);
  assert.equal(isStorableRecipe({ title: "no id", sections: [{}] }), false);
  assert.equal(isStorableRecipe(null), false);
  assert.equal(isStorableRecipe("a recipe"), false);
});

// ---------------------------------------------------------------------------
// The pull
// ---------------------------------------------------------------------------

test("an empty library pulls a whole collection, one page after another", async () => {
  const store = memoryStore();
  const { fetchPage, asked } = pager([
    { recipes: [envelope("r1"), envelope("r2")], nextCursor: "c1", syncedAt: "2026-11-13T00:00:00.000Z" },
    { recipes: [envelope("r3")], nextCursor: null, syncedAt: "2026-11-13T00:00:01.000Z" },
  ]);

  const result = await pullRecipes({ store, accountId: "user-alice", fetchPage });
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.equal(result.stored, 3);
  assert.equal(result.updated, 0);
  assert.deepEqual(asked, [null, "c1"], "it followed the cursor rather than guessing offsets");
  assert.deepEqual(store.written.map((w) => w.id), ["r1", "r2", "r3"]);
  assert.equal(store.lastSynced.get("user-alice"), "2026-11-13T00:00:01.000Z");
  assert.equal(await store.getCursor("user-alice"), null, "and finished with no cursor to resume from");
});

test("pulling twice updates in place and makes no duplicates", async () => {
  const store = memoryStore();
  const first = pager([{ recipes: [envelope("r1"), envelope("r2")], nextCursor: null, syncedAt: "t1" }]);
  await pullRecipes({ store, accountId: "user-alice", fetchPage: first.fetchPage });

  const second = pager([{ recipes: [envelope("r1"), envelope("r2")], nextCursor: null, syncedAt: "t2" }]);
  const again = await pullRecipes({ store, accountId: "user-alice", fetchPage: second.fetchPage });

  assert.equal(again.stored, 0, "nothing new");
  assert.equal(again.updated, 2, "both updated in place");
  assert.equal(store.origins.size, 2, "and the library still holds two recipes");
});

test("an interrupted pull resumes from the page it reached, not from the start", async () => {
  const store = memoryStore();
  const dropped = Object.assign(new Error("offline"), { name: "AuthNetworkError" });

  let call = 0;
  const firstRun = await pullRecipes({
    store, accountId: "user-alice",
    fetchPage: async (cursor) => {
      call += 1;
      if (call === 1) return { recipes: [envelope("r1")], nextCursor: "c1", syncedAt: "t1" };
      throw dropped;
    },
  });
  assert.equal(firstRun.complete, false);
  assert.equal(firstRun.stoppedBy, "network");
  assert.equal(firstRun.stored, 1);
  assert.equal(await store.getCursor("user-alice"), "c1", "the cursor survived the interruption");

  const resumed = pager([{ recipes: [envelope("r2")], nextCursor: null, syncedAt: "t2" }]);
  const second = await pullRecipes({ store, accountId: "user-alice", fetchPage: resumed.fetchPage });
  assert.deepEqual(resumed.asked, ["c1"], "it asked for the page it had not had");
  assert.equal(second.complete, true);
  assert.equal(store.origins.size, 2, "and nothing was pulled twice");
});

test("a server error stops the pull without losing what was already stored", async () => {
  const store = memoryStore();
  let call = 0;
  const result = await pullRecipes({
    store, accountId: "user-alice",
    fetchPage: async () => {
      call += 1;
      if (call === 1) return { recipes: [envelope("r1")], nextCursor: "c1", syncedAt: "t1" };
      throw Object.assign(new Error("boom"), { name: "AuthApiError" });
    },
  });
  assert.equal(result.stoppedBy, "server");
  assert.equal(result.stored, 1, "the first page is still here");
  assert.equal(result.complete, false);
});

test("local recipes and samples survive a pull that collides with them", async () => {
  const store = memoryStore({ seeded: ["lemon-posset"], origins: [LOCAL, SAMPLE] });
  const { fetchPage } = pager([{
    recipes: [envelope("mine", { recipe: recipe("mine", "Cloud version") }), envelope("lemon-posset"), envelope("r9")],
    nextCursor: null, syncedAt: "t1",
  }]);

  const result = await pullRecipes({ store, accountId: "user-alice", fetchPage });
  assert.equal(result.stored, 1, "only the recipe with a free id was stored");
  assert.deepEqual(store.written.map((w) => w.id), ["r9"]);
  assert.deepEqual(
    result.skipped.map((s) => [s.recipeId, s.reason]),
    [["mine", "local-collision"], ["lemon-posset", "sample-collision"]],
    "and the other two are reported rather than silently dropped",
  );
  assert.equal(store.origins.get("mine")!.origin, "local", "the local recipe is still local");
  assert.equal(store.origins.get("lemon-posset")!.origin, "sample", "and the sample is still a sample");
});

test("a sample whose provenance row is missing is still treated as a sample", async () => {
  // Provenance can be rebuilt; the seeded list is the authority on samples.
  const store = memoryStore({ seeded: ["lemon-posset"] });
  const { fetchPage } = pager([{ recipes: [envelope("lemon-posset")], nextCursor: null, syncedAt: "t1" }]);
  const result = await pullRecipes({ store, accountId: "user-alice", fetchPage });
  assert.equal(result.stored, 0);
  assert.equal(result.skipped[0].reason, "sample-collision");
});

test("a household recipe keeps its owner, so it is never mistaken for the cook's own", async () => {
  const store = memoryStore();
  const { fetchPage } = pager([{
    recipes: [envelope("shared-1", { ownerId: "user-bob", ownerName: "Bob", shared: true })],
    nextCursor: null, syncedAt: "t1",
  }]);
  await pullRecipes({ store, accountId: "user-alice", fetchPage });
  const origin = store.origins.get("shared-1")!;
  assert.equal(origin.ownerId, "user-bob");
  assert.equal(origin.shared, true);
  assert.equal(origin.accountId, "user-alice", "pulled by Alice, owned by Bob");
});

test("a malformed recipe is skipped and named, not stored and not fatal", async () => {
  const store = memoryStore();
  const { fetchPage } = pager([{
    recipes: [
      { ...envelope("bad"), recipe: { id: "bad", title: "No sections", sections: [] } as unknown as Recipe },
      envelope("good"),
    ],
    nextCursor: null, syncedAt: "t1",
  }]);
  const result = await pullRecipes({ store, accountId: "user-alice", fetchPage });
  assert.equal(result.stored, 1, "the good one still arrives");
  assert.deepEqual(result.skipped.map((s) => s.reason), ["invalid"]);
});

test("a server that never stops paging is cut off rather than looped on forever", async () => {
  const store = memoryStore();
  let n = 0;
  const result = await pullRecipes({
    store, accountId: "user-alice", maxPages: 3,
    fetchPage: async () => { n += 1; return { recipes: [envelope("r" + n)], nextCursor: "c" + n, syncedAt: "t" }; },
  });
  assert.equal(result.pages, 3);
  assert.equal(result.stoppedBy, "limit");
  assert.equal(result.complete, false);
});

test("progress is reported per page, so a long pull can be shown", async () => {
  const store = memoryStore();
  const seen: number[] = [];
  const { fetchPage } = pager([
    { recipes: [envelope("r1")], nextCursor: "c1", syncedAt: "t1" },
    { recipes: [envelope("r2")], nextCursor: null, syncedAt: "t2" },
  ]);
  await pullRecipes({ store, accountId: "user-alice", fetchPage, onProgress: (p) => seen.push(p.stored) });
  assert.deepEqual(seen, [1, 2]);
});
