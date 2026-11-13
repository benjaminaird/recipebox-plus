// Joining the two halves: the session that can authenticate, and the pull that
// knows what to do with a page.
//
// Thin by design. The rules are in pull.ts and the writing down is in
// syncStore.ts; what is here is the one line that says where the pages come
// from — `session.authorized`, so refreshing an expired access token mid-pull
// is the session manager's business and not this file's.

import { sqlitePullStore } from "../data/syncStore";
import { pullRecipes, type PullResult, type RecipePage } from "./pull.ts";

/** How many recipes per request. Small enough that an interrupted pull loses
 *  little, large enough that a big library is not hundreds of round trips. */
const PAGE_SIZE = 50;

export type SyncProgress = { pages: number; stored: number; updated: number };

export type SyncSession = {
  authorized(path: string, init?: { method?: string; body?: unknown }): Promise<unknown>;
};

export async function syncRecipes(
  session: SyncSession,
  accountId: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<PullResult> {
  return pullRecipes({
    store: sqlitePullStore(),
    accountId,
    onProgress,
    fetchPage: async (cursor) => {
      const query = "?limit=" + PAGE_SIZE + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      return (await session.authorized("/api/v1/recipes" + query)) as RecipePage;
    },
  });
}

/** What the Account screen says about a finished pull. */
export function describeResult(result: PullResult): string {
  if (result.stoppedBy === "network") {
    return result.stored + result.updated > 0
      ? `Stopped — no connection. ${result.stored + result.updated} saved so far; it will carry on from here.`
      : "No connection. Nothing was downloaded, and nothing was lost.";
  }
  if (result.stoppedBy === "server") return "RecipeBox could not finish. Nothing already downloaded was affected.";
  if (result.stoppedBy === "limit") return "Stopped after a lot of pages. Tap again to carry on.";

  const parts: string[] = [];
  if (result.stored) parts.push(`${result.stored} new`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (parts.length === 0) parts.push("nothing new");
  let text = "Up to date — " + parts.join(", ") + ".";
  const skipped = result.skipped.length;
  if (skipped) {
    text += ` ${skipped} ${skipped === 1 ? "recipe was" : "recipes were"} left alone because this phone already has `
      + `${skipped === 1 ? "a recipe" : "recipes"} with the same name on the device.`;
  }
  return text;
}
