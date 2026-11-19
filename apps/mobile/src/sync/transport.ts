// The network half of a sync run.
//
// One job: turn the session's authorized() into the two calls the coordinator
// makes, and turn a failed response into an error the coordinator can classify.
// Nothing decides anything here — if a rule appears in this file it is in the
// wrong file.

import type { PullPage, SyncTransport } from "./coordinator.ts";
import type { RecipeEnvelope } from "./pull.ts";

export type AuthorizedCall = (
  path: string, init?: { method?: string; body?: unknown },
) => Promise<unknown>;

/**
 * An error carrying the HTTP status, because the coordinator asks for it.
 *
 * `isRetryable` distinguishes a server that refused from a server that was not
 * reached, and that distinction is the difference between dropping a change
 * and keeping it. A thrown Error with no status is treated as unreachable,
 * which is the safe direction: the change stays queued.
 */
export class SyncHttpError extends Error {
  status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.name = "SyncHttpError";
    this.status = status;
  }
}

/**
 * Every page of the library view, which is where household recipes live.
 *
 * All of it, not a page: revocation is decided by absence, and absence from
 * one page of several means nothing at all. A device that stopped reading
 * half way would delete every shared recipe below the cut.
 *
 * So a read that cannot finish returns nothing and says so, rather than
 * handing back a partial list that the rules would read as "the rest is gone".
 */
export async function readLibrary(
  authorized: AuthorizedCall, pageSize = 50, maxPages = 100,
): Promise<RecipeEnvelope[]> {
  const all: RecipeEnvelope[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query = "?limit=" + pageSize + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    const body = await authorized("/api/v1/recipes" + query) as {
      recipes?: unknown[]; nextCursor?: string | null;
    };
    const recipes = Array.isArray(body?.recipes) ? body.recipes as RecipeEnvelope[] : [];
    all.push(...recipes);
    cursor = typeof body?.nextCursor === "string" ? body.nextCursor : null;
    if (!cursor) return all;
  }

  throw new SyncHttpError(null, "Your library is larger than RecipeBox expected to read in one go.");
}

export function httpTransport(authorized: AuthorizedCall): SyncTransport {
  return {
    async pull(since, limit) {
      const query = "?since=" + encodeURIComponent(String(since)) + "&limit=" + encodeURIComponent(String(limit));
      const body = await authorized("/api/v1/sync/recipes" + query);
      return normalizePage(body);
    },

    async push(body) {
      const answer = await authorized("/api/v1/sync/recipes", { method: "POST", body }) as {
        applied?: unknown[]; conflicts?: unknown[]; rejected?: unknown[];
        skipped?: unknown[]; revision?: number;
      };
      return {
        applied: asOutcomes(answer?.applied),
        conflicts: asOutcomes(answer?.conflicts),
        rejected: asOutcomes(answer?.rejected),
        skipped: asOutcomes(answer?.skipped),
        revision: Number(answer?.revision ?? 0),
      };
    },
  };
}

/**
 * A page, with every field given a value this device can act on.
 *
 * A malformed page is treated as an empty one rather than as a crash, with two
 * exceptions that must not be guessed at: `revision`, because a wrong
 * watermark skips changes for ever, and `resyncRequired`, because missing it
 * means resurrecting deleted recipes. Both are read strictly.
 */
function normalizePage(body: unknown): PullPage {
  const page = (body ?? {}) as Record<string, unknown>;
  const revision = Number(page.revision);
  if (!Number.isFinite(revision) || revision < 0) {
    throw new SyncHttpError(null, "The server sent a page RecipeBox could not read.");
  }
  return {
    recipes: Array.isArray(page.recipes) ? page.recipes as PullPage["recipes"] : [],
    deletions: Array.isArray(page.deletions) ? page.deletions as PullPage["deletions"] : [],
    revision,
    headRevision: typeof page.headRevision === "number" ? page.headRevision : undefined,
    more: page.more === true,
    resyncRequired: page.resyncRequired === true,
  };
}

function asOutcomes(value: unknown): never[] {
  return (Array.isArray(value) ? value : []) as never[];
}
