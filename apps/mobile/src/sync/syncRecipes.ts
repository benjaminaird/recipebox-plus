// Joining the two halves: the session that can authenticate, and the pull that
// knows what to do with a page.
//
// Thin by design. The rules are in pull.ts and the writing down is in
// syncStore.ts; what is here is the one line that says where the pages come
// from — `session.authorized`, so refreshing an expired access token mid-pull
// is the session manager's business and not this file's.

import { sqlitePullStore } from "../data/syncStore";
import { pullRecipes, type PullResult, type RecipePage } from "./pull.ts";
import type { Message } from "../auth/messages.ts";

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
  /** The local library this account may write to; the pull refuses any other. */
  expectedStore?: string,
): Promise<PullResult> {
  return pullRecipes({
    store: sqlitePullStore(expectedStore),
    accountId,
    onProgress,
    fetchPage: async (cursor) => {
      const query = "?limit=" + PAGE_SIZE + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      return (await session.authorized("/api/v1/recipes" + query)) as RecipePage;
    },
  });
}

/**
 * What the Account screen says about a finished pull, and how it should look.
 *
 * The tone travels with the words. A pull that stopped is not a pull that
 * worked, and drawing the two the same way told the cook their library had
 * downloaded when it had not.
 */
export function describeResult(result: PullResult): Message {
  if (result.stoppedBy === "network") {
    return {
      tone: "attention",
      title: result.stored + result.updated > 0
        ? `Stopped — no connection. ${result.stored + result.updated} saved so far; it will carry on from here.`
        : "No connection. Nothing was downloaded, and nothing was lost.",
    };
  }
  if (result.stoppedBy === "server") {
    return { tone: "danger", title: "RecipeBox could not finish. Nothing already downloaded was affected." };
  }
  if (result.stoppedBy === "limit") {
    return { tone: "attention", title: "Stopped after a lot of pages. Tap again to carry on." };
  }

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
  return { tone: "info", title: text };
}
