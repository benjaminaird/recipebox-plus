// Fetching a recipe page for import.
//
// The server fetches, the device reads. `/api/v1/import/fetch` returns the
// page's HTML and this hands it to the same extractor the web app uses
// (`src/domain/webImport.ts` → `packages/recipe-core`), so there is one
// implementation of what a recipe says and the review screen can re-read the
// page it already has without another round trip.
//
// Nothing here saves or uploads anything. It returns a page.

import { AuthApiError, AuthNetworkError } from "../auth/types.ts";
import type { Message } from "../auth/messages.ts";

export type FetchedPage = {
  url: string;
  finalUrl: string;
  html: string;
  htmlHash: string;
  via: "direct" | "proxy";
  fetchedAt: number;
};

export type ImportSession = {
  authorized(path: string, init?: { method?: string; body?: unknown }): Promise<unknown>;
};

/** A link a cook could plausibly have pasted. Checked before spending a request
 *  — and deliberately permissive, because the server's guard is the real one. */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname.includes(".") && parsed.hostname.length > 3;
  } catch {
    return false;
  }
}

/** Accepts what a share sheet or a browser actually puts on the clipboard. */
export function tidyUrl(input: string): string {
  let text = input.trim();
  // A pasted link is often wrapped in angle brackets or followed by prose.
  const match = /https?:\/\/[^\s<>"')]+/i.exec(text);
  if (match) text = match[0];
  return text.replace(/[.,;:]+$/, "");
}

export async function fetchPageForImport(session: ImportSession, rawUrl: string): Promise<FetchedPage> {
  const url = tidyUrl(rawUrl);
  const body = (await session.authorized("/api/v1/import/fetch", { method: "POST", body: { url } })) as FetchedPage;
  if (!body || typeof body.html !== "string" || body.html.length === 0) {
    throw new AuthApiError(502, "unsupported_response", "That page came back empty.");
  }
  return body;
}

/**
 * What each failure says to a cook.
 *
 * Pure, and separate from the screen, because the useful thing to say differs
 * per cause and the useless thing — "import failed" — is what you get when
 * they are all handled together. Every message names something the cook can
 * actually do next, and none of them blames them.
 */
export function describeImportError(err: unknown): Message {
  if (err instanceof AuthNetworkError) {
    return {
      title: "No connection",
      detail: "RecipeBox could not reach the server. Your recipes are on this device and still work; try the link again when you are back online.",
      tone: "attention",
    };
  }
  if (!(err instanceof AuthApiError)) {
    return { title: "Something went wrong", detail: "Try the link again in a moment.", tone: "danger" };
  }
  switch (err.code) {
    case "bad_url":
      return { title: "That link cannot be imported", detail: "It needs to be a public recipe page — a link starting http:// or https:// that anyone could open.", tone: "danger" };
    case "not_html":
      return { title: "That is not a recipe page", detail: "The link points at a file rather than a page. Open the recipe in a browser and copy the link from the address bar.", tone: "attention" };
    case "too_large":
      return { title: "That page is too big to read", detail: "Copy the recipe text instead and paste it in.", tone: "attention" };
    case "blocked":
      return { title: "That site will not let us read it", detail: "Some publishers block automated readers. Copy the recipe text and paste it in — nothing is wrong with the link.", tone: "attention" };
    case "upstream_timeout":
      return { title: "That site took too long", detail: "It may be slow rather than broken. Try again, or paste the recipe text.", tone: "attention" };
    case "upstream_unreachable":
      return { title: "That page could not be reached", detail: "Check the link is right. If it opens in a browser, try again in a moment.", tone: "attention" };
    case "rate_limited":
      return { title: "Too many imports just now", detail: "Wait a few minutes and try again.", tone: "attention", retryAfter: err.retryAfter ?? undefined };
    case "unauthorized":
    case "token_expired":
    case "refresh_invalid":
      return { title: "Your session has ended", detail: "Sign in again to import. Nothing on this device has changed.", tone: "attention" };
    case "database_unavailable":
      return { title: "RecipeBox is unavailable", detail: "The server is not accepting imports right now. Try again shortly.", tone: "attention" };
    case "not_found":
    case "unsupported_response":
      return { title: "No import server", detail: "This copy of RecipeBox is not connected to a RecipeBox server, so links cannot be fetched. Writing a recipe out still works.", tone: "attention" };
    default:
      return { title: "Something went wrong", detail: "Try the link again in a moment.", tone: "danger" };
  }
}

/** True when signing in again is what would fix it. */
export function needsSignIn(err: unknown): boolean {
  return err instanceof AuthApiError
    && (err.code === "unauthorized" || err.code === "token_expired" || err.code === "refresh_invalid");
}
